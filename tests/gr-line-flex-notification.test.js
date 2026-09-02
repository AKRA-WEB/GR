const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TEST_SECRET = 'test-main-jwt-secret-at-least-32-characters';
const sharedPath = path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', '_shared', 'main-jwt.ts');
const apiPath = path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'gr-api', 'index.ts');

const sharedSource = fs.readFileSync(sharedPath, 'utf8').replace(/^export\s+/gm, '');
const apiSource = fs.readFileSync(apiPath, 'utf8')
  .replace(/^import\b.*$/gm, '')
  .replace(/^declare const Deno:[\s\S]*?^};\r?\n/m, '')
  .replace(/^declare const EdgeRuntime:.*$/gm, '');

function createHarness(options = {}) {
  const linePushBodies = [];
  const lineTasks = [];
  let flexShouldFail = options.flexShouldFail || false;
  let handler = null;

  const context = vm.createContext({
    console: {
      log() {},
      warn() {},
      error() {}
    },
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    atob,
    btoa,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    Map,
    Set,
    Intl,
    EdgeRuntime: {
      waitUntil(task) { lineTasks.push(task); }
    },
    Deno: {
      env: {
        get(name) {
          return {
            MAIN_JWT_SECRET: TEST_SECRET,
            SUPABASE_URL: 'https://database.example',
            GR_SUPABASE_SECRET_KEY: 'server-only-key',
            GR_ALLOWED_ORIGINS: 'https://akra-web.github.io',
            LINE_TOKEN_COMPLETED: 'line-test-token',
            LINE_GROUP_COMPLETED: 'line-test-group'
          }[name];
        }
      },
      serve(fn) { handler = fn; }
    },
    fetch: async (url, fetchOpts = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/rpc/')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (target === 'https://api.line.me/v2/bot/message/push') {
        const body = JSON.parse(fetchOpts.body);
        linePushBodies.push(body);
        if (body.messages[0]?.type === 'flex' && flexShouldFail) {
          return new Response(JSON.stringify({ message: 'Flex error' }), { status: 400 });
        }
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });

  vm.runInContext(`${sharedSource}\n${apiSource}`, context);

  async function invoke(payload) {
    const token = await context.signMainJwt({
      id: 'SUPER1',
      name: 'Supervisor Tester',
      roles: ['SUPERVISOR'],
      perms: { 'app-gr': ['approveGR', 'receiveGR'] },
      exp: Math.floor(Date.now() / 1000) + 3600
    }, TEST_SECRET);

    const res = await handler(new Request('https://database.example/functions/v1/gr-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://akra-web.github.io' },
      body: JSON.stringify({ ...payload, token })
    }));

    await Promise.all(lineTasks.splice(0));
    return res;
  }

  return { invoke, linePushBodies, setFlexShouldFail(v) { flexShouldFail = v; } };
}

