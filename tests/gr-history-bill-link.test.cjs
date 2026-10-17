const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const nodes = new Map();
const absentNodes = new Set();
function element(id) {
  if (absentNodes.has(id)) return null;
  if (!nodes.has(id)) {
    const classes = new Set(['hidden']);
    nodes.set(id, { id, value: '', innerHTML: '', innerText: '', textContent: '', disabled: false,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle() {} },
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      focus() { context.document.activeElement = this; } });
  }
  return nodes.get(id);
}
const context = vm.createContext({ console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval() {},
  window: { location: { hostname: '127.0.0.1', search: '?demo=1' }, addEventListener() {} }, navigator: { onLine: true },
  document: { activeElement: null, getElementById: element, addEventListener() {}, querySelectorAll() { return []; },
    createElement() { return element('created'); }, body: { classList: { add() {}, remove() {} } } },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, lucide: { createIcons() {} },
  fetch: async () => { throw new Error('No network allowed'); } });
context.window.localStorage = context.localStorage;
context.self = context.window;
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i)[1], context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/gr-dashboard-v2.js'), 'utf8'), context);

const receipt = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const row = { grUid: 'legacy-item', grId: receipt, grNumber: 'GR-TEST-001', receiptDateIso: '2025-02-03',
  receiptDate: '03/02/2025', sku: 'SKU', product: 'Product', quantity: 4, unit: 'ลัง' };
const bill = { grId: 'event-1', grIds: [receipt], grNumber: 'GR-TEST-001', poNumber: 'PO-1',
  ataDate: '2025-02-03', items: [{ sku: 'SKU', grQty: 4 }, { sku: 'OTHER-SKU', grQty: 9 }] };
context.productHistoryState = { product: { sku: 'SKU', name: 'Product' }, latest: row, history: [row], total: 1, nextOffset: 1 };
context.renderProductReceiptHistory();
assert.match(element('dashboard-product-results').innerHTML, /GR-TEST-001/, 'history must identify the originating bill');
assert.match(element('dashboard-product-results').innerHTML, /openProductHistoryBill/, 'history must offer the bill action');

