const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function columnNumber(label) {
  return [...label].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

class Sheet {
  constructor(width, rows = []) {
    this.rows = [Array(width).fill('HEADER'), ...rows.map(row => row.slice())];
  }
  getLastRow() { return this.rows.length; }
  getRange(row, column, rowCount, columnCount) {
    const sheet = this;
    const range = {
      getValues() {
        return sheet.rows.slice(row - 1, row - 1 + rowCount)
          .map(values => values.slice(column - 1, column - 1 + columnCount));
      },
      setValues(values) {
        values.forEach((source, rowOffset) => {
          while (sheet.rows.length < row + rowOffset) sheet.rows.push([]);
          source.forEach((value, columnOffset) => {
            sheet.rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
          });
        });
        return range;
      },
      setNumberFormat() { return range; }
    };
    return range;
  }
  getRangeList(a1Ranges) {
    const sheet = this;
    return {
      setValue(value) {
        a1Ranges.forEach(a1 => {
          const match = /^([A-Z]+)(\d+)$/.exec(a1);
          sheet.rows[Number(match[2]) - 1][columnNumber(match[1]) - 1] = value;
        });
      }
    };
  }
  deleteRows(startRow, count) { this.rows.splice(startRow - 1, count); }
}

function poRow(uid, product) {
  return [uid, 'BILL-1', new Date('2026-08-01'), 'PO-001', 'Vendor', 'W1', `SKU-${uid}`, product, 10, 'ลัง', '', 'Pending GR', ''];
}

const poSheet = new Sheet(13, [poRow('PO-A', 'Product A'), poRow('PO-B', 'Product B')]);
const grSheet = new Sheet(15);
let uuid = 0;
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
  parseFloat,
  parseInt,
  encodeURIComponent,
  SpreadsheetApp: {
    openById() {
      return {
        getSheetByName(name) {
          if (name === 'PO') return poSheet;
          if (name === 'GR') return grSheet;
          return null;
        }
      };
    },
    flush() {}
  },
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  CacheService: { getScriptCache() { return { get() { return null; }, put() {}, remove() {} }; } },
  Session: { getScriptTimeZone() { return 'Asia/Bangkok'; } },
  Utilities: {
    getUuid() { uuid += 1; return `GR-${uuid}`; },
    formatDate() { return ''; }
  },
  PropertiesService: { getScriptProperties() { return { getProperty() { return ''; } }; } }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8'), context, { filename: 'Code.gs.txt' });

function receive(poUids, itemUid, targetStatus) {
  return context.bulkReceivePO({
    groupPoUids: poUids,
    groupInfo: { poDate: '01/08/2026', vendor: 'Vendor', warehouse: 'W1' },
    ata: '20/08/2026',
    receiverName: 'Receiver',
    targetStatus,
    items: [{ uid: itemUid, grQty: 10, unit: 'ลัง', locIn: 'W1-A1', exp: '', oldStock: 0 }],
    extraItems: [],
    remark: ''
  });
}

function poStatus(uid) {
  return poSheet.rows.find(row => row[0] === uid)[11];
}

function liveGr(poUid) {
  return grSheet.rows.slice(1).find(row => row[1] === poUid);
}

const invalidStatus = receive(['PO-A'], 'PO-A', 'Completed');
assert.equal(invalidStatus.success, false, 'Non-canonical target statuses must be rejected server-side');
assert.equal(invalidStatus.reason, 'invalid_target_status');
assert.equal(poStatus('PO-A'), 'Pending GR', 'Rejected status must not mutate PO state');
assert.equal(grSheet.rows.length, 1, 'Rejected status must not insert GR rows');

assert.equal(receive(['PO-A', 'PO-B'], 'PO-A', 'Pending Review').success, true);
assert.equal(poStatus('PO-A'), 'Pending Review');
assert.equal(poStatus('PO-B'), 'Pending GR', 'Unreceived part must stay Pending GR');

assert.equal(receive(['PO-A'], 'PO-A', 'GR Completed').success, true);
assert.equal(poStatus('PO-A'), 'GR Completed');
assert.equal(liveGr('PO-A')[13], 'GR Completed');

assert.equal(receive(['PO-B'], 'PO-B', 'Pending Review').success, true);
assert.equal(liveGr('PO-A')[13], 'GR Completed', 'Receiving the remainder must preserve the completed part');
assert.equal(liveGr('PO-B')[13], 'Pending Review');

assert.equal(receive(['PO-B'], 'PO-B', 'GR Completed').success, true);
assert.equal(poStatus('PO-A'), 'GR Completed');
assert.equal(poStatus('PO-B'), 'GR Completed');

const reset = context.recallGR({ poUids: ['PO-A', 'PO-B'], actionType: 'reset' });
assert.equal(reset.success, true);
assert.equal(poStatus('PO-A'), 'Pending GR');
assert.equal(poStatus('PO-B'), 'Pending GR');
assert.equal(grSheet.rows.length, 1, 'Whole-bill reset must remove every live receipt row');

console.log('PASS gr-partial-receiving-lifecycle: partial receive, staged completion, later receive, and whole-bill reset stay consistent');
