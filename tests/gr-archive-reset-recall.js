const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function columnNumber(label) {
  let value = 0;
  for (const char of label) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

class MockSheet {
  constructor(rows) {
    this.rows = rows.map(row => row.slice());
  }

  getLastRow() {
    return this.rows.length;
  }

  getRange(row, column, rowCount, columnCount) {
    const sheet = this;
    return {
      getValues() {
        return sheet.rows.slice(row - 1, row - 1 + rowCount)
          .map(values => values.slice(column - 1, column - 1 + columnCount));
      },
      setValues(values) {
        values.forEach((sourceRow, rowOffset) => {
          while (sheet.rows.length < row + rowOffset) sheet.rows.push([]);
          sourceRow.forEach((value, columnOffset) => {
            sheet.rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
          });
        });
        return this;
      },
      setValue(value) {
        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
          while (sheet.rows.length < row + rowOffset) sheet.rows.push([]);
          for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
            sheet.rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
          }
        }
        return this;
      }
    };
  }

  getRangeList(a1Ranges) {
    const sheet = this;
    return {
      setValue(value) {
        a1Ranges.forEach(a1 => {
          const match = /^([A-Z]+)(\d+)$/.exec(a1);
          assert.ok(match, `Unsupported A1 range in fixture: ${a1}`);
          sheet.rows[Number(match[2]) - 1][columnNumber(match[1]) - 1] = value;
        });
        return this;
      }
    };
  }

  deleteRows(startRow, count) {
    this.rows.splice(startRow - 1, count);
  }
}

function grRow(uid, poUid, status, remark = '') {
  return [uid, poUid, '2026-07-01', '2026-07-01', 'Receiver', 'SKU', 'Product', 1, 'ลัง', 'W1-A1', '', 0, remark, status, 0];
}

function loadFixture({ poRows, liveRows, archiveRows }) {
  const sheets = {
    PO: new MockSheet([Array(13).fill('HEADER'), ...poRows]),
    GR: new MockSheet([Array(15).fill('HEADER'), ...liveRows]),
    GR_Archive: new MockSheet([Array(15).fill('HEADER'), ...archiveRows])
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
      openById() { return { getSheetByName(name) { return sheets[name] || null; } }; },
      flush() {}
    },
    LockService: {
      getScriptLock() { return { waitLock() {}, releaseLock() {} }; }
    },
    CacheService: {
      getScriptCache() { return { get() { return null; }, put() {}, remove() {} }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8'), context, { filename: 'Code.gs.txt' });
  return { context, sheets };
}

function poRow(uid, status) {
  const row = Array(13).fill('');
  row[0] = uid;
  row[11] = status;
  return row;
}

function testResetDeletesArchivedReceiptRows() {
  const { context, sheets } = loadFixture({
    poRows: [poRow('PO-RESET', 'GR Completed')],
    liveRows: [grRow('GR-LIVE-OTHER', 'PO-OTHER', 'GR Completed')],
    archiveRows: [
      grRow('GR-ARCHIVED-RESET', 'PO-RESET', 'GR Completed'),
      grRow('GR-ARCHIVED-OTHER', 'PO-OTHER', 'GR Completed')
    ]
  });

  const result = context.recallGR({ poUids: ['PO-RESET'], actionType: 'reset' });
  assert.equal(result.success, true);
  assert.equal(sheets.PO.rows[1][11], 'Pending GR', 'Reset must restore the PO item to Pending GR');
  assert.equal(
    sheets.GR_Archive.rows.some(row => row[0] === 'GR-ARCHIVED-RESET'),
    false,
    'Reset must delete matching completed rows from GR_Archive'
  );
  assert.equal(
    sheets.GR_Archive.rows.some(row => row[0] === 'GR-ARCHIVED-OTHER'),
    true,
    'Reset must preserve unrelated archived rows'
  );
}

function testRecallRestoresArchivedReceiptRowsAsDraft() {
  const { context, sheets } = loadFixture({
    poRows: [poRow('PO-RECALL', 'GR Completed')],
    liveRows: [grRow('GR-LIVE-OTHER', 'PO-OTHER', 'GR Completed')],
    archiveRows: [
      grRow('GR-ARCHIVED-RECALL', 'PO-RECALL', 'GR Completed'),
      grRow('GR-ARCHIVED-OTHER', 'PO-OTHER', 'GR Completed')
    ]
  });

  const result = context.recallGR({ poUids: ['PO-RECALL'], actionType: 'recall' });
  assert.equal(result.success, true);
  assert.equal(sheets.PO.rows[1][11], 'Draft GR', 'Recall must restore the PO item to Draft GR');

  const restoredRow = sheets.GR.rows.find(row => row[0] === 'GR-ARCHIVED-RECALL');
  assert.ok(restoredRow, 'Recall must move the archived receipt row back to live GR');
  assert.equal(restoredRow[13], 'Draft GR', 'Restored receipt row must be editable Draft GR');
  assert.equal(
    sheets.GR_Archive.rows.some(row => row[0] === 'GR-ARCHIVED-RECALL'),
    false,
    'Recall must remove the restored row from GR_Archive'
  );
  assert.equal(
    sheets.GR_Archive.rows.some(row => row[0] === 'GR-ARCHIVED-OTHER'),
    true,
    'Recall must preserve unrelated archived rows'
  );
}

testResetDeletesArchivedReceiptRows();
testRecallRestoresArchivedReceiptRowsAsDraft();
console.log('PASS gr-archive-reset-recall: reset deletes archived rows and recall restores them as drafts');
