const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cacheStart = html.indexOf('const GR_CACHE_TTL =');
const cacheEnd = html.indexOf('function mergeDeliveryPlanningIntoPendingPOs', cacheStart);
const versionStart = html.indexOf('const CURRENT_VERSION =');
const versionEnd = html.indexOf('    var APP_CONFIG = {', versionStart);
const reconciliationStart = html.indexOf('    async function openReceivingInBackground()');
const reconciliationEnd = html.indexOf('    function parseDateToInput', reconciliationStart);
const autocompleteStart = html.indexOf('    function setupAutocomplete(inputEl)');
const autocompleteEnd = html.indexOf('    function initExpiryInputPreview', autocompleteStart);
assert.ok(cacheStart >= 0 && cacheEnd > cacheStart, 'cache and read-coordination functions must exist');
assert.ok(versionStart >= 0 && versionEnd > versionStart, 'version guard functions must exist');
assert.ok(reconciliationStart >= 0 && reconciliationEnd > reconciliationStart, 'post-save reconciliation function must exist');
assert.ok(autocompleteStart >= 0 && autocompleteEnd > autocompleteStart, 'extra-item autocomplete must exist');
const cacheSource = html.slice(cacheStart, cacheEnd);
const versionSource = html.slice(versionStart, versionEnd);
const reconciliationSource = html.slice(reconciliationStart, reconciliationEnd);
const autocompleteSource = html.slice(autocompleteStart, autocompleteEnd);
const userA = { identityId: '11111111-1111-4111-8111-111111111111', sessionVersion: 1, authorizationRevision: 'auth-a' };
const userB = { identityId: '22222222-2222-4222-8222-222222222222', sessionVersion: 2, authorizationRevision: 'auth-b' };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeStorage() {
  const values = new Map();
  return {
    values,
    quotaBytes: Infinity,
    failNextWrite: false,
    writeAttempts: 0,
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) {
      this.writeAttempts++;
      if (this.failNextWrite) { this.failNextWrite = false; throw Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 }); }
      const raw = String(value);
      let size = 0;
      for (const [entryKey, entryValue] of values) size += entryKey === key ? 0 : new TextEncoder().encode(entryValue).length;
      if (size + new TextEncoder().encode(raw).length > this.quotaBytes) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 });
      values.set(key, raw);
    }
  };
}

function cacheContext(options = {}) {
  const localStorage = options.storage || makeStorage();
  const window = { appSession: options.session || userA };
  const context = vm.createContext({
    console: { warn() {} }, Date, TextEncoder, Promise, Map, Set, Object, Array, JSON, Number, String, Math, RegExp, encodeURIComponent,
    window, localStorage, appData: { products: [] }, grActiveDataRequests: new Map(), grActiveReadEpoch: 0,
    grReconcilingBillKeys: new Map(), grDashboardState: { loaded: false, analytics: null }, grReconciliationRetryPromise: null,
    grActiveDataRequestGeneration: 0, grCompletedLoaded: false, grCompletedLoadedFull: false, grCompletedHasMore: false,
    grCompletedNextOffset: 0, grCompletedLoadedFromCache: false, grDeliveryPlanningLoaded: false,
    grDeliveryPlanRenderPending: false, groupPendingPOs() {}, renderPOListForReceiving() {}, loadGRDeliveryPlanningBackground() {},
    PERF_MODE: false, perfLog() {}, document: { getElementById() { return null; } },
    apiCall: options.apiCall || (async () => ({ success: false, message: 'network_failed' }))
  });
  vm.runInContext(cacheSource, context, { filename: 'GR cache/read functions' });
  vm.runInContext(reconciliationSource, context, { filename: 'GR post-save reconciliation' });
  return context;
}

function browserNode() {
  const children = [];
  return {
    id: '', className: '', textContent: '', disabled: false, children,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, focus() {},
    appendChild(child) { children.push(child); },
    querySelector() { return { focus() {} }; }
  };
}

