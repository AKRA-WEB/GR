const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function createTest() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const scriptRegex = /<script.*?>([\s\S]*?)<\/script>/g;
    let allScripts = '';
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        allScripts += match[1] + '\n';
    }

    const classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    function createMockElement(opts = {}) {
        return {
            value: opts.value || '',
            dataset: opts.dataset || {},
            classList,
            querySelector: (sel) => {
                if (opts.querySelectorMap && opts.querySelectorMap[sel]) return opts.querySelectorMap[sel];
                return createMockElement();
            },
            querySelectorAll: () => [],
            addEventListener: () => {},
            appendChild: () => {},
            disabled: false,
            className: ''
        };
    }

    let lastNotification = null;

    async function runTestWithExpValue(expValue, options = {}) {
        lastNotification = null;
        const calls = [];
        const errorMarks = { po: false, po2: false, extra: false, poExpiry: false, extraExpiry: false };
        const poExpiry = createMockElement({ value: expValue });
        const extraExpiry = createMockElement({ value: options.extraExpValue ?? expValue });
        poExpiry.classList = { add: name => { if (name === 'input-error') errorMarks.poExpiry = true; }, remove: () => {} };
        extraExpiry.classList = { add: name => { if (name === 'input-error') errorMarks.extraExpiry = true; }, remove: () => {} };
        const poOldStock = createMockElement({ value: options.poOldStock ?? '5' });
        const poOldStock2 = createMockElement({ value: options.poOldStock2 ?? '' });
        const extraOldStock = createMockElement({ value: options.extraOldStock ?? '3' });
        const extraProductInput = createMockElement({
            value: 'extra prod',
            dataset: options.extraSelectedSku ? { selectedSku: options.extraSelectedSku, selectedUnit: options.extraSelectedUnit || '' } : {}
        });
        const extraSkuInput = createMockElement({ value: options.extraHiddenSku ?? '' });
        const extraUnitInput = createMockElement({ value: options.extraUnitValue ?? 'unit' });
        poOldStock.classList = { add: name => { if (name === 'input-error') errorMarks.po = true; }, remove: () => {} };
        poOldStock2.classList = { add: name => { if (name === 'input-error') errorMarks.po2 = true; }, remove: () => {} };
        extraOldStock.classList = { add: name => { if (name === 'input-error') errorMarks.extra = true; }, remove: () => {} };
        const splitWrap = createMockElement();
        splitWrap.classList = { contains: name => name === 'hidden' && !options.split };
        
        const mockDoc = {
            getElementById: (id) => {
                if (id === 'gr-issue-normal') return { checked: true };
                if (id === 'gr-issue-note') return { value: '' };
                if (id === 'lift-fee-container') return null;
                if (id === 'toast-container') return createMockElement();
                if (id === 'r-group-index') return createMockElement({ value: '0' });
                if (id === 'r-ata') return createMockElement({ value: '2026-09-08' });
                if (id === 'r-receiver') return createMockElement({ value: 'Receiver' });
                if (id === 'r-remark') return createMockElement({ value: '' });
                if (id === 'btn-confirm-receive') return createMockElement();
                if (id === 'btn-draft') return createMockElement();
                if (id === 'btn-review') return createMockElement();
                if (id === 'btn-recall') return createMockElement();
                if (id === 'btn-reset') return createMockElement();
                return createMockElement();
            },
            querySelectorAll: (sel) => {
                if (sel === '.po-item-row') {
                    return [createMockElement({
                        dataset: { rownum: '1', uid: 'uuid-1' },
                        querySelectorMap: {
                            '.po-exp': poExpiry,
                            '.po-no-expiry': { checked: options.poNoExpiry === true },
                            '.po-qty': createMockElement({ value: options.poQty ?? '10' }),
                            '.po-unit': createMockElement({ value: 'unit' }),
                            '.po-loc-wh': createMockElement({ value: 'W1' }),
                            '.po-loc-floor': createMockElement({ value: '1' }),
                            '.po-old-stock': poOldStock,
                            '.po-old-stock2': poOldStock2,
                            '.po-split': splitWrap,
                            '.po-loc-wh2': createMockElement({ value: options.poWarehouse2 ?? 'W5' }),
                            '.po-loc-floor2': createMockElement({ value: '1' }),
                            '.po-qty2': createMockElement({ value: options.poQty2 ?? '' })
                        }
                    })];
                }
                if (sel === '.extra-item-row') {
                    return [createMockElement({
                        querySelectorMap: {
                            '.ex-exp': extraExpiry,
                            '.ex-no-expiry': { checked: options.extraNoExpiry === true },
                            '.ex-qty': createMockElement({ value: '10' }),
                            '.ex-product': extraProductInput,
                            '.ex-sku': extraSkuInput,
                            '.ex-unit': extraUnitInput,
                            '.ex-loc-wh': createMockElement({ value: 'W1' }),
                            '.ex-loc-floor': createMockElement({ value: '1' }),
                            '.ex-old-stock': extraOldStock
                        }
                    })];
                }
                return [];
            },
            querySelector: () => createMockElement(),
            createElement: () => createMockElement(),
            head: { appendChild: () => {} },
            body: { appendChild: () => {}, classList },
            addEventListener: () => {}
        };

        const context = {
            crypto: require('node:crypto').webcrypto,
            document: mockDoc,
            window: { 
                location: { search: '', href: '' }, 
                addEventListener: () => {}, 
                speechSynthesis: { cancel: () => {} },
                scrollTo: () => {},
                appSession: { roles: ['ADMIN'], perms: { 'app-gr': ['approveGR', 'receiveGR'] }, token: 'mock-token' },
                AkraSupabaseGR: { request: async (action, payload) => {
                    calls.push({ action, payload });
                    return { success: true };
                } }
            },
            URLSearchParams: class { get() { return null; } },
            console: { ...console, error: () => {}, log: () => {} },
            setTimeout: (cb, delay) => {
                // If it's the notification timeout, capture the text
                if (delay === 5000) return setTimeout(cb, delay);
                cb();
            },
            clearTimeout: clearTimeout,
            Date: Date,
            parseFloat: parseFloat,
            String: String,
            Array: Array,
            Object: Object,
            fetch: async () => ({ ok: true, json: async () => ({}) }),
            alert: () => {},
            URL: URL,
            global: global,
            APP_CONFIG: {},
            DATA_SCRIPT_URL: '',
            appData: {},
            localStorage: { removeItem: () => {} },
            groupedPOs: [{ poDate: '2026-09-08', vendor: 'Vendor', poNumber: 'PO-1', warehouse: 'W1', refPrUid: 'PR-1', items: [{ uid: 'uuid-1', status: 'Pending GR', sku: 'SKU-1', product: 'P1' }] }],
            currentActiveGroup: null,
            isDraft: false,
            currentBillHadLoadedExtras: false,
            receivingMutationInFlight: false,
            UI: { showLoading: () => {}, showError: () => {}, showApp: () => {} },
            showDataLoading: () => {},
            hideDataLoading: () => {},
            apiCall: async () => ({ success: true }),
            Utilities_formatDateFrontEnd: (d) => d,
            itemUids: () => ['uuid-1'],
            usableBillRefUid: () => '',
            serializeLoc: () => '',
            lucide: { createIcons: () => {} },
            session: { roles: ['ADMIN'], perms: { 'app-gr': ['receiveGR'] } },
            navigator: { onLine: true },
            canApproveGR: () => true,
            canReceiveGR: () => true,
            can: () => true,
            hasGrAccess: () => true
        };

        // Capture notification text inside createMockElement / DOM appending
        const originalCreateElement = mockDoc.createElement;
        mockDoc.createElement = (tag) => {
            const el = originalCreateElement(tag);
            let textContent = '';
            Object.defineProperty(el, 'innerHTML', {
                set: (val) => {
                    // Extract text from `<p>${msg}</p>`
                    const match = val.match(/<p[^>]*>(.*?)<\/p>/);
                    if (match) lastNotification = match[1];
                }
            });
            return el;
        };

        vm.createContext(context);
        const script = new vm.Script(allScripts);
        script.runInContext(context);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/gr-dashboard-v2.js'), 'utf8'), context);
        context.appData.grSchemaVersion=2;

        context.groupedPOs = [{ poDate: '2026-09-08', vendor: 'Vendor', poNumber: 'PO-1', warehouse: 'W1', refPrUid: 'PR-1', items: [{ uid: 'uuid-1', status: 'Pending GR', sku: 'SKU-1', product: 'P1' }] }];

        // Run the function
        await context.submitReceiving({ preventDefault: () => {} }, options.targetStatus || 'GR Completed');
        
        return { notification: lastNotification, calls, errorMarks };
    }

    let char200 = 'a'.repeat(200);
    let result = await runTestWithExpValue(char200);
    assert.strictEqual(result.notification, "ยืนยันรับเข้าคลังเรียบร้อย! (บิลย้ายไปที่แท็บ 'รับแล้ว')", '200 chars should pass length validation');
    assert.equal(result.calls.length, 1, 'valid receipt should reach the API once');

    let char201 = 'a'.repeat(201);
    result = await runTestWithExpValue(char201);
    assert.strictEqual(result.notification, 'ข้อความวันหมดอายุหรือรหัส Lot ยาวเกิน 200 ตัวอักษร', '201 chars should fail length validation');

    const expiryWarning = 'กรุณากรอกวันหมดอายุหรือเลือกไม่มีวันหมดอายุสำหรับสินค้าที่รับทุกรายการ';
    result = await runTestWithExpValue('');
    assert.equal(result.notification, expiryWarning, 'blank expiry choice must be explained');
    assert.equal(result.calls.length, 0, 'blank expiry choice must block API');
    assert.equal(result.errorMarks.poExpiry, true);
    assert.equal(result.errorMarks.extraExpiry, true);

    result = await runTestWithExpValue('', { poNoExpiry: true, extraNoExpiry: true });
    assert.equal(result.calls.length, 1, 'checked no-expiry choices must reach API');
    assert.equal(result.calls[0].payload.items[0].noExpiry, true);
    assert.equal(result.calls[0].payload.extraItems[0].noExpiry, true);
    assert.equal(result.calls[0].payload.items[0].exp, '');
    assert.equal(result.calls[0].payload.items[0].lotCode, '');

    result = await runTestWithExpValue('G2C', { poNoExpiry: true, extraNoExpiry: true, extraExpValue: 'B-7' });
    assert.equal(result.calls.length, 1, 'lot codes in no-expiry mode must reach API');
    assert.equal(result.calls[0].payload.items[0].exp, '');
    assert.equal(result.calls[0].payload.items[0].lotCode, 'G2C');
    assert.equal(result.calls[0].payload.extraItems[0].exp, '');
    assert.equal(result.calls[0].payload.extraItems[0].lotCode, 'B-7');

    result = await runTestWithExpValue('31 ธ.ค. 69', { extraExpValue: '', extraNoExpiry: true });
    assert.equal(result.calls.length, 1, 'raw expiry and checked no-expiry may coexist on separate rows');
    assert.equal(result.calls[0].payload.items[0].exp, '31 ธ.ค. 69');
    assert.equal(result.calls[0].payload.items[0].lotCode, '');
    assert.equal(result.calls[0].payload.items[0].noExpiry, false);
    assert.equal(result.calls[0].payload.extraItems[0].noExpiry, true);

    const oldStockWarning = 'กรุณากรอกสต๊อกเก่าสำหรับสินค้าที่รับทุกรายการ (ใส่ 0 หากไม่มีสต๊อกเดิม)';
    const validExpiry = '31/12/2026';
    result = await runTestWithExpValue(validExpiry, {
        extraNoExpiry: true,
        extraSelectedSku: 'LOCAL-002',
        extraSelectedUnit: 'ถุง',
        extraUnitValue: ''
    });
    assert.equal(result.calls.length, 1, 'a selected catalog product must submit even if its hidden field is empty');
    assert.equal(result.calls[0].payload.extraItems[0].sku, 'LOCAL-002');
    assert.equal(result.calls[0].payload.extraItems[0].unit, 'ถุง');

    result = await runTestWithExpValue(validExpiry, { poOldStock: '' });
    assert.equal(result.notification, oldStockWarning, 'blank PO old stock must be explained');
    assert.equal(result.calls.length, 0, 'blank PO old stock must block the API');
    assert.equal(result.errorMarks.po, true, 'blank PO old stock must be marked');

    result = await runTestWithExpValue(validExpiry, { extraOldStock: '', targetStatus: 'Pending Review' });
    assert.equal(result.notification, oldStockWarning, 'blank extra old stock must be explained');
    assert.equal(result.calls.length, 0, 'blank extra old stock must block review submission');
    assert.equal(result.errorMarks.extra, true, 'blank extra old stock must be marked');

    result = await runTestWithExpValue(validExpiry, { poOldStock: '0', extraOldStock: '0' });
    assert.equal(result.calls.length, 1, 'zero old stock must be accepted');
    assert.equal(result.calls[0].payload.items[0].oldStock, '0');
    assert.equal(result.calls[0].payload.items[0].oldStockByWarehouse.W1, '0');
    assert.equal(result.calls[0].payload.extraItems[0].oldStock, '0');
    assert.equal(result.calls[0].payload.extraItems[0].oldStockByWarehouse.W1, '0');

    result = await runTestWithExpValue(validExpiry, { split: true, poQty2: '2', poOldStock2: '' });
    assert.equal(result.calls.length, 0, 'missing second receiving warehouse count must block API');
    assert.equal(result.errorMarks.po2, true, 'second warehouse count must be marked');

    result = await runTestWithExpValue(validExpiry, { split: true, poQty2: '2', poOldStock: '0', poOldStock2: '7' });
    assert.equal(result.calls.length, 1, 'split warehouse counts must reach API');
    assert.equal(result.calls[0].payload.items[0].oldStockByWarehouse.W1, '0');
    assert.equal(result.calls[0].payload.items[0].oldStockByWarehouse.W5, '7');

    result = await runTestWithExpValue(validExpiry, { split: true, poQty2: '2', poOldStock: '0', poWarehouse2: 'W1', poOldStock2: '' });
    assert.equal(result.calls.length, 1, 'two locations in the same warehouse share one checked count');
    assert.equal(Object.keys(result.calls[0].payload.items[0].oldStockByWarehouse).length, 1);

    result = await runTestWithExpValue(validExpiry, { split: true, poQty: '0', poQty2: '2', poOldStock: '0', poOldStock2: '0' });
    assert.equal(result.calls.length, 0, 'a final split must receive a positive quantity in each warehouse');

    result = await runTestWithExpValue('', { poOldStock: '', extraOldStock: '', targetStatus: 'Draft GR' });
    assert.equal(result.calls.length, 1, 'draft must allow blank old stock');

    result = await runTestWithExpValue('', { split: true, poQty2: '2', poOldStock: '', poOldStock2: '', targetStatus: 'Draft GR' });
    assert.equal(result.calls.length, 1, 'draft split must allow both counts blank');
    result = await runTestWithExpValue('', { split: true, poQty: '0', poQty2: '2', poOldStock: '', poOldStock2: '', targetStatus: 'Draft GR' });
    assert.equal(result.calls.length, 1, 'draft split may still have an incomplete first quantity');

    result = await runTestWithExpValue(validExpiry, { poQty: '', poOldStock: '', extraOldStock: '0' });
    assert.equal(result.calls.length, 1, 'unreceived PO row must not require old stock');
    
    console.log('PASS gr-submit-payload: submitReceiving payload behavior, 200/201 char boundary validation, and vm.Script syntax compilation verified');
}

createTest().catch(err => {
    console.error(err);
    process.exit(1);
});