(async () => {
  // Test 1: Standard GR Completed with valid Flex Bubble layout
  {
    const harness = createHarness();
    const res = await harness.invoke({
      action: 'bulkReceivePO',
      data: {
        targetStatus: 'GR Completed',
        receiverName: 'สมชาย คลังสินค้า',
        ata: '02/09/2026',
        remark: 'กล่องสมบูรณ์ ตรวจนับครบ',
        groupInfo: { vendor: 'บริษัท แป้งสยาม จำกัด', poNumber: 'PO-20260902-01', warehouse: 'W1', billRef: 'BILL-999' },
        items: [
          { uid: 'PO-1', product: 'แป้งเค้กพัดโบก 1 กก.', grQty: 10, unit: 'ถุง', locIn: 'W1-1F-Z1', exp: '31/12/2026' },
          { uid: 'PO-2', product: 'เนยสดออร์คิด 5 กก.', grQty: 5, unit: 'กล่อง', locIn: 'W1-F1-CHILL', exp: '15/10/2026' }
        ],
        extraItems: [
          { sku: 'EX-101', product: 'ที่ปาดเค้กพลาสติก', grQty: 2, unit: 'อัน', locIn: 'W1-2F-Z3', exp: '' }
        ]
      }
    });

    assert.equal(res.status, 200);
    assert.equal(harness.linePushBodies.length, 1);
    const msg = harness.linePushBodies[0].messages[0];
    assert.equal(msg.type, 'flex');
    assert.match(msg.altText, /✅ อนุมัติรับเข้าคลัง: บริษัท แป้งสยาม จำกัด \(W1\) 3 รายการ \[02\/09\/2026\]/);

    const bubble = msg.contents;
    assert.equal(bubble.type, 'bubble');
    assert.equal(bubble.size, 'mega');
    assert.equal(bubble.header.backgroundColor, '#0F172A');
    assert.equal(bubble.header.contents[0].text, '✅ อนุมัติรับเข้าคลังเรียบร้อย (GR Completed)');
    assert.match(bubble.header.contents[1].text, /ผู้รับลงสินค้า: สมชาย คลังสินค้า/);

    const json = JSON.stringify(bubble);
    assert.match(json, /บริษัท แป้งสยาม จำกัด/);
    assert.match(json, /PO-20260902-01/);
    assert.match(json, /BILL-999/);
    assert.match(json, /แป้งเค้กพัดโบก 1 กก\./);
    assert.match(json, /10 ถุง/);
    assert.match(json, /\[W1-1F-Z1\]/);
    assert.match(json, /หมดอายุ: 31\/12\/2026/);
    assert.match(json, /เนยสดออร์คิด 5 กก\./);
    assert.match(json, /ที่ปาดเค้กพลาสติก \(ของแถม\/นอกบิล\)/);
    assert.match(json, /กล่องสมบูรณ์ ตรวจนับครบ/);

    console.log('PASS Test 1: Standard GR Completed produces structured LINE Flex Bubble');
  }

  // Test 2: Blank Expiry handling (must NOT show empty Expiry tags)
  {
    const harness = createHarness();
    await harness.invoke({
      action: 'bulkReceivePO',
      data: {
        targetStatus: 'GR Completed',
        receiverName: 'สมหญิง',
        ata: '02/09/2026',
        groupInfo: { vendor: 'ซัพพลายเออร์ B', warehouse: 'W5' },
        items: [
          { uid: 'PO-3', product: 'กล่องลูกฟูกเบอร์ 0', grQty: 100, unit: 'ใบ', locIn: 'W5-1F-A', exp: '' },
          { uid: 'PO-4', product: 'ถุงพลาสติกใส', grQty: 50, unit: 'แพ็ค', locIn: 'W5-1F-B', exp: null }
        ],
        extraItems: []
      }
    });

    assert.equal(harness.linePushBodies.length, 1);
    const bubble = harness.linePushBodies[0].messages[0].contents;
    const json = JSON.stringify(bubble);
    assert.match(json, /กล่องลูกฟูกเบอร์ 0/);
    assert.match(json, /ถุงพลาสติกใส/);
    assert.doesNotMatch(json, /หมดอายุ:/, 'Blank or null exp must not output expiry label in Flex');
    assert.doesNotMatch(json, /📝 หมายเหตุ:/, 'No remark box when remark is empty');

    console.log('PASS Test 2: Blank / null expiry produces clean rows without empty tags');
  }

  // Test 3: Overflow items (> 30 items) adds overflow summary
  {
    const harness = createHarness();
    const manyItems = [];
    for (let i = 1; i <= 35; i++) {
      manyItems.push({ uid: `ITEM-${i}`, product: `วัตถุดิบทดสอบ #${i}`, grQty: i, unit: 'ชิ้น', locIn: `W1-1F-Z${i}`, exp: '' });
    }
    await harness.invoke({
      action: 'bulkReceivePO',
      data: {
        targetStatus: 'GR Completed',
        receiverName: 'สมชาย',
        ata: '02/09/2026',
        groupInfo: { vendor: 'บิ๊กซัพพลายเออร์', warehouse: 'W1' },
        items: manyItems,
        extraItems: []
      }
    });

    assert.equal(harness.linePushBodies.length, 1);
    const bubble = harness.linePushBodies[0].messages[0].contents;
    const json = JSON.stringify(bubble);
    assert.match(json, /วัตถุดิบทดสอบ #1/);
    assert.match(json, /วัตถุดิบทดสอบ #30/);
    assert.doesNotMatch(json, /วัตถุดิบทดสอบ #31/, 'Item 31 should be capped in display items');
    assert.match(json, /และรายการอื่นๆ อีก 5 รายการ \(ตรวจสอบได้ในระบบ GR\)/);

    console.log('PASS Test 3: > 30 items properly bounded with summary notice');
  }

  // Test 4: Graceful fallback to Plain Text when Flex push fails
  {
    const harness = createHarness({ flexShouldFail: true });
    await harness.invoke({
      action: 'bulkReceivePO',
      data: {
        targetStatus: 'GR Completed',
        receiverName: 'สมชาย',
        ata: '02/09/2026',
        groupInfo: { vendor: 'ซัพพลายเออร์ C', warehouse: 'W1' },
        items: [
          { uid: 'PO-5', product: 'น้ำตาลทราย 1 กก.', grQty: 20, unit: 'ถุง', locIn: 'W1-1F-Z2', exp: '01/01/2028' }
        ],
        extraItems: []
      }
    });

    assert.equal(harness.linePushBodies.length, 2, 'Should attempt Flex push first then fallback to Text push');
    assert.equal(harness.linePushBodies[0].messages[0].type, 'flex');
    assert.equal(harness.linePushBodies[1].messages[0].type, 'text');
    assert.match(harness.linePushBodies[1].messages[0].text, /✅ อนุมัติรับเข้าคลังเรียบร้อย \(GR Completed\)/);
    assert.match(harness.linePushBodies[1].messages[0].text, /น้ำตาลทราย 1 กก\./);

    console.log('PASS Test 4: Fallback to plain text verified when Flex API returns error');
  }

  // Test 5: Draft and Pending Review must send zero notifications
  {
    const harness = createHarness();
    await harness.invoke({
      action: 'bulkReceivePO',
      data: {
        targetStatus: 'Pending Review',
        receiverName: 'สมชาย',
        items: [{ uid: 'PO-6', grQty: 5 }]
      }
    });
    await harness.invoke({
      action: 'bulkReceivePO',
      data: {
        targetStatus: 'Draft GR',
        receiverName: 'สมชาย',
        items: [{ uid: 'PO-6', grQty: '' }]
      }
    });

    assert.equal(harness.linePushBodies.length, 0, 'Draft and Pending Review must produce zero LINE notifications');
    console.log('PASS Test 5: Draft and Pending Review produce zero notifications');
  }

  console.log('\nALL GR LINE Flex Message Tests Passed Successfully! 🚀');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
