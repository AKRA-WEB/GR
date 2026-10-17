const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const baseline = process.env.GR_TEST_BASELINE_DIR;
const html = fs.readFileSync(baseline ? path.join(baseline, 'index.html') : path.join(__dirname, '..', 'index.html'), 'utf8');
const client = fs.readFileSync(baseline ? path.join(baseline, 'supabase-gr-client.js') : path.join(__dirname, '..', 'js/supabase-gr-client.js'), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).join('\n');
const bridgeSource = fs.readFileSync(baseline ? path.join(baseline,'akra-shell-bridge.js') : path.join(__dirname, '..', 'js/akra-shell-bridge.js'), 'utf8');
function element() {
  const classes = new Set(['hidden']), attributes = new Map();
  return { value: '', innerHTML: '', innerText: '', textContent: '', disabled: false,
    classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n), toggle(n, enabled) { enabled ??= !classes.has(n); enabled ? classes.add(n) : classes.delete(n); } },
    setAttribute: (n, v) => attributes.set(n, String(v)), getAttribute: n => attributes.get(n), removeAttribute: n => attributes.delete(n),
    addEventListener() {}, appendChild() {}, querySelector() { return element(); }, querySelectorAll() { return []; }, focus() {} };
}
function runtime(fetch, options = {}) {
  const nodes = new Map(), storage = new Map(), retired = [];
  const user = { id: 'fixture', identityId: 'fixture-user', sessionVersion: 1, authorizationRevision: 'fixture', name: 'Fixture', roles: ['ADMIN'], perms: { 'app-gr': ['receiveGR', 'approveGR'] }, token: 'fixture-token' };
  const window = { appSession: user, location: { search: '', hostname: 'example.test', pathname: '/GR/', href: 'https://example.test/GR/' }, addEventListener() {}, history: { replaceState() {} }, scrollTo() {},
    AkraModule: { embedded: !!options.embedded, getToken: () => options.embedded ? 'fixture-token' : '', verifySession: options.verifySession || (async () => user), authRequired: value => retired.push(value), home() {} } };
  storage.set('akra_gr_session', JSON.stringify(user));
  const context = vm.createContext({ window, self: window, document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelector() { return element(); }, querySelectorAll() { return []; }, createElement: element, addEventListener() {}, body: element(), head: element() },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), removeItem: k => storage.delete(k), get length() { return storage.size; }, key: i => [...storage.keys()][i] },
    navigator: { onLine: true }, URL, URLSearchParams, AbortController, TypeError, Error, Promise, Date, console: { warn() {}, error() {}, log() {} }, fetch,
    setTimeout: options.fastDeadline ? (fn, ms) => setTimeout(fn, ms > 1000 ? 5 : 0) : setTimeout, clearTimeout, setInterval() {}, requestAnimationFrame: fn => fn(), lucide: { createIcons() {} } });
  vm.runInContext(client, context);
  vm.runInContext(source, context);
  vm.runInContext('AppVersionGuard.blockIfStale = async () => false; checkAppVersion = async () => true;', context);
  return { context, nodes, window, retired };
}
function response(status, payload) { return { ok: status < 400, status, json: async () => payload }; }

test('old rejected 401 cannot retire a replacement session', async () => {
  let finish;
  const f=runtime(()=>new Promise(resolve=>finish=resolve),{embedded:true});
  const pending=f.context.apiCall('getInitialData',{});
  await new Promise(setImmediate);
  const replacement={id:'new-owner',token:'replacement-token'};f.window.appSession=replacement;
  finish(response(401,{success:false,reason:'invalid_or_expired_token'}));
  const result=await pending;
  assert.equal(f.window.appSession,replacement);
  assert.equal(f.retired.length,0);
  assert.equal(result.reason,'session_changed');
});
test('auth verifier 500 with no explicit reason remains a server failure', async () => {
  const f=runtime(async()=>response(500,{}));
  const start=bridgeSource.indexOf('        verifySession: async'),end=bridgeSource.indexOf('        home: fallback',start);
  const context=vm.createContext({shell:null,isMainSignedOut:()=>false,sessionStamp:()=> 'same',window:{},AbortController,setTimeout,clearTimeout,SESSION_VERIFY_TIMEOUT_MS:100,fetch:async()=>response(500,{})});
  vm.runInContext('var verifier={' + bridgeSource.slice(start,end) + '};',context);
  await assert.rejects(context.verifier.verifySession('app-gr','fixture-token'),error=>{
    assert.equal(f.context.grErrorState(error).type,'server');return true;
  });
});

