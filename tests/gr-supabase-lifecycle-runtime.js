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

function signedToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = nodeCrypto
    .createHmac('sha256', 'test-main-jwt-secret-at-least-32-characters')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

let handler;
global.Deno = {
  env: { get: name => ({
    MAIN_JWT_SECRET: 'test-main-jwt-secret-at-least-32-characters',
    SUPABASE_URL: 'https://database.example',
    GR_SUPABASE_SECRET_KEY: 'server-only-key',
    GR_ALLOWED_ORIGINS: 'https://akra-web.github.io'
  })[name] },
  serve: fn => { handler = fn; }
};

const po = {
  id: 'bill-1',
  legacy_uid: 'PO-A',
  po_number: 'PO-001',
  po_date: '2026-08-01',
  ref_pr_uid: 'BILL-1',
  vendor_name: 'Vendor',
  warehouse: 'W1',
  expected_date: '2026-08-20',
  status: 'Partial GR',
  remark: '',
  created_at: '2026-08-01T00:00:00Z',
  items: [
    { id: 'item-a', legacy_uid: 'PO-A', sku: 'SKU-A', product_name: 'A', po_qty: 10, unit: 'ลัง', status: 'GR Completed' },
    { id: 'item-b', legacy_uid: 'PO-B', sku: 'SKU-B', product_name: 'B', po_qty: 10, unit: 'ลัง', status: 'Pending GR' }
  ],
  receipts: [receipt('A', 'item-a', 'PO-A', 'GR Completed')]
};

function receipt(label, itemId, uid, status) {
  return {
    id: `receipt-${label}`,
    legacy_uid: uid,
    ref_po_uid: uid,
    ata_date: '2026-08-20',
    receiver: 'Receiver',
    status,
    remark: '',
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    gr_items: [{ id: `gr-item-${label}`, po_item_id: itemId, ref_po_item_uid: uid, gr_qty: 10, unit: 'ลัง', location_in: 'W1-A1', is_extra: false }]
  };
}

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.startsWith('https://database.example/rest/v1/')) {
    assert.equal(options.headers.get('apikey'), 'server-only-key');
    assert.equal(options.headers.has('Authorization'), false, 'Modern Supabase secrets use apikey only');
  }
  if (target.endsWith('/rest/v1/rpc/auth_validate_session_v1')) {
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ valid: true }) };
  }
  if (target.includes('/rest/v1/purchase_order_items?')) {
    return { ok: true, status: 200, headers: new Headers(), json: async () => [{ po_id: po.id }] };
  }
  if (target.includes('/rest/v1/goods_receipts?')) {
    return { ok: true, status: 200, headers: new Headers(), json: async () => po.receipts.length ? [{ po_id: po.id }] : [] };
  }
  if (target.includes('/rest/v1/purchase_orders?')) {
    return { ok: true, status: 200, headers: new Headers(), json: async () => [structuredClone(po)] };
  }
  if (target.endsWith('/rest/v1/rpc/gr_receive_v1')) {
    const payload = JSON.parse(options.body).p_payload;
    assert.deepEqual(payload.items.map(item => item.uid), ['item-b'], 'Only the submitted remainder may be mutated');
    const status = payload.targetStatus;
    po.items[1].status = status;
    const existing = po.receipts.find(row => row.ref_po_uid === 'PO-B' || row.ref_po_uid === 'item-b');
    if (existing) existing.status = status;
    else po.receipts.push(receipt('B', 'item-b', 'item-b', status));
    po.status = po.items.every(item => item.status === 'GR Completed') ? 'GR Completed' : 'Partial GR';
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true }) };
  }
  if (target.endsWith('/rest/v1/rpc/gr_recall_v1')) {
    po.items.forEach(item => { item.status = 'Pending GR'; });
    po.receipts = [];
    po.status = 'Pending GR';
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true }) };
  }
  throw new Error(`Unexpected fetch: ${target}`);
};

const sharedSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', '_shared', 'main-jwt.ts'),
  'utf8'
);
const grSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'gr-api', 'index.ts'),
  'utf8'
);
vm.runInThisContext(transpileTsToJs(`${sharedSource}\n${grSource}`), { filename: 'gr-api.bundle.ts' });

const approverToken = signedToken({
  tokenVersion: 2,
  sessionVersion: 1,
  authorizationRevision: 'revision-1',
  id: 'A1',
  name: 'Approver',
  roles: ['SUPERVISOR'],
  perms: { 'app-gr': ['receiveGR', 'approveGR'] },
  exp: Date.now() + 60000
});

async function invoke(action, data) {
  const response = await handler(new Request('https://database.example/functions/v1/gr-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://akra-web.github.io' },
    body: JSON.stringify({ action, data, token: approverToken })
  }));
  assert.equal(response.status, 200);
  return response.json();
}

(async () => {
  const boot = await invoke('bootstrap', { includeCompleted: true });
  assert.equal(boot.valid, true);
  let data = boot.initialData;
  assert.deepEqual(data.pendingPOs.map(item => item.uid), ['item-b']);
  assert.deepEqual(data.grCompleted.map(item => item.uid), ['item-a']);

  await invoke('bulkReceivePO', { targetStatus: 'Pending Review', items: [{ uid: 'item-b', expectedStatus: 'Pending GR', grQty: 10 }] });
  data = await invoke('getInitialData', { includeCompleted: true });
  assert.deepEqual(data.pendingPOs.map(item => [item.uid, item.status]), [['item-b', 'Pending Review']]);
  assert.deepEqual(data.grCompleted.map(item => item.uid), ['item-a'], 'Receiving the remainder must preserve completed item A');

  await invoke('bulkReceivePO', { targetStatus: 'GR Completed', items: [{ uid: 'item-b', expectedStatus: 'Pending Review', grQty: 10 }] });
  data = await invoke('getInitialData', { includeCompleted: true });
  assert.equal(data.pendingPOs.length, 0);
  assert.deepEqual(new Set(data.grCompleted.map(item => item.uid)), new Set(['item-a', 'item-b']));

  await invoke('recallGR', { actionType: 'reset', billRef: 'BILL-1', poUids: ['item-b'] });
  data = await invoke('getInitialData', { includeCompleted: true });
  assert.deepEqual(new Set(data.pendingPOs.map(item => item.uid)), new Set(['item-a', 'item-b']));
  assert.equal(data.grCompleted.length, 0);
  console.log('PASS gr-supabase-lifecycle-runtime: partial, later receive, completion, refresh, and reset stay in one Supabase projection');
})().finally(() => {
  global.fetch = originalFetch;
  delete global.Deno;
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
