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
  ['receiving-list-view', { classList: classList(['hidden']) }]
]);
const rendered = [], calls = [];
elements.set('gr-load-error', {classList:classList(['hidden']),innerHTML:''});
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
  grActiveDataRequestGeneration: 0,
  grSessionCacheScope() { return 'test-session'; },
  readGRActiveData(options) { return context.apiCall('getInitialData', options); },
  reconciliationClearCount: 0,
  clearCurrentGRReconciliations() { context.reconciliationClearCount++; },
  hasPendingGRReconciliation() { return false; },
  renderGRReconciliationNotice() {},
  grProductsDataScope: null,
  grProductsLoadedFromFreshFetch: false,
  grProductsRequestedScope: null,
  GR_CACHE_TTL: 1,
  GR_PRODUCTS_CACHE_TTL: 1,
  PERF_MODE: false,
  getCache() { return null; },
  setCache() {},
  showView() {},
  renderPOListSkeleton() {},
  groupPendingPOs() {},
  renderPOListForReceiving() { rendered.push(JSON.parse(JSON.stringify(context.appData.pendingPOs))); },
  showNotification() {},
  perfLog() {},
  loadGRDeliveryPlanningBackground() {},
  restoreGRDeliveryPlanning() {},
  loadGRProductsBackground() {},
  async ensureCompletedLoaded() {},
  async apiCall(action,options) { calls.push({action,options}); return { success:false,reason:'internal_error',status:500,message:'fixture-private' }; }
});
const classifierSource=html.slice(html.indexOf('    function grErrorState('),html.indexOf('    function grReadFailure('));
const escStart=html.indexOf('    function esc('),escEnd=html.indexOf('\n    }',escStart)+'\n    }'.length;
vm.runInContext(classifierSource+'\n'+html.slice(escStart,escEnd),context);
vm.runInContext(`${html.slice(loadingStart, loadingEnd)}\n${html.slice(loadStart, loadEnd)}`, context);

(async () => {
  const notice=elements.get('gr-load-error');
  await vm.runInContext('openReceiving(false)',context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'),true,'failed read stops its blocking spinner');
  assert.equal(notice.classList.contains('hidden'),false,'cold failure remains visibly actionable');
  assert.match(notice.innerHTML,/ระบบขัดข้องชั่วคราว/);assert.doesNotMatch(notice.innerHTML,/fixture-private/);
  assert.equal(rendered.length,0,'cold failed read must not render a successful empty list');
  assert.equal(calls.length,1);

  context.apiCall=async(action,options)=>{calls.push({action,options});return {success:true,products:[],pendingPOs:[]};};
  const retry=vm.runInContext('retryGRFailedRead()',context);
  const duplicate=vm.runInContext('retryGRFailedRead()',context);
  await Promise.all([retry,duplicate]);assert.equal(calls.length,2,'one retry consumes its action once');
  assert.equal(notice.classList.contains('hidden'),true,'successful retry clears persistent error');
  assert.equal(rendered.length,1);assert.deepEqual(rendered[0],[],'fresh successful empty may render');
  context.apiCall=async()=>({success:true,products:[]});
  const clearsBeforeMalformedRead=context.reconciliationClearCount;
  await vm.runInContext('openReceiving(true)',context);
  assert.equal(context.reconciliationClearCount,clearsBeforeMalformedRead,'malformed success cannot clear pending post-save reconciliation');

  context.getCache=key=>key==='CACHE_GR_ACTIVE_DATA_V3'?{products:[],pendingPOs:[]}:null;
  context.groupPendingPOs=()=>{throw Error('corrupt cache shape');};
  context.grActiveDataRendered=false;
  context.apiCall=async()=>({success:false,reason:'offline',message:'fixture-private'});
  const renderedBeforeInvalid=rendered.length;
  await vm.runInContext('openReceiving(false)',context);
  assert.equal(notice.classList.contains('hidden'),false,'corrupt cache and failed read keep a persistent error');
  assert.match(notice.innerHTML,/เชื่อมต่อไม่ได้/);assert.equal(rendered.length,renderedBeforeInvalid);
  await vm.runInContext('retryGRFailedRead()',context);
  assert.equal(notice.classList.contains('hidden'),false,'failed retry remains actionable');
  assert.equal(rendered.length,renderedBeforeInvalid,'failure cannot manufacture an empty list');

  context.groupPendingPOs=()=>{};
  context.getCache=key=>key==='CACHE_GR_ACTIVE_DATA_V3'?{products:[],pendingPOs:[{uid:'cached'}]}:null;
  context.grActiveDataRendered=false;
  await vm.runInContext('openReceiving(false)',context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'),true,'cached UI remains available without a blocking spinner');
  assert.equal(notice.classList.contains('hidden'),false,'failed cached refresh stays retryable');
  assert.equal(context.appData.pendingPOs[0].uid,'cached','cached bill identity survives failed read');
  console.log('PASS GR startup loading: persistent inline failure/read retry/no false empty/corrupt cache/retained cached identity');
})().catch(error=>{console.error(error);process.exitCode=1;});
