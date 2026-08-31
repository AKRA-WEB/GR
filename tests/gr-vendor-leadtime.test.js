/**
 * ============================================================================
 * GR VENDOR LEADTIME & RECEIVING HISTORY TEST SUITE
 * Validates syntax compilation, version parity, client routing, and execution
 * ============================================================================
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const grDir = path.resolve(__dirname, '..');
const htmlPath = path.join(grDir, 'index.html');
const versionPath = path.join(grDir, 'version.json');
const clientPath = path.join(grDir, 'js', 'supabase-gr-client.js');

console.log('================================================================================');
console.log('🧪 RUNNING GR VENDOR LEADTIME & RECEIVING HISTORY VERIFICATION');
console.log('================================================================================\n');

// 1. Version Parity Check
console.log('1. Checking version parity...');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

const versionMatch = htmlContent.match(/const\s+CURRENT_VERSION\s*=\s*["']([^"']+)["']/);
assert(versionMatch, 'CURRENT_VERSION must exist in index.html');
assert.strictEqual(versionMatch[1], versionJson.version, `index.html version (${versionMatch[1]}) must match version.json (${versionJson.version})`);
assert.strictEqual(versionJson.version, '20260831.02', 'Version must be 20260831.02');
console.log(`✅ Version parity verified: ${versionJson.version}`);

// 2. Syntax compilation of all <script> blocks in index.html
console.log('\n2. Compiling all inline script blocks with node:vm...');
const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 0;
let inlineScriptsFound = 0;
let mainScriptContent = '';

while ((match = scriptRegex.exec(htmlContent)) !== null) {
  scriptIndex++;
  const scriptBody = match[1];
  const tag = match[0];
  if (tag.includes('src=')) continue; // external
  if (!scriptBody.trim()) continue;

  inlineScriptsFound++;
  mainScriptContent = scriptBody;
  try {
    new vm.Script(scriptBody, { filename: `index.html#inline-script-${scriptIndex}` });
    console.log(`  ✓ Script block #${scriptIndex} compiled successfully (${scriptBody.length} bytes)`);
  } catch (err) {
    console.error(`❌ Syntax error in script block #${scriptIndex}:`, err);
    throw err;
  }
}
assert(inlineScriptsFound > 0, 'Must have found inline scripts to test');
console.log(`✅ All ${inlineScriptsFound} inline script blocks compiled with 0 syntax errors.`);

// 3. Client Module Check
console.log('\n3. Verifying supabase-gr-client.js exports...');
const clientContent = fs.readFileSync(clientPath, 'utf8');
new vm.Script(clientContent, { filename: 'supabase-gr-client.js' });

const grClient = require('../js/supabase-gr-client.js');
assert(typeof grClient.getVendorLeadtimeInsights === 'function', 'getVendorLeadtimeInsights must be exported');
assert(typeof grClient.getVendorReceiptHistory === 'function', 'getVendorReceiptHistory must be exported');
console.log('✅ supabase-gr-client.js has required leadtime & history methods.');

// 4. Client negative auth invariant check
console.log('\n4. Testing negative auth invariant (no token)...');
assert.rejects(
  async () => {
    await grClient.getVendorLeadtimeInsights({}, null);
  },
  /กรุณาเข้าสู่ระบบใหม่/,
  'Must reject without token'
);
console.log('✅ Invariant: Unauthenticated requests are immediately rejected client-side.');

// 5. Test apiCall routing in index.html - Verify Supabase dispatch vs GAS fallback
console.log('\n5. Verifying apiCall routing for Vendor Leadtime & History in index.html...');
const actionMatch = mainScriptContent.match(/const\s+supabaseGrActions\s*=\s*\[([^\]]+)\]/);
assert(actionMatch, 'supabaseGrActions array must exist in index.html');
const declaredActions = actionMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));

assert(declaredActions.includes('getVendorLeadtimeInsights'), 'supabaseGrActions must include getVendorLeadtimeInsights');
assert(declaredActions.includes('getVendorReceiptHistory'), 'supabaseGrActions must include getVendorReceiptHistory');
console.log('  ✓ getVendorLeadtimeInsights is registered in supabaseGrActions');
console.log('  ✓ getVendorReceiptHistory is registered in supabaseGrActions');

// 6. Test runtime simulated execution of apiCall with Mock AkraSupabaseGR
console.log('\n6. Testing runtime simulated apiCall dispatch...');
const dispatchedActions = [];
const mockSandbox = {
  window: {
    location: { href: 'http://localhost/GR/index.html', search: '' },
    appSession: { token: 'mock-valid-token', roles: ['ADMIN'], perms: { 'app-gr': ['receiveGR', 'approveGR'] } },
    addEventListener: () => {}
  },
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      if (id === 'avg-modal' || id === 'avg-banner' || id === 'avg-style') return null;
      return {
        value: '30d',
        innerText: '',
        innerHTML: '',
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        appendChild: () => {},
        replaceChildren: () => {},
        addEventListener: () => {},
        querySelector: () => ({ focus: () => {} }),
        setAttribute: () => {},
        focus: () => {}
      };
    },
    createElement: (tag) => ({
      tagName: tag,
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      setAttribute: () => {},
      addEventListener: () => {},
      focus: () => {}
    }),
    querySelectorAll: () => [],
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }
  },
  navigator: { onLine: true },
  localStorage: {
    getItem: (key) => key === 'akra_gr_session' ? JSON.stringify({ token: 'mock-valid-token', roles: ['ADMIN'] }) : null,
    setItem: () => {}
  },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  fetch: async () => ({ ok: true, json: async () => ({ version: '20260831.02' }) }),
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: () => {},
  clearInterval: () => {},
  console: console,
  URLSearchParams: URLSearchParams,
  URL: URL,
  Date: Date,
  lucide: { createIcons: () => {} }
};

mockSandbox.window.AkraSupabaseGR = {
  request: async (action, payload, token) => {
    dispatchedActions.push({ action, payload, token });
    if (action === 'getVendorLeadtimeInsights') {
      return {
        success: true,
        summary: { vendorCount: 102, overallAvgLeadDays: 1.8, overallOnTimeRate: 98.7, totalReceipts: 1883 },
        vendors: [{ vendorName: 'UFM', avgLeadDays: 1.2, confidence: 'high', totalReceipts: 50, onTimeRate: 100 }]
      };
    }
    if (action === 'getVendorReceiptHistory') {
      return {
        success: true,
        total: 1,
        hasMore: false,
        bills: [{ poNumber: 'PO-TEST-001', vendor: 'UFM', leadtimeDays: 1, items: [] }]
      };
    }
    return { success: true };
  }
};

mockSandbox.self = mockSandbox.window;
mockSandbox.window.window = mockSandbox.window;

vm.createContext(mockSandbox);
vm.runInContext(mainScriptContent, mockSandbox);

vm.runInContext(`
  AppVersionGuard.start({
    current: '20260831.02',
    readActions: ['getVendorLeadtimeInsights', 'getVendorReceiptHistory']
  });
`, mockSandbox);

async function testRuntimeExecution() {
  const res1 = await mockSandbox.apiCall('getVendorLeadtimeInsights', {});
  assert.strictEqual(res1.success, true, 'apiCall(getVendorLeadtimeInsights) must succeed via AkraSupabaseGR');
  assert.strictEqual(dispatchedActions[0].action, 'getVendorLeadtimeInsights');
  assert.strictEqual(dispatchedActions[0].token, 'mock-valid-token');

  const res2 = await mockSandbox.apiCall('getVendorReceiptHistory', { search: 'UFM' });
  assert.strictEqual(res2.success, true, 'apiCall(getVendorReceiptHistory) must succeed via AkraSupabaseGR');
  assert.strictEqual(dispatchedActions[1].action, 'getVendorReceiptHistory');

  console.log('✅ Runtime simulated apiCall successfully dispatched to AkraSupabaseGR without falling through to Google Apps Script.');
}

testRuntimeExecution().then(() => {
  console.log('\n================================================================================');
  console.log('🌟 ALL 6 VERIFICATION SUITES PASSED (100%)');
  console.log('================================================================================\n');
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
