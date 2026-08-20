async (page) => {
  const completedRequests = [];
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/gr-api', async route => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = JSON.parse(request.postData() || '{}');
    const data = body.data || {};
    const row = (uid, bill, poNumber, product) => ({
      uid,
      refPrUid: bill,
      poNumber,
      vendor: 'Fixture Vendor',
      poDate: '03/08/2026',
      warehouse: 'W1',
      status: 'GR Completed',
      product,
      displayStatus: 'GR Completed'
    });

    let response;
    if (body.action === 'getInitialData' && data.includeCompleted) {
      completedRequests.push(data);
      response = data.completedOffset
        ? {
            success: true,
            pendingPOs: [],
            grCompleted: [row('B', 'BILL-B', 'PO-B', 'Second page item')],
            grCompletedTotal: 2,
            grCompletedHasMore: false,
            grCompletedNextOffset: 2,
            deliveryPlanning: {}
          }
        : {
            success: true,
            pendingPOs: [],
            grCompleted: [row('A', 'BILL-A', 'PO-A', 'First page item')],
            grCompletedTotal: 2,
            grCompletedHasMore: true,
            grCompletedNextOffset: 1,
            deliveryPlanning: {}
          };
    } else if (body.action === 'getInitialData') {
      response = { success: true, pendingPOs: [], grCompleted: [], deliveryPlanning: {} };
    } else if (body.action === 'getProducts') {
      response = { success: true, products: [] };
    } else if (body.action === 'getDeliveryPlanning') {
      response = { success: true, deliveryPlanning: {}, planByUid: {} };
    } else {
      response = { success: true };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });

  await page.goto('http://localhost:4173/');
  await page.waitForSelector('#r-status-filter');
  await page.locator('#r-status-filter').selectOption('GR Completed');
  await page.getByText('First page item').waitFor();
  await page.getByRole('button', { name: /โหลดประวัติเพิ่ม/ }).click();
  await page.getByText('Second page item').waitFor();

  const completedItems = await page.locator('#po-list-container .status-card--completed').count();
  if (completedItems !== 2) throw new Error(`Expected 2 merged completed bills, received ${completedItems}`);
  if (completedRequests.length !== 2) throw new Error(`Expected 2 completed requests, received ${completedRequests.length}`);
  if (completedRequests[0].completedLimit !== 200 || completedRequests[0].completedOffset !== undefined) {
    throw new Error('First completed request was not the initial bounded page');
  }
  if (completedRequests[1].completedLimit !== 200 || completedRequests[1].completedOffset !== 1) {
    throw new Error('Second completed request did not use the next offset');
  }
  if (consoleErrors.length > 0) throw new Error(`Browser console errors: ${consoleErrors.join(' | ')}`);
}
