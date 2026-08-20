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

function poRow({ uid, date, number, vendor, warehouse = 'W1', sku = 'SKU-1', product = 'Alpha' }) {
  return [uid, 'BILL-' + uid, date, number, vendor, warehouse, sku, product, 1, 'EA', '', 'GR Completed', ''];
}

function grRow({ uid, poUid, grDate, ata, receiver, sku = 'SKU-1', product = 'Alpha', qty = 1, unit = 'EA', location = 'A1', exp = '', remark = '', status = 'GR Completed', oldStock = 0 }) {
  return [uid, poUid, grDate, ata, receiver, sku, product, qty, unit, location, exp, 1, remark, status, oldStock];
}

function createBackend(options = {}) {
  const poRows = [
    poRow({ uid: 'PO-1', date: new Date('2026-07-01T00:00:00Z'), number: 'PO-001', vendor: 'Vendor A', warehouse: 'W1' }),
    poRow({ uid: 'PO-2', date: new Date('2026-06-01T00:00:00Z'), number: 'PO-002', vendor: 'Vendor B', warehouse: 'W2' }),
    poRow({ uid: 'PO-3', date: new Date('2026-05-01T00:00:00Z'), number: 'PO-003', vendor: 'Vendor C', warehouse: 'W3' })
  ];
  const grRows = [
    grRow({ uid: 'GR-LATEST', poUid: 'PO-1', grDate: new Date('2026-08-04T00:00:00Z'), ata: new Date('2026-08-05T00:00:00Z'), receiver: 'Newest Receiver', qty: 10, exp: new Date('2026-12-31T00:00:00Z'), remark: 'Latest note', oldStock: 2 }),
    grRow({ uid: 'GR-OLD', poUid: 'PO-2', grDate: new Date('2026-06-15T00:00:00Z'), ata: '', receiver: 'Old Receiver', qty: 5, exp: new Date('2026-09-30T00:00:00Z'), remark: 'Old note' }),
    grRow({ uid: 'GR-EXTRA', poUid: 'EXTRA', grDate: new Date('2026-08-02T00:00:00Z'), ata: new Date('2026-08-03T00:00:00Z'), receiver: 'Extra Receiver', sku: '', qty: 2, remark: '[EXTRA_FOR:PO-3] Gift note' }),
    grRow({ uid: 'GR-PENDING', poUid: 'PO-1', grDate: new Date('2026-08-06T00:00:00Z'), ata: new Date('2026-08-06T00:00:00Z'), receiver: 'Pending Receiver', status: 'Pending Review' }),
    grRow({ uid: 'GR-OTHER', poUid: 'PO-1', grDate: new Date('2026-08-07T00:00:00Z'), ata: new Date('2026-08-07T00:00:00Z'), receiver: 'Other Receiver', sku: 'SKU-2', product: 'Alphabet' }),
    grRow({ uid: 'GR-INVALID-DATE', poUid: 'PO-1', grDate: '2026-03-01', ata: '31/13/2026', receiver: 'Invalid Date Receiver' }),
    grRow({ uid: 'GR-LEGACY-EXTRA', poUid: 'EXTRA', grDate: '2026-02-01', ata: '2026-02-02', receiver: 'Legacy Extra Receiver', sku: '', remark: 'Legacy extra note' })
  ].concat(options.extraGrRows || []);
  const archiveRows = [
    grRow({ uid: 'GR-OLD', poUid: 'PO-2', grDate: new Date('2026-06-15T00:00:00Z'), ata: '', receiver: 'Duplicate Archive', qty: 999 }),
    grRow({ uid: 'GR-ARCHIVE', poUid: 'MISSING-PO', grDate: new Date('2026-04-01T00:00:00Z'), ata: new Date('2026-04-02T00:00:00Z'), receiver: 'Archive Receiver', remark: 'Archive note', status: 'Completed' }),
    grRow({ uid: 'GR-PENDING', poUid: 'PO-1', grDate: new Date('2026-02-01T00:00:00Z'), ata: new Date('2026-02-02T00:00:00Z'), receiver: 'Stale Completed Archive', status: 'Completed' }),
    grRow({ uid: 'GR-OTHER', poUid: 'PO-1', grDate: new Date('2026-01-01T00:00:00Z'), ata: new Date('2026-01-02T00:00:00Z'), receiver: 'Stale Matching Archive' })
  ];
  const sheets = { PO: makeSheet(poRows), GR: makeSheet(grRows) };
  if (options.includeArchive !== false) sheets.GR_Archive = makeSheet(archiveRows);
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
        const day = String(value.getUTCDate()).padStart(2, '0');
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        return `${day}/${month}/${value.getUTCFullYear()}`;
      },
      getUuid() { return 'test-uuid'; }
    },
    UrlFetchApp: {
      fetch(url) {
        const token = new URL(url).searchParams.get('token');
        const perms = token === 'receive' ? ['receiveGR'] : token === 'approve' ? ['approveGR'] : ['viewGR'];
        return {
          getResponseCode() { return 200; },
          getContentText() {
            return JSON.stringify({ valid: true, user: { roles: ['WAREHOUSE'], perms: { 'app-gr': perms } } });
          }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput(text) {
        return { text, setMimeType() { return this; } };
      }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs.txt' });
  return context;
}

function post(context, token, data) {
  const output = context.doPost({
    postData: { contents: JSON.stringify({ action: 'getProductReceiptHistory', token, data }) }
  });
  return JSON.parse(output.text);
}

const backend = createBackend();
assert.equal(typeof backend.getProductReceiptHistory, 'function', 'product receipt history endpoint must exist');
assert.deepEqual(
  JSON.parse(JSON.stringify(backend.getProtectedActionGuard_('getProductReceiptHistory'))),
  { anyPerm: ['receiveGR', 'approveGR'] },
  'history endpoint must reuse existing GR receive/approve permissions'
);

const missingToken = post(backend, '', { sku: 'SKU-1', productName: 'Alpha' });
assert.equal(missingToken.success, false);
assert.equal(missingToken.reason, 'no_token');
const denied = post(backend, 'denied', { sku: 'SKU-1', productName: 'Alpha' });
assert.equal(denied.success, false);
assert.equal(denied.reason, 'permission_denied');
assert.equal(post(backend, 'receive', { sku: 'SKU-1', productName: 'Alpha', limit: 2 }).success, true);
assert.equal(post(backend, 'approve', { sku: 'SKU-1', productName: 'Alpha', limit: 2 }).success, true);

const firstPage = backend.getProductReceiptHistory({ sku: 'sku-1', productName: '  Alpha  ', limit: 2 });
assert.equal(firstPage.success, true);
assert.equal(firstPage.total, 6, 'completed live/archive rows should merge, dedupe, and exclude pending/nonmatching rows');
assert.equal(firstPage.history.length, 2);
assert.equal(firstPage.hasMore, true);
assert.equal(firstPage.nextOffset, 2);
assert.equal(firstPage.latest.grUid, 'GR-LATEST', 'latest must use greatest ATA');
assert.equal(firstPage.latest.receiptDate, '05/08/2026');
assert.equal(firstPage.latest.expDate, '31/12/2026', 'latest expiry must come from the same latest row');
assert.equal(firstPage.latest.poNumber, 'PO-001');
assert.equal(firstPage.latest.vendor, 'Vendor A');
assert.equal(firstPage.latest.warehouse, 'W1');
assert.equal(firstPage.history[1].grUid, 'GR-EXTRA', 'blank-SKU extra row should use exact normalized name fallback');
assert.equal(firstPage.history[1].poNumber, 'PO-003', 'extra marker should resolve PO metadata');
assert.equal(firstPage.history[1].remark, 'Gift note', 'technical extra marker must not leak into the user remark');

const secondPage = backend.getProductReceiptHistory({ sku: 'SKU-1', productName: 'Alpha', offset: 2, limit: 2 });
assert.deepEqual(Array.from(secondPage.history, row => row.grUid), ['GR-OLD', 'GR-ARCHIVE']);
assert.equal(secondPage.history[0].receiptDate, '15/06/2026', 'blank ATA must fall back to GR date');
assert.equal(secondPage.history[0].receiver, 'Old Receiver', 'live row must win duplicate archive UID');
assert.equal(secondPage.history[1].poNumber, '', 'missing PO metadata must remain safely unavailable');
assert.equal(secondPage.hasMore, true);

const thirdPage = backend.getProductReceiptHistory({ sku: 'SKU-1', productName: 'Alpha', offset: 4, limit: 2 });
assert.deepEqual(Array.from(thirdPage.history, row => row.grUid), ['GR-INVALID-DATE', 'GR-LEGACY-EXTRA']);
assert.equal(thirdPage.history[0].ata, '', 'invalid legacy ATA must display as not recorded');
assert.equal(thirdPage.history[0].receiptDate, '01/03/2026', 'invalid ATA must fall back to valid GR date');
assert.equal(thirdPage.history[1].poNumber, '', 'unresolvable legacy extra rows must remain visible with unavailable PO metadata');
assert.equal(thirdPage.hasMore, false);

const nameOnly = backend.getProductReceiptHistory({ productName: ' alpha ' });
assert.equal(nameOnly.total, 6, 'name-only fallback must use normalized exact matching');

const withoutArchive = createBackend({ includeArchive: false }).getProductReceiptHistory({ sku: 'SKU-1', productName: 'Alpha' });
assert.equal(withoutArchive.success, true, 'an absent optional archive must not fail the request');
assert.equal(withoutArchive.total, 5);

const tieBackend = createBackend({
  includeArchive: false,
  extraGrRows: [
    grRow({ uid: 'GR-TIE-A', poUid: 'PO-1', grDate: '2026-01-01', ata: '2026-02-01', receiver: 'Tie A', sku: 'SKU-TIE', product: 'Tie Product' }),
    grRow({ uid: 'GR-TIE-B', poUid: 'PO-1', grDate: '2026-01-02', ata: '2026-02-01', receiver: 'Tie B', sku: 'SKU-TIE', product: 'Tie Product' }),
    grRow({ uid: 'GR-TIE-C', poUid: 'PO-1', grDate: '2026-01-02', ata: '2026-02-01', receiver: 'Tie C', sku: 'SKU-TIE', product: 'Tie Product' })
  ]
});
const tied = tieBackend.getProductReceiptHistory({ sku: 'SKU-TIE', productName: 'Tie Product' });
assert.deepEqual(Array.from(tied.history, row => row.grUid), ['GR-TIE-B', 'GR-TIE-C', 'GR-TIE-A'], 'same ATA must tie-break by GR date then deterministic source order');

const empty = backend.getProductReceiptHistory({ sku: 'SKU-NONE', productName: 'No history' });
assert.equal(empty.success, true);
assert.equal(empty.total, 0);
assert.equal(empty.latest, null);
assert.deepEqual(Array.from(empty.history), []);

const invalid = backend.getProductReceiptHistory({});
assert.equal(invalid.success, false);
assert.equal(invalid.reason, 'product_required');

console.log('PASS gr-product-receipt-history: auth, matching, live/archive dedupe, latest semantics, joins, missing fields, and pagination');