function versionContext(fetch) {
  const elements = new Map();
  const startupEffects = { alerts: [], replacements: [] };
  const document = {
    head: browserNode(), body: browserNode(),
    getElementById(id) { return elements.get(id) || null; },
    createElement() { return browserNode(); }, addEventListener() {}
  };
  document.head.appendChild = child => { document.head.children.push(child); if (child.id) elements.set(child.id, child); };
  document.body.appendChild = child => { document.body.children.push(child); if (child.id) elements.set(child.id, child); };
  const context = vm.createContext({
    console: { warn() {} }, Date, URL, URLSearchParams, Promise, setTimeout, clearTimeout, AbortController, fetch, document,
    window: { location: { href: 'https://example.test/gr/', search: '', replace(url) { startupEffects.replacements.push(String(url)); } }, addEventListener() {} },
    alert(message) { startupEffects.alerts.push(message); }, setInterval() { return 1; }
  });
  vm.runInContext(versionSource.replace('const VERSION_CHECK_TIMEOUT_MS = 5000;', 'const VERSION_CHECK_TIMEOUT_MS = 10;'), context, { filename: 'GR version guard' });
  const guard = vm.runInContext('AppVersionGuard', context);
  guard.checkStartupVersion = () => vm.runInContext('checkAppVersion()', context);
  guard.startupEffects = startupEffects;
  return guard;
}

function autocompleteContext() {
  const productInputs = { sku: { value: '' }, unit: { value: '' }, qty: { focused: false, focus() { this.focused = true; } } };
  const row = { querySelector(selector) { return selector === '.ex-sku' ? productInputs.sku : selector === '.ex-unit' ? productInputs.unit : productInputs.qty; } };
  const events = {}, attributes = new Map();
  const input = {
    value: '', dataset: {}, nextElementSibling: { nextElementSibling: null },
    addEventListener(type, handler) { events[type] = handler; },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) || null; },
    removeAttribute(name) { attributes.delete(name); }, closest() { return row; }
  };
  const classes = new Set(['hidden']);
  const suggestionBox = {
    children: [],
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
    appendChild(option) { this.children.push(option); },
    set innerHTML(value) { this.children = []; }, get innerHTML() { return ''; }
  };
  input.nextElementSibling.nextElementSibling = suggestionBox;
  const context = vm.createContext({
    appData: { products: [] },
    normalizeGRProductText(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); },
    getGRProductSearchIndex() { return context.appData.products.map(product => ({ product, name: product.name.toLowerCase(), sku: product.sku.toLowerCase() })); },
    esc(value) { return String(value); },
    document: { createElement() { const listeners = {}; const attrs = new Map(); return { className: '', id: '', innerHTML: '', listeners, addEventListener(type, handler) { listeners[type] = handler; }, setAttribute(name, value) { attrs.set(name, value); }, getAttribute(name) { return attrs.get(name) || null; }, classList: { toggle() {} }, scrollIntoView() {} }; } },
    setTimeout(callback) { return 1; }
  });
  vm.runInContext(autocompleteSource, context, { filename: 'GR extra-item autocomplete' });
  return { context, input, events, suggestionBox, productInputs };
}

test('quota recovery evicts only bounded disposable GR cache and preserves other app data', () => {
  const storage = makeStorage();
  const context = cacheContext({ storage });
  const productKey = context.cacheStorageKey('CACHE_GR_PRODUCTS_V1');
  const otherAppKey = 'akra_main_session';
  const oldProducts = JSON.stringify({ _ts: Date.now(), _d: { products: [{ name: 'x'.repeat(5000) }] } });
  storage.values.set(productKey, oldProducts);
  storage.values.set(otherAppKey, 'other app record');
  const active = { pendingPOs: [{ uid: 'p-1' }] };
  const incomingBytes = new TextEncoder().encode(JSON.stringify({ _ts: Date.now(), _d: active })).length;
  storage.quotaBytes = new TextEncoder().encode(oldProducts).length + new TextEncoder().encode('other app record').length + incomingBytes - 1;
  assert.equal(context.setCache('CACHE_GR_ACTIVE_DATA_V3', active), true);
  assert.equal(storage.values.has(productKey), false, 'oldest disposable GR cache should be evicted to recover quota');
  assert.equal(storage.values.get(otherAppKey), 'other app record');
  assert.equal(storage.writeAttempts, 2, 'cache write retries at most once');
});

