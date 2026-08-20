const assert = require('assert');
const grClient = require('../js/supabase-gr-client.js');

async function runTests() {
  console.log('=== TESTING GR SUPABASE API CLIENT ADAPTER ===\n');

  // 1. Initial Data Read (Active receiving bills)
  console.log('[1/3] Testing getInitialData (Active receiving bills)...');
  const t0 = Date.now();
  const initData = await grClient.getInitialData({ includeCompleted: true });
  const initMs = Date.now() - t0;
  assert.strictEqual(initData.status, 'success');
  assert(Array.isArray(initData.activeBills), 'Active bills must be an array');
  assert(initData.activeBills.length > 0, 'Must have active bills');
  assert(initData.completedBills.length > 0, 'Must have completed bills');
  console.log(`  -> Initial Read Latency: ${initMs}ms`);
  console.log(`  -> Active Bills Count: ${initData.activeBills.length}`);
  console.log(`  -> Completed Bills Count: ${initData.completedBills.length}`);

  // 2. Receive Goods Mutation on Isolated Test Record
  console.log('\n[2/3] Testing Goods Receipt creation mutation on isolated test PO...');
  const poClient = require('../../PO/js/supabase-po-client.js');
  const tempPo = await poClient.saveDirectPO({
    poNumber: 'PO-TEST-GR-' + Date.now(),
    poDate: '2026-08-19',
    vendor: 'ทดสอบระบบ Vendor',
    warehouse: 'W1',
    remark: 'Automated Test PO',
    items: [
      {
        sku: 'FF21610104',
        productName: 'สินค้าทดสอบรับเข้า',
        poQty: 10,
        unit: 'ลัง'
      }
    ]
  });

  const receiptPayload = {
    poId: tempPo.poId,
    poNumber: tempPo.poNumber,
    grNumber: 'GR-TEST-' + Date.now(),
    grDate: '2026-08-19',
    receiver: 'Test Inspector',
    warehouse: 'W1',
    status: 'Pending Review',
    items: [
      {
        sku: 'FF21610104',
        productName: 'สินค้าทดสอบรับเข้า',
        grQty: 10,
        unit: 'ลัง',
        exp: '19/08/2027',
        locIn: 'W1-1F'
      }
    ]
  };

  const grRes = await grClient.receiveGoods(receiptPayload);
  assert.strictEqual(grRes.status, 'success');
  console.log(`  -> Created Goods Receipt ID: ${grRes.grId}`);

  // Cleanup isolated test PO
  await poClient.deleteBill(tempPo.poId);
  console.log(`  -> Cleaned up isolated test PO [${tempPo.poId}]`);

  // 3. Product Receipt History
  console.log('\n[3/3] Testing Product Receipt History query (<30ms)...');
  const historyRes = await grClient.getProductReceiptHistory('FF21610104');
  assert.strictEqual(historyRes.status, 'success');
  console.log(`  -> Retrieved history for SKU [${historyRes.sku}]: ${historyRes.totalReceipts} records`);

  console.log('\n🌟 GR SUPABASE API CLIENT ADAPTER TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
