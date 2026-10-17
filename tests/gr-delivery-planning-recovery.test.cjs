// Actual page/client in an isolated synthetic runtime. No real records or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(process.env.GR_PLANNING_HTML||path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(source=>source.trim());
const tick=()=>new Promise(setImmediate),response=(status,data)=>({ok:status<400,status,json:async()=>data});
const planned={success:true,deliveryPlanning:{sampleCount:8,vendorCount:1},planByUid:{'plan-item':{expectedDate:'',plannedDate:'2026-10-14',planSource:'estimated_p75',daysUntil:1}}};
function rig(){
 const nodes=new Map(),calls=[],routes=[],storage=new Map();let stamp='main-one',handler=async()=>response(200,planned);
 const node=id=>{if(!nodes.has(id)){const classes=new Set(['hidden']);nodes.set(id,{value:'',innerHTML:'',innerText:'',textContent:'',disabled:false,style:{},classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},contains:name=>classes.has(name),toggle(name,value){value?classes.add(name):classes.delete(name);}},setAttribute(){},removeAttribute(){},addEventListener(){},appendChild(){},querySelector:()=>node(id+'-child'),querySelectorAll:()=>[],focus(){}});}return nodes.get(id);};
 const owner={id:'fixture',identityId:'00000000-0000-4000-8000-000000000001',sessionVersion:1,authorizationRevision:'one',roles:['ADMIN'],perms:{'app-gr':['receiveGR','approveGR']},token:'fixture-token'};
 const window={appSession:owner,location:{search:'',hostname:'fixture.invalid',pathname:'/GR/',href:'https://fixture.invalid/GR/'},scrollTo(){},addEventListener(){},AkraModule:{embedded:false,sessionStamp:()=>stamp,home:()=>routes.push('home'),authRequired:()=>routes.push('auth')}};
 const c=vm.createContext({window,self:window,document:{getElementById:node,querySelector:()=>node('query'),querySelectorAll:()=>[],createElement:node,body:node('body'),head:node('head'),addEventListener(){}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},Date,Intl,URL,URLSearchParams,AbortController,Error,TypeError,Promise,
  console:{log(){},error(){},warn(){}},navigator:{onLine:true},lucide:{createIcons(){}},setInterval(){},clearInterval(){},setTimeout:(fn,ms)=>setTimeout(fn,ms<1000?0:ms),clearTimeout,requestAnimationFrame:fn=>fn(),fetch:async(_url,options)=>{const call=JSON.parse(options.body);calls.push(call);return handler(call,options);}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/supabase-gr-client.js'),'utf8'),c);for(const source of scripts)vm.runInContext(source,c);
 vm.runInContext('AppVersionGuard.blockIfStale=async()=>false;',c);c.appData={products:[],pendingPOs:[{uid:'plan-item',product:'Fixture product',quantity:1,status:'Pending GR',vendor:'Fixture Vendor',poNumber:'PO fixture',expectedDate:''}]};
 node('receiving-list-view').classList.remove('hidden');c.groupPendingPOs();
 return{c,window,owner,node,calls,routes,setHandler:fn=>handler=fn,setStamp:value=>stamp=value,markup:()=>node('delivery-plan-summary').innerHTML};
}
for(const warm of [false,true])for(const failure of ['server','network'])test((warm?'warm':'cold')+' '+failure+' planning failure is persistent and never becomes a successful empty plan',async()=>{
 const f=rig();if(warm)await f.c.loadGRDeliveryPlanningBackground(true);
 const old=f.c.appData.pendingPOs[0].plannedDate;f.setHandler(async()=>{if(failure==='network')throw new TypeError('private offline exception');return response(500,{success:false,message:'private server detail'});});
 await f.c.loadGRDeliveryPlanningBackground(true);assert.equal(f.c.grDeliveryPlanningLoaded,warm);assert.match(f.markup(),/role="alert"/);assert.match(f.markup(),failure==='network'?/เชื่อมต่อไม่ได้/:/ระบบขัดข้องชั่วคราว/);assert.doesNotMatch(f.markup(),/private/);
 if(warm){assert.equal(f.c.appData.pendingPOs[0].plannedDate,old);assert.match(f.markup(),/แผนที่โหลดไว้ก่อนหน้านี้/);}else assert.doesNotMatch(f.markup(),/Vendor ยืนยัน 0|0 ตัวอย่าง/);
 f.setHandler(async()=>response(200,planned));const before=f.calls.length,p=f.c.retryGRDeliveryPlanning();f.c.retryGRDeliveryPlanning();await p;assert.equal(f.calls.length,before+1);assert.ok(f.calls.every(call=>call.action==='getDeliveryPlanning'));assert.equal(f.c.grDeliveryPlanningLoaded,true);assert.doesNotMatch(f.markup(),/role="alert"/);
});
test('current 401 retires the existing page and cannot mark cold planning loaded or start a retry',async()=>{
 const f=rig();f.setHandler(async()=>response(401,{reason:'invalid_or_expired_token'}));await f.c.loadGRDeliveryPlanningBackground(true);
 assert.equal(f.window.appSession,null);assert.equal(f.c.grDeliveryPlanningLoaded,false);assert.equal(f.node('app-content').classList.contains('hidden'),true);assert.match(f.node('error-message').innerText,/เข้าสู่ระบบ BUYMORETH อีกครั้ง/);
 const before=f.calls.length;await f.c.retryGRDeliveryPlanning();await f.c.loadGRDeliveryPlanningBackground(true);assert.equal(f.calls.length,before);
});
test('intentional cancellation stays distinct, stops loading and never retries without a new action',async()=>{
 const f=rig();f.setHandler(async()=>{throw Object.assign(new Error('private cancellation'),{name:'AbortError'});});await f.c.loadGRDeliveryPlanningBackground(true);
 assert.equal(f.calls.length,1);assert.equal(f.c.grDeliveryPlanningLoading,false);assert.equal(f.c.grDeliveryPlanningLoaded,false);assert.match(f.markup(),/ยกเลิกการโหลดแล้ว/);assert.match(f.markup(),/role="status"/);assert.doesNotMatch(f.markup(),/เชื่อมต่อไม่ได้|private cancellation/);
});
test('planning deadline is a persistent network failure after its bounded read attempts',async()=>{
 const f=rig();f.c.setTimeout=(fn,ms)=>setTimeout(fn,ms<1000?0:5);f.setHandler((_call,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('private deadline'),{name:'AbortError'})))));
 await f.c.loadGRDeliveryPlanningBackground(true);assert.equal(f.calls.length,2);assert.equal(f.c.grDeliveryPlanningLoaded,false);assert.equal(f.c.grDeliveryPlanningLoading,false);assert.match(f.markup(),/เชื่อมต่อไม่ได้/);assert.doesNotMatch(f.markup(),/private deadline/);
});
test('denied planning drops permitted-plan reuse and offers Main; retry cannot query denied data',async()=>{
 const f=rig();await f.c.loadGRDeliveryPlanningBackground(true);f.setHandler(async()=>response(403,{reason:'permission_denied',message:'private denied'}));await f.c.loadGRDeliveryPlanningBackground(true);
 assert.equal(f.c.grDeliveryPlanningLoaded,false);assert.equal(f.c.appData.pendingPOs[0].plannedDate,undefined);assert.match(f.markup(),/ไม่มีสิทธิ์ใช้ส่วนนี้/);assert.match(f.markup(),/กลับหน้าหลัก/);assert.doesNotMatch(f.markup(),/แผนที่โหลดไว้ก่อนหน้านี้|private denied/);assert.doesNotMatch(f.c.deliveryPlanBadge(f.c.groupedPOs[0]),/2026|2569|เข้าไว/);
 const before=f.calls.length;await f.c.retryGRDeliveryPlanning();assert.equal(f.calls.length,before);assert.deepEqual(f.routes,['home']);
});
test('fresh malformed planning success remains error; explicit successful empty response is distinct',async()=>{
 const f=rig();f.setHandler(async()=>response(200,{success:true}));await f.c.loadGRDeliveryPlanningBackground();assert.equal(f.c.grDeliveryPlanningLoaded,false);assert.match(f.markup(),/โหลดแผนรับสินค้าไม่สำเร็จ/);
 f.setHandler(async()=>response(200,{success:true,deliveryPlanning:{sampleCount:0,vendorCount:0},planByUid:{}}));await f.c.retryGRDeliveryPlanning();assert.equal(f.c.grDeliveryPlanningLoaded,true);assert.doesNotMatch(f.markup(),/role="alert"/);assert.match(f.markup(),/0 ตัวอย่าง/);
});
test('successful empty planning after a warm plan removes obsolete derived hints without changing receiving fields',async()=>{
 const f=rig();f.c.appData.pendingPOs[0].remark='unchanged draft';await f.c.loadGRDeliveryPlanningBackground(true);
 f.setHandler(async()=>response(200,{success:true,deliveryPlanning:{sampleCount:0,vendorCount:0},planByUid:{}}));await f.c.loadGRDeliveryPlanningBackground(true);
 assert.equal(f.c.grDeliveryPlanningLoaded,true);assert.equal(f.c.appData.pendingPOs[0].plannedDate,undefined);assert.equal(f.c.appData.pendingPOs[0].expectedDate,'');assert.equal(f.c.appData.pendingPOs[0].remark,'unchanged draft');assert.match(f.markup(),/คาดการณ์ 0/);assert.doesNotMatch(f.markup(),/role="alert"/);
});
for(const drift of ['owner','token','stamp','active-generation','unavailable-shell-token'])test('late planning response after '+drift+' cannot modify current data or notice',async()=>{
 const f=rig();let resolve,tokenUnavailable=false;if(drift==='unavailable-shell-token'){f.window.AkraModule.embedded=true;f.window.AkraModule.getToken=()=>{if(tokenUnavailable)throw new Error('shell_session_unavailable');return f.owner.token;};}f.setHandler(()=>new Promise(done=>resolve=done));const pending=f.c.loadGRDeliveryPlanningBackground(true);await tick();
 if(drift==='owner')f.window.appSession={...f.owner,identityId:'00000000-0000-4000-8000-000000000002'};if(drift==='token')f.owner.token='refreshed-token';if(drift==='stamp')f.setStamp('main-two');if(drift==='active-generation')f.c.grActiveDataRequestGeneration++;if(drift==='unavailable-shell-token')tokenUnavailable=true;
 f.c.appData={products:[],pendingPOs:[{uid:'replacement',plannedDate:'new-owner-data'}]};f.node('delivery-plan-summary').innerHTML='replacement notice';resolve(response(200,planned));await pending;assert.equal(f.c.appData.pendingPOs[0].uid,'replacement');assert.equal(f.markup(),'replacement notice');assert.equal(f.c.grDeliveryPlanningLoaded,false);
});
test('a newer planning read supersedes an older active-data generation, and current request coalesces',async()=>{
 const f=rig(),pending=[];f.setHandler(()=>new Promise(resolve=>pending.push(resolve)));const old=f.c.loadGRDeliveryPlanningBackground(true);await tick();f.c.grActiveDataRequestGeneration++;const fresh=f.c.loadGRDeliveryPlanningBackground(true),duplicate=f.c.loadGRDeliveryPlanningBackground(true);await tick();assert.equal(pending.length,2);
 pending[1](response(200,{...planned,deliveryPlanning:{sampleCount:12,vendorCount:1}}));await Promise.all([fresh,duplicate]);pending[0](response(500,{reason:'internal_error'}));await old;assert.equal(f.c.appData.deliveryPlanning.sampleCount,12);assert.doesNotMatch(f.markup(),/role="alert"/);
});
test('active refresh preserves previous permitted plan across data replacement when its planning refresh fails',async()=>{
 const f=rig();await f.c.loadGRDeliveryPlanningBackground(true);const active=JSON.parse(JSON.stringify(f.c.appData));delete active.deliveryPlanning;for(const item of active.pendingPOs){delete item.plannedDate;delete item.planSource;delete item.daysUntil;}
 f.c.loadGRProductsBackground=()=>{};f.setHandler(async call=>call.action==='getInitialData'?response(200,{success:true,...active}):response(500,{reason:'internal_error'}));await f.c.openReceiving(true);await tick();
 assert.equal(f.c.appData.pendingPOs[0].plannedDate,'2026-10-14');assert.equal(f.c.grDeliveryPlanningLoaded,true);assert.match(f.markup(),/แผนที่โหลดไว้ก่อนหน้านี้/);assert.equal(f.calls.filter(call=>call.action==='getInitialData').length,1);
});
test('failed planning retry starts a fresh read after active generation changes while the same owner remains current',async()=>{
 const f=rig();f.setHandler(async()=>response(500,{reason:'internal_error'}));await f.c.loadGRDeliveryPlanningBackground(true);
 f.c.grActiveDataRequestGeneration++;f.setHandler(async()=>response(200,planned));const before=f.calls.length;
 await f.c.retryGRDeliveryPlanning();assert.equal(f.calls.length,before+1,'visible retry must issue a fresh planning read');assert.ok(f.calls.every(call=>call.action==='getDeliveryPlanning'));
 assert.equal(f.c.appData.pendingPOs[0].plannedDate,'2026-10-14');assert.equal(f.c.grDeliveryPlanningLoading,false);assert.doesNotMatch(f.markup(),/role="alert"/);
});
test('warm failed planning refresh leaves a newly read bill unknown until its own planning read succeeds',async()=>{
 const f=rig();await f.c.loadGRDeliveryPlanningBackground(true);const active=JSON.parse(JSON.stringify(f.c.appData));delete active.deliveryPlanning;
 for(const item of active.pendingPOs){delete item.plannedDate;delete item.planSource;delete item.daysUntil;}
 active.pendingPOs.push({uid:'new-item',product:'New fixture product',quantity:2,status:'Draft GR',vendor:'New fixture vendor',poNumber:'New PO fixture',expectedDate:'2026-10-20',remark:'keep draft'});
 f.c.loadGRProductsBackground=()=>{};f.setHandler(async call=>call.action==='getInitialData'?response(200,{success:true,...active}):response(500,{reason:'internal_error'}));await f.c.openReceiving(true);await tick();
 const oldBill=f.c.groupedPOs.find(group=>group.items.some(item=>item.uid==='plan-item')),newBill=f.c.groupedPOs.find(group=>group.items.some(item=>item.uid==='new-item'));
 assert.match(f.c.deliveryPlanBadge(oldBill),/2026|2569/);assert.match(f.c.deliveryPlanBadge(newBill),/ยังไม่ทราบแผนรับสินค้า/);assert.doesNotMatch(f.c.deliveryPlanBadge(newBill),/ยังไม่มีแผนรับ/);assert.match(f.c.deliveryPlanText(newBill),/ยังไม่ทราบแผนรับสินค้า/);
 assert.equal(newBill.items[0].expectedDate,'2026-10-20');assert.equal(newBill.items[0].remark,'keep draft');
 f.setHandler(async()=>response(200,{success:true,deliveryPlanning:{sampleCount:0,vendorCount:0},planByUid:{}}));await f.c.retryGRDeliveryPlanning();
 const refreshed=f.c.groupedPOs.find(group=>group.items.some(item=>item.uid==='new-item'));assert.match(f.c.deliveryPlanBadge(refreshed),/ยังไม่มีแผนรับ/);assert.doesNotMatch(f.c.deliveryPlanBadge(refreshed),/ยังไม่ทราบ/);
 assert.equal(refreshed.items[0].expectedDate,'2026-10-20');assert.equal(refreshed.items[0].remark,'keep draft');assert.equal(refreshed.items[0].status,'Draft GR');
});
for(const drift of ['token','stamp'])test('failed planning retry after '+drift+' change cannot query with its obsolete authority',async()=>{
 const f=rig();f.setHandler(async()=>response(500,{reason:'internal_error'}));await f.c.loadGRDeliveryPlanningBackground(true);f.c.grActiveDataRequestGeneration++;
 if(drift==='token')f.owner.token='replacement-token';else f.setStamp('replacement-main');const before=f.calls.length;await f.c.retryGRDeliveryPlanning();assert.equal(f.calls.length,before);
});
test('completed receiving history outside active planning coverage retains its existing plan and received label',async()=>{
 const f=rig();await f.c.loadGRDeliveryPlanningBackground(true);f.c.appData.grCompleted=[{uid:'completed-item',product:'Historical fixture',quantity:1,status:'GR Completed',vendor:'Historical vendor',poNumber:'Historical PO',expectedDate:'2026-10-10',plannedDate:'2026-10-10',planSource:'confirmed'}];f.c.groupPendingPOs();
 const completed=f.c.groupedPOs.find(group=>group.status==='GR Completed');assert.equal(f.c.deliveryPlanText(completed),'รับเข้าแล้ว');assert.match(f.c.deliveryPlanBadge(completed),/2026|2569/);assert.doesNotMatch(f.c.deliveryPlanBadge(completed),/ยังไม่ทราบ/);
 assert.equal(completed.items[0].expectedDate,'2026-10-10');assert.equal(completed.items[0].status,'GR Completed');
});
test('obsolete failed read retry cannot run under a replacement owner and hidden detail view is never rerendered',async()=>{
 const f=rig();f.node('receiving-list-view').classList.add('hidden');f.setHandler(async()=>response(500,{reason:'internal_error'}));await f.c.loadGRDeliveryPlanningBackground(true);assert.equal(f.c.grDeliveryPlanRenderPending,true);assert.equal(f.markup(),'');
 f.c.renderDeliveryPlanSummary();const before=f.calls.length;f.window.appSession={...f.owner,identityId:'00000000-0000-4000-8000-000000000002'};await f.c.retryGRDeliveryPlanning();assert.equal(f.calls.length,before);
});
test('explicit local demo still loads fictional planning with no token, session cache or network',async()=>{
 const f=rig();f.window.location.hostname='127.0.0.1';f.window.location.search='?demo=1';f.window.appSession=f.c.getLocalPreviewSession();f.c.appData=f.c.getLocalPreviewData();
 await f.c.loadGRDeliveryPlanningBackground(true);assert.equal(f.c.grDeliveryPlanningLoaded,true);assert.equal(f.calls.length,0);assert.equal(f.c.appData.deliveryPlanning.sampleCount,48);assert.doesNotMatch(f.markup(),/role="alert"/);
});
