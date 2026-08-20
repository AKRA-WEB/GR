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

    /**
     * Receive Goods Mutation (Save GR Record + Items + Update PO Status)
     */
    async function receiveGoods(receiptData) {
        const { poId, poNumber, grNumber, grDate, ataDate, receiver, warehouse, status, items } = receiptData;

        // 1. Insert into goods_receipts
        const grPayload = {
            po_id: poId || null,
            po_number: poNumber,
            gr_number: grNumber || ('GR-' + Date.now()),
            gr_date: grDate || new Date().toISOString().split('T')[0],
            ata_date: ataDate || grDate || new Date().toISOString().split('T')[0],
            receiver: receiver || 'Warehouse Staff',
            warehouse: warehouse || 'W1',
            status: status || 'Pending Review'
        };

        const createdReceipts = await supabaseRest('goods_receipts', {
            method: 'POST',
            body: grPayload
        });
        const gr = createdReceipts[0];

        // 2. Insert into goods_receipt_items
        if (Array.isArray(items) && items.length > 0) {
            const itemPayloads = items.map(item => ({
                gr_id: gr.id,
                po_item_id: item.poItemId || null,
                sku: item.sku,
                product_name: item.productName || item.product_name,
                gr_qty: Number(item.receivedQty || item.received_qty || item.gr_qty || 0),
                unit: item.unit || 'ชิ้น',
                is_extra: item.isExtra === true,
                exp_date: item.expiryDate || item.exp_date || null,
                location_in: item.location || item.location_in || warehouse || 'W1'
            }));

            await supabaseRest('goods_receipt_items', {
                method: 'POST',
                body: itemPayloads
            });
        }

        // 3. Update PO status
        if (poId) {
            await supabaseRest(`purchase_orders?id=eq.${encodeURIComponent(poId)}`, {
                method: 'PATCH',
                body: { status: status === 'GR Completed' ? 'GR Completed' : 'Pending Review' }
            });
        }

        return {
            status: 'success',
            grId: gr.id,
            grNumber: gr.gr_number
        };
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
        getProductReceiptHistory,
        SUPABASE_CONFIG
    };
}));
