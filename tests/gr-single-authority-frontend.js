const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /js\/supabase-gr-client\.js/, 'GR must load its Supabase Edge client');
assert.match(
  html,
  /AkraSupabaseGR\.request\(action, payload, getSessionToken\(\)\)/,
  'All canonical GR reads and mutations must use the authenticated Supabase endpoint'
);
assert.doesNotMatch(
  html,
  /Supabase GR .*fallback to GAS/i,
  'GR must not fall back to a second Sheet authority after a Supabase failure'
);

assert.match(
  html,
  /async function readApiCall\(action, payload = null\)\s*{\s*return apiCall\(action, payload\);\s*}/,
  'All GR reads must use the same authenticated API path'
);

assert.doesNotMatch(
  html,
  /function decodeJwtPayload\(/,
  'Frontend must not grant access from locally decoded unsigned JWT claims'
);

const authStart = html.indexOf('var AuthGuard = {');
const authEnd = html.indexOf("document.addEventListener('DOMContentLoaded', AuthGuard.init);");
assert.ok(authStart >= 0 && authEnd > authStart, 'AuthGuard block must exist');
const authBlock = html.slice(authStart, authEnd);
assert.doesNotMatch(authBlock, /isPreviewEnv|Preview mode/, 'Unauthenticated preview must not render cached GR data');
const verifyIndex = authBlock.indexOf("AkraSupabaseGR.request('bootstrap'");
const sessionIndex = authBlock.indexOf('window.appSession = session');
const prefetchIndex = authBlock.indexOf('initialDataPrefetch = Promise.resolve(result.initialData)');
assert.ok(verifyIndex >= 0, 'AuthGuard must bootstrap through the Main-verifying GR Edge Function');
assert.doesNotMatch(authBlock, /fetch\(verifyURL\)/, 'Bootstrap must not repeat a direct browser-to-Main verification round trip');
assert.match(authBlock, /error\.reason === 'mandatory_password_change_required'/,
  'Main mandatory-password rejection must show the actionable password-change message');
assert.ok(sessionIndex > verifyIndex, 'Verified session must be established after Main verification');
assert.ok(prefetchIndex > sessionIndex, 'Initial GR read must start only after the verified session is established');

console.log('PASS gr-single-authority-frontend: Main-verified session and one authenticated Supabase GR authority enforced');
