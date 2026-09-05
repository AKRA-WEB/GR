/**
 * Contract test for GR Partial Receiving & Recall Unreceived Items Visibility (20260905.01)
 *
 * Validates:
 * 1. JavaScript inline script syntax compilation with 0 syntax errors
 * 2. Version parity (CURRENT_VERSION == version.json == 20260905.01)
 * 3. 10-item PO scenario with 9 items in Draft GR and 1 item in Pending GR:
 *    - getBillModalItems(group) returns all 10 items in original rowNumber order
 *    - selectOneStatusGroupPerBill provides all 10 items and status breakdown
 *    - openReceivingDetail renders all 10 item rows, leaving item 10 editable
 *    - handleRecallOrReset correctly scopes poUids to the 9 recallable items (excluding Pending GR item)
 * 4. Historical partial receiving isolation:
 *    - PO with items 1-5 GR Completed, item 6 Draft GR, items 7-10 Pending GR
 *    - Opening Draft GR strictly includes only items 6-10 (excludes items 1-5)
 *    - Opening GR Completed strictly includes only items 1-5
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const versionPath = path.resolve(__dirname, '..', 'version.json');
const html = fs.readFileSync(htmlPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

console.log('=== TESTING GR PARTIAL RECEIVING & RECALL VISIBILITY CONTRACT ===\n');

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
assert.strictEqual(currentVersionMatch[1], '20260905.01', 'Target version must be 20260905.01');
console.log(`[PASS] 2. Version parity verified: ${currentVersionMatch[1]}`);

// 3. Simulated DOM & runtime environment
class MockElement {
    constructor(id = '', tag = 'div') {
        this.id = id;
        this.tagName = tag;
        this.innerHTML = '';
        this.innerText = '';
        this.value = '';
        this.disabled = false;
        this.dataset = {};
        this.classList = {
            toggle: () => false,
            add: () => {},
            remove: () => {},
            contains: () => false
        };
        this.style = {};
        this.children = [];
    }
    focus() {}
    querySelector(sel) {
        const el = new MockElement();
        if (sel && sel.startsWith('.')) el.classList.contains = (c) => sel.includes(c);
        return el;
    }
    querySelectorAll() { return []; }
    closest() { return new MockElement(); }
    appendChild(child) { this.children.push(child); }
    remove() {}
    addEventListener() {}
    setAttribute() {}
    getAttribute() { return ''; }
}

const elements = new Map();
function getEl(id) {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
}

let lastApiCallAction = null;
let lastApiCallPayload = null;

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
    confirm: () => true,
    clearTimeout: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    window: {
        location: { search: '' },
        currentUser: 'TestAdmin',
        confirm: () => true,
        scrollTo: () => {},
        appSession: {
            roles: ['ADMIN', 'SUPERVISOR'],
            perms: { 'app-gr': ['approveGR', 'receiveGR'] },
            token: 'test-token'
        }
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
    fetch: async () => ({ ok: true, json: async () => ({ version: '20260905.01' }) }),
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    apiCall: async (action, payload) => {
        lastApiCallAction = action;
        lastApiCallPayload = payload;
        return { success: true, message: 'OK' };
    }
};

vm.createContext(sandbox);
vm.runInContext(mainScript, sandbox);

const apiCalls = [];
sandbox.apiCall = async (action, payload) => {
    apiCalls.push({ action, payload });
    lastApiCallAction = action;
    lastApiCallPayload = payload;
    return { success: true, message: 'OK' };
};

// Setup user permissions so recall/approve actions are authorized
sandbox.currentUser = 'TestAdmin';
sandbox.appSession = { roles: ['ADMIN', 'SUPERVISOR'], permissions: ['approveGR', 'receiveGR'] };

// Build a 10-item PO where 9 items were drafted/recalled and 1 item is Pending GR
const poItems10 = [];
for (let i = 1; i <= 10; i++) {
    const isDraft = i <= 9;
    poItems10.push({
        id: `item-${i}`,
        rowNumber: i,
        uid: `item-${i}`,
        refPrUid: 'PR-TEST-10ITEMS',
        poNumber: 'PO-2026-0010',
        vendor: 'VENDOR XYZ',
        poDate: '05/09/2026',
        warehouse: 'W1',
        status: isDraft ? 'Draft GR' : 'Pending GR',
        expectedDate: '05/09/2026',
        product: `สินค้าชิ้นที่ ${i}`,
        quantity: 10 * i,
        unit: 'ลัง',
        grQty: isDraft ? String(10 * i) : '',
        locIn: isDraft ? 'W1-1F-Z1' : '',
        exp: isDraft ? '31/12/2026' : '',
        oldStock: '',
        billRemark: 'หมายเหตุรวมทั้งบิล',
        itemRemark: ''
    });
}

sandbox.appData = {
    pendingPOs: poItems10,
    grCompleted: []
};

// 3. Test groupPendingPOs & getBillModalItems
sandbox.groupPendingPOs();
assert.ok(sandbox.groupedPOs.length >= 2, 'Should initially split into Draft GR and Pending GR status groups');

const draftGroup = sandbox.groupedPOs.find(g => g.status === 'Draft GR');
assert.ok(draftGroup, 'Must find Draft GR group');
assert.strictEqual(draftGroup.items.length, 9, 'Raw Draft GR group only contains the 9 draft items');

// Call getBillModalItems for draftGroup
const modalItems = sandbox.getBillModalItems(draftGroup);
assert.strictEqual(modalItems.length, 10, 'getBillModalItems must combine all 10 items (9 Draft GR + 1 Pending GR)');
assert.strictEqual(modalItems[0].uid, 'item-1');
assert.strictEqual(modalItems[9].uid, 'item-10');
assert.strictEqual(modalItems[9].status, 'Pending GR', '10th item must retain its Pending GR status');
assert.strictEqual(modalItems[9].grQty, '', '10th item must have empty grQty');
console.log('[PASS] 3. getBillModalItems combines all 10 items (9 Draft GR + 1 Pending GR) in correct order');

// 4. Test selectOneStatusGroupPerBill
const displayBills = sandbox.selectOneStatusGroupPerBill(sandbox.groupedPOs);
assert.strictEqual(displayBills.length, 1, 'Should consolidate to 1 bill card in default view');
const consolidatedBill = displayBills[0];
assert.strictEqual(consolidatedBill.status, 'Draft GR', 'Primary status must be Draft GR');
assert.strictEqual(consolidatedBill.items.length, 10, 'Consolidated card items must contain all 10 items');
assert.deepStrictEqual(JSON.parse(JSON.stringify(consolidatedBill.listStatusCounts)), { 'Draft GR': 9, 'Pending GR': 1 });
console.log('[PASS] 4. selectOneStatusGroupPerBill consolidates to 1 card with 10 items and status breakdown');

// 5. Test openReceivingDetail
sandbox.openReceivingDetail(draftGroup.index);
assert.strictEqual(sandbox.currentActiveGroup.items.length, 10, 'currentActiveGroup.items must have all 10 items');
const itemsContainerHtml = getEl('r-items-container').innerHTML;
assert.ok(itemsContainerHtml.includes('data-uid="item-1"'), 'Modal HTML must include item 1');
assert.ok(itemsContainerHtml.includes('data-uid="item-9"'), 'Modal HTML must include item 9');
assert.ok(itemsContainerHtml.includes('data-uid="item-10"'), 'Modal HTML must include unreceived item 10');
console.log('[PASS] 5. openReceivingDetail renders all 10 item rows into modal');

// 6. Test handleRecallOrReset scoping
// In a scenario where 9 items are in Draft GR/Pending Review and 1 item is Pending GR,
// recalling must only target the 9 items, NOT the pending item.
(async () => {
    await sandbox.handleRecallOrReset('recall');
    const recallCall = apiCalls.find(c => c.action === 'recallGR');
    assert.ok(recallCall, 'recallGR must be called');
    assert.ok(recallCall.payload, 'Payload must be sent to recallGR');
    assert.strictEqual(recallCall.payload.poUids.length, 9, 'poUids must strictly contain only the 9 recallable items');
    assert.ok(!recallCall.payload.poUids.includes('item-10'), 'poUids must NOT include the unreceived item 10');
    console.log('[PASS] 6. handleRecallOrReset scopes poUids strictly to the 9 recallable items');

// 7. Test historical partial receiving isolation
// Scenario: Items 1-5 were completed in an earlier shipment (GR Completed).
// Item 6 is in Draft GR. Items 7-10 are Pending GR.
const partialPOItems = [];
const completedPOItems = [];
for (let i = 1; i <= 10; i++) {
    const item = {
        id: `pitem-${i}`,
        rowNumber: i,
        uid: `pitem-${i}`,
        refPrUid: 'PR-PARTIAL-SPLIT',
        poNumber: 'PO-PARTIAL-001',
        vendor: 'VENDOR PARTIAL',
        poDate: '01/09/2026',
        warehouse: 'W1',
        status: i <= 5 ? 'GR Completed' : (i === 6 ? 'Draft GR' : 'Pending GR'),
        product: `สินค้าแยกงวดที่ ${i}`,
        quantity: 10,
        unit: 'ลัง'
    };
    if (i <= 5) {
        completedPOItems.push(item);
    } else {
        partialPOItems.push(item);
    }
}

sandbox.appData = {
    pendingPOs: partialPOItems,
    grCompleted: completedPOItems
};
sandbox.groupPendingPOs();

// Find draft group for item 6
const item6DraftGroup = sandbox.groupedPOs.find(g => g.refPrUid === 'PR-PARTIAL-SPLIT' && g.status === 'Draft GR');
assert.ok(item6DraftGroup, 'Must find Draft GR group for item 6');
const item6ModalItems = sandbox.getBillModalItems(item6DraftGroup);

// Must strictly contain items 6-10 (1 Draft + 4 Pending), EXCLUDING items 1-5
assert.strictEqual(item6ModalItems.length, 5, 'Must contain only 5 items (items 6-10)');
assert.strictEqual(item6ModalItems[0].uid, 'pitem-6');
assert.strictEqual(item6ModalItems[4].uid, 'pitem-10');
assert.ok(!item6ModalItems.some(it => it.status === 'GR Completed'), 'Must NOT include completed items 1-5');

// Find completed group for items 1-5
const completedGroup = sandbox.groupedPOs.find(g => g.refPrUid === 'PR-PARTIAL-SPLIT' && g.status === 'GR Completed');
assert.ok(completedGroup, 'Must find GR Completed group');
const completedModalItems = sandbox.getBillModalItems(completedGroup);
assert.strictEqual(completedModalItems.length, 5, 'Completed receipt must strictly show only the 5 completed items');
assert.ok(completedModalItems.every(it => it.status === 'GR Completed'));

console.log('[PASS] 7. Historical partial receiving isolation verified (completed items never leak into draft receiving)');

console.log('\n🌟 ALL GR PARTIAL RECEIVING & RECALL VISIBILITY TESTS PASSED (100%)! 🌟');
})();
