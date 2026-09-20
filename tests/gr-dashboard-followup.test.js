const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const grDir = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(grDir, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i)?.[1];
assert.ok(script, 'GR main inline script must be present');

assert.match(html, /\.chart-day-bar\s*\{[\s\S]*?flex:\s*0\s+0\s+56px/, 'single-day chart needs a fixed bar width');
assert.match(html, /id="dashboard-bills-load-more"/, 'dashboard bills need a load-more control');
assert.match(html, /id="vendor-leadtime-view"[^>]*dashboard-preview-surface/, 'dashboard must expose the preview-aligned surface');
assert.match(html, /family=Prompt/, 'dashboard preview typography must load Prompt');
assert.match(html, /dashboard-preview-tabs/, 'dashboard tabs need the preview-aligned navigation treatment');
assert.match(html, /dashboard-preview-kpis/, 'dashboard KPI grid needs the preview-aligned spacing treatment');
assert.match(script, /dashboard-wh-donut/, 'warehouse breakdown must retain the preview donut visual');
assert.match(script, /function\s+loadGrDashboardMore\s*\(/, 'dashboard must expose paged historical loading');
assert.match(script, /function\s+groupGrDashboardBills\s*\(/, 'dashboard must group same-round receipt rows');
assert.match(script, /function\s+getGrDashboardApprover\s*\(/, 'dashboard must normalize untrusted receiver-derived approvers');
assert.match(script, /dashboard-chart-item-label/, 'daily chart must expose item totals separately from bill totals');
assert.match(script, /gridTemplateColumns\s*=\s*`repeat\(\$\{Math\.max\(1, list\.length\)\}, minmax\(56px, 1fr\)\)`/, 'daily chart must keep historical dates horizontally accessible');

const elements = new Map();
function element(id) {
    if (!elements.has(id)) {
        elements.set(id, {
            id,
            value: '',
            innerHTML: '',
            innerText: '',
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            addEventListener() {},
            setAttribute() {},
            appendChild() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            focus() {}
        });
    }
    return elements.get(id);
}

const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Set,
    Map,
    JSON,
    URL,
    URLSearchParams,
    AbortController,
    navigator: { onLine: true },
    window: { location: { hostname: '127.0.0.1', search: '?demo=1' }, addEventListener() {} },
    document: {
        addEventListener() {},
        getElementById: element,
        querySelectorAll() { return []; },
        createElement() { return element('created'); },
        body: { classList: { add() {}, remove() {} } }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    lucide: { createIcons() {} },
    fetch: async () => ({ ok: true, json: async () => ({ version: '20260919.05' }) }),
    setInterval() {},
    setTimeout,
    clearTimeout
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.self = sandbox.window;
sandbox.window.window = sandbox.window;

vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'GR/index.html' });

const grouped = sandbox.groupGrDashboardBills([
    {
        grId: 'gr-1', grNumber: 'GR-1', poId: 'po-1', poNumber: 'PO-1', vendor: 'Vendor',
        ataDate: '2026-09-19', warehouse: 'W3', receiver: 'Receiver', approver: 'Approver',
        totalCrates: 100, itemCount: 1, items: [{ sku: 'A', product: 'A', grQty: 100 }]
    },
    {
        grId: 'gr-2', grNumber: 'GR-2', poId: 'po-1', poNumber: 'PO-1', vendor: 'Vendor',
        ataDate: '2026-09-19', warehouse: 'W3', receiver: 'Receiver', approver: 'Approver',
        totalCrates: 50, itemCount: 1, items: [{ sku: 'B', product: 'B', grQty: 50 }]
    },
    {
        grId: 'gr-3', grNumber: 'GR-3', poId: 'po-1', poNumber: 'PO-1', vendor: 'Vendor',
        ataDate: '2026-09-19', warehouse: 'W3', receiver: 'Another receiver', approver: 'Approver',
        totalCrates: 25, itemCount: 1, items: [{ sku: 'C', product: 'C', grQty: 25 }]
    }
]);

assert.equal(grouped.length, 2, 'same PO/date/warehouse/receiver/approver should render as one receiving round');
const sameRound = grouped.find(row => row.receiver === 'Receiver');
assert.equal(sameRound.totalCrates, 150, 'grouped receiving round must sum crates');
assert.equal(sameRound.itemCount, 2, 'grouped receiving round must sum item count');
assert.deepEqual(Array.from(sameRound.grNumbers), ['GR-1', 'GR-2'], 'grouped row must retain source GR numbers');

assert.equal(sandbox.getGrDashboardApprover({ receiver: 'สอน', approver: 'สอน' }), 'ไม่ระบุ', 'receiver-derived approver must not be shown as an approval');
assert.equal(sandbox.getGrDashboardApprover({ receiver: 'สอน', approver: 'Chen' }), 'Chen', 'authenticated Chen approval must remain visible');

sandbox.renderGrDailyChart([{ date: '2026-09-19', billCount: 3, itemCount: 7, totalCrates: 351 }]);
const chartHtml = element('dashboard-daily-chart').innerHTML;
assert.match(chartHtml, />3 บิล</, 'daily chart must label the number of receipt bills');
assert.match(chartHtml, />7 รายการ</, 'daily chart must label item count separately');
assert.match(chartHtml, /height:\s*150px/, 'daily chart bar height must be based on bill count for the highest-volume day');

sandbox.grDashboardState.analytics = {
    bills: [
        { ataDate: '2026-09-19', itemCount: 3 },
        { ataDate: '2026-09-19', itemCount: 2 },
        { ataDate: '2026-09-19', itemCount: 2 }
    ]
};
sandbox.renderGrDailyChart([{ date: '2026-09-19', billCount: 3, totalCrates: 351 }]);
assert.match(element('dashboard-daily-chart').innerHTML, />7 รายการ</, 'legacy RPC responses must derive item count from loaded bills during migration rollout');

sandbox.renderGrDashboardBillsTable([
    { grId: 'gr-1', grNumber: 'GR-1', poId: 'po-1', poNumber: 'PO-1', vendor: 'Vendor', ataDate: '2026-09-19', warehouse: 'W3', receiver: 'Receiver', approver: 'Chen', totalCrates: 100, itemCount: 1, items: [{ sku: 'A', product: 'A', grQty: 100 }] },
    { grId: 'gr-2', grNumber: 'GR-2', poId: 'po-1', poNumber: 'PO-1', vendor: 'Vendor', ataDate: '2026-09-19', warehouse: 'W3', receiver: 'Receiver', approver: 'Chen', totalCrates: 50, itemCount: 2, items: [{ sku: 'B', product: 'B', grQty: 25 }, { sku: 'C', product: 'C', grQty: 25 }] },
    { grId: 'gr-3', grNumber: 'GR-3', poId: 'po-1', poNumber: 'PO-1', vendor: 'Vendor', ataDate: '2026-09-19', warehouse: 'W3', receiver: 'Receiver', approver: 'Chen', totalCrates: 25, itemCount: 4, items: [{ sku: 'D', product: 'D', grQty: 25 }] }
]);
const tableHtml = element('dashboard-bills-tbody').innerHTML;
assert.match(tableHtml, /รวม 7 รายการในรอบเดียวกัน/, 'same-round row must describe seven items, not three bills');
assert.doesNotMatch(tableHtml, /รวม 3 บิลในรอบเดียวกัน/, 'same-round row must not mislabel source receipts as item count');

console.log('PASS gr-dashboard-followup: chart sizing, same-round grouping, pagination contract, and historical approver contract are covered');