test('actual Edge client and apiCall preserve status/reason across denied reads', async () => {
  const { context } = runtime(async () => response(403, { success: false, reason: 'permission_denied', message: 'fixture private error' }));
  await assert.rejects(context.window.AkraSupabaseGR.request('getInitialData', {}, 'fixture-token'), error => error.status === 403 && error.reason === 'permission_denied');
  const result = await context.apiCall('getInitialData', {});
  assert.equal(result.reason, 'permission_denied'); assert.equal(result.status, 403);
  assert.match(result.message, /ไม่มีสิทธิ์ใช้ส่วนนี้/); assert.doesNotMatch(result.message, /fixture private/);
});
test('read server, network, retry success and mutation rejection keep their own behavior', async () => {
  let calls = 0, mode = 'server';
  const { context } = runtime(async () => { calls++; if (mode === 'network') throw new TypeError('Failed to fetch'); if (mode === 'success') return response(200,{ success:true, pendingPOs: [] }); return response(mode === 'conflict' ? 409 : 500, { success:false, reason: mode === 'conflict' ? 'stale_count' : '', message:'fixture private error' }); });
  assert.match((await context.apiCall('getInitialData', {})).message, /ระบบขัดข้องชั่วคราว/);
  assert.equal(context.grErrorState({status:503,reason:'unexpected_backend_failure'}).type,'server');
  assert.equal(context.grErrorState({status:403,reason:'invalid_or_expired_token'}).type,'session');
  assert.equal(context.grErrorState({status:500,reason:'validation_failed'}),null);
  mode = 'network'; calls = 0; assert.match((await context.apiCall('getInitialData', {})).message, /เชื่อมต่อไม่ได้/); assert.equal(calls, 2);
  mode = 'success'; assert.equal((await context.apiCall('getInitialData', {})).success, true);
  mode = 'conflict'; calls = 0; const rejection = await context.apiCall('bulkReceivePO', {}); assert.equal(calls, 1); assert.equal(rejection.reason, 'stale_count'); assert.equal(rejection.status, 409); assert.equal(rejection.message, 'fixture private error');
});
test('verified startup shows session wording and only embedded retirement reaches Main', async () => {
  for (const embedded of [false, true]) {
    const { context, nodes, retired } = runtime(async () => response(200,{}), { embedded, verifySession: async () => { throw Object.assign(new Error('invalid_or_expired_token'), { reason:'invalid_or_expired_token', status:401 }); } });
    await context.AuthGuard.init();
    assert.match(nodes.get('error-message').innerText, /เข้าสู่ระบบ BUYMORETH อีกครั้ง/);
    assert.equal(retired.length, embedded ? 1 : 0);
    assert.equal(context.window.appSession, null);
  }
});
test('actual Main verifier retains the denied response status and reason without domain calls', async () => {
  const verifyCode = bridgeSource.slice(bridgeSource.indexOf('        verifySession: async'), bridgeSource.indexOf('        home: fallback'));
  let calls = 0;
  const context = vm.createContext({ shell:null, isMainSignedOut:()=>false, sessionStamp:()=> 'fixture', window:{}, AbortController, setTimeout, clearTimeout, SESSION_VERIFY_TIMEOUT_MS:100,
    fetch:async url => { calls++; assert.match(url,/\/auth-api$/); return response(403,{valid:false,reason:'permission_denied'}); } });
  vm.runInContext('var verifier = {' + verifyCode + '};',context);
  await assert.rejects(context.verifier.verifySession('app-gr','fixture-token'),error => error.status === 403 && error.reason === 'permission_denied');
  assert.equal(calls,1);
});
test('stale response rejects rather than appearing as an outage or new-owner data', async () => {
  let finish;
  const { context, window } = runtime(() => new Promise(resolve => { finish = resolve; }));
  const pending = context.apiCall('getInitialData', {});
  while (!finish) await Promise.resolve();
  window.appSession = { identityId:'other-user' };
  finish(response(200,{ success:true, pendingPOs:[{ privateFixture:true }] }));
  const result = await pending;
  assert.equal(result.reason, 'session_changed'); assert.equal(result.success, false);
  assert.equal(result.pendingPOs, undefined); assert.doesNotMatch(result.message, /เชื่อมต่อไม่ได้/);
  assert.equal(window.appSession.identityId, 'other-user', 'stale failure cannot retire the new account');
});
test('deadline timeout retries reads while intentional cancellation stays distinct and does not retry', async () => {
  let calls = 0;
  const timed = runtime((url, init) => { calls++; return new Promise((resolve,reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture deadline'), { name:'AbortError' })))); }, { fastDeadline:true });
  const timeout = await timed.context.apiCall('getInitialData', {});
  assert.equal(calls, 2); assert.equal(timeout.reason, 'request_timeout'); assert.match(timeout.message, /เชื่อมต่อไม่ได้/);
  calls = 0;
  const cancelled = runtime(async () => { calls++; throw Object.assign(new Error('fixture intentional cancel'), { name:'AbortError' }); });
  const result = await cancelled.context.apiCall('getInitialData', {});
  assert.equal(calls, 1); assert.doesNotMatch(result.message, /เชื่อมต่อไม่ได้/);
  calls = 0;
  const uncertainWrite = await timed.context.apiCall('bulkReceivePO', {targetStatus:'Pending Review'});
  assert.equal(calls,1); assert.equal(uncertainWrite.reason,'request_timeout');
  assert.equal(uncertainWrite.message,'fixture deadline', 'uncertain write keeps the existing mutation handler, without read replay');
});
test('rendered bill cards expose one keyboard/pointer action and ignore nested controls and repeats', () => {
  const { context, nodes } = runtime(async () => response(200,{}));
  context.groupedPOs = [{ index:0, status:'Pending GR', warehouse:'W2', poNumber:'PO fixture', vendor:'ผู้ขายทดสอบ', poDate:'12/10/2026', refPrUid:'fixture-bill', searchText:'', items:[{uid:'fixture-item',product:'สินค้าทดสอบ',quantity:1,unit:'ลัง'}] }];
  context.renderPOListForReceiving();
  const markup = nodes.get('po-list-container').innerHTML;
  const card = markup.match(/<div id="gr-bill-card-0"[^>]+>/)?.[0];
  assert.ok(card, 'runtime card has a stable identity for returned focus');
  assert.match(card, /role="button"/); assert.match(card, /tabindex="0"/); assert.match(card, /aria-label="เปิดบิล PO fixture ผู้ขายทดสอบ"/);
  const handlers = Object.fromEntries([...card.matchAll(/(onclick|onkeydown)="([^"]+)"/g)].map(m => [m[1],m[2]]));
  let activations = 0, prevented = 0;
  context.openReceivingDetail = () => { activations++; };
  const target = {};
  for (const [type, key] of [['click',''],['keydown','Enter'],['keydown',' ']]) {
    context.event = { type,key,target,currentTarget:target,preventDefault() { prevented++; } };
    vm.runInContext(handlers[type === 'click' ? 'onclick' : 'onkeydown'], context);
  }
  assert.equal(activations,3); assert.equal(prevented,2);
  context.event = {type:'keydown',key:' ',repeat:true,target,currentTarget:target,preventDefault() { prevented++; }};
  vm.runInContext(handlers.onkeydown,context);
  context.event = {type:'click',target:{closest:()=>({tagName:'BUTTON'})},currentTarget:target};
  vm.runInContext(handlers.onclick,context);
  assert.equal(activations,3);
});
test('failed warm read keeps cached bills and one read retry clears the inline failure', async () => {
  let fail = true, calls = 0;
  const { context, nodes } = runtime(async () => { calls++; return fail ? response(500,{success:false,reason:'internal_error'}) : response(200, context.getLocalPreviewData()); });
  const cached = context.getLocalPreviewData();
  context.getCache = name => name === 'CACHE_GR_ACTIVE_DATA_V3' ? cached : null;
  context.loadGRProductsBackground = () => {};
  context.loadGRDeliveryPlanningBackground = () => {};
  await context.openReceiving();
  const oldList = nodes.get('po-list-container').innerHTML;
  assert.match(oldList,/PO-260914-001/); assert.match(nodes.get('gr-load-error').innerHTML,/ระบบขัดข้องชั่วคราว/);
  assert.equal(nodes.get('data-loader').classList.contains('hidden'), true);
  fail = false; calls = 0;
  const pending = context.retryGRFailedRead();
  assert.equal(context.retryGRFailedRead(), undefined, 'second activation cannot send a duplicate retry');
  await pending;
  assert.equal(calls,1); assert.equal(nodes.get('gr-load-error').classList.contains('hidden'), true);
  assert.match(nodes.get('po-list-container').innerHTML,/PO-260914-001/);
});
