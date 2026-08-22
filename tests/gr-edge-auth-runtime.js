const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const vm = require('node:vm');

function transpileTsToJs(tsCode) {
  return tsCode
    .replace(/\r\n/g, '\n')
    .replace(/^import\b.*$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/^type\s+[A-Za-z0-9_]+\s*=.*$/gm, '')
    .replace(/declare\s+const\s+Deno[\s\S]*?;\n\};/g, '')
    .replace(/declare\s+const\s+EdgeRuntime[^;]+;/g, '')
    .replace(/new\s+Map<[^>\n]+>\(\)/g, 'new Map()')
    .replace(/new\s+Set<[^>\n]+>\(\)/g, 'new Set()')
    .replace(/\bas\s+[A-Za-z0-9_<>\[\]]+/g, '')
    .replace(/interface\s+[A-Za-z0-9_]+\s*\{[\s\S]*?\}/g, '')
    .replace(/\):\s*Promise<\{[\s\S]*?\}\s*>\s*\{/g, ') {')
    .replace(/\):\s*\{[\s\S]*?\}\s*\{/g, ') {')
    .replace(/\):\s*[A-Za-z0-9_<>\[\],| ]+\s*\{/g, ') {')
    .replace(/\(([A-Za-z0-9_$]+)\s*:\s*Record<string,\s*string>,\s*([A-Za-z0-9_$]+)\)\s*=>/g, '($1, $2) =>')
    .replace(/(function\s+[A-Za-z0-9_$]+\s*)\(([^)]*)\)/g, (match, fn, params) => {
      const cleaned = params.split(',').map(param => param.split(':')[0].trim()).join(', ');
      return fn + '(' + cleaned + ')';
    })
    .replace(/\(([A-Za-z0-9_$,\s:]+)\)\s*=>/g, (match, params) => {
      const cleaned = params.split(',').map(param => param.split(':')[0].trim()).join(', ');
      return '(' + cleaned + ') =>';
    })
    .replace(/\b(const|let|var)\s+([A-Za-z0-9_$]+)\s*:\s*[A-Za-z0-9_<>\[\],| ]+\s*=/g, '$1 $2 =')
    .replace(/catch\s*\(\s*([A-Za-z0-9_$]+)\s*:\s*[A-Za-z0-9_]+\s*\)/g, 'catch ($1)')
    .replace(/\)!([.;,\s\)])/g, ')$1')
    .replace(/([A-Za-z0-9_$]+)!([.;,\s\)])/g, '$1$2');
}

const sharedSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', '_shared', 'main-jwt.ts'), 'utf8');
const grSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'gr-api', 'index.ts'), 'utf8');
const executableSource = transpileTsToJs(`${sharedSource}\n${grSource}`);

let handler = null;
global.Deno = {
  env: {
    get(name) {
      return {
        MAIN_JWT_SECRET: 'test-main-jwt-secret-at-least-32-characters',
        SUPABASE_URL: 'https://database.example',
        GR_SUPABASE_SECRET_KEY: 'server-only-key',
        GR_ALLOWED_ORIGINS: 'https://akra-web.github.io',
        LINE_TOKEN_COMPLETED: 'line-token',
        LINE_GROUP_COMPLETED: 'line-group'
      }[name];
    }
  },
  serve(fn) { handler = fn; }
};

const originalFetch = global.fetch;
const rpcCalls = [];
const linePushBodies = [];
const lineTasks = [];
let sessionValid = true;
global.EdgeRuntime = { waitUntil(task) { lineTasks.push(task); } };
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('/rest/v1/rpc/')) {
    assert.equal(options.headers.get('apikey'), 'server-only-key');
    assert.equal(options.headers.has('Authorization'), false, 'Modern sb_secret keys must never be sent as bearer JWTs');
    rpcCalls.push({ target, body: JSON.parse(options.body) });
    if (target.endsWith('/rest/v1/rpc/auth_validate_session_v1')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ valid: sessionValid })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true })
    };
  }
  if (target === 'https://api.line.me/v2/bot/message/push') {
    linePushBodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, text: async () => '' };
  }
  throw new Error(`Unexpected fetch: ${target}`);
};

function signedToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    tokenVersion: 2,
    sessionVersion: 1,
    authorizationRevision: 'revision-1',
    ...user,
    exp: Date.now() + 60000
  })).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = nodeCrypto
    .createHmac('sha256', 'test-main-jwt-secret-at-least-32-characters')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

