const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert(inlineScript, 'main inline script must exist');
assert.doesNotThrow(() => new vm.Script(inlineScript[1]), 'modified inline JavaScript must parse');

function functionSource(name, nextName) {
  const start = html.indexOf(`function ${name}`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : -1;
  assert(start >= 0, `${name} must exist`);
  return html.slice(start, end > start ? end : html.length);
}

assert.match(html, /id="product-history-view"/, 'separate product history view must exist');
assert.match(html, /id="product-history-input"[^>]+list="product-history-options"/, 'product history input must use product suggestions');
assert.match(html, /id="product-history-status"[^>]+aria-live="polite"/, 'result state must be announced accessibly');
assert.match(html, /id="product-history-results"/, 'history result container must exist');
assert.match(html, /id="product-history-load-more"/, 'bounded pagination control must exist');
assert.match(html, /openProductHistory\(\)/, 'navigation must expose the product history view');

const openReceiving = functionSource('openReceiving', 'productHistoryOptionValue');
assert.doesNotMatch(openReceiving, /getProductReceiptHistory/, 'normal startup must not fetch product history');

const search = functionSource('searchProductReceiptHistory', 'loadMoreProductReceiptHistory');
assert.match(search, /apiCall\(['"]getProductReceiptHistory['"]/, 'search must call the dedicated backend action');
assert.match(search, /sku\s*:/, 'history request must include exact selected SKU');
assert.match(search, /productName\s*:/, 'history request must include the selected product name fallback');
assert.match(search, /offset\s*:/, 'history request must include pagination offset');
assert.match(search, /limit\s*:/, 'history request must remain bounded');
assert.match(search, /historyUids/, 'additional pages must dedupe repeated GR UIDs');

const render = functionSource('renderProductReceiptHistory');
assert.match(render, /esc\(/, 'Sheet and user-entered strings must be escaped before HTML rendering');
assert.match(render, /productHistoryState\.latest/, 'latest summary must come from the backend latest row');
assert.match(render, /productHistoryState\.history/, 'bounded history rows must be rendered');
assert.match(render, /ไม่พบประวัติ/, 'empty state must be explicit');

assert.match(html, /readActions:\s*\[[^\]]*['"]getProductReceiptHistory['"]/, 'version guard must recognize the history endpoint as a read action');
assert.match(functionSource('isReadApiAction', 'delay'), /getProductReceiptHistory/, 'history requests must use read retry and timeout behavior');

console.log('PASS gr-product-receipt-history-frontend: lazy view, request contract, states, safe rendering, pagination, and read guards');
