const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function testVersionAndFrontendConstants() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));

  // 1. Version check
  const versionMatch = html.match(/const CURRENT_VERSION = ["']([^"']+)["'];/);
  assert.ok(versionMatch, 'CURRENT_VERSION must be declared in index.html');
  assert.equal(versionMatch[1], versionJson.version, 'CURRENT_VERSION and version.json must match');
  assert.ok(versionJson.version.startsWith('202608'), 'version.json must be 202608xx.xx');

  // 2. Cache TTL check
  const cacheTtlMatch = html.match(/const GR_CACHE_TTL = ([^;]+);/);
  assert.ok(cacheTtlMatch, 'GR_CACHE_TTL must be declared in index.html');
  assert.equal(eval(cacheTtlMatch[1]), 60000, 'GR_CACHE_TTL must be 60000ms (60 seconds)');

  // 3. Mutation timeout check (must be at least 45000ms)
  const timeoutMatch = html.match(/const timeoutMs = isReadApiAction\(action\) \? 60000 : (\d+);/);
  assert.ok(timeoutMatch, 'timeoutMs ternary must be declared in apiCall');
  const mutationTimeout = Number(timeoutMatch[1]);
  assert.ok(mutationTimeout >= 45000, `Mutation timeout (${mutationTimeout}ms) must be >= 45000ms to tolerate LockService`);

  // 4. In-flight mutex check in submitReceiving
  assert.ok(html.includes('if (receivingMutationInFlight) return;'), 'submitReceiving must check receivingMutationInFlight');
  assert.ok(html.includes('receivingMutationInFlight = true;'), 'submitReceiving must set receivingMutationInFlight to true');
  assert.ok(html.includes('receivingMutationInFlight = false;'), 'submitReceiving must reset receivingMutationInFlight to false');

  // 5. bypassCache parameter on manual refresh
  assert.ok(html.includes('bypassCache: isManualRefresh'), 'openReceiving must pass bypassCache on manual refresh');
}

function testBackendBypassCache() {
  let cacheGetCount = 0;
  const dummySheet = {
    getLastRow() { return 2; },
    getRange() {
      return {
        getValues() { return [['PO-1', 'BILL-1', new Date('2026-08-19'), 'PO-001', 'Vendor', 'W1', 'SKU1', 'Item 1', 10, 'ลัง', '', 'Pending GR', '']]; }
      };
    }
  };

  const sheets = { PO: dummySheet, GR: { getLastRow() { return 1; }, getRange() { return { getValues() { return []; } }; } } };
  const mockCache = {
    get(key) {
      cacheGetCount += 1;
      return JSON.stringify({ success: true, fromCache: true, pendingPOs: [{ uid: 'cached-po' }] });
    },
    put() {},
    remove() {}
  };

  const context = {
    console,
    Date,
    Set,
    Map,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    isFinite,
    encodeURIComponent,
    SpreadsheetApp: {
      openById() {
        return { getSheetByName(name) { return sheets[name] || null; } };
      }
    },
    CacheService: { getScriptCache() { return mockCache; } },
    Session: { getScriptTimeZone() { return 'Asia/Bangkok'; } },
    Utilities: {
      formatDate(value) { return '19/08/2026'; },
      getUuid() { return 'test-uuid'; }
    }
  };

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs.txt' });

  // 1. Normal lean read without bypass should read cache
  cacheGetCount = 0;
  const cachedResult = context.getInitialData({ includeCompleted: false, includeProducts: false, includeDeliveryPlanning: false });
  assert.equal(cachedResult.fromCache, true, 'Normal lean read should return cached object');
  assert.equal(cacheGetCount, 1, 'CacheService.get should be called once');

  // 2. Lean read with bypassCache: true should ignore cache and read sheet
  cacheGetCount = 0;
  const freshResult = context.getInitialData({ includeCompleted: false, includeProducts: false, includeDeliveryPlanning: false, bypassCache: true });
  assert.equal(freshResult.fromCache, undefined, 'bypassCache: true must not return cached object');
  assert.equal(cacheGetCount, 0, 'CacheService.get should not be called when bypassCache: true');
  assert.equal(freshResult.pendingPOs[0].uid, 'PO-1', 'Fresh read must return sheet row');

  // 3. Backend revision
  const revision = vm.runInContext('GR_BACKEND_REVISION', context);
  assert.equal(revision, '20260820.05-auth-archive', 'GR_BACKEND_REVISION must identify the auth/archive release');
}

testVersionAndFrontendConstants();
testBackendBypassCache();
console.log('PASS gr-concurrency-and-cache: backend 20260820.05, 60s TTL, 50s timeout, in-flight mutex, and bypassCache verified');
