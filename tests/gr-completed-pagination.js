const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const functionStart = html.indexOf('async function ensureCompletedLoaded');
const functionEnd = html.indexOf('\n    async function loadMoreCompletedGR', functionStart);

assert(functionStart >= 0 && functionEnd > functionStart, 'ensureCompletedLoaded must exist in index.html');

const ensureCompletedLoadedSource = html.slice(functionStart, functionEnd);
function createContext(cachedResponse, responses) {
  const context = vm.createContext({ console, Date });
  context.cachedResponseFixture = cachedResponse;
  context.responseFixtures = responses;
  vm.runInContext(`
    var grCompletedLoaded = false;
    var grCompletedLoadedFull = false;
    var grCompletedHasMore = false;
    var grCompletedTotal = 0;
    var grCompletedNextOffset = 0;
    var grCompletedLoadedFromCache = false;
    const GR_COMPLETED_WINDOW_SIZE = 200;
    const GR_COMPLETED_CACHE_TTL = 1;
    const PERF_MODE = false;
    var appData = { grCompleted: [] };
    var requests = [];
    var responses = responseFixtures;
    function getCache() { return cachedResponseFixture; }
    function setCache() {}
    function showDataLoading() {}
    function hideDataLoading() {}
    function perfLog() {}
    function groupPendingPOs() {}
    function showNotification() {}
    async function apiCall(action, options) {
      requests.push(JSON.parse(JSON.stringify(options)));
      return responses.shift();
    }
    ${ensureCompletedLoadedSource}
  `, context);
  return context;
}

(async () => {
  const context = createContext(null, [
    { success: true, grCompleted: [{ uid: 'A' }], grCompletedTotal: 2, grCompletedHasMore: true, grCompletedNextOffset: 1 },
    { success: true, grCompleted: [{ uid: 'B' }], grCompletedTotal: 2, grCompletedHasMore: false, grCompletedNextOffset: 2 }
  ]);
  await vm.runInContext('(async () => { await ensureCompletedLoaded(); await ensureCompletedLoaded(true); })()', context);

  assert.strictEqual(context.requests.length, 2, 'first page and one additional page should be requested');
  assert.strictEqual(context.requests[0].completedLimit, 200);
  assert.strictEqual(context.requests[0].completedOffset, undefined);
  assert.strictEqual(context.requests[1].completedLimit, 200);
  assert.strictEqual(context.requests[1].completedOffset, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(context.appData.grCompleted)), [{ uid: 'A' }, { uid: 'B' }]);
  assert.strictEqual(context.grCompletedNextOffset, 2);
  assert.strictEqual(context.grCompletedHasMore, false);
  assert.strictEqual(context.grCompletedLoadedFull, true);

  const cachedContext = createContext(
    { grCompleted: [{ uid: 'A' }], grCompletedTotal: 2, grCompletedHasMore: true, grCompletedNextOffset: 1 },
    [{
      success: true,
      grCompleted: [{ uid: 'NEW' }, { uid: 'A' }, { uid: 'B' }],
      grCompletedTotal: 3,
      grCompletedHasMore: false,
      grCompletedNextOffset: 3
    }]
  );
  await vm.runInContext('(async () => { await ensureCompletedLoaded(); await ensureCompletedLoaded(true); })()', cachedContext);

  assert.strictEqual(cachedContext.requests.length, 1, 'cached page rollover should refresh and extend from offset zero in one request');
  assert.strictEqual(cachedContext.requests[0].completedLimit, 201);
  assert.strictEqual(cachedContext.requests[0].completedOffset, undefined);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(cachedContext.appData.grCompleted)),
    [{ uid: 'NEW' }, { uid: 'A' }, { uid: 'B' }],
    'a newly completed bill before the cached boundary must not be omitted'
  );

  console.log('PASS gr-completed-pagination: live pages merge and cached rollover refreshes from offset zero');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
