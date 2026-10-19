'use strict';
// Actual inline/dashboard runtime with fictional rows and a DOM fixture; no browser/network/SQL claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
scripts.forEach((source, index) => new vm.Script(source, { filename: `gr-inline-${index}.js` }));
const source = scripts.find(script => script.includes('async function submitReceiving'));
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'js/gr-dashboard-v2.js'), 'utf8');
const json = value => JSON.parse(JSON.stringify(value));
const poId = '10000000-0000-4000-8000-000000000001';
const eventId = '30000000-0000-4000-8000-000000000001';
const itemUid = index => `20000000-0000-4000-8000-00000000000${index}`;
const target = { poId, receivingEventId: eventId, fingerprint: '0123456789abcdef0123456789abcdef', itemCount: 3,
    grNumber: 'GR-FICTIONAL-001', ata: '2026-10-19', receiverName: 'Original receiver', warehouse: 'W2', remark: 'Original remark' };
const fixture = () => [1, 2, 3, 4].map(index => ({ uid: itemUid(index), poId, rowNumber: index, status: index < 4 ? 'Pending Review' : 'Pending GR',
    displayStatus: index < 4 ? 'Pending Review' : 'Pending GR', receivingEventId: index < 4 ? eventId : '',
    appendReviewSet: index === 4 ? { ...target } : null, refPrUid: 'DIRECT-FICTIONAL', poDate: '2026-10-01', poNumber: 'PO-FICTIONAL',
    warehouse: 'W2', vendor: 'Fictional vendor', sku: `FIX-${index}`, product: `Fictional product ${index}`, quantity: 5, unit: 'box',
    ata: index < 4 ? '19/10/2026' : '', receiverName: index < 4 ? target.receiverName : '', remark: index < 4 ? target.remark : '',
    grQty: index < 4 ? '5' : '', locIn: index < 4 ? 'W2-1F-Z' : '', oldStock: index < 4 ? '0' : '',
    exp: '', noExpiry: index < 4, lotCode: index < 4 ? `LOT-${index}` : '', liftRounds: 0 }));

