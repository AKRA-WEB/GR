const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TEST_SECRET = 'test-main-jwt-secret-at-least-32-characters';
const sharedPath = path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', '_shared', 'main-jwt.ts');
const apiPath = path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'gr-api', 'index.ts');

const rpcCalls = [];
const linePushBodies = [];
const lineTasks = [];

const sharedSource = fs.readFileSync(sharedPath, 'utf8')
  .replace(/^export\s+/gm, '');
const apiSource = fs.readFileSync(apiPath, 'utf8')
  .replace(/^import\b.*$/gm, '')
  .replace(/^declare const Deno:[\s\S]*?^};\r?\n/m, '')
  .replace(/^declare const EdgeRuntime:.*$/gm, '');

let handler = null;
const context = vm.createContext({
  console,
  URL,
  URLSearchParams,
  Headers,
  Request,
  Response,
  TextEncoder,
  TextDecoder,
  crypto: globalThis.crypto,
  atob,
  btoa,
  Date,
  JSON,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Error,
  Map,
  Set,
  Intl,
  EdgeRuntime: {
    waitUntil(task) { lineTasks.push(task); }
  },
  Deno: {
    env: {
      get(name) {
        return {
          MAIN_JWT_SECRET: TEST_SECRET,
          SUPABASE_URL: 'https://database.example',
          GR_SUPABASE_SECRET_KEY: 'server-only-key',
          GR_ALLOWED_ORIGINS: 'https://akra-web.github.io',
          LINE_TOKEN_COMPLETED: 'line-token',
          LINE_GROUP_COMPLETED: 'line-group'
        }[name];
      }
    },
    serve(fn) { handler = fn; }
  },
  fetch: async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/rest/v1/rpc/')) {
      assert.equal(options.headers.get('apikey'), 'server-only-key');
      assert.equal(options.headers.has('Authorization'), false, 'Modern sb_secret keys must never be sent as bearer JWTs');
      rpcCalls.push({ target, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (target.includes('/rest/v1/purchase_orders') || target.includes('/rest/v1/purchase_order_items') || target.includes('/rest/v1/goods_receipts')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'content-range': '0-0/0' }
      });
    }
    if (target === 'https://api.line.me/v2/bot/message/push') {
      linePushBodies.push(JSON.parse(options.body));
      return new Response('', { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  }
});

vm.runInContext(`${sharedSource}\n${apiSource}`, context);
assert.equal(typeof handler, 'function', 'Edge Function handler must register');

function invoke(body, origin = 'https://akra-web.github.io') {
  return handler(new Request('https://database.example/functions/v1/gr-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body)
  }));
}

(async () => {
  const approverToken = await context.signMainJwt({
    id: 'A1',
    name: 'Approver',
    roles: ['SUPERVISOR'],
    perms: { 'app-gr': ['approveGR'] },
    exp: Math.floor(Date.now() / 1000) + 3600
  }, TEST_SECRET);

  const emptySupervisorToken = await context.signMainJwt({
    id: 'S1',
    name: 'Empty Supervisor',
    roles: ['SUPERVISOR'],
    perms: { 'app-gr': [] },
    exp: Math.floor(Date.now() / 1000) + 3600
  }, TEST_SECRET);

  const receiverToken = await context.signMainJwt({
    id: 'R1',
    name: 'Receiver',
    roles: ['WAREHOUSE'],
    perms: { 'app-gr': ['receiveGR'] },
    exp: Math.floor(Date.now() / 1000) + 3600
  }, TEST_SECRET);

  let response = await invoke({
    action: 'bulkReceivePO',
    token: receiverToken,
    data: { targetStatus: 'Pending Review', items: [{ uid: 'PO-1', expectedStatus: 'Pending GR', grQty: 1 }] }
  });
  assert.equal(response.status, 200);
  assert.match(rpcCalls.at(-1).target, /\/rpc\/gr_receive_v1$/);
  assert.equal(rpcCalls.at(-1).body.p_actor.id, 'R1');

  const beforeDenied = rpcCalls.length;
  response = await invoke({
    action: 'bulkReceivePO',
    token: receiverToken,
    data: { targetStatus: 'GR Completed', items: [{ uid: 'PO-1', expectedStatus: 'Pending GR', grQty: 1 }] }
  });
  assert.equal(response.status, 403, 'Receiver cannot approve a completed GR');
  assert.equal(rpcCalls.length, beforeDenied, 'Denied action must not reach PostgreSQL');

  response = await invoke({
    action: 'recallGR',
    token: emptySupervisorToken,
    data: { actionType: 'reset', poUids: ['PO-1'] }
  });
  assert.equal(response.status, 403, 'Explicit empty app-gr permissions must not use privileged-role fallback');
  assert.equal(rpcCalls.length, beforeDenied, 'Explicitly denied Supervisor must not reach PostgreSQL');

  response = await invoke({
    action: 'recallGR',
    token: approverToken,
    data: { actionType: 'reset', poUids: ['PO-1'] }
  });
  assert.equal(response.status, 200);
  assert.match(rpcCalls.at(-1).target, /\/rpc\/gr_recall_v1$/);

  response = await invoke({
    action: 'bulkReceivePO',
    token: approverToken,
    data: {
      targetStatus: 'GR Completed',
      receiverName: 'Receiving Employee',
      ata: '21/08/2026',
      groupInfo: { vendor: 'Vendor A', warehouse: 'W1' },
      items: [{ uid: 'PO-1', product: 'Product A', expectedStatus: 'Pending Review', grQty: 1, unit: 'EA', locIn: 'W1-1F-2', exp: '31/12/2026' }],
      extraItems: [{ sku: 'EX-1', product: 'Bonus A', grQty: 2, unit: 'ชิ้น', locIn: 'W2-2F-B', exp: '15/01/2027' }]
    }
  });
  assert.equal(response.status, 200);
  await Promise.all(lineTasks.splice(0));
  assert.equal(linePushBodies.length, 1, 'Completed GR must send one LINE notification');
  const completedLineText = linePushBodies[0].messages[0].text;
  assert.match(completedLineText, /ผู้รับลงสินค้า: Receiving Employee/, 'LINE must name the employee who received the goods');
  assert.doesNotMatch(completedLineText, /ผู้รับลงสินค้า: Approver/, 'LINE must not use the employee who clicked approval');
  assert.match(completedLineText, /1\. Product A จำนวน 1 EA \[W1-1F-2\] \| หมดอายุ: 31\/12\/2026/, 'LINE must format item with full location');
  assert.match(completedLineText, /2\. Bonus A \(ของแถม\/นอกบิล\) จำนวน 2 ชิ้น \[W2-2F-B\] \| หมดอายุ: 15\/01\/2027/, 'LINE must format extra item with full location');

  response = await invoke({ action: 'getInitialData', token: receiverToken, data: {} }, 'https://evil.example');
  assert.equal(response.status, 403, 'Rejected origin must return 403');

  console.log('PASS gr-edge-auth-runtime: origin, Main token, granular permission, full location in LINE, and RPC boundary enforced');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
