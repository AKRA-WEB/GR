const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("=== RUNNING GR INSTANT AUTH & PERFORMANCE TESTS ===\n");

const htmlPath = path.join(__dirname, "..", "index.html");
const versionPath = path.join(__dirname, "..", "version.json");
const html = fs.readFileSync(htmlPath, "utf8");
const versionJson = JSON.parse(fs.readFileSync(versionPath, "utf8"));

// 1. Version Parity Check
console.log("[Test 1] Version Parity Check...");
const versionMatch = html.match(/const CURRENT_VERSION = "(.*?)";/);
assert.ok(versionMatch, "CURRENT_VERSION must exist in index.html");
assert.strictEqual(versionMatch[1], versionJson.version);
assert.strictEqual(versionJson.version, "20260824.01");
console.log("  -> PASS: Version is " + versionJson.version);

// Check delivery plan is hidden by default
const deliveryPlanDefaultMatch = html.match(/var isDeliveryPlanVisible = (false|true);/);
assert.ok(deliveryPlanDefaultMatch, "isDeliveryPlanVisible must exist in index.html");
assert.strictEqual(deliveryPlanDefaultMatch[1], "false", "Delivery planning must be hidden by default");
console.log("  -> PASS: Delivery planning is hidden by default (isDeliveryPlanVisible = false)");

// 2. decodeJwtPayload Unit Tests
console.log("\n[Test 2] decodeJwtPayload unit tests...");
function extractFunction(source, fnName) {
  const regex = new RegExp("function " + fnName + "\\s*\\([\\s\\S]*?\\n    \\}", "m");
  const match = source.match(regex);
  if (!match) throw new Error("Could not find function " + fnName);
  return match[0];
}

const decodeCode = extractFunction(html, "decodeJwtPayload");
const sandbox = {
  TextDecoder,
  Uint8Array,
  Buffer,
  atob: (b64) => Buffer.from(b64, "base64").toString("binary"),
  decodeURIComponent,
  escape,
  Date,
  JSON,
  console
};
vm.createContext(sandbox);
vm.runInContext(decodeCode, sandbox);

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return header + "." + body + ".mockSig";
}

const validToken = makeJwt({ id: "u-1", name: "Somchai", roles: ["WAREHOUSE"], exp: Math.floor(Date.now() / 1000) + 3600 });
const decoded = sandbox.decodeJwtPayload(validToken);
assert.strictEqual(decoded.id, "u-1");
assert.strictEqual(decoded.name, "Somchai");
assert.strictEqual(JSON.stringify(decoded.roles), JSON.stringify(["WAREHOUSE"]));
console.log("  -> PASS: Decoded valid token correctly");

assert.strictEqual(sandbox.decodeJwtPayload("invalid"), null);
assert.strictEqual(sandbox.decodeJwtPayload(null), null);
assert.strictEqual(sandbox.decodeJwtPayload(""), null);
console.log("  -> PASS: Malformed tokens return null");

const expiredToken = makeJwt({ id: "u-2", name: "Expired", roles: ["ADMIN"], exp: Math.floor(Date.now() / 1000) - 100 });
assert.strictEqual(sandbox.decodeJwtPayload(expiredToken), null);
console.log("  -> PASS: Expired token returns null");

// 3. Simulated AuthGuard.init Instant vs Fallback Flow
console.log("\n[Test 3] Simulated AuthGuard.init Instant Flow...");
let shownAppName = null;
let openReceivingCalled = false;
let bootstrapCalled = false;

const mockAuthGuardContext = {
  document: { title: "GR", getElementById: () => null },
  URLSearchParams,
  JSON,
  checkAppVersion: async () => true,
  AppVersionGuard: { start: () => {} },
  lucide: { createIcons: () => {} },
  UI: {
    showLoading: () => {},
    showApp: (name) => { shownAppName = name; },
    showError: (err) => {}
  },
  window: {
    location: { search: "?sso=" + validToken, pathname: "/GR/" },
    history: { replaceState: () => {} }
  },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  APP_CONFIG: { STORAGE_KEY: "gr_session", PORTAL_URL: "https://portal" },
  buildAppSession: (user, token) => ({ name: user.name, id: user.id, roles: user.roles, token }),
  hasGrAccess: (s) => true,
  AuthGuard: { bindEvents: () => {} },
  openReceiving: async () => { openReceivingCalled = true; },
  AkraSupabaseGR: {
    request: async (action) => {
      if (action === "bootstrap") bootstrapCalled = true;
      return { valid: true, user: { name: "Remote" }, initialData: {} };
    }
  },
  readApiCall: async () => ({ success: true, pendingPOs: [] }),
  PERF_MODE: false,
  initialDataPrefetch: null,
  decodeJwtPayload: sandbox.decodeJwtPayload,
  CURRENT_VERSION: "20260824.01",
  console
};

const authGuardCode = "var AuthGuard = " + html.match(/var AuthGuard = (\{[\s\S]*?\n    \};)/)[1];
vm.createContext(mockAuthGuardContext);
vm.runInContext(authGuardCode, mockAuthGuardContext);

(async () => {
  const t0 = Date.now();
  await mockAuthGuardContext.AuthGuard.init();
  const duration = Date.now() - t0;
  
  assert.strictEqual(mockAuthGuardContext.window.currentUser, "Somchai");
  assert.strictEqual(openReceivingCalled, true, "openReceiving must be called");
  assert.strictEqual(bootstrapCalled, false, "Instant auth must NOT block on remote bootstrap");
  assert.ok(duration < 50, "Instant auth must complete in < 50ms (took " + duration + "ms)");
  console.log("  -> PASS: Instant Auth initialized in " + duration + "ms with zero remote bootstrap blocking!");
  
  console.log("\n=== ALL GR INSTANT AUTH & PERFORMANCE TESTS PASSED! ===\n");
})().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
