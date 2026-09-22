const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert(inlineScript, 'main inline script must exist');
assert.doesNotThrow(() => new vm.Script(inlineScript[1]), 'modified inline JavaScript must parse');

assert.doesNotMatch(html, /class="gr-nav-product"/, 'standalone product-history navigation must be removed');
assert.doesNotMatch(html, /id="product-history-view"/, 'standalone product-history view must be removed');
assert.match(html, /id="tab-btn-product-drilldown"[\s\S]*?ค้นหาประวัติสินค้ารายตัว/, 'Dashboard must keep the product-history tab');
assert.match(
    html,
    /id="dashboard-product-form"[\s\S]*?searchProductReceiptHistory\(true\)/,
    'Dashboard product search must use the canonical product-history flow'
);
assert.match(html, /id="dashboard-product-input"[^>]+list="product-history-options"/, 'Dashboard search must expose product suggestions');

const searchStart = html.indexOf('async function searchProductReceiptHistory');
const searchEnd = html.indexOf('async function loadMoreProductReceiptHistory', searchStart);
assert(searchStart >= 0 && searchEnd > searchStart, 'canonical product-history search function must exist');
const searchSource = html.slice(searchStart, searchEnd);
assert.match(searchSource, /dashboard-product-input/, 'canonical search must read the Dashboard input');
assert.match(searchSource, /apiCall\(['"]getProductReceiptHistory['"]/, 'canonical search must call the history API');
assert.match(searchSource, /sku:\s*product\.sku/, 'history request must use the selected SKU');
assert.match(searchSource, /productName:\s*product\.name/, 'history request must include the selected product name');
assert.match(searchSource, /offset:/, 'history request must preserve pagination');
assert.match(searchSource, /limit:/, 'history request must remain bounded');

for (const shellPath of [
    path.join(__dirname, '..', 'js', 'akra-shell-bridge.js'),
    path.join(__dirname, '..', '..', 'Main', 'js', 'akra-shell-bridge.js'),
    path.join(__dirname, '..', '..', 'Main', 'js', 'unified-shell.js')
]) {
    const shellSource = fs.readFileSync(shellPath, 'utf8');
    assert.doesNotMatch(shellSource, /label:'ประวัติการรับสินค้า'/, `${path.basename(shellPath)} must not expose duplicate history navigation`);
    assert.match(shellSource, /label:'Dashboard GR'.*selector:'.gr-nav-vendor'/, `${path.basename(shellPath)} must expose Dashboard navigation`);
}

console.log('PASS gr-dashboard-product-history-consolidation: Dashboard is the single product-history surface');
