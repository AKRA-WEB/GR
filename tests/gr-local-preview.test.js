const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i);
assert.ok(scriptMatch, 'GR main inline script must be present');

let fetchCalls = [];
const elements = new Map();
function mockElement(id) {
    return {
        id,
        value: '',
        innerHTML: '',
        innerText: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        setAttribute() {},
        appendChild() {},
        querySelectorAll() { return []; },
        querySelector() { return null; }
    };
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
    window: {
        location: { hostname: '127.0.0.1', search: '' },
        addEventListener() {}
    },
    document: {
        addEventListener() {},
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, mockElement(id));
            return elements.get(id);
        },
        querySelectorAll() { return []; },
        createElement() { return mockElement('created'); },
        body: { classList: { add() {}, remove() {} } }
    },
    localStorage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    },
    lucide: { createIcons() {} },
    fetch: async (url) => {
        fetchCalls.push(String(url));
        return { ok: true, json: async () => ({ version: '' }) };
    },
    setInterval() {},
    setTimeout,
    clearTimeout
};
sandbox.window.localStorage = sandbox.localStorage;

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox, { filename: 'GR/index.html' });

assert.equal(sandbox.isLocalPreviewMode(), true, 'loopback host should enable local preview mode');
sandbox.window.location.hostname = 'akra-web.github.io';
assert.equal(sandbox.isLocalPreviewMode(), false, 'production host must never enable local preview mode');
sandbox.window.location.hostname = '127.0.0.1';

const previewData = sandbox.getLocalPreviewData();
assert.equal(previewData.success, true, 'local preview data must be a successful read model');
assert.ok(previewData.pendingPOs.length >= 3, 'local preview should include representative receiving bills');
assert.ok(previewData.pendingPOs.some(item => item.warehouse === 'W2'), 'local preview should cover W2 lift workflow');

const previewSession = sandbox.getLocalPreviewSession();
assert.deepEqual(Array.from(previewSession.perms['app-gr']), ['receiveGR', 'approveGR'], 'local preview session should unlock read-only UI controls');

fetchCalls = [];
const readResponse = await sandbox.apiCall('getInitialData', {});
assert.equal(readResponse.success, true, 'local preview reads should resolve from fixture data');
assert.equal(fetchCalls.filter(url => !url.includes('version.json')).length, 0, 'local preview reads must not call an external API');

const mutationResponse = await sandbox.apiCall('bulkReceivePO', {});
assert.equal(mutationResponse.success, false, 'local preview mutations must be blocked');
assert.match(mutationResponse.message, /Preview|บันทึกข้อมูล/, 'blocked mutation should explain local preview behavior');
assert.equal(fetchCalls.filter(url => !url.includes('version.json')).length, 0, 'local preview mutations must not call an external API');

sandbox.window.scrollTo = () => {};
const mainScroller = sandbox.document.getElementById('gr-main');
for (const viewId of ['receiving-detail-view', 'product-history-view', 'vendor-leadtime-view', 'receiving-list-view']) {
    mainScroller.scrollTop = 480;
    sandbox.showView(viewId);
    assert.equal(mainScroller.scrollTop, 0, `${viewId} should start at the top after leaving a scrolled view`);
}

    console.log('PASS gr-local-preview: loopback fixture preview is isolated from production auth/API');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
