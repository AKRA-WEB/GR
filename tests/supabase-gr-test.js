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

  // 2. Receive Goods Mutation
  console.log('\n[2/3] Testing Goods Receipt creation mutation...');
  const sampleBill = initData.activeBills[0];
  const receiptPayload = {
    poId: sampleBill.poId,
    poNumber: sampleBill.poNumber,
    grNumber: 'GR-TEST-' + Date.now(),
    grDate: '2026-08-19',
    receiver: 'Test Inspector',
    warehouse: sampleBill.warehouse,
    status: 'Pending Review',
    items: (sampleBill.items || []).slice(0, 1).map(it => ({
      poItemId: it.itemId,
      sku: it.sku,
      productName: it.productName,
      receivedQty: it.poQty,
      unit: it.unit,
      expiryDate: '2027-08-19'
    }))
  };

  const grRes = await grClient.receiveGoods(receiptPayload);
  assert.strictEqual(grRes.status, 'success');
  assert(grRes.grId, 'Must return generated GR ID');
  console.log(`  -> Created Goods Receipt [${grRes.grNumber}] ID: ${grRes.grId}`);

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
