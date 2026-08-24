const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const loadingStart = html.indexOf('function showDataLoading(');
const loadingEnd = html.indexOf('\n    const GR_CACHE_TTL', loadingStart);
const loadStart = html.indexOf('async function openReceiving(');
const loadEnd = html.indexOf('\n    function productHistoryOptionValue', loadStart);
assert.ok(loadingStart >= 0 && loadingEnd > loadingStart, 'GR loading-state functions must exist');
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'GR openReceiving must exist');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

const elements = new Map([
  ['data-loader', { classList: classList(['hidden']), setAttribute() {} }],
  ['data-loader-text', { innerText: '' }],
  ['data-loader-spinner', { classList: classList() }],
  ['data-loader-retry', { classList: classList(['hidden']) }],
  ['pending-count', { innerText: '' }],
  ['po-list-container', { innerHTML: '' }],
  ['r-status-filter', { value: '' }],
  ['product-history-view', { classList: classList(['hidden']) }]
]);
const context = vm.createContext({ console, Date });
Object.assign(context, {
  document: { getElementById(id) { return elements.get(id) || { classList: classList(), innerText: '', innerHTML: '', value: '', setAttribute() {} }; } },
  appData: { products: [], pendingPOs: [] },
  initialDataPrefetch: null,
  grDeliveryPlanningLoaded: false,
  grActiveDataRendered: false,
  grProductsLoaded: false,
  grCompletedLoaded: false,
  grCompletedLoadedFull: false,
  grCompletedHasMore: false,
  grCompletedNextOffset: 0,
  grCompletedLoadedFromCache: false,
  GR_CACHE_TTL: 1,
  GR_PRODUCTS_CACHE_TTL: 1,
  PERF_MODE: false,
  getCache() { return null; },
  setCache() {},
  showView() {},
  renderPOListSkeleton() {},
  groupPendingPOs() {},
  renderPOListForReceiving() {},
  showNotification() {},
  perfLog() {},
  loadGRDeliveryPlanningBackground() {},
  loadGRProductsBackground() {},
  async ensureCompletedLoaded() {},
  async apiCall() { return { success: false, message: 'session_not_ready' }; }
});
vm.runInContext(`${html.slice(loadingStart, loadingEnd)}\n${html.slice(loadStart, loadEnd)}`, context);

(async () => {
  await vm.runInContext('openReceiving(false)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), false, 'cold-start failure must keep a full-page status visible');
  assert.equal(elements.get('data-loader-spinner').classList.contains('hidden'), true, 'failure state must stop the spinner');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'), false, 'failure state must provide a retry action');
  assert.match(elements.get('data-loader-text').innerText, /ไม่สำเร็จ|เชื่อมต่อ/, 'failure state must explain that data did not load');

  context.apiCall = async () => ({ success: true, products: [], pendingPOs: [] });
  await vm.runInContext('openReceiving(true)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), true, 'successful retry must dismiss the loading state');

  elements.get('data-loader').classList.add('hidden');
  context.getCache = key => key === 'CACHE_GR_ACTIVE_DATA_V2' ? { products: [], pendingPOs: [] } : null;
  context.groupPendingPOs = () => { throw new Error('corrupt cache shape'); };
  context.grActiveDataRendered = false;
  context.apiCall = async () => ({ success: false, message: 'network_failed' });
  await vm.runInContext('openReceiving(false)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), false, 'unusable cache plus network failure must not leave an endless spinner or empty shell');
  assert.equal(elements.get('data-loader-spinner').classList.contains('hidden'), true, 'unusable cache failure must stop the spinner');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'), false, 'unusable cache failure must remain retryable');

  await vm.runInContext('openReceiving(true)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), false, 'failed retry after unusable cache must keep the retryable error visible');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'), false, 'failed retry after unusable cache must not expose an empty shell');

  elements.get('data-loader').classList.add('hidden');
  context.groupPendingPOs = () => {};
  context.grActiveDataRendered = false;
  await vm.runInContext('openReceiving(false)', context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'), true, 'usable cached UI must remain available when its background refresh fails');
  console.log('PASS gr-startup-loading-state: cold-start failures remain visible and retryable');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
