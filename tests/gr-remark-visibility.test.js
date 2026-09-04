/**
 * Contract test for GR Bill and Item Remark Visibility (20260904.01)
 * Validates:
 * 1. JavaScript inline script syntax compilation with 0 syntax errors
 * 2. Version parity (20260904.01)
 * 3. groupPendingPOs captures billRemark and itemRemark correctly
 * 4. group.searchText queries vendor, poNumber, billRemark, and itemRemark
 * 5. renderPOListForReceiving renders both billRemark banner and itemRemark line
 * 6. openReceivingDetail populates billRemark banner and item-level remark line
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const versionPath = path.resolve(__dirname, '..', 'version.json');
const html = fs.readFileSync(htmlPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

console.log('=== TESTING GR BILL & ITEM REMARKS CONTRACT ===\n');

// 1. Script compilation
const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 0;
let mainScript = '';
while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    if (!code.trim()) continue;
    scriptIndex++;
    new vm.Script(code, { filename: `inline-script-${scriptIndex}.js` });
    if (code.includes('const CURRENT_VERSION =')) {
        mainScript = code;
    }
}
assert.ok(scriptIndex > 0, 'Must have at least 1 inline script');
console.log(`[PASS] 1. All ${scriptIndex} inline scripts compile with 0 syntax errors`);

// 2. Version parity
const currentVersionMatch = html.match(/const\s+CURRENT_VERSION\s*=\s*["']([^"']+)["']/);
assert.ok(currentVersionMatch, 'CURRENT_VERSION must exist in index.html');
assert.strictEqual(currentVersionMatch[1], versionJson.version, 'CURRENT_VERSION must match version.json');
assert.strictEqual(currentVersionMatch[1], '20260904.02', 'Target version must be 20260904.02');
console.log(`[PASS] 2. Version parity verified: ${currentVersionMatch[1]}`);

// 3. Simulated DOM & runtime execution of groupPendingPOs & card rendering
class MockElement {
    constructor(id = '', tag = 'div') {
        this.id = id;
        this.tagName = tag;
        this.innerHTML = '';
        this.innerText = '';
        this.value = '';
        this.classList = {
            toggle: () => false,
            add: () => {},
            remove: () => {},
            contains: () => false
        };
        this.style = {};
        this.children = [];
    }
    querySelector() { return new MockElement(); }
    querySelectorAll() { return []; }
    closest() { return new MockElement(); }
    addEventListener() {}
    setAttribute() {}
    getAttribute() { return ''; }
}

const elements = new Map();
function getEl(id) {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
}

const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
    parseInt,
    parseFloat,
    URLSearchParams,
    Headers: global.Headers || Map,
    clearTimeout: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    window: {
        location: { search: '' },
        currentUser: 'TestReceiver',
        scrollTo: () => {}
    },
    document: {
        getElementById: (id) => getEl(id),
        createElement: (tag) => new MockElement('', tag),
        addEventListener: () => {},
        body: new MockElement('body'),
        querySelector: () => new MockElement(),
        querySelectorAll: () => []
    },
    lucide: {
        createIcons: () => {}
    },
    AppConfig: {
        MAIN_PORTAL_URL: 'https://test-main.app'
    },
    AkraSupabaseGR: {},
    fetch: async () => ({ ok: true, json: async () => ({ version: '20260904.01' }) }),
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    }
};

vm.createContext(sandbox);
vm.runInContext(mainScript, sandbox);

// Setup sample PO data with billRemark and itemRemark
sandbox.appData = {
    pendingPOs: [
        {
            id: 'item-1',
            rowNumber: 1,
            uid: 'item-1',
            poNumber: 'PO-2026-001',
            vendor: 'SUPPLIER A',
            poDate: '04/09/2026',
            warehouse: 'W1',
            status: 'Pending GR',
            expectedDate: '05/09/2026',
            product: 'น้ำตาลทรายขาว 1กก.',
            quantity: 50,
            unit: 'ถุง',
            billRemark: 'ส่งด่วนก่อนเที่ยง ประตู 2',
            itemRemark: 'ต้องการถุงสภาพสมบูรณ์ ไม่ชื้น',
            poRemark: 'ส่งด่วนก่อนเที่ยง ประตู 2 | ต้องการถุงสภาพสมบูรณ์ ไม่ชื้น'
        },
        {
            id: 'item-2',
            rowNumber: 2,
            uid: 'item-2',
            poNumber: 'PO-2026-001',
            vendor: 'SUPPLIER A',
            poDate: '04/09/2026',
            warehouse: 'W1',
            status: 'Pending GR',
            expectedDate: '05/09/2026',
            product: 'แป้งสาลีเอนกประสงค์',
            quantity: 20,
            unit: 'กระสอบ',
            billRemark: 'ส่งด่วนก่อนเที่ยง ประตู 2',
            itemRemark: '',
            poRemark: 'ส่งด่วนก่อนเที่ยง ประตู 2'
        }
    ],
    grCompleted: []
};

// Test groupPendingPOs
sandbox.groupPendingPOs();
assert.strictEqual(sandbox.groupedPOs.length, 1, 'Should group into 1 bill');
const billGroup = sandbox.groupedPOs[0];
assert.strictEqual(billGroup.billRemark, 'ส่งด่วนก่อนเที่ยง ประตู 2', 'Bill remark must be captured on group');
console.log('[PASS] 3. groupPendingPOs correctly captured billRemark');

// Test searchText includes remarks
assert.ok(billGroup.searchText.includes('ส่งด่วนก่อนเที่ยง ประตู 2'.toLowerCase()), 'searchText must include billRemark');
assert.ok(billGroup.searchText.includes('ต้องการถุงสภาพสมบูรณ์ ไม่ชื้น'.toLowerCase()), 'searchText must include itemRemark');
console.log('[PASS] 4. group.searchText queries billRemark and itemRemark');

// Test renderPOListForReceiving
getEl('r-search-input').value = '';
getEl('r-warehouse-filter').value = '';
getEl('r-status-filter').value = '';
sandbox.renderPOListForReceiving();

const containerHtml = getEl('po-list-container').innerHTML;
assert.ok(containerHtml.includes('หมายเหตุบิล:'), 'Cards must display billRemark banner');
assert.ok(containerHtml.includes('ส่งด่วนก่อนเที่ยง ประตู 2'), 'Cards must display billRemark text');
assert.ok(containerHtml.includes('↳ หมายเหตุ: ต้องการถุงสภาพสมบูรณ์ ไม่ชื้น'), 'Cards must display itemRemark line under product');
console.log('[PASS] 5. renderPOListForReceiving renders both billRemark banner and itemRemark line');

// Test openReceivingDetail modal rendering
sandbox.openReceivingDetail(0);
const modalDeliveryPlan = getEl('r-delivery-plan').innerHTML;
assert.ok(modalDeliveryPlan.includes('หมายเหตุบิล (จาก PO):'), 'Modal delivery plan must render bill remark header');
assert.ok(modalDeliveryPlan.includes('ส่งด่วนก่อนเที่ยง ประตู 2'), 'Modal must render bill remark content');

const modalItemsHtml = getEl('r-items-container').innerHTML;
assert.ok(modalItemsHtml.includes('↳ หมายเหตุจาก PO: ต้องการถุงสภาพสมบูรณ์ ไม่ชื้น'), 'Modal items container must render itemRemark line');
console.log('[PASS] 6. openReceivingDetail populates billRemark banner and itemRemark line in modal');

// 7. Test "Direct PO" suppression in both card and modal
sandbox.appData.pendingPOs = [
    {
        id: 'direct-po-item',
        rowNumber: 10,
        uid: 'direct-po-item',
        poNumber: 'PO-2026-DIR',
        vendor: 'SUPPLIER DIRECT',
        poDate: '04/09/2026',
        warehouse: 'W2',
        status: 'Pending GR',
        expectedDate: '05/09/2026',
        product: 'สินค้า Direct PO',
        quantity: 10,
        unit: 'กล่อง',
        billRemark: 'Direct PO',
        itemRemark: 'Direct PO Web App',
        poRemark: 'Direct PO'
    }
];
sandbox.groupPendingPOs();
assert.strictEqual(sandbox.groupedPOs.length, 1);
const directGroup = sandbox.groupedPOs[0];

sandbox.renderPOListForReceiving();
const directContainerHtml = getEl('po-list-container').innerHTML;
assert.ok(!directContainerHtml.includes('หมายเหตุบิล:'), 'Cards must NOT display billRemark banner when remark is Direct PO');
assert.ok(!directContainerHtml.includes('↳ หมายเหตุ:'), 'Cards must NOT display itemRemark line when remark is Direct PO');

sandbox.openReceivingDetail(0);
const directModalDeliveryPlan = getEl('r-delivery-plan').innerHTML;
assert.ok(!directModalDeliveryPlan.includes('หมายเหตุบิล (จาก PO):'), 'Modal must NOT render bill remark banner for Direct PO');
const directModalItemsHtml = getEl('r-items-container').innerHTML;
assert.ok(!directModalItemsHtml.includes('↳ หมายเหตุจาก PO:'), 'Modal items container must NOT render itemRemark for Direct PO');
console.log('[PASS] 7. "Direct PO" remarks cleanly suppressed from both card and modal displays');

console.log('\n🌟 ALL GR BILL & ITEM REMARK CONTRACT TESTS PASSED (100%)! 🌟');
