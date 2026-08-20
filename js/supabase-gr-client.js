/**
 * ============================================================================
 * AKRA GR (GOODS RECEIPT) SUPABASE API CLIENT
 * Supabase is the canonical GR store. This browser client talks only to the
 * authenticated GR Edge Function and never receives a database credential.
 * ============================================================================
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AkraSupabaseGR = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const API_URL = 'https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/gr-api';
    const READ_ACTIONS = new Set(['bootstrap', 'getInitialData', 'getProducts', 'getDeliveryPlanning', 'getProductReceiptHistory']);

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function request(action, data, token) {
        if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
        const isRead = READ_ACTIONS.has(action);
        const attempts = isRead ? 2 : 1;
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), isRead ? 25000 : 35000);
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, data: data || {}, token }),
                    signal: controller.signal
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const error = new Error(payload.message || payload.reason || `GR API HTTP ${response.status}`);
                    error.reason = payload.reason || '';
                    throw error;
                }
                return payload;
            } catch (error) {
                lastError = error;
                if (attempt < attempts && (error.name === 'AbortError' || error instanceof TypeError)) {
                    await delay(250 * attempt);
                    continue;
                }
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        }
        throw lastError || new Error('GR API unavailable');
    }

    return {
        request,
        getInitialData: (data, token) => request('getInitialData', data, token),
        bulkReceivePO: (data, token) => request('bulkReceivePO', data, token),
        recallGR: (data, token) => request('recallGR', data, token),
        getProductReceiptHistory: (data, token) => request('getProductReceiptHistory', data, token),
        API_URL
    };
}));
