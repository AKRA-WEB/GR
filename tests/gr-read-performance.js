const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeSheet(rows) {
  return {
    getLastRow() { return rows.length + 1; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues() {
          return rows.slice(row - 2, row - 2 + rowCount).map(source => {
            const values = [];
            for (let index = 0; index < columnCount; index += 1) {
              values.push(source[column - 1 + index] ?? '');
            }
            return values;
          });
        }
      };
    }
  };
}

function poRow({ uid, ref, date, number, status, product = 'Item' }) {
  return [uid, ref, date, number, 'Vendor', 'W2', 'SKU', product, 1, 'EA', '', status, ''];
}

function grRow({ uid, poUid, date, status = 'GR Completed' }) {
  return [`GR-${uid}`, poUid, date, date, 'Receiver', 'SKU', 'Item', 1, 'EA', 'A1', date, 1, '', status, 0];
}

function createBackend(poRows, grRows = []) {
  let formattedDates = 0;
  const sheets = { PO: makeSheet(poRows), GR: makeSheet(grRows) };
  const cache = { get() { return null; }, put() {}, remove() {} };
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
    CacheService: { getScriptCache() { return cache; } },
    Session: { getScriptTimeZone() { return 'Asia/Bangkok'; } },
    Utilities: {
      formatDate(value) {
        formattedDates += 1;
        const day = String(value.getUTCDate()).padStart(2, '0');
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        return `${day}/${month}/${value.getUTCFullYear()}`;
      },
      getUuid() { return 'test-uuid'; }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs.txt' });
  return {
    getInitialData: context.getInitialData,
    getFormattedDateCount: () => formattedDates
  };
}

function testActiveReadHydratesOnlyActiveRows() {
  const backend = createBackend([
    poRow({ uid: 'active-1', ref: 'BILL-A', date: new Date('2026-08-03T00:00:00Z'), number: 'PO-A', status: 'Pending GR' }),
    poRow({ uid: 'done-1', ref: 'BILL-B', date: new Date('2026-08-02T00:00:00Z'), number: 'PO-B', status: 'GR Completed' }),
    poRow({ uid: 'done-2', ref: 'BILL-B', date: new Date('2026-08-02T00:00:00Z'), number: 'PO-B', status: 'GR Completed' }),
    poRow({ uid: 'apv-1', ref: 'BILL-C', date: new Date('2026-07-30T00:00:00Z'), number: 'PO-C', status: 'PO Closed - Ready for APV' })
  ]);

  const result = backend.getInitialData({
    includeCompleted: false,
    includeProducts: false,
    includeDeliveryPlanning: false
  });

  assert.equal(result.success, true);
  assert.equal(Array.from(result.pendingPOs, item => item.uid).join(','), 'active-1');
  assert.equal(
    backend.getFormattedDateCount(),
    1,
    'active reads must not format or hydrate terminal history rows'
  );
}

function testLatestGrStatusOverridesPendingPoStatus() {
  const completedDate = new Date('2026-08-03T00:00:00Z');
  const backend = createBackend([
    poRow({ uid: 'pending-po', ref: 'BILL-A', date: completedDate, number: 'PO-A', status: 'Pending GR' })
  ], [
    grRow({ uid: 'completed-gr', poUid: 'pending-po', date: completedDate, status: 'GR Completed' })
  ]);

  const result = backend.getInitialData({
    includeCompleted: true,
    includeProducts: false,
    includeDeliveryPlanning: false,
    completedLimit: 1
  });

  assert.equal(result.success, true);
  assert.equal(result.pendingPOs.length, 0, 'latest GR status must remove the bill from active rows');
  assert.equal(Array.from(result.grCompleted, item => item.uid).join(','), 'pending-po');
}

function testCompletedWindowHydratesOnlySelectedBills() {
  const backend = createBackend([
    poRow({ uid: 'active-1', ref: 'BILL-A', date: new Date('2026-08-03T00:00:00Z'), number: 'PO-A', status: 'Pending GR' }),
    poRow({ uid: 'done-new-1', ref: 'BILL-B', date: new Date('2026-08-02T00:00:00Z'), number: 'PO-B', status: 'GR Completed', product: 'B1' }),
    poRow({ uid: 'done-new-2', ref: 'BILL-B', date: new Date('2026-08-02T00:00:00Z'), number: 'PO-B', status: 'GR Completed', product: 'B2' }),
    poRow({ uid: 'done-old-1', ref: 'BILL-C', date: new Date('2026-07-01T00:00:00Z'), number: 'PO-C', status: 'GR Completed', product: 'C1' }),
    poRow({ uid: 'apv-1', ref: 'BILL-D', date: new Date('2026-06-01T00:00:00Z'), number: 'PO-D', status: 'PO Closed - Ready for APV' })
  ]);

  const result = backend.getInitialData({
    includeCompleted: true,
    includeProducts: false,
    includeDeliveryPlanning: false,
    completedLimit: 1
  });

  assert.equal(result.success, true);
  assert.equal(Array.from(result.grCompleted, item => item.uid).join(','), 'done-new-1,done-new-2');
  assert.equal(result.grCompletedTotal, 2);
  assert.equal(result.grCompletedHasMore, true);
  assert.equal(
    backend.getFormattedDateCount(),
    3,
    'completed windows must hydrate the active row plus only the selected complete bill'
  );
}

function testCompletedWindowHydratesOnlySelectedGrDetails() {
  const newDate = new Date('2026-08-02T00:00:00Z');
  const oldDate = new Date('2026-07-01T00:00:00Z');
  const backend = createBackend([
    poRow({ uid: 'active-1', ref: 'BILL-A', date: new Date('2026-08-03T00:00:00Z'), number: 'PO-A', status: 'Pending GR' }),
    poRow({ uid: 'done-new-1', ref: 'BILL-B', date: newDate, number: 'PO-B', status: 'GR Completed' }),
    poRow({ uid: 'done-new-2', ref: 'BILL-B', date: newDate, number: 'PO-B', status: 'GR Completed' }),
    poRow({ uid: 'done-old-1', ref: 'BILL-C', date: oldDate, number: 'PO-C', status: 'GR Completed' })
  ], [
    grRow({ uid: 'new-1', poUid: 'done-new-1', date: newDate }),
    grRow({ uid: 'new-2', poUid: 'done-new-2', date: newDate }),
    grRow({ uid: 'old-1', poUid: 'done-old-1', date: oldDate })
  ]);

  const result = backend.getInitialData({
    includeCompleted: true,
    includeProducts: false,
    includeDeliveryPlanning: false,
    completedLimit: 1
  });

  assert.equal(result.success, true);
  assert.equal(Array.from(result.grCompleted, item => item.uid).join(','), 'done-new-1,done-new-2');
  assert.equal(
    backend.getFormattedDateCount(),
    7,
    'unselected completed bills must not format GR ATA/expiry details'
  );
}

function testCompletedWindowSupportsNonOverlappingOffsets() {
  const backend = createBackend([
    poRow({ uid: 'done-new-1', ref: 'BILL-B', date: new Date('2026-08-02T00:00:00Z'), number: 'PO-B', status: 'GR Completed' }),
    poRow({ uid: 'done-new-2', ref: 'BILL-B', date: new Date('2026-08-02T00:00:00Z'), number: 'PO-B', status: 'GR Completed' }),
    poRow({ uid: 'done-old-1', ref: 'BILL-C', date: new Date('2026-07-01T00:00:00Z'), number: 'PO-C', status: 'GR Completed' })
  ]);

  const result = backend.getInitialData({
    includeCompleted: true,
    includeProducts: false,
    includeDeliveryPlanning: false,
    completedLimit: 1,
    completedOffset: 1
  });

  assert.equal(result.success, true);
  assert.equal(Array.from(result.grCompleted, item => item.uid).join(','), 'done-old-1');
  assert.equal(result.grCompletedTotal, 2);
  assert.equal(result.grCompletedHasMore, false);
  assert.equal(result.grCompletedOffset, 1);
  assert.equal(result.grCompletedNextOffset, 2);
}

function testLegacySameDayBillStaysWhole() {
  const backend = createBackend([
    poRow({ uid: 'legacy-1', ref: 'DIRECT', date: new Date('2026-08-02T01:00:00Z'), number: 'PO-LEGACY', status: 'GR Completed' }),
    poRow({ uid: 'legacy-2', ref: 'DIRECT', date: new Date('2026-08-02T08:00:00Z'), number: 'PO-LEGACY', status: 'GR Completed' }),
    poRow({ uid: 'legacy-old', ref: 'DIRECT', date: new Date('2026-07-01T01:00:00Z'), number: 'PO-OLD', status: 'GR Completed' })
  ]);

  const result = backend.getInitialData({
    includeCompleted: true,
    includeProducts: false,
    includeDeliveryPlanning: false,
    completedLimit: 1
  });

  assert.equal(Array.from(result.grCompleted, item => item.uid).join(','), 'legacy-1,legacy-2');
  assert.equal(result.grCompletedTotal, 2, 'same legacy bill and calendar day should count once');
  assert.equal(result.grCompletedNextOffset, 1);
}

testActiveReadHydratesOnlyActiveRows();
testLatestGrStatusOverridesPendingPoStatus();
testCompletedWindowHydratesOnlySelectedBills();
testCompletedWindowHydratesOnlySelectedGrDetails();
testCompletedWindowSupportsNonOverlappingOffsets();
testLegacySameDayBillStaysWhole();
console.log('PASS gr-read-performance: active and completed reads hydrate only selected rows and support offsets');