test('other-app-only quota exhaustion keeps a memory-only path and leaves those keys untouched', () => {
  const storage = makeStorage();
  storage.values.set('akra_gr_session', 'signed session record');
  storage.values.set('akra_main_data', 'protected record');
  storage.quotaBytes = 1;
  const context = cacheContext({ storage });
  assert.equal(context.setCache('CACHE_GR_ACTIVE_DATA_V3', { pendingPOs: [] }), false);
  assert.equal(storage.values.get('akra_gr_session'), 'signed session record');
  assert.equal(storage.values.get('akra_main_data'), 'protected record');
  assert.equal(storage.values.size, 2);
  assert.equal(storage.writeAttempts, 2);
});

test('denied browser storage cannot interrupt the live data path', () => {
  const denied = {
    get length() { throw new Error('storage access denied'); },
    key() { throw new Error('storage access denied'); },
    getItem() { throw new Error('storage access denied'); },
    setItem() { throw new Error('storage access denied'); },
    removeItem() { throw new Error('storage access denied'); }
  };
  const context = cacheContext({ storage: denied });
  assert.doesNotThrow(() => context.getCache('CACHE_GR_ACTIVE_DATA_V3', 1000));
  assert.equal(context.setCache('CACHE_GR_ACTIVE_DATA_V3', { pendingPOs: [] }), false);
});

test('oversized catalog entry is skipped before touching storage', () => {
  const storage = makeStorage();
  const context = cacheContext({ storage });
  assert.equal(context.setCache('CACHE_GR_PRODUCTS_V1', { products: ['x'.repeat(2 * 1024 * 1024)] }), false);
  assert.equal(storage.writeAttempts, 0);
});

test('extra-item suggestions are capped and support keyboard and touch selection with SKU/unit identity', () => {
  const f = autocompleteContext();
  f.context.appData.products = Array.from({ length: 40 }, (_, index) => ({ sku: `SKU-${String(index).padStart(3, '0')}`, name: `Product ${index}`, unit: `unit-${index}` }));
  f.input.setAttribute('aria-controls', 'product-options');
  f.context.setupAutocomplete(f.input);
  f.input.value = 'sku-';
  f.events.input.call(f.input);
  assert.equal(f.suggestionBox.children.length, 15);
  assert.equal(f.input.getAttribute('aria-expanded'), 'true');
  assert.equal(f.suggestionBox.children[0].getAttribute('role'), 'option');
  let prevented = false;
  f.events.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
  f.events.keydown({ key: 'ArrowDown', preventDefault() {} });
  f.events.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(prevented, true);
  assert.equal(f.input.value, 'Product 1');
  assert.equal(f.productInputs.sku.value, 'SKU-001');
  assert.equal(f.productInputs.unit.value, 'unit-1');
  assert.equal(f.input.dataset.selectedSku, 'SKU-001');
  assert.equal(f.productInputs.qty.focused, true);
  assert.equal(f.input.getAttribute('aria-expanded'), 'false');

  f.input.value = 'manually entered product';
  f.events.input.call(f.input);
  assert.equal(f.input.dataset.selectedSku, undefined, 'manual text clears the selected product identity');
  assert.equal(f.input.dataset.selectedUnit, undefined, 'manual text clears the selected product unit');
  assert.equal(f.productInputs.sku.value, '', 'manual text does not retain a stale SKU');
  assert.equal(f.productInputs.unit.value, '', 'manual text does not retain a stale unit');

  const touch = autocompleteContext();
  touch.context.appData.products = [{ sku: 'SKU-T', name: 'Touch Product', unit: 'bag' }];
  touch.input.setAttribute('aria-controls', 'touch-options');
  touch.context.setupAutocomplete(touch.input);
  touch.input.value = 'touch';
  touch.events.input.call(touch.input);
  touch.suggestionBox.children[0].listeners.click();
  assert.equal(touch.input.value, 'Touch Product');
  assert.equal(touch.productInputs.sku.value, 'SKU-T');
  assert.equal(touch.productInputs.unit.value, 'bag');
  assert.equal(touch.input.dataset.selectedSku, 'SKU-T');
});

