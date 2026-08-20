const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientPath = path.join(__dirname, '..', 'js', 'supabase-gr-client.js');
const source = fs.readFileSync(clientPath, 'utf8');
const grClient = require(clientPath);

async function runTests() {
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY|eyJ[a-zA-Z0-9_-]{20,}/,
    'Browser adapter must not include or reference a privileged credential');
  assert.match(grClient.API_URL, /\/functions\/v1\/gr-api$/);

  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ success: true, marker: 'edge' }) };
  };
  try {
    const result = await grClient.request('bulkReceivePO', { targetStatus: 'Pending Review' }, 'main-token');
    assert.deepEqual(result, { success: true, marker: 'edge' });
    assert.equal(request.url, grClient.API_URL);
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), {
      action: 'bulkReceivePO',
      data: { targetStatus: 'Pending Review' },
      token: 'main-token'
    });
    assert.equal(request.options.headers['Content-Type'], 'application/json');
  } finally {
    global.fetch = originalFetch;
  }

  await assert.rejects(grClient.request('getInitialData', {}, ''), /เข้าสู่ระบบใหม่/);
  console.log('PASS supabase-gr-test: credential-free browser client calls only the authenticated GR Edge Function');
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
