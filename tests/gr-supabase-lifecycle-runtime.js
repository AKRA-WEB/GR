const assert = require('node:assert/strict');
const path = require('node:path');

let handler;
global.Deno = {
  env: { get: name => ({
    MAIN_VERIFY_URL: 'https://main.example/exec',
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
  if (target.startsWith('https://main.example/exec')) {
    return { ok: true, json: async () => ({ valid: true, user: {
      id: 'A1', name: 'Approver', roles: ['SUPERVISOR'], perms: { 'app-gr': ['receiveGR', 'approveGR'] }
    } }) };
  }
  if (target.startsWith('https://database.example/rest/v1/')) {
    assert.equal(options.headers.get('apikey'), 'server-only-key');
    assert.equal(options.headers.has('Authorization'), false, 'Modern Supabase secrets use apikey only');
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
    assert.deepEqual(payload.items.map(item => item.uid), ['PO-B'], 'Only the submitted remainder may be mutated');
    const status = payload.targetStatus;
    po.items[1].status = status;
    const existing = po.receipts.find(row => row.ref_po_uid === 'PO-B');
    if (existing) existing.status = status;
    else po.receipts.push(receipt('B', 'item-b', 'PO-B', status));
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

require(path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'gr-api', 'index.ts'));

async function invoke(action, data) {
  const response = await handler(new Request('https://database.example/functions/v1/gr-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://akra-web.github.io' },
    body: JSON.stringify({ action, data, token: 'approver-token' })
  }));
  assert.equal(response.status, 200);
  return response.json();
}

(async () => {
  const boot = await invoke('bootstrap', { includeCompleted: true });
  assert.equal(boot.valid, true);
  let data = boot.initialData;
  assert.deepEqual(data.pendingPOs.map(item => item.uid), ['PO-B']);
  assert.deepEqual(data.grCompleted.map(item => item.uid), ['PO-A']);

  await invoke('bulkReceivePO', { targetStatus: 'Pending Review', items: [{ uid: 'PO-B', expectedStatus: 'Pending GR', grQty: 10 }] });
  data = await invoke('getInitialData', { includeCompleted: true });
  assert.deepEqual(data.pendingPOs.map(item => [item.uid, item.status]), [['PO-B', 'Pending Review']]);
  assert.deepEqual(data.grCompleted.map(item => item.uid), ['PO-A'], 'Receiving the remainder must preserve completed item A');

  await invoke('bulkReceivePO', { targetStatus: 'GR Completed', items: [{ uid: 'PO-B', expectedStatus: 'Pending Review', grQty: 10 }] });
  data = await invoke('getInitialData', { includeCompleted: true });
  assert.equal(data.pendingPOs.length, 0);
  assert.deepEqual(new Set(data.grCompleted.map(item => item.uid)), new Set(['PO-A', 'PO-B']));

  await invoke('recallGR', { actionType: 'reset', billRef: 'BILL-1', poUids: ['PO-B'] });
  data = await invoke('getInitialData', { includeCompleted: true });
  assert.deepEqual(new Set(data.pendingPOs.map(item => item.uid)), new Set(['PO-A', 'PO-B']));
  assert.equal(data.grCompleted.length, 0);
  console.log('PASS gr-supabase-lifecycle-runtime: partial, later receive, completion, refresh, and reset stay in one Supabase projection');
})().finally(() => {
  global.fetch = originalFetch;
  delete global.Deno;
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