(async () => {
  const calls = [];
  context.grDashboardState.analytics = { bills: [{ ...bill, grId: other, grIds: [other] }] };
  context.grDashboardState.renderedBillGroups = [];
  const dashboardBefore = JSON.stringify(context.grDashboardState);
  const historyBefore = JSON.stringify(context.productHistoryState);
  const button = element('history-button');
  button.textContent = 'ดูใบ GR'; button.focus();
  context.apiCall = async (action, query) => { calls.push({ action, query }); return { success: true, schemaVersion: 2, bills: [bill] }; };
  await context.openProductHistoryBill(0, button);
  assert.equal(calls[0].action, 'getGrDashboardAnalytics');
  assert.equal(calls[0].query.search, receipt, 'lookup uses canonical source receipt, never legacy item identity');
  assert.equal(calls[0].query.dateFrom, '2025-02-03');
  assert.equal(calls[0].query.dateTo, '2025-02-03');
  assert.equal(calls[0].query.preset, 'custom');
  assert.ok(calls[0].query.limit <= 20, 'one bounded page only');
  for (const key of ['warehouse', 'receiver', 'sku', 'issue', 'vendor']) assert.ok(!calls[0].query[key], 'dashboard filters must not leak');
  assert.equal(element('modal-bill-gr').innerText, 'GR-TEST-001');
  assert.match(element('modal-items-body').innerHTML, /OTHER-SKU/, 'popup shows whole bill, not selected SKU only');
  assert.equal(element('gr-bill-detail-modal').classList.contains('hidden'), false);
  context.closeGrBillDetailModal();
  assert.equal(context.document.activeElement, button, 'close restores the opening control');
  assert.equal(JSON.stringify(context.grDashboardState), dashboardBefore);
  assert.equal(JSON.stringify(context.productHistoryState), historyBefore);

  context.apiCall = async () => ({ success: true, schemaVersion: 2, bills: [{ ...bill, grId: other, grIds: [other] }] });
  await context.openProductHistoryBill(0, button);
  assert.equal(element('gr-bill-detail-modal').classList.contains('hidden'), true, 'no first-result fallback');
  assert.match(element('product-history-bill-status-0').textContent, /ไม่พบ/);
  context.apiCall = async () => ({ success: false, reason: 'permission_denied', message: 'ไม่มีสิทธิ์เปิดใบ GR' });
  await context.openProductHistoryBill(0, button);
  assert.match(element('product-history-bill-status-0').textContent, /ไม่มีสิทธิ์/);
  assert.equal(button.disabled, false, 'failed read can be retried');

  const deferred = [];
  context.productHistoryState.history.push({ ...row, grId: other });
  context.apiCall = () => new Promise(resolve => deferred.push(resolve));
  const first = context.openProductHistoryBill(0, button);
  const second = context.openProductHistoryBill(1, element('second-button'));
  deferred[1]({ success: true, schemaVersion: 2, bills: [{ ...bill, grId: other, grIds: [other], grNumber: 'GR-SECOND' }] });
  await second;
  deferred[0]({ success: true, schemaVersion: 2, bills: [bill] });
  await first;
  assert.equal(element('modal-bill-gr').innerText, 'GR-SECOND', 'older read cannot replace latest selection');
  context.closeGrBillDetailModal();

  const pending = context.openProductHistoryBill(0, button);
  context.closeGrBillDetailModal();
  deferred[2]({ success: true, schemaVersion: 2, bills: [bill] }); await pending;
  assert.equal(element('gr-bill-detail-modal').classList.contains('hidden'), true, 'closed request cannot reopen popup');

  button.isConnected = false;
  const replacement = element('product-history-bill-0');
  const rerendered = context.openProductHistoryBill(0, button);
  nodes.delete('product-history-bill-status-0');
  deferred[3]({ success: false, reason: 'permission_denied' }); await rerendered;
  assert.match(element('product-history-bill-status-0').textContent, /ไม่มีสิทธิ์/, 'pagination replacement gets visible error');
  const rerenderedSuccess = context.openProductHistoryBill(0, button);
  deferred[4]({ success: true, schemaVersion: 2, bills: [bill] }); await rerenderedSuccess;
  context.closeGrBillDetailModal();
  assert.equal(context.document.activeElement, replacement, 'pagination replacement receives return focus');

  const lateReplacement = context.openProductHistoryBill(0, replacement);
  deferred[5]({ success: true, schemaVersion: 2, bills: [bill] }); await lateReplacement;
  replacement.isConnected = false;
  nodes.delete('product-history-bill-0');
  const afterOpenButton = element('product-history-bill-0');
  context.closeGrBillDetailModal();
  assert.equal(context.document.activeElement, afterOpenButton, 'pagination after opening resolves focus at close');

  const paginationFailure = context.openProductHistoryBill(0, afterOpenButton);
  absentNodes.add('product-history-bill-status-0');
  context.productHistoryState.error = 'pagination failed';
  deferred[6]({ success: false, reason: 'permission_denied' }); await paginationFailure;
  assert.equal(element('gr-bill-detail-modal').classList.contains('hidden'), true, 'failed pagination cannot reopen removed history');
  absentNodes.delete('product-history-bill-status-0');
  delete context.productHistoryState.error;

  context.productHistoryState.history = [{ ...row, grId: '', grNumber: '' }];
  context.renderProductReceiptHistory();
  assert.doesNotMatch(element('dashboard-product-results').innerHTML, /openProductHistoryBill/);
  context.openGrBillDetailModal('unknown');
  assert.equal(element('gr-bill-detail-modal').classList.contains('hidden'), true, 'Approved GR unknown identity also fails closed');
  console.log('PASS GR history bill link: exact grouped identity, whole bill, filters, denial/retry, races, close, old response compatibility');
})().catch(error => { console.error(error); process.exitCode = 1; });
