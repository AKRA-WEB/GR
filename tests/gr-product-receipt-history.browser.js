async (page) => {
  const historyRequests = [];
  const consoleErrors = [];
  let errorAttempts = 0;
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.unroute('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/gr-api');
  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/gr-api', async route => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = JSON.parse(request.postData() || '{}');
    const data = body.data || {};
    let response;
    if (body.action === 'getInitialData') {
      await page.waitForTimeout(500);
      response = { success: true, pendingPOs: [], grCompleted: [], deliveryPlanning: {} };
    } else if (body.action === 'getProducts') {
      response = { success: true, products: [
        { sku: 'SKU-001', name: 'สินค้าทดสอบชื่อยาวสำหรับตรวจสอบการแสดงผลบนหน้าจอขนาดเล็ก', unit: 'ลัง' },
        { sku: 'SKU-EMPTY', name: 'สินค้าไม่มีประวัติ', unit: 'ชิ้น' },
        { sku: 'SKU-ERROR', name: 'สินค้าทดสอบลองใหม่', unit: 'ชิ้น' }
      ] };
    } else if (body.action === 'getDeliveryPlanning') {
      response = { success: true, deliveryPlanning: {}, planByUid: {} };
    } else if (body.action === 'getProductReceiptHistory') {
      historyRequests.push(data);
      const first = {
        grUid: 'GR-1', sku: 'SKU-001', product: 'สินค้าทดสอบชื่อยาวสำหรับตรวจสอบการแสดงผลบนหน้าจอขนาดเล็ก', receiptDate: '05/08/2026', expDate: '31/12/2026', receiver: 'ผู้รับสินค้า',
        quantity: 10, unit: 'ลัง', warehouse: 'W1', location: 'W1-1F', vendor: '<img src=x onerror="window.__historyXss=1">',
        poNumber: 'PO-001', poDate: '01/08/2026', oldStock: 2, remark: '<script>window.__historyXss=1</script>'
      };
      const second = {
        grUid: 'GR-2', sku: 'SKU-001', product: 'สินค้าทดสอบชื่อยาวสำหรับตรวจสอบการแสดงผลบนหน้าจอขนาดเล็ก', receiptDate: '01/07/2026', expDate: '', receiver: 'ผู้รับเก่า', quantity: 5, unit: 'ลัง',
        warehouse: 'W2', location: 'W2-2F', vendor: 'Vendor B', poNumber: 'PO-002', poDate: '28/06/2026', oldStock: 1, remark: 'หมายเหตุย้อนหลัง'
      };
      if (data.sku === 'SKU-EMPTY') {
        response = { success: true, latest: null, history: [], total: 0, nextOffset: 0, hasMore: false };
      } else if (data.sku === 'SKU-ERROR') {
        errorAttempts += 1;
        response = errorAttempts === 1
          ? { success: false, message: 'Fixture history error' }
          : { success: true, latest: first, history: [first], total: 1, nextOffset: 1, hasMore: false };
      } else {
        response = data.offset
          ? { success: true, latest: first, history: [first, second], total: 2, nextOffset: 2, hasMore: false }
          : { success: true, latest: first, history: [first], total: 2, nextOffset: 1, hasMore: true };
      }
    } else {
      response = { success: true };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('#receiving-list-view:not(.hidden)');
  if (historyRequests.length !== 0) throw new Error('Product history was requested during normal startup');

  await page.getByRole('button', { name: 'เปิดประวัติสินค้า' }).click();
  await page.waitForSelector('#product-history-view:not(.hidden)');
  await page.waitForFunction(() => document.querySelectorAll('#product-history-options option').length === 3);
  await page.waitForTimeout(600);
  if (!(await page.locator('#product-history-view').isVisible())) throw new Error('Late startup response replaced the history view');
  if (await page.locator('#product-history-options option').count() !== 3) throw new Error('Late startup response cleared loaded products');
  if (historyRequests.length !== 0) throw new Error('Opening the history view must not fetch receipt history');

  await page.locator('#product-history-input').fill('SKU-001');
  await page.getByRole('button', { name: 'ค้นหาประวัติ' }).click();
  await page.getByText('31/12/2026', { exact: true }).first().waitFor();
  if (historyRequests.length !== 1 || historyRequests[0].sku !== 'SKU-001' || historyRequests[0].offset !== 0 || historyRequests[0].limit !== 50) {
    throw new Error('Initial history request contract is incorrect');
  }
  if (await page.locator('#product-history-results img').count()) throw new Error('Untrusted history text rendered as markup');
  if (await page.evaluate(() => window.__historyXss === 1)) throw new Error('History payload executed script');

  await page.getByRole('button', { name: 'โหลดประวัติเพิ่ม' }).click();
  await page.getByText('หมายเหตุย้อนหลัง', { exact: true }).waitFor();
  if (historyRequests.length !== 2 || historyRequests[1].offset !== 1) throw new Error('History pagination did not use nextOffset');
  if (await page.locator('#product-history-results ol > li').count() !== 2) throw new Error('History pages did not merge');

  await page.locator('#product-history-input').fill('SKU-EMPTY');
  await page.locator('#product-history-input').press('Enter');
  await page.getByText('ไม่พบประวัติการรับเข้าสำเร็จของสินค้านี้', { exact: true }).first().waitFor();

  await page.locator('#product-history-input').fill('SKU-ERROR');
  await page.getByRole('button', { name: 'ค้นหาประวัติ' }).click();
  await page.getByText('Fixture history error', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'ลองใหม่' }).click();
  await page.getByText('31/12/2026', { exact: true }).first().waitFor();
  if (errorAttempts !== 2) throw new Error('History retry did not repeat the selected product request');

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`Mobile layout overflows horizontally by ${overflow}px`);
  if (!(await page.getByRole('button', { name: 'เปิดประวัติสินค้า' }).isVisible())) throw new Error('Mobile history navigation is not visible');
  if (!(await page.locator('#product-history-results ol > li').first().isVisible())) throw new Error('Mobile history result is not visible');
  if (consoleErrors.length > 0) throw new Error(`Browser console errors: ${consoleErrors.join(' | ')}`);
}