function invoke(body, origin = 'https://akra-web.github.io') {
  return handler(new Request('https://database.example/functions/v1/gr-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body)
  }));
}

(async () => {
  vm.runInThisContext(executableSource, { filename: 'gr-api.bundle.ts' });
  assert.equal(typeof handler, 'function', 'Edge Function handler must register');
  const receiverToken = signedToken({ id: 'R1', name: 'Receiver', roles: ['WAREHOUSE'], perms: { 'app-gr': ['receiveGR'] } });
  const emptySupervisorToken = signedToken({ id: 'S1', name: 'Empty Supervisor', roles: ['SUPERVISOR'], perms: { 'app-gr': [] } });
  const approverToken = signedToken({ id: 'A1', name: 'Approver', roles: ['SUPERVISOR'], perms: { 'app-gr': ['approveGR'] } });
  const forgedPayload = Buffer.from(JSON.stringify({
    id: 'attacker',
    name: 'Attacker',
    roles: ['SUPERVISOR'],
    perms: { 'app-gr': ['approveGR'] },
    exp: Date.now() + 60000
  })).toString('base64url');
  let response = await invoke({
    action: 'recallGR',
    token: `e30.${forgedPayload}.forged`,
    data: { actionType: 'reset', poUids: ['PO-1'] }
  });
  assert.equal(response.status, 401, 'Forged JWT must be rejected');
  assert.equal(rpcCalls.length, 0, 'Forged JWT must not reach PostgreSQL');

  const missingContractToken = signedToken({ id: 'S0', name: 'Missing Contract', roles: ['SUPERVISOR'], perms: {} });
  response = await invoke({
    action: 'recallGR',
    token: missingContractToken,
    data: { actionType: 'reset', poUids: ['PO-1'] }
  });
  assert.equal(response.status, 403, 'v2 token without app-gr grants must fail closed');
  assert.equal(rpcCalls.length, 0, 'Permission denial must happen before session or domain database access');

  sessionValid = false;
  const revokedToken = signedToken({ id: 'R0', name: 'Revoked', roles: ['WAREHOUSE'], perms: { 'app-gr': ['receiveGR'] } });
  response = await invoke({
    action: 'bulkReceivePO',
    token: revokedToken,
    data: { targetStatus: 'Pending Review', items: [{ uid: 'PO-1', expectedStatus: 'Pending GR', grQty: 1 }] }
  });
  assert.equal(response.status, 401, 'Revoked v2 session must be rejected');
  assert.equal(rpcCalls.length, 1, 'Revoked session may call only the private session validator');
  assert.match(rpcCalls[0].target, /\/rpc\/auth_validate_session_v1$/);
  sessionValid = true;

  response = await invoke({
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
      items: [{ uid: 'PO-1', product: 'Product A', expectedStatus: 'Pending Review', grQty: 1, unit: 'EA', locIn: 'W1-A1' }]
    }
  });
  assert.equal(response.status, 200);
  await Promise.all(lineTasks.splice(0));
  assert.equal(linePushBodies.length, 1, 'Completed GR must send one LINE notification');
  const completedLineText = linePushBodies[0].messages[0].text;
  assert.match(completedLineText, /ผู้รับลงสินค้า: Receiving Employee/, 'LINE must name the employee who received the goods');
  assert.doesNotMatch(completedLineText, /ผู้รับลงสินค้า: Approver/, 'LINE must not use the employee who clicked approval');

  const beforeOrigin = rpcCalls.length;
  response = await invoke({ action: 'getInitialData', token: receiverToken, data: {} }, 'https://evil.example');
  assert.equal(response.status, 403);
  assert.equal(rpcCalls.length, beforeOrigin, 'Rejected origin must not trigger data access');

  assert.equal(
    rpcCalls.filter(call => call.target.endsWith('/rest/v1/rpc/auth_validate_session_v1')).length,
    3,
    'Repeated requests with the same valid token must reuse the 30-second session validation cache'
  );

  console.log('PASS gr-edge-auth-runtime: origin, signed Main token, granular permission, and RPC boundary enforced');
})().finally(() => {
  global.fetch = originalFetch;
  delete global.Deno;
  delete global.EdgeRuntime;
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