function runtime() {
    const nodes = new Map(), calls = [], notices = [], listeners = {};
    let stored = fixture(), rows = [], extras = [], denied = false, resultMode = 'success', readFailed = false, readCount = 0;
    function element(id = '', tag = 'div') {
        let markup = '', fields = [], classNames = new Set();
        const node = { id, tagName: tag, dataset: {}, value: '', checked: false, disabled: false, innerText: '', textContent: '', children: [], style: {},
            classList: { add(...names) { names.forEach(name => classNames.add(name)); }, remove(...names) { names.forEach(name => classNames.delete(name)); },
                contains(name) { return classNames.has(name); }, toggle(name, force) { const next = force ?? !classNames.has(name); next ? classNames.add(name) : classNames.delete(name); return next; } },
            set className(value) { classNames = new Set(String(value).split(/\s+/)); }, get className() { return [...classNames].join(' '); },
            set innerHTML(value) {
                markup = String(value); fields = []; this.children = [];
                if (id === 'r-items-container') {
                    const starts = [...markup.matchAll(/<div\b[^>]*class="[^"]*\bpo-item-row\b[^"]*"[^>]*>/g)];
                    rows = starts.map((match, index) => {
                        const row = element(); row.dataset = { uid: match[0].match(/data-uid="([^"]*)"/)[1], rownum: match[0].match(/data-rownum="([^"]*)"/)[1] };
                        row.innerHTML = markup.slice(match.index + match[0].length, starts[index + 1]?.index ?? markup.length);
                        return row;
                    });
                    this.children = rows; return;
                }
                if (id === 'r-extra-items-container' && !markup) extras = [];
                if (id === 'r-lift-fee-section' && !markup) { nodes.delete('lift-fee-container'); nodes.delete('lift-fee-rounds'); }
                for (const match of markup.matchAll(/<(input|select|button|div|span|textarea)\b([^>]*)>/g)) {
                    const attrs = match[2], fieldId = attrs.match(/\bid="([^"]*)"/)?.[1] || '', field = element(fieldId, match[1]);
                    field.className = attrs.match(/\bclass="([^"]*)"/)?.[1] || '';
                    field.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || '';
                    field.checked = /\bchecked\b/.test(attrs); field.disabled = /\bdisabled\b/.test(attrs);
                    for (const data of attrs.matchAll(/data-([a-z]+)="([^"]*)"/g)) field.dataset[data[1]] = data[2];
                    if (match[1] === 'select') {
                        const content = markup.slice(match.index + match[0].length, markup.indexOf('</select>', match.index));
                        const options = [...content.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
                        field.value = (options.find(option => /\bselected\b/.test(option[2])) || options[0])?.[1] || '';
                    }
                    field.parentElement = this; fields.push(field);
                    if (fieldId) nodes.set(fieldId, field);
                }
            }, get innerHTML() { return markup; },
            querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
            querySelectorAll(selector) {
                const selectors = selector.split(',').map(value => value.trim());
                const candidates = id === 'r-items-container' ? rows.flatMap(row => row.querySelectorAll('input, select, button, div, span')) : fields;
                return candidates.filter(field => selectors.some(value => value[0] === '.' ? field.classList.contains(value.slice(1)) : field.tagName === value));
            },
            closest() { return this.parentElement; },
            appendChild(child) { this.children.push(child); }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {}, scrollTo() {}
        };
        return node;
    }
    const get = id => { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); };
    const queryAll = selector => {
        if (selector === '.po-item-row') return rows;
        if (selector === '.extra-item-row') return extras;
        if (selector === '.po-item-row input') return rows.flatMap(row => row.querySelectorAll('input'));
        if (selector === '.po-item-row select, .po-item-row .po-split-btn') return rows.flatMap(row => row.querySelectorAll('select, .po-split-btn'));
        if (selector === '.po-no-expiry, .ex-no-expiry') return rows.flatMap(row => row.querySelectorAll('.po-no-expiry'));
        return [];
    };
    const context = vm.createContext({ crypto, console, URL, URLSearchParams, Date, navigator: { onLine: true },
        document: { getElementById(id) { return id === 'lift-fee-container' ? nodes.get(id) || null : get(id); }, querySelectorAll: queryAll,
            querySelector(selector) { return selector === 'button[onclick="addExtraItemRow()"]' ? get('add-extra') : null; }, createElement: element,
            addEventListener() {}, body: element('body') },
        window: { location: { search: '', pathname: '/GR/' }, currentUser: 'Fixture receiver', scrollTo() {},
            addEventListener(type, handler) { listeners[type] = handler; },
            appSession: { token: 'fictional-token', identityId: '90000000-0000-4000-8000-000000000001', sessionVersion: 1, authorizationRevision: 'fixture' } },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, length: 0 }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        fetch: async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')) }),
        setTimeout() {}, clearTimeout() {}, setInterval() {}, lucide: { createIcons() {} }, matchMedia: () => ({ matches: true }) });
    vm.runInContext(source, context); vm.runInContext(dashboard, context);
    vm.runInContext('AppVersionGuard.start({ current: CURRENT_VERSION, readActions: [] });', context);
    context.showNotification = (message, type) => notices.push({ message, type });
    context.canReceiveGR = () => !denied; context.canApproveGR = () => true;
    context.initExpiryInputPreview = () => {}; context.syncNoExpiryControl = () => {};
    context.renderPOListForReceiving = () => {}; context.loadGRDeliveryPlanningBackground = () => {};
    context.readGRActiveData = async () => { readCount++; return readFailed ? { success: false } : { success: true, pendingPOs: json(stored), products: [], grSchemaVersion: 2 }; };
    context.window.AkraSupabaseGR = { async request(action, payload) {
        calls.push({ action, payload: json(payload) });
        if (resultMode === 'network') return { success: false, reason: 'request_timeout', message: 'Fixture uncertain response' };
        if (resultMode === 'conflict') return { success: false, reason: 'stale_append_review_target', status: 409, message: 'Fixture stale target' };
        if (payload.appendReviewSet) stored = stored.map(item => payload.items.some(row => row.uid === item.uid) ? { ...item,
            status: 'Pending Review', receivingEventId: eventId, appendReviewSet: null, grQty: payload.items.find(row => row.uid === item.uid).grQty,
            ata: '19/10/2026', receiverName: payload.receiverName, remark: payload.remark, locIn: payload.items[0].locIn,
            oldStock: payload.items[0].oldStock, noExpiry: payload.items[0].noExpiry, lotCode: payload.items[0].lotCode } : item);
        return { success: true };
    } };
    context.appData = { pendingPOs: json(stored), products: [], grSchemaVersion: 2 };
    context.groupPendingPOs();
    return { context, get, calls, notices, rows: () => rows, stored: () => stored, readCount: () => readCount,
        open(status = 'Pending GR') { context.openReceivingDetail(context.groupedPOs.findIndex(group => group.status === status)); },
        fill() { const row = rows[0]; row.querySelector('.po-qty').value = '7'; row.querySelector('.po-loc-floor').value = '1';
            row.querySelector('.po-loc-zone').value = 'NEW'; row.querySelector('.po-old-stock').value = '0';
            row.querySelector('.po-no-expiry').checked = true; row.querySelector('.po-exp').value = 'NEW-LOT'; },
        submit(status = 'Pending Review') { return context.submitReceiving({ preventDefault() {} }, status); },
        deny(value) { denied = value; }, result(value) { resultMode = value; }, failRead(value) { readFailed = value; },
        setRows(value) { rows = value; }, addExtra() { extras.push(element()); }, listeners };
}

