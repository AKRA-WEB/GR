const assert = require('node:assert/strict');
const path = require('node:path');

let handler = null;
global.Deno = {
  env: {
    get(name) {
      return {
        MAIN_VERIFY_URL: 'https://main.example/exec',
        SUPABASE_URL: 'https://database.example',
        GR_SUPABASE_SECRET_KEY: 'server-only-key',
        GR_ALLOWED_ORIGINS: 'https://akra-web.github.io'
      }[name];
    }
  },
  serve(fn) { handler = fn; }
};

const originalFetch = global.fetch;
const rpcCalls = [];
let verifyCalls = 0;
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.startsWith('https://main.example/exec')) {
    verifyCalls++;
    const token = new URL(target).searchParams.get('token');
    const user = token === 'approver-token'
      ? { id: 'A1', name: 'Approver', roles: ['SUPERVISOR'], perms: { 'app-gr': ['approveGR'] } }
      : token === 'empty-supervisor-token'
        ? { id: 'S1', name: 'Empty Supervisor', roles: ['SUPERVISOR'], perms: { 'app-gr': [] } }
      : { id: 'R1', name: 'Receiver', roles: ['WAREHOUSE'], perms: { 'app-gr': ['receiveGR'] } };
    return { ok: true, json: async () => ({ valid: true, user }) };
  }
  if (target.includes('/rest/v1/rpc/')) {
    assert.equal(options.headers.get('apikey'), 'server-only-key');
    assert.equal(options.headers.has('Authorization'), false, 'Modern sb_secret keys must never be sent as bearer JWTs');
    rpcCalls.push({ target, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true })
    };
  }
  throw new Error(`Unexpected fetch: ${target}`);
};

require(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'gr-api', 'index.ts'));
assert.equal(typeof handler, 'function', 'Edge Function handler must register');

function invoke(body, origin = 'https://akra-web.github.io') {
  return handler(new Request('https://database.example/functions/v1/gr-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body)
  }));
}

(async () => {
  let response = await invoke({
    action: 'bulkReceivePO',
    token: 'receiver-token',
    data: { targetStatus: 'Pending Review', items: [{ uid: 'PO-1', expectedStatus: 'Pending GR', grQty: 1 }] }
  });
  assert.equal(response.status, 200);
  assert.match(rpcCalls.at(-1).target, /\/rpc\/gr_receive_v1$/);
  assert.equal(rpcCalls.at(-1).body.p_actor.id, 'R1');

  const beforeDenied = rpcCalls.length;
  response = await invoke({
    action: 'bulkReceivePO',
    token: 'receiver-token',
    data: { targetStatus: 'GR Completed', items: [{ uid: 'PO-1', expectedStatus: 'Pending GR', grQty: 1 }] }
  });
  assert.equal(response.status, 403, 'Receiver cannot approve a completed GR');
  assert.equal(rpcCalls.length, beforeDenied, 'Denied action must not reach PostgreSQL');

  response = await invoke({
    action: 'recallGR',
    token: 'empty-supervisor-token',
    data: { actionType: 'reset', poUids: ['PO-1'] }
  });
  assert.equal(response.status, 403, 'Explicit empty app-gr permissions must not use privileged-role fallback');
  assert.equal(rpcCalls.length, beforeDenied, 'Explicitly denied Supervisor must not reach PostgreSQL');

  response = await invoke({
    action: 'recallGR',
    token: 'approver-token',
    data: { actionType: 'reset', poUids: ['PO-1'] }
  });
  assert.equal(response.status, 200);
  assert.match(rpcCalls.at(-1).target, /\/rpc\/gr_recall_v1$/);

  const beforeOrigin = verifyCalls;
  response = await invoke({ action: 'getInitialData', token: 'receiver-token', data: {} }, 'https://evil.example');
  assert.equal(response.status, 403);
  assert.equal(verifyCalls, beforeOrigin, 'Rejected origin must not trigger authentication or data access');

  assert.equal(verifyCalls, 3, 'Repeated receiver actions should reuse the short Main verification cache');
  console.log('PASS gr-edge-auth-runtime: origin, Main token, granular permission, cache, and RPC boundary enforced');
})().finally(() => {
  global.fetch = originalFetch;
  delete global.Deno;
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
