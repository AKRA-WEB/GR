const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackend(verifyResult) {
  let fetchCount = 0;
  let lastFetchUrl = '';
  const context = {
    console,
    Date,
    Set,
    Map,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    isFinite,
    encodeURIComponent,
    UrlFetchApp: {
      fetch(url) {
        fetchCount += 1;
        lastFetchUrl = url;
        return {
          getResponseCode() { return 200; },
          getContentText() { return JSON.stringify(verifyResult.value); }
        };
      }
    },
    Utilities: {
      base64DecodeWebSafe(value) { return Buffer.from(value, 'base64url'); },
      newBlob(value) { return { getDataAsString() { return Buffer.from(value).toString('utf8'); } }; }
    },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput(value) { return { value, setMimeType() { return this; } }; }
    }
  };

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs.txt'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs.txt' });
  return { context, getFetchCount: () => fetchCount, getLastFetchUrl: () => lastFetchUrl };
}

function unsignedJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    ''
  ].join('.');
}

function testReadGuards() {
  const verifyResult = { value: { valid: false, reason: 'invalid_token' } };
  const { context } = loadBackend(verifyResult);
  const expectedReadActions = [
    'getInitialData',
    'getProducts',
    'getDeliveryPlanning',
    'getProductReceiptHistory'
  ];

  expectedReadActions.forEach(action => {
    const guard = context.getProtectedActionGuard_(action, null);
    assert.deepEqual(
      Array.from(guard && guard.anyPerm || []),
      ['receiveGR', 'approveGR'],
      `${action} must require GR read access`
    );
  });

  const diagnosticsGuard = context.getProtectedActionGuard_('getDiagnostics', null);
  assert.equal(diagnosticsGuard && diagnosticsGuard.perm, 'approveGR', 'Diagnostics must require approveGR');
  assert.equal(diagnosticsGuard && diagnosticsGuard.privilegedRole, true, 'Diagnostics must require Admin/Supervisor');
}

function testUnsignedClaimsAreNeverTrusted() {
  const verifyResult = { value: { valid: false, reason: 'invalid_token' } };
  const { context, getFetchCount } = loadBackend(verifyResult);
  const forgedToken = unsignedJwt({
    id: 'attacker',
    roles: ['ADMIN'],
    perms: { 'app-gr': ['receiveGR', 'approveGR'] }
  });

  const result = context.requireAuth(forgedToken, { perm: 'approveGR', privilegedRole: true });
  assert.equal(getFetchCount(), 1, 'Every token, including JWT-shaped input, must be verified by Main');
  assert.equal(result.error && result.error.reason, 'invalid_token', 'Main rejection must reject forged claims');
}

function testVerifiedPermissionsStillWork() {
  const verifyResult = {
    value: {
      valid: true,
      user: {
        id: 'supervisor-1',
        name: 'Supervisor',
        roles: ['SUPERVISOR'],
        perms: { 'app-gr': ['approveGR'] }
      }
    }
  };
  const { context, getFetchCount, getLastFetchUrl } = loadBackend(verifyResult);
  const result = context.requireAuth('opaque-session-token', { perm: 'approveGR', privilegedRole: true });
  assert.equal(getFetchCount(), 1, 'Valid opaque tokens must be verified by Main');
  assert.equal(new URL(getLastFetchUrl()).searchParams.get('appId'), 'app-gr', 'Main verification must enforce GR app access');
  assert.equal(result.user && result.user.id, 'supervisor-1');
}

function testPoProxyUsesTrackingAccessAndPoPermissions() {
  const verifyResult = {
    value: {
      valid: true,
      user: {
        id: 'purchaser-1',
        roles: ['PURCHASING'],
        perms: { 'app-po': ['createPO'] }
      }
    }
  };
  const { context, getLastFetchUrl } = loadBackend(verifyResult);
  const guard = context.getProtectedActionGuard_('updatePO', {});
  assert.equal(guard.verifyAppId, 'app-tracking');
  assert.equal(guard.permAppId, 'app-po');
  const result = context.requireAuth('po-session-token', guard);
  assert.equal(new URL(getLastFetchUrl()).searchParams.get('appId'), 'app-tracking', 'PO proxy must verify Main app-tracking access');
  assert.equal(result.user && result.user.id, 'purchaser-1', 'PO proxy must authorize from the app-po permission namespace');
}

function testMandatoryPasswordChangeIsRejected() {
  const verifyResult = {
    value: {
      valid: true,
      user: {
        id: 'user-1',
        roles: ['WAREHOUSE'],
        perms: { 'app-gr': ['receiveGR'] },
        mustChangePassword: true
      }
    }
  };
  const { context } = loadBackend(verifyResult);
  const result = context.requireAuth('must-change-token', { anyPerm: ['receiveGR', 'approveGR'] });
  assert.equal(result.error && result.error.reason, 'mandatory_password_change_required');
}

function testForgedCompletedStatusCannotUseReceivePermission() {
  const verifyResult = {
    value: {
      valid: true,
      user: {
        id: 'receiver-1',
        roles: ['WAREHOUSE'],
        perms: { 'app-gr': ['receiveGR'] }
      }
    }
  };
  const { context } = loadBackend(verifyResult);
  const output = context.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'bulkReceivePO',
        token: 'receiver-token',
        data: { targetStatus: 'Completed', groupPoUids: ['PO-1'], items: [] }
      })
    }
  });
  const result = JSON.parse(output.value);
  assert.equal(result.reason, 'permission_denied', 'Non-canonical completed statuses must not bypass approveGR');
}

testReadGuards();
testUnsignedClaimsAreNeverTrusted();
testVerifiedPermissionsStillWork();
testPoProxyUsesTrackingAccessAndPoPermissions();
testMandatoryPasswordChangeIsRejected();
testForgedCompletedStatusCannotUseReceivePermission();
console.log('PASS gr-auth-boundary: protected reads and Main-verified authorization enforced');