test('catalog callers share one request and a changed session cannot receive the previous response', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const context = cacheContext({ apiCall: () => (++calls === 1 ? first.promise : second.promise) });
  const a = context.loadGRProductsBackground();
  const concurrent = context.loadGRProductsBackground();
  await Promise.resolve();
  assert.equal(calls, 1);
  context.window.appSession = userB;
  const newSession = context.loadGRProductsBackground();
  await Promise.resolve();
  assert.deepEqual(Array.from(context.appData.products), [], 'old catalog is cleared before loading a different session');
  first.resolve({ success: true, products: [{ sku: 'A', name: 'old user item' }] });
  await a; await concurrent;
  assert.deepEqual(Array.from(context.appData.products), [], 'late response from the previous session is ignored');
  second.resolve({ success: true, products: [{ sku: 'B', name: 'new user item' }] });
  await newSession;
  assert.equal(context.appData.products[0].sku, 'B');
});

test('cached catalog stays usable when the required opening refresh fails', async () => {
  const storage = makeStorage();
  const context = cacheContext({ storage, apiCall: async () => ({ success: false, error: 'network_failed' }) });
  const key = context.cacheStorageKey('CACHE_GR_PRODUCTS_V1');
  storage.values.set(key, JSON.stringify({ _ts: Date.now(), _d: { products: [{ sku: 'SKU-CACHED', name: 'Cached item' }] } }));
  await context.loadGRProductsBackground();
  assert.equal(context.grProductsLoaded, true);
  assert.equal(context.grProductsLoadedFromFreshFetch, false);
  assert.equal(context.grProductsRefreshError, 'network_failed');
  assert.equal(context.appData.products[0].sku, 'SKU-CACHED');
});

test('active reads coalesce by session/options, retain bootstrap prefetches, then separate after a successful write epoch', async () => {
  const reads = [deferred(), deferred()];
  let calls = 0;
  const context = cacheContext({ apiCall: () => reads[calls++].promise });
  const options = { includeCompleted: false, includeProducts: false, includeDeliveryPlanning: false, bypassCache: false, perf: false };
  const first = context.readGRActiveData(options);
  const shared = context.readGRActiveData(options);
  await Promise.resolve();
  assert.equal(calls, 1);
  context.grActiveReadEpoch++;
  const afterSave = context.readGRActiveData(options);
  await Promise.resolve();
  assert.equal(calls, 2, 'post-write reconciliation must not share a pre-write read');
  reads[0].resolve({ success: true, pendingPOs: [{ uid: 'stale' }] });
  reads[1].resolve({ success: true, pendingPOs: [{ uid: 'fresh' }] });
  await Promise.all([first, shared, afterSave]);
  assert.equal(context.grActiveDataRequests.size, 0);
  const bootstrap = Promise.resolve({ success: true, pendingPOs: [{ uid: 'bootstrap' }] });
  const prefetched = context.readGRActiveData(options, bootstrap);
  const samePrefetch = context.readGRActiveData(options);
  assert.equal((await prefetched).pendingPOs[0].uid, 'bootstrap');
  assert.equal((await samePrefetch).pendingPOs[0].uid, 'bootstrap');
  assert.equal(calls, 2, 'coalesced bootstrap data must avoid a duplicate active request');
});

