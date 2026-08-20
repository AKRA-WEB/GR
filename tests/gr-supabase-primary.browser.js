async (page) => {
  const state = {
    items: [
      { uid: 'PO-A', product: 'Product A', status: 'GR Completed' },
      { uid: 'PO-B', product: 'Product B', status: 'Pending GR' }
    ],
    extras: [{ id: 'EX-A', sku: 'BONUS-A', product: 'Bonus A', grQty: 1, unit: 'ชิ้น', locIn: 'W1-1F-A1', exp: '', oldStock: '' }]
  };
  const edgeActions = [];
  let gasPosts = 0;
  let mainRequests = 0;
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await page.route('https://script.google.com/**', async route => {
    const request = route.request();
    mainRequests++;
    if (request.method() === 'POST') gasPosts++;
    if (request.url().includes('action=verifyToken')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, user: {
          id: 'A1', name: 'Browser Approver', roles: ['SUPERVISOR'],
          perms: { 'app-gr': ['receiveGR', 'approveGR'] }
        } })
      });
      return;
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false }) });
  });

  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/gr-api', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    edgeActions.push(body.action);
    const row = item => ({
      uid: item.uid, refPrUid: 'BILL-1', poNumber: 'PO-001', poDate: '01/08/2026',
      vendor: 'Fixture Vendor', warehouse: 'W1', sku: `SKU-${item.uid}`, product: item.product,
      quantity: 10, unit: 'ลัง', status: item.status, displayStatus: item.status,
      grQty: item.status === 'Pending GR' ? '' : 10, locIn: item.status === 'Pending GR' ? '' : 'W1-1F',
      ata: item.status === 'Pending GR' ? '' : '20/08/2026', receiverName: 'Browser Approver',
      extraItems: state.extras.map(extra => ({ ...extra }))
    });
    let response;
    if (body.action === 'bootstrap' || body.action === 'getInitialData') {
      const initialData = {
        success: true,
        pendingPOs: state.items.filter(item => item.status !== 'GR Completed').map(row),
        grCompleted: body.data?.includeCompleted ? state.items.filter(item => item.status === 'GR Completed').map(row) : [],
        grCompletedTotal: state.items.some(item => item.status === 'GR Completed') ? 1 : 0,
        grCompletedHasMore: false,
        grCompletedNextOffset: state.items.some(item => item.status === 'GR Completed') ? 1 : 0,
        products: [], deliveryPlanning: {}
      };
      response = body.action === 'bootstrap'
        ? { valid: true, user: {
            id: 'A1', name: 'Browser Approver', roles: ['SUPERVISOR'],
            perms: { 'app-gr': ['receiveGR', 'approveGR'] }
          }, initialData }
        : initialData;
    } else if (body.action === 'getProducts') {
      response = { success: true, products: [] };
    } else if (body.action === 'getDeliveryPlanning') {
      response = { success: true, deliveryPlanning: {}, planByUid: {} };
    } else if (body.action === 'bulkReceivePO') {
      const selected = new Set((body.data?.items || []).map(item => item.uid));
      state.items.forEach(item => { if (selected.has(item.uid)) item.status = body.data.targetStatus; });
      if (body.data?.replaceExtras) state.extras = (body.data.extraItems || []).map((extra, index) => ({ id: `EX-${index}`, ...extra }));
      response = { success: true };
    } else if (body.action === 'recallGR') {
      const selected = new Set(body.data?.poUids || []);
      state.items.forEach(item => {
        if (body.data?.billRef === 'BILL-1' || selected.has(item.uid)) item.status = body.data.actionType === 'reset' ? 'Pending GR' : 'Draft GR';
      });
      if (body.data.actionType === 'reset') state.extras = [];
      response = { success: true };
    } else {
      response = { success: false, message: 'unexpected action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });

  await page.addInitScript(() => {
    localStorage.setItem('akra_gr_session', JSON.stringify({ token: 'browser-main-token' }));
  });
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.locator('#app-content').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.appData?.pendingPOs?.length === 1);

  const result = await page.evaluate(async () => {
    const before = { pending: window.appData.pendingPOs.map(item => item.uid) };
    window.openReceivingDetail(0);
    const renderedExtras = Array.from(document.querySelectorAll('.extra-item-row .ex-product')).map(input => input.value);
    window.addExtraItemRow({ sku: 'BONUS-B', product: 'Bonus B', grQty: 2, unit: 'ชิ้น', locIn: 'W1-1F-A2', exp: '', oldStock: '' });
    const poQty = document.querySelector('.po-item-row .po-qty');
    const poFloor = document.querySelector('.po-item-row .po-loc-floor');
    poQty.value = '10';
    poFloor.value = Array.from(poFloor.options).find(option => option.value)?.value || '';
    await window.submitReceiving({ preventDefault() {} }, 'GR Completed');
    const completed = await window.apiCall('getInitialData', { includeCompleted: true, completedLimit: 200 });
    await window.apiCall('recallGR', { actionType: 'reset', billRef: 'BILL-1', poUids: ['PO-B'] });
    const reset = await window.apiCall('getInitialData', { includeCompleted: true, completedLimit: 200 });
    return {
      before,
      renderedExtras,
      completed: completed.grCompleted.map(item => item.uid).sort(),
      completedExtras: (completed.grCompleted[0]?.extraItems || []).map(item => item.product).sort(),
      resetPending: reset.pendingPOs.map(item => item.uid).sort(),
      resetCompleted: reset.grCompleted.length
    };
  });

  if (JSON.stringify(result.before.pending) !== JSON.stringify(['PO-B'])) throw new Error(`Unexpected initial projection: ${JSON.stringify(result)}`);
  if (JSON.stringify(result.renderedExtras) !== JSON.stringify(['Bonus A'])) throw new Error(`Canonical extras were not rendered: ${JSON.stringify(result)}`);
  if (JSON.stringify(result.completedExtras) !== JSON.stringify(['Bonus A', 'Bonus B'])) throw new Error(`Extra merge/approval lost data: ${JSON.stringify(result)}`);
  if (JSON.stringify(result.completed) !== JSON.stringify(['PO-A', 'PO-B'])) throw new Error(`Later receive lost completed rows: ${JSON.stringify(result)}`);
  if (JSON.stringify(result.resetPending) !== JSON.stringify(['PO-A', 'PO-B']) || result.resetCompleted !== 0) throw new Error(`Reset projection failed: ${JSON.stringify(result)}`);
  if (gasPosts !== 0) throw new Error(`Canonical GR flow posted to GAS ${gasPosts} time(s)`);
  if (mainRequests !== 0) throw new Error(`Browser repeated Main verification ${mainRequests} time(s)`);
  if (!edgeActions.includes('bulkReceivePO') || !edgeActions.includes('recallGR')) throw new Error(`Missing Edge actions: ${edgeActions.join(',')}`);
  if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join(' | ')}`);
  return { result, edgeActions, gasPosts, mainRequests, consoleErrors };
}
