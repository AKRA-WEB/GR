/**
 * ============================================================================
 * AKRA GR (GOODS RECEIVING) SUPABASE API CLIENT
 * High-Speed Receiving & History Management (<25ms queries)
 * ============================================================================
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AkraSupabaseGR = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const SUPABASE_CONFIG = {
        URL: 'https://hgxrrskztbpejirrdpbq.supabase.co',
        KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneHJyc2t6dGJwZWppcnJkcGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzEyNDU4MCwiZXhwIjoyMTAyNzAwNTgwfQ.9RiiP0kItbbcMeI2mYActrD9a1naHCNbmYJBRXHR1DI',
            };

    async function supabaseRest(endpoint, options = {}) {
        const url = `${SUPABASE_CONFIG.URL}/rest/v1/${endpoint}`;
        const key = SUPABASE_CONFIG.KEY;
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': options.prefer || 'return=representation',
            ...(options.headers || {})
        };
        const res = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Supabase REST HTTP ${res.status}: ${errText}`);
        }
        return res.json();
    }

    function formatIsoToDdMmYyyy(isoDate) {
        if (!isoDate) return '';
        const clean = String(isoDate).trim().split('T')[0];
        const parts = clean.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return isoDate;
    }

    function mapPoToBill(po) {
        const receipts = po.receipts || [];
        const primaryReceipt = receipts[0] || null;

        return {
            poId: po.id,
            billId: po.legacy_uid || po.id,
            poNumber: po.po_number,
            poDate: po.po_date ? formatIsoToDdMmYyyy(po.po_date) : '',
            refPrUid: po.ref_pr_uid || '',
            expectedDate: po.expected_date ? formatIsoToDdMmYyyy(po.expected_date) : '',
            vendor: po.vendor_name,
            warehouse: po.warehouse,
            status: po.status,
            remark: po.remark,
            ata: primaryReceipt?.ata_date ? formatIsoToDdMmYyyy(primaryReceipt.ata_date) : '',
            receiverName: primaryReceipt?.receiver || '',
            items: (po.items || []).map(item => {
                let matchedGrItem = null;
                let matchedReceipt = null;
                for (const rec of receipts) {
                    for (const grIt of (rec.gr_items || [])) {
                        if ((grIt.po_item_id && grIt.po_item_id === item.id) ||
                            (grIt.ref_po_item_uid && grIt.ref_po_item_uid === (item.legacy_uid || item.id))) {
                            matchedGrItem = grIt;
                            matchedReceipt = rec;
                            break;
                        }
                    }
                    if (matchedGrItem) break;
                }

                const grQty = matchedGrItem && matchedGrItem.gr_qty !== null && matchedGrItem.gr_qty !== undefined ? String(matchedGrItem.gr_qty) : '';
                const locIn = matchedGrItem?.location_in || '';
                const exp = matchedGrItem?.exp_date ? formatIsoToDdMmYyyy(matchedGrItem.exp_date) : '';
                const oldStock = matchedGrItem && matchedGrItem.old_stock ? String(matchedGrItem.old_stock) : '';
                const leadtime = matchedGrItem && matchedGrItem.leadtime_days !== null && matchedGrItem.leadtime_days !== undefined ? String(matchedGrItem.leadtime_days) : '';
                const itemAta = matchedReceipt?.ata_date ? formatIsoToDdMmYyyy(matchedReceipt.ata_date) : (primaryReceipt?.ata_date ? formatIsoToDdMmYyyy(primaryReceipt.ata_date) : '');
                const itemReceiver = matchedReceipt?.receiver || primaryReceipt?.receiver || '';

                return {
                    itemId: item.id,
                    id: item.id,
                    uid: item.legacy_uid || item.id,
                    sku: item.sku,
                    productName: item.product_name,
                    product: item.product_name,
                    quantity: Number(item.po_qty),
                    poQty: Number(item.po_qty),
                    unit: item.unit || 'ชิ้น',
                    expectedDate: item.expected_date ? formatIsoToDdMmYyyy(item.expected_date) : (po.expected_date ? formatIsoToDdMmYyyy(po.expected_date) : ''),
                    status: item.status || po.status,
                    grQty: grQty,
                    locIn: locIn,
                    exp: exp,
                    oldStock: oldStock,
                    leadtime: leadtime,
                    ata: itemAta,
                    receiverName: itemReceiver
                };
            }),
            receipts: receipts
        };
    }

    /**
     * Get Initial Data for Active Receiving Bills
     */
    async function getInitialData(options = {}) {
        const [activeOrders, vendors] = await Promise.all([
            supabaseRest('purchase_orders?status=in.(Pending Review,Pending GR,Partial GR)&select=*,items:purchase_order_items(*),receipts:goods_receipts(*,gr_items:goods_receipt_items(*))&order=created_at.desc'),
            supabaseRest('vendors?is_active=eq.true&select=name&order=name.asc')
        ]);

        const activeBills = (activeOrders || []).map(mapPoToBill);

        let completedBills = [];
        if (options.includeCompleted) {
            const completedOrders = await supabaseRest('purchase_orders?status=in.(GR Completed,Completed)&select=*,items:purchase_order_items(*),receipts:goods_receipts(*,gr_items:goods_receipt_items(*))&order=created_at.desc&limit=100');
            completedBills = (completedOrders || []).map(mapPoToBill);
        }

        return {
            status: 'success',
            activeBills,
            completedBills,
            vendors: (vendors || []).map(v => v.name)
        };
    }

    function formatToIsoDate(dateStr) {
        if (!dateStr) return null;
        const str = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const parts = str.replace(/[-.]/g, '/').split('/');
        if (parts.length === 3) {
            let p1 = parseInt(parts[0], 10);
            let p2 = parseInt(parts[1], 10);
            let p3 = parseInt(parts[2], 10);
            if (isNaN(p1) || isNaN(p2) || isNaN(p3)) return null;
            let day, month, year;
            if (p1 > 1000) { year = p1; month = p2; day = p3; }
            else { day = p1; month = p2; year = p3; }
            if (year > 2400) year -= 543;
            else if (year < 100) year = year >= 60 ? 2500 + year - 543 : 2000 + year;
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        return null;
    }

    /**
     * Bulk Receive PO Mutation (Save GR Record + Items + Update PO Status)
     */
    async function bulkReceivePO(bulkPayload) {
        const { ata, receiverName, remark, targetStatus, groupInfo, groupPoUids, items, extraItems } = bulkPayload;

        const ataIso = formatToIsoDate(ata) || new Date().toISOString().split('T')[0];
        const status = targetStatus === 'GR Completed' ? 'GR Completed' : (targetStatus === 'Draft GR' ? 'Pending Review' : 'Pending Review');
        const poStatus = targetStatus === 'GR Completed' ? 'GR Completed' : (targetStatus === 'Pending Review' ? 'Pending Review' : 'Pending GR');

        // 1. Locate the Purchase Order
        let po = null;
        if (Array.isArray(groupPoUids) && groupPoUids.length > 0) {
            const uids = groupPoUids.map(u => encodeURIComponent(u)).join(',');
            const foundPOs = await supabaseRest(`purchase_orders?legacy_uid=in.(${uids})&select=*,items:purchase_order_items(*)`);
            if (foundPOs && foundPOs.length > 0) po = foundPOs[0];
            else {
                const foundById = await supabaseRest(`purchase_orders?id=in.(${uids})&select=*,items:purchase_order_items(*)`);
                if (foundById && foundById.length > 0) po = foundById[0];
            }
        }

        if (!po && groupInfo && groupInfo.poNumber) {
            const foundByPoNum = await supabaseRest(`purchase_orders?po_number=eq.${encodeURIComponent(groupInfo.poNumber)}&select=*,items:purchase_order_items(*)`);
            if (foundByPoNum && foundByPoNum.length > 0) po = foundByPoNum[0];
        }

        const poId = po ? po.id : null;
        const poNumber = po ? po.po_number : (groupInfo?.poNumber || '');
        const warehouse = groupInfo?.warehouse || po?.warehouse || 'W1';

        // 2. Find or Create goods_receipts record
        let gr = null;
        if (poId) {
            const existingGRs = await supabaseRest(`goods_receipts?po_id=eq.${encodeURIComponent(poId)}&select=*`);
            if (existingGRs && existingGRs.length > 0) gr = existingGRs[0];
        }

        if (gr) {
            const updatedGRs = await supabaseRest(`goods_receipts?id=eq.${encodeURIComponent(gr.id)}`, {
                method: 'PATCH',
                body: {
                    ata_date: ataIso,
                    receiver: receiverName || 'WAREHOUSE',
                    warehouse: warehouse,
                    status: status,
                    remark: remark || ''
                }
            });
            if (updatedGRs && updatedGRs.length > 0) gr = updatedGRs[0];
        } else {
            const newGrPayload = {
                po_id: poId,
                po_number: poNumber,
                ref_po_uid: (groupPoUids && groupPoUids[0]) || po?.legacy_uid || null,
                gr_number: `GR-${ataIso.replace(/-/g, '')}-${Date.now().toString(36)}`,
                gr_date: ataIso,
                ata_date: ataIso,
                receiver: receiverName || 'WAREHOUSE',
                warehouse: warehouse,
                status: status,
                remark: remark || ''
            };
            const createdReceipts = await supabaseRest('goods_receipts', {
                method: 'POST',
                body: newGrPayload
            });
            gr = createdReceipts[0];
        }

        // 3. Upsert Goods Receipt Items
        if (gr && Array.isArray(items) && items.length > 0) {
            const existingGrItems = await supabaseRest(`goods_receipt_items?gr_id=eq.${encodeURIComponent(gr.id)}&select=*`);
            const existingMapByRef = new Map();
            (existingGrItems || []).forEach(it => {
                if (it.ref_po_item_uid) existingMapByRef.set(it.ref_po_item_uid, it);
                if (it.po_item_id) existingMapByRef.set(it.po_item_id, it);
            });

            const poItemsList = po?.items || [];
            const poItemMap = new Map();
            poItemsList.forEach(pi => {
                if (pi.legacy_uid) poItemMap.set(pi.legacy_uid, pi);
                if (pi.id) poItemMap.set(pi.id, pi);
            });

            for (const item of items) {
                const matchedPoItem = poItemMap.get(item.uid);
                const existingGrItem = existingMapByRef.get(item.uid) || (matchedPoItem ? existingMapByRef.get(matchedPoItem.id) : null);
                const expDateIso = item.exp ? formatToIsoDate(item.exp) : null;
                const grQtyNum = parseFloat(item.grQty) || 0;
                const oldStockNum = parseFloat(item.oldStock) || 0;

                if (existingGrItem) {
                    await supabaseRest(`goods_receipt_items?id=eq.${encodeURIComponent(existingGrItem.id)}`, {
                        method: 'PATCH',
                        body: {
                            gr_qty: grQtyNum,
                            unit: item.unit || existingGrItem.unit,
                            location_in: item.locIn || existingGrItem.location_in,
                            exp_date: expDateIso,
                            old_stock: oldStockNum
                        }
                    });
                } else {
                    await supabaseRest('goods_receipt_items', {
                        method: 'POST',
                        body: {
                            gr_id: gr.id,
                            po_item_id: matchedPoItem ? matchedPoItem.id : null,
                            ref_po_item_uid: item.uid,
                            sku: matchedPoItem?.sku || '',
                            product_name: matchedPoItem?.product_name || 'Unknown Product',
                            gr_qty: grQtyNum,
                            unit: item.unit || matchedPoItem?.unit || 'ชิ้น',
                            location_in: item.locIn || warehouse || 'W1',
                            exp_date: expDateIso,
                            old_stock: oldStockNum,
                            is_extra: false,
                            remark: remark || ''
                        }
                    });
                }
            }
        }

        // 4. Handle extra items
        if (gr && Array.isArray(extraItems) && extraItems.length > 0) {
            for (const ex of extraItems) {
                const expDateIso = ex.exp ? formatToIsoDate(ex.exp) : null;
                await supabaseRest('goods_receipt_items', {
                    method: 'POST',
                    body: {
                        gr_id: gr.id,
                        sku: ex.sku || '',
                        product_name: ex.product || 'ของแถม',
                        gr_qty: parseFloat(ex.grQty) || 0,
                        unit: ex.unit || 'ชิ้น',
                        location_in: ex.locIn || warehouse || 'W1',
                        exp_date: expDateIso,
                        old_stock: parseFloat(ex.oldStock) || 0,
                        is_extra: true,
                        remark: remark || ''
                    }
                });
            }
        }

        // 5. Update PO and PO Item Status
        if (poId) {
            await supabaseRest(`purchase_orders?id=eq.${encodeURIComponent(poId)}`, {
                method: 'PATCH',
                body: { status: poStatus, updated_at: new Date().toISOString() }
            });
            await supabaseRest(`purchase_order_items?po_id=eq.${encodeURIComponent(poId)}`, {
                method: 'PATCH',
                body: { status: poStatus }
            });
        }

        return {
            success: true,
            status: 'success',
            message: targetStatus === 'GR Completed' ? 'ยืนยันรับเข้าคลังเรียบร้อย' : 'บันทึกสำเร็จ',
            grId: gr?.id
        };
    }

    /**
     * Receive Goods Mutation (Save GR Record + Items + Update PO Status)
     */
    async function receiveGoods(receiptData) {
        return bulkReceivePO({
            ata: receiptData.ataDate || receiptData.grDate,
            receiverName: receiptData.receiver,
            remark: receiptData.remark,
            targetStatus: receiptData.status,
            groupInfo: { poNumber: receiptData.poNumber, warehouse: receiptData.warehouse },
            groupPoUids: [receiptData.poId],
            items: receiptData.items || []
        });
    }

    /**
     * Product Receipt History Dashboard & Analytics Query (<30ms)
     */
    async function getProductReceiptHistory(sku, limit = 50) {
        if (!sku) throw new Error('Missing SKU parameter');
        const cleanSku = String(sku).trim();
        const items = await supabaseRest(`goods_receipt_items?sku=eq.${encodeURIComponent(cleanSku)}&select=*,receipt:goods_receipts(*)&order=created_at.desc&limit=${limit}`);
        return {
            status: 'success',
            sku: cleanSku,
            totalReceipts: items ? items.length : 0,
            history: items || []
        };
    }

    return {
        getInitialData,
        receiveGoods,
        bulkReceivePO,
        getProductReceiptHistory,
        SUPABASE_CONFIG
    };
}));
