const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createSheet(rows) {
  return {
    rows,
    getLastRow() { return this.rows.length + 1; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => this.rows.slice(row - 2, row - 2 + rowCount).map(source => {
          const values = [];
          for (let index = 0; index < columnCount; index += 1) {
            values.push(source[column - 1 + index] ?? '');
          }
          return values;
        }),
        setNumberFormat() { return this; },
        setValues: values => {
          values.forEach((value, index) => { this.rows[row - 2 + index] = value.slice(); });
          return this;
        }
      };
    },
    getRangeList() { return { setValue() {} }; },
    deleteRows(row, count) { this.rows.splice(row - 2, count); }
  };
}

function createBackend() {
  const poSheet = createSheet([
    ['PO-1', 'BILL-1', '01/08/2026', 'PO-001', 'Vendor A', 'W1', 'SKU-1', 'สินค้า A', 5, 'EA', '', 'Pending GR', '']
  ]);
  const grSheet = createSheet([]);
  const lineMessages = [];
  let uuid = 0;
  const cache = { get() { return null; }, put() {}, remove() {} };
  const lock = { waitLock() {}, releaseLock() {} };
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
    LockService: { getScriptLock() { return lock; } },
    SpreadsheetApp: {
      openById() {
        return { getSheetByName(name) { return name === 'PO' ? poSheet : grSheet; } };
      },
      flush() {}
    },
    CacheService: { getScriptCache() { return cache; } },
    Session: { getScriptTimeZone() { return 'Asia/Bangkok'; } },
    Utilities: {
      getUuid() { uuid += 1; return `test-uuid-${uuid}`; },
      formatDate(value) {
        const day = String(value.getUTCDate()).padStart(2, '0');
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        return `${day}/${month}/${value.getUTCFullYear()}`;
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            if (name.includes('TOKEN')) return 'test-token';
            if (name.includes('GROUP')) return 'test-group';
            return '';
          }
        };
      }
    },
    UrlFetchApp: {
      fetch(url, options) {
        if (url === 'https://api.line.me/v2/bot/message/push') {
          lineMessages.push(JSON.parse(options.payload).messages[0].text);
          return { getResponseCode() { return 200; }, getContentText() { return ''; } };
        }
        throw new Error(`Unexpected external request: ${url}`);
      }
    },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput(text) { return { text, setMimeType() { return this; } }; }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs.txt' });
  return { context, lineMessages };
}

const backend = createBackend();
const result = backend.context.bulkReceivePO({
  ata: '13/08/2026',
  receiverName: 'Receiver',
  remark: '',
  targetStatus: 'Pending Review',
  groupInfo: { poDate: '01/08/2026', vendor: 'Vendor A', poNumber: 'PO-001', warehouse: 'W1' },
  groupPoUids: ['PO-1'],
  items: [{ uid: 'PO-1', grQty: '5', unit: 'EA', locIn: 'W1-F1-Z1', exp: '31/12/2569', oldStock: '' }],
  extraItems: []
});

assert.equal(result.success, true);
assert.equal(backend.lineMessages.length, 1);
assert.match(
  backend.lineMessages[0],
  /1\. สินค้า A จำนวน 5 EA \[W1\] \| หมดอายุ: 31\/12\/2569/,
  'a received item with expiry must show that expiry on its own LINE entry'
);

console.log('PASS gr-line-expiry-notification: populated PO expiry appears on its LINE item');

const completedBackend = createBackend();
const completedResult = completedBackend.context.bulkReceivePO({
  ata: '13/08/2026',
  receiverName: 'Approver',
  remark: '',
  targetStatus: 'GR Completed',
  groupInfo: { poDate: '01/08/2026', vendor: 'Vendor A', poNumber: 'PO-001', warehouse: 'W1' },
  groupPoUids: ['PO-1'],
  items: [{ uid: 'PO-1', grQty: '', unit: 'EA', locIn: '', exp: '', oldStock: '' }],
  extraItems: [{ sku: 'EX-1', product: 'ของแถม A', grQty: '2', unit: 'ชิ้น', locIn: 'W2-F1-Z2', exp: '30/11/2569', oldStock: '' }]
});

assert.equal(completedResult.success, true);
assert.equal(completedBackend.lineMessages.length, 1);
assert.match(completedBackend.lineMessages[0], /GR Completed/);
assert.match(
  completedBackend.lineMessages[0],
  /1\. ของแถม A จำนวน 2 ชิ้น \[W2\] \(ของแถม\/นอกบิล\) \| หมดอายุ: 30\/11\/2569/,
  'an extra item with expiry must show that expiry on its own completed LINE entry'
);
assert.doesNotMatch(completedBackend.lineMessages[0], /สินค้า A/, 'a zero-received PO item must remain absent from LINE');

console.log('PASS gr-line-expiry-notification: populated extra-item expiry appears in completed LINE');

for (const blankExpiry of ['', '   ', null, undefined]) {
  const blankBackend = createBackend();
  const blankResult = blankBackend.context.bulkReceivePO({
    ata: '13/08/2026',
    receiverName: 'Receiver',
    remark: '',
    targetStatus: 'Pending Review',
    groupInfo: { poDate: '01/08/2026', vendor: 'Vendor A', poNumber: 'PO-001', warehouse: 'W1' },
    groupPoUids: ['PO-1'],
    items: [{ uid: 'PO-1', grQty: '5', unit: 'EA', locIn: 'W1-F1-Z1', exp: blankExpiry, oldStock: '' }],
    extraItems: [{ sku: 'EX-2', product: 'ของแถมไม่มีวันหมดอายุ', grQty: '1', unit: 'ชิ้น', locIn: 'W1-F1-Z2', exp: '   ', oldStock: '' }]
  });

  assert.equal(blankResult.success, true);
  assert.equal(blankBackend.lineMessages.length, 1);
  assert.match(blankBackend.lineMessages[0], /1\. สินค้า A จำนวน 5 EA \[W1\]\n/);
  assert.match(blankBackend.lineMessages[0], /2\. ของแถมไม่มีวันหมดอายุ จำนวน 1 ชิ้น \[W1\] \(ของแถม\/นอกบิล\)\n/);
  assert.doesNotMatch(blankBackend.lineMessages[0], /หมดอายุ:/, `blank expiry ${String(blankExpiry)} must add no expiry label`);
  assert.doesNotMatch(blankBackend.lineMessages[0], / \| \n/, 'blank expiry must add no separator or empty fragment');
}

const draftBackend = createBackend();
const draftResult = draftBackend.context.bulkReceivePO({
  ata: '',
  receiverName: 'Receiver',
  remark: '',
  targetStatus: 'Draft GR',
  groupInfo: { poDate: '01/08/2026', vendor: 'Vendor A', poNumber: 'PO-001', warehouse: 'W1' },
  groupPoUids: ['PO-1'],
  items: [{ uid: 'PO-1', grQty: '', unit: 'EA', locIn: '', exp: '31/12/2569', oldStock: '' }],
  extraItems: []
});

assert.equal(draftResult.success, true);
assert.equal(draftBackend.lineMessages.length, 0, 'Draft GR must remain non-notifying');

console.log('PASS gr-line-expiry-notification: blank omission, zero quantity, and Draft behavior remain intact');