test('failed reconciliation keeps the saved bill locked and retry performs only an authoritative read', async () => {
  const actions = [];
  const context = cacheContext({ apiCall: async action => { actions.push(action); return { success: false, error: 'network_failed' }; } });
  context.grReconcilingBillKeys.set('bill:po-1', context.grSessionCacheScope());
  assert.equal(await context.openReceivingInBackground(), false);
  assert.equal(context.hasPendingGRReconciliation(), true);
  assert.equal(await context.retryGRReconciliation(), false);
  assert.equal(context.hasPendingGRReconciliation(), true);
  assert.deepEqual(actions, ['getInitialData', 'getInitialData']);
  assert.ok(actions.every(action => action !== 'bulkReceivePO'), 'retry never repeats the committed write');
});

test('an out-of-session reconciliation result cannot replace active data', async () => {
  const request = deferred();
  const context = cacheContext({ apiCall: () => request.promise });
  context.appData.pendingPOs = [{ uid: 'current-session-data' }];
  const refresh = context.openReceivingInBackground();
  await Promise.resolve();
  context.window.appSession = userB;
  request.resolve({ success: true, pendingPOs: [{ uid: 'old-session-response' }] });
  assert.equal(await refresh, false);
  assert.equal(context.appData.pendingPOs[0].uid, 'current-session-data');
});

test('delivery-planning reads bypass version fetches, while a hanging mutation check times out under existing fail-open policy', async () => {
  let fetchCalls = 0;
  const guard = versionContext(async () => { fetchCalls++; return { ok: true, async json() { return { version: 'v1' }; } }; });
  guard.start({ current: 'v1', readActions: ['getDeliveryPlanning'] });
  assert.equal(await guard.blockIfStale('getDeliveryPlanning'), false);
  assert.equal(fetchCalls, 0);

  let signal;
  const hanging = versionContext((url, options) => { signal = options.signal; return new Promise(() => {}); });
  hanging.start({ current: 'v1', readActions: [] });
  assert.equal(await hanging.blockIfStale('bulkReceivePO'), false, 'failed version fetch keeps the existing policy');
  assert.equal(signal.aborted, true, 'the timed-out request is aborted');

  let bodySignal;
  const hangingBody = versionContext((url, options) => {
    bodySignal = options.signal;
    return Promise.resolve({ ok: true, json() { return new Promise(() => {}); } });
  });
  hangingBody.start({ current: 'v1', readActions: [] });
  assert.equal(await hangingBody.blockIfStale('bulkReceivePO'), false, 'a stalled version response body keeps the existing fail-open policy');
  assert.equal(bodySignal.aborted, true, 'the response body is also bounded by the timeout');
});

test('confirmed version mismatch blocks a mutation and identical concurrent checks share one fetch', async () => {
  let calls = 0;
  const stale = versionContext(async () => { calls++; return { ok: true, async json() { return { version: 'v2' }; } }; });
  stale.start({ current: 'v1', readActions: [] });
  assert.equal(await stale.blockIfStale('bulkReceivePO'), true);
  assert.equal(calls, 1);

  const startupMismatch = versionContext(async () => ({ ok: true, json: async () => ({ version: 'old-version' }) }));
  assert.equal(await startupMismatch.checkStartupVersion(), false, 'startup parsing retains its mismatch redirect behavior');
  assert.equal(startupMismatch.startupEffects.alerts.length, 1);
  assert.equal(startupMismatch.startupEffects.replacements.length, 1);

  const startupUnavailable = versionContext(() => Promise.reject(new Error('offline')));
  assert.equal(await startupUnavailable.checkStartupVersion(), true, 'startup keeps the existing fail-open version-fetch policy');

  const response = deferred();
  calls = 0;
  const guard = versionContext(() => { calls++; return response.promise; });
  guard.start({ current: 'v1', readActions: [] });
  const one = guard.check(), two = guard.check();
  await Promise.resolve();
  response.resolve({ ok: true, async json() { return { version: 'v1' }; } });
  assert.deepEqual(await Promise.all([one, two]), [true, true]);
  assert.equal(calls, 1);
});