async function run() {
    let rt = runtime(); rt.open(); rt.fill();
    assert.equal(rt.rows().length, 1, 'old three review rows are not in the new receiving form');
    assert.match(rt.get('r-append-review-context').innerText, /GR-FICTIONAL-001.*3 รายการ.*ยืนยันทั้งชุดครั้งเดียว/);
    for (const id of ['r-ata', 'r-receiver', 'r-remark']) assert.equal(rt.get(id).disabled, true);
    for (const id of ['r-extra-items-section', 'gr-issue-review', 'btn-draft', 'btn-confirm-receive']) assert.equal(rt.get(id).classList.contains('hidden'), true);
    assert.equal(rt.get('r-lift-fee-section').innerHTML, '');
    assert.equal(rt.get('add-extra').disabled, true);
    assert.equal(rt.rows()[0].querySelector('.po-qty').disabled, false);
    assert.equal(rt.rows()[0].querySelector('.po-loc-wh').disabled, false);
    rt.context.addExtraItemRow(); assert.equal(rt.get('r-extra-items-container').children.length, 0);
    rt.get('r-ata').value = '2027-01-01'; rt.get('r-receiver').value = 'Changed'; rt.get('r-remark').value = 'Changed';
    const oldRows = json(rt.stored().slice(0, 3));
    await rt.submit(); await new Promise(resolve => setImmediate(resolve));
    const payload = rt.calls[0].payload;
    assert.deepEqual(payload.appendReviewSet, { poId, receivingEventId: eventId, fingerprint: target.fingerprint, itemCount: 3 });
    assert.equal(payload.ata, target.ata); assert.equal(payload.receiverName, target.receiverName); assert.equal(payload.remark, target.remark);
    assert.equal(payload.groupInfo.warehouse, target.warehouse); assert.equal(payload.groupInfo.billRef, poId);
    assert.deepEqual(payload.groupPoUids, [itemUid(4)]); assert.equal(payload.items.length, 1); assert.equal(payload.items[0].uid, itemUid(4));
    assert.equal(payload.items[0].expectedStatus, 'Pending GR'); assert.equal(payload.items[0].grQty, '7');
    assert.equal(payload.items[0].locIn, 'W2-1F-NEW'); assert.equal(payload.items[0].noExpiry, true); assert.equal(payload.items[0].lotCode, 'NEW-LOT');
    for (const key of ['issueReview', 'lift', 'replaceExtras', 'extraItems']) assert.equal(Object.hasOwn(payload, key), false);
    assert.deepEqual(rt.stored().slice(0, 3), oldRows, 'fixture API receives no previous row changes');
    assert.ok(rt.readCount() > 0); assert.equal(rt.context.groupedPOs.filter(group => group.status === 'Pending Review').length, 1);
    assert.equal(rt.context.groupedPOs.find(group => group.status === 'Pending Review').items.length, 4, 'authoritative reload naturally combines event rows');
    rt.open('Pending Review'); assert.equal(rt.rows().length, 4); assert.equal(rt.get('btn-confirm-receive').classList.contains('hidden'), false);
    await rt.submit('GR Completed');
    assert.equal(rt.calls[1].payload.items.length, 4, 'normal subsequent confirmation submits the whole review set once');
    assert.equal(Object.hasOwn(rt.calls[1].payload, 'appendReviewSet'), false);
    assert.ok(rt.calls[1].payload.issueReview); assert.ok(rt.calls[1].payload.lift);

    rt = runtime(); rt.open(); rt.fill(); rt.result('network'); await rt.submit(); await rt.submit();
    assert.equal(rt.calls[0].payload.requestId, rt.calls[1].payload.requestId, 'identical uncertain retry retains request ID');
    rt.rows()[0].querySelector('.po-qty').value = '8'; await rt.submit();
    assert.notEqual(rt.calls[1].payload.requestId, rt.calls[2].payload.requestId, 'changed new receiving data gets a new request ID');
    for (const status of ['Draft GR', 'GR Completed']) { rt = runtime(); rt.open(); rt.fill(); await rt.submit(status); assert.equal(rt.calls.length, 0); }
    const driftCases = [
        current => { current.context.window.appSession.token = 'refreshed-token'; },
        current => { current.context.window.appSession = { ...current.context.window.appSession }; },
        current => { current.context.window.appSession.authorizationRevision = 'changed'; },
        current => { vm.runInContext('grActiveDataRequestGeneration++;', current.context); },
        current => { current.context.currentActiveGroup.items[0].status = 'Pending Review'; },
        current => { current.context.currentActiveGroup.items[0].poId = '10000000-0000-4000-8000-000000000002'; },
        current => { current.context.currentActiveGroup.items[0].appendReviewSet.itemCount++; },
        current => { current.context.currentActiveGroup.items[0].appendReviewSet.fingerprint = 'changed'; },
        current => { current.context.appData.pendingPOs[0].status = 'GR Completed'; },
        current => { current.context.appData.pendingPOs.push({ ...current.context.appData.pendingPOs[3], uid: itemUid(5) }); },
        current => { current.rows()[0].dataset.uid = itemUid(1); },
        current => { current.setRows([]); },
        current => { current.setRows([current.rows()[0], current.rows()[0]]); },
        current => { current.addExtra(); },
        current => { current.context.showView('receiving-list-view'); },
        current => { current.context.invalidateGRAuthStartup(); }
    ];
    for (const mutate of driftCases) { rt = runtime(); rt.open(); rt.fill(); mutate(rt); await rt.submit(); assert.equal(rt.calls.length, 0); assert.match(rt.notices.at(-1).message, /โหลดข้อมูลล่าสุด/); }
    rt = runtime(); rt.open(); rt.fill(); rt.deny(true); await rt.submit(); assert.equal(rt.calls.length, 0);
    rt = runtime(); rt.open(); rt.fill(); vm.runInContext("AppVersionGuard.blockIfStale=async()=>{grActiveDataRequestGeneration++;return false;};", rt.context);
    await rt.submit(); assert.equal(rt.calls.length, 0); assert.match(rt.notices.at(-1).message, /โหลดข้อมูลล่าสุด/);
    rt = runtime(); rt.open(); rt.fill(); rt.result('conflict'); await rt.submit(); await rt.submit(); assert.equal(rt.calls.length, 1, 'conflict requires reload');
    rt = runtime(); rt.open(); rt.fill(); rt.failRead(true); await rt.submit(); await new Promise(resolve => setImmediate(resolve));
    rt.open(); await rt.submit(); assert.equal(rt.calls.length, 1, 'saved bill stays locked through failed authoritative reload');
    rt = runtime(); rt.context.appData.pendingPOs[3].appendReviewSet = null; rt.context.groupPendingPOs(); rt.open();
    assert.equal(rt.get('form-receiving').dataset.appendReview, '', 'missing trusted projection retains ordinary mode');
    assert.equal(rt.get('r-ata').disabled, false); assert.equal(rt.get('btn-draft').classList.contains('hidden'), false);
    rt = runtime(); rt.context.appData.pendingPOs.push({ ...rt.context.appData.pendingPOs[3], uid: itemUid(5), poId: '10000000-0000-4000-8000-000000000002' }); rt.context.groupPendingPOs(); rt.open();
    assert.equal(rt.get('form-receiving').dataset.appendReview, '', 'mixed canonical POs never enable append');
    rt = runtime(); rt.context.appData.pendingPOs.push({ ...rt.context.appData.pendingPOs[3], uid: itemUid(5), appendReviewSet: { ...target, fingerprint: 'abcdef0123456789abcdef0123456789' } }); rt.context.groupPendingPOs(); rt.open();
    assert.equal(rt.get('form-receiving').dataset.appendReview, '', 'mixed projected targets never enable append');
    for (const fingerprint of ['malformed', '0123456789ABCDEF0123456789ABCDEF', '0123456789abcdef0123456789abcde']) {
        rt = runtime(); rt.context.appData.pendingPOs[3].appendReviewSet.fingerprint = fingerprint; rt.context.groupPendingPOs(); rt.open();
        assert.equal(rt.get('form-receiving').dataset.appendReview, '', 'malformed projected fingerprint never enables append');
    }
    const api = rt.context.GrDashboard;
    assert.throws(() => api.writeMetadata({ appendReviewSet: target, targetStatus: 'GR Completed' }), /รับเพิ่ม/);
    for (const key of ['issueReview', 'lift', 'replaceExtras', 'extraItems']) assert.throws(() => api.writeMetadata({ appendReviewSet: target, targetStatus: 'Pending Review', [key]: [] }), /รับเพิ่ม/);
    assert.equal(html.match(/CURRENT_VERSION = '([^']+)'/)[1], JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'))).version);
    console.log('PASS GR append frontend: trusted same-PO target, inherited locks, new-only ISO/canonical payload, combined reload/full confirmation, request retry IDs, drift/permission/reconciliation fences and ordinary fallback');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runtime, target, fixture, itemUid };
