const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = source.indexOf('async function searchProductReceiptHistory(');
const end = source.indexOf('async function loadMoreProductReceiptHistory(', start);
const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, innerHTML: '', textContent: '', classList: { add() {} }, focus() {} });
  return nodes.get(id);
};
const calls = [], responses = [];
const product = { sku: 'CURSOR-SKU', name: 'Fixture' };
const context = vm.createContext({
  document: { getElementById: node }, selectedProductHistoryProduct: () => product,
  productHistoryState: {}, productHistoryRequestGeneration: 0, productHistoryBillRequestGeneration: 0,
  PRODUCT_HISTORY_PAGE_SIZE: 2, renderProductReceiptHistory() {},
  apiCall: async (action, payload) => { calls.push({ action, payload }); return responses.shift(); }
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  const newest = { itemId: 'item-3', grUid: 'reused-legacy', grId: 'receipt-3', receiptDate: '12/10/2026' };
  const middle = { itemId: 'item-2', grUid: 'reused-legacy', grId: 'receipt-2', receiptDate: '11/10/2026' };
  const oldest = { itemId: 'item-1', grUid: 'old', grId: 'receipt-1', receiptDate: '10/10/2026' };
  const cursor = { version: 1, snapshot: '2026-10-23T00:00:00Z', itemId: 'item-2', seen: 2 };
  responses.push({ success: true, orderVersion: 2, latest: newest, history: [newest, middle], total: 3, nextOffset: 2, nextCursor: cursor, hasMore: true });
  await context.searchProductReceiptHistory(true);
  assert.equal(calls[0].payload.cursor, null);
  responses.push({ success: true, orderVersion: 2, latest: newest, history: [middle, oldest], total: 3, nextOffset: 3, nextCursor: null, hasMore: false });
  await context.searchProductReceiptHistory(false);
  assert.equal(JSON.stringify(calls[1].payload.cursor), JSON.stringify(cursor));
  assert.equal(calls[1].payload.offset, 2);
  assert.equal(JSON.stringify(context.productHistoryState.history.map(row => row.itemId)), JSON.stringify(['item-3', 'item-2', 'item-1']), 'preserves server order and deduplicates by canonical item despite reused legacy UID');
  assert.equal(context.productHistoryState.latest.grId, 'receipt-3');
  responses.push({ success: true, latest: newest, history: [newest], total: 2, nextOffset: 1, hasMore: true });
  await context.searchProductReceiptHistory(true);
  assert.equal(calls[2].payload.cursor, null, 'new search resets cursor');
  responses.push({ success: true, latest: oldest, history: [oldest], total: 2, nextOffset: 2, hasMore: false });
  await context.searchProductReceiptHistory(false);
  assert.equal(calls[3].payload.offset, 1, 'old backend offset compatibility');
  assert.equal(context.productHistoryState.latest.grId, 'receipt-3', 'old backend page latest cannot overwrite first global summary');
  responses.push({ success: false, reason: 'invalid_history_cursor', message: 'ค้นหาใหม่' });
  await context.searchProductReceiptHistory(false);
  assert.equal(context.productHistoryState.error, 'ค้นหาใหม่');
  const preserved = JSON.stringify({ rows: context.productHistoryState.history, latest: context.productHistoryState.latest, total: context.productHistoryState.total });
  responses.push({ success: false, reason: 'history_changed', message: 'ประวัติมีการแก้ไข กรุณาค้นหาใหม่' });
  await context.searchProductReceiptHistory(false);
  assert.equal(JSON.stringify({ rows: context.productHistoryState.history, latest: context.productHistoryState.latest, total: context.productHistoryState.total }), preserved, 'invalidation preserves the coherent previous display');
  assert.equal(context.productHistoryState.hasMore, false);
  assert.equal(context.productHistoryState.nextCursor, null);
  responses.push({ success: true, orderVersion: 2, history: [oldest], latest: oldest, total: 1, hasMore: false });
  await context.searchProductReceiptHistory(true);
  assert.equal(context.productHistoryState.history.length, 1, 'refresh replaces invalidated collection');
  console.log('PASS history cursor: forwarding/reset, canonical deduplication, global latest, legacy offset and failure state');
})().catch(error => { console.error(error); process.exitCode = 1; });
