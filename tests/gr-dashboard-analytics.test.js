/**
 * ============================================================================
 * GR COMPREHENSIVE DASHBOARD ANALYTICS & DRILLDOWN TEST SUITE
 * Validates DOM integrity, no-icon rule, client contract, and runtime execution
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
console.log('🧪 RUNNING GR COMPREHENSIVE DASHBOARD VERIFICATION');
console.log('================================================================================\n');

// 1. Version Parity Check
console.log('1. Checking version parity...');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

const versionMatch = htmlContent.match(/const\s+CURRENT_VERSION\s*=\s*["']([^"']+)["']/);
assert(versionMatch, 'CURRENT_VERSION must exist in index.html');
assert.strictEqual(versionMatch[1], versionJson.version, `index.html version (${versionMatch[1]}) must match version.json (${versionJson.version})`);
assert.strictEqual(versionJson.version, '20260920.01', 'Version must be locked at 20260920.01');
console.log(`✅ Version parity verified: ${versionJson.version}`);

// 2. Strict User Rule Invariant: No decorative emojis/icons in dashboard
console.log('\n2. Verifying strict user rule: "พยายามไม่ต้องใส่ Icon มา" (No decorative emojis in dashboard)...');
const dashboardSectionRegex = /<section id="vendor-leadtime-view"[\s\S]*?<\/section>/i;
const dashboardSectionMatch = htmlContent.match(dashboardSectionRegex);
assert(dashboardSectionMatch, 'vendor-leadtime-view dashboard section must exist in index.html');
const dashboardHtml = dashboardSectionMatch[0];

// Assert that common emoji icons were not reintroduced into the dashboard template
const prohibitedDashboardEmojis = ['📊', '⏱️', '📦', '📋', '🔍', '🏢', '⚡', '🎯', '✓', '📝', '✨', '🚚', '🛒'];
const foundEmojis = prohibitedDashboardEmojis.filter(emoji => dashboardHtml.includes(emoji));
assert.strictEqual(foundEmojis.length, 0, `Dashboard contains prohibited emoji icons: ${foundEmojis.join(', ')}`);
console.log('✅ Invariant satisfied: Dashboard has zero decorative emoji icons, strictly honoring user constraint.');

// 3. Compile all inline script blocks in index.html
console.log('\n3. Compiling all inline script blocks with node:vm...');
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

// 4. Verify Client Exports & Auth Invariant
console.log('\n4. Verifying supabase-gr-client.js exports & auth guard...');
const grClient = require('../js/supabase-gr-client.js');
assert(typeof grClient.getGrDashboardAnalytics === 'function', 'getGrDashboardAnalytics must be exported');
assert(typeof grClient.getVendorLeadtimeInsights === 'function', 'getVendorLeadtimeInsights must be exported');
assert(typeof grClient.getVendorReceiptHistory === 'function', 'getVendorReceiptHistory must be exported');

assert.rejects(
  async () => {
    await grClient.getGrDashboardAnalytics({}, null);
  },
  /กรุณาเข้าสู่ระบบใหม่/,
  'Must reject without token'
);
console.log('✅ Client contract and unauthenticated rejection verified.');

// 5. Verify DOM Elements for Comprehensive Dashboard
console.log('\n5. Verifying presence of required DOM elements in index.html...');
const requiredDomIds = [
  // Presets & Filter Controls
  'btn-preset-today',
  'btn-preset-7d',
  'btn-preset-1m',
  'btn-preset-custom',
  'dashboard-custom-date-box',
  'dashboard-date-from',
  'dashboard-date-to',
  'dashboard-active-period-label',
  // KPI Stat Cards
  'kpi-approved-bills',
  'kpi-total-crates',
  'kpi-top-warehouse',
  'kpi-avg-leadtime',
  'kpi-wh-breakdown-sub',
  'kpi-ontime-rate-sub',
  // Visual Analytics
  'dashboard-wh-breakdown',
  'dashboard-wh-total-label',
  'dashboard-daily-chart',
  'dashboard-chart-filter-status',
  'dashboard-btn-reset-day',
  // Bills Table
  'dashboard-bill-search',
  'dashboard-bill-wh',
  'dashboard-bills-tbody',
  'dashboard-bills-count-label',
  // Bill Detail Modal
  'gr-bill-detail-modal',
  'modal-bill-gr',
  'modal-bill-po',
  'modal-bill-vendor',
  'modal-bill-ata',
  'modal-bill-wh',
  'modal-bill-leadtime',
  'modal-bill-receiver',
  'modal-bill-approver',
  'modal-item-count',
  'modal-total-crates',
  'modal-items-body',
  // Tabs
  'vendor-leadtime-tab-overview',
  'vendor-leadtime-tab-benchmarks',
  'vendor-leadtime-tab-product',
  // Product Search Form
  'dashboard-product-form',
  'dashboard-product-input'
];

requiredDomIds.forEach(id => {
  assert(htmlContent.includes(`id="${id}"`), `DOM element #${id} must exist in index.html`);
});
console.log(`✅ All ${requiredDomIds.length} required DOM elements verified in index.html.`);

// 6. Test runtime simulated execution of apiCall('getGrDashboardAnalytics')
console.log('\n6. Testing runtime simulated apiCall dispatch...');
const dispatchedActions = [];
const mockElements = new Map();

function createMockElement(id) {
  return {
    id,
    value: '',
    innerText: '',
    innerHTML: '',
    className: '',
    classList: {
      add: function (...cls) { this.classes = this.classes || new Set(); cls.forEach(c => this.classes.add(c)); },
      remove: function (...cls) { this.classes = this.classes || new Set(); cls.forEach(c => this.classes.delete(c)); },
      toggle: function (cls, force) {
        this.classes = this.classes || new Set();
        if (force === undefined) force = !this.classes.has(cls);
        if (force) this.classes.add(cls); else this.classes.delete(cls);
      },
      contains: function (cls) { return (this.classes || new Set()).has(cls); }
    },
    appendChild: () => {},
    replaceChildren: () => {},
    addEventListener: () => {},
    querySelector: () => ({ focus: () => {} }),
    setAttribute: () => {},
    focus: () => {}
  };
}

const mockSandbox = {
  window: {
    location: { href: 'http://localhost/GR/index.html', search: '' },
    appSession: { token: 'mock-valid-token', roles: ['ADMIN'], perms: { 'app-gr': ['receiveGR', 'approveGR'] } },
    addEventListener: () => {}
  },
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      if (!mockElements.has(id)) {
        mockElements.set(id, createMockElement(id));
      }
      return mockElements.get(id);
    },
    createElement: (tag) => createMockElement(tag),
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
  fetch: async () => ({ ok: true, json: async () => ({ version: '20260919.05' }) }),
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
    if (action === 'getGrDashboardAnalytics') {
      return {
        success: true,
        summary: {
          approvedBills: 12,
          totalCrates: 450,
          totalItems: 38,
          overallAvgLeadDays: 1.5,
          overallOnTimeRate: 100
        },
        warehouseBreakdown: [
          { warehouse: 'W1', totalCrates: 250, billCount: 7, percentage: 55.6 },
          { warehouse: 'W2', totalCrates: 120, billCount: 3, percentage: 26.7 },
          { warehouse: 'W5', totalCrates: 80, billCount: 2, percentage: 17.8 }
        ],
        dailyStats: [
          { date: '2026-09-18', billCount: 5, totalCrates: 180 },
          { date: '2026-09-19', billCount: 7, totalCrates: 270 }
        ],
        bills: [
          {
            grId: 'gr-001',
            grNumber: 'GR-202609-001',
            poNumber: 'PO-202609-001',
            vendor: 'บริษัท ยูเอฟเอ็ม ฟลาวมิลส์ จำกัด',
            poDate: '2026-09-17',
            ataDate: '2026-09-19',
            warehouse: 'W1',
            totalCrates: 120,
            itemCount: 2,
            receiver: 'นายสมชาย รับดี',
            approver: 'หัวหน้าตรวจรับ',
            leadtimeDays: 2,
            items: [
              { sku: 'SKU-001', product: 'แป้งสาลี ตราบัวแดง 1 กก.', qty: 100, unit: 'ถุง', location: 'W1-A-01', expDate: '2027-09-19', isExtra: false },
              { sku: 'SKU-002', product: 'แป้งเค้ก ตราพัดโบก 1 กก.', qty: 20, unit: 'ถุง', location: 'W1-A-02', expDate: '2027-09-19', isExtra: false }
            ]
          }
        ]
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
    current: '20260919.03',
    readActions: ['getGrDashboardAnalytics', 'getVendorLeadtimeInsights', 'getVendorReceiptHistory']
  });
`, mockSandbox);

async function testRuntimeExecution() {
  const res = await mockSandbox.apiCall('getGrDashboardAnalytics', { preset: '7d' });
  assert.strictEqual(res.success, true, 'apiCall(getGrDashboardAnalytics) must succeed via AkraSupabaseGR');
  assert.strictEqual(dispatchedActions[0].action, 'getGrDashboardAnalytics');
  assert.strictEqual(dispatchedActions[0].payload.preset, '7d');
  assert.strictEqual(dispatchedActions[0].token, 'mock-valid-token');

  // Test that UI render functions can execute without runtime exceptions
  mockSandbox.applyGrDashboardSummary(res.summary, res.warehouseBreakdown);
  const countEl = mockSandbox.document.getElementById('kpi-approved-bills');
  assert.strictEqual(countEl.innerText, '12', 'kpi-approved-bills must render 12');

  const cratesEl = mockSandbox.document.getElementById('kpi-total-crates');
  assert.strictEqual(cratesEl.innerText, '450', 'kpi-total-crates must render 450');

  const whEl = mockSandbox.document.getElementById('kpi-top-warehouse');
  assert.strictEqual(whEl.innerText, 'W1 และ W2', 'kpi-top-warehouse must show top warehouses');

  mockSandbox.renderGrWarehouseBreakdown(res.warehouseBreakdown, res.summary.totalCrates);
  const whContainer = mockSandbox.document.getElementById('dashboard-wh-breakdown');
  assert.ok(whContainer.innerHTML.includes('W1'), 'Warehouse breakdown must render W1');
  assert.ok(whContainer.innerHTML.includes('55.6%'), 'Warehouse breakdown must render percentage');

  mockSandbox.renderGrDailyChart(res.dailyStats);
  const chartContainer = mockSandbox.document.getElementById('dashboard-daily-chart');
  assert.ok(chartContainer.innerHTML.includes('2026-09-19'), 'Daily chart must render 2026-09-19');

  mockSandbox.renderGrDashboardBillsTable(res.bills);
  const billsTbody = mockSandbox.document.getElementById('dashboard-bills-tbody');
  assert.ok(billsTbody.innerHTML.includes('GR-202609-001'), 'Bills table must render GR number');
  assert.ok(billsTbody.innerHTML.includes('นายสมชาย รับดี'), 'Bills table must render receiver');
  assert.ok(billsTbody.innerHTML.includes('หัวหน้าตรวจรับ'), 'Bills table must render approver');

  // Test opening detail modal
  mockSandbox.grDashboardState.analytics = res;
  mockSandbox.openGrBillDetailModal('gr-001');
  const modalPo = mockSandbox.document.getElementById('modal-bill-po');
  assert.ok(modalPo.innerText.includes('PO-202609-001'), 'Detail modal must render PO number');

  console.log('✅ Runtime simulated execution and DOM rendering passed flawlessly.');
}

testRuntimeExecution().then(() => {
  console.log('\n================================================================================');
  console.log('🌟 ALL 6 DASHBOARD VERIFICATION SUITES PASSED (100%)');
  console.log('================================================================================\n');
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
