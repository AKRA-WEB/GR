const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'gr-dashboard-v2.test.cjs'),'utf8');
const make=new Function('require','__dirname',source.slice(0,source.indexOf("test('actual calendar"))+'\nreturn fixture;')(require,__dirname);
const grId='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
async function setup(beforeResponse){
 const f=make();f.calls=[];f.c.window={appSession:{token:'original'}};f.c.openGrBillDetailModal=(...args)=>f.calls.push(args);
 Object.assign(f.state,{preset:'custom',warehouse:'W2',analytics:{filters:{dateFrom:'2026-10-01',dateTo:'2026-10-31'}}});
 f.node('vc-range').focus=()=>{};f.node('gr-vendor-calendar').replaceChildren=()=>{};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/gr-vendor-calendar.js'),'utf8'),f.c);
 f.c.GrVendorCalendar.open('Vendor A');
 beforeResponse?.(f);
 f.pending[0].resolve({success:true,vendorDeliveryCalendarVersion:1,filters:{dateFrom:'2026-10-01',dateTo:'2026-10-31'},total:1,vendorBreakdown:[{key:'Vendor A',deliveryDays:[{date:'2026-10-06',billCount:1,bills:[{grId,sourceId,grNumber:'GR-EXACT'}]}]}]});
 await new Promise(r=>setTimeout(r,0));return f;
}
const response=()=>({success:true,schemaVersion:2,bills:[{grId,grIds:[sourceId],grNumber:'GR-EXACT',items:[]}]});
test('popup reads only the clicked source receipt under its original scope and passes exact bill to existing modal',async()=>{
 const f=await setup(),trigger={disabled:false};const waiting=f.c.GrVendorCalendar.openBill(0,trigger);
 const q=f.pending[1].query;assert.equal(q.search,sourceId);assert.equal(q.dateFrom,'2026-10-01');assert.equal(q.dateTo,'2026-10-31');assert.equal(q.exactDate,null);assert.equal(q.vendor,'Vendor A');assert.equal(q.warehouse,'W2');assert.equal(f.state.limit,50);
 f.pending[1].resolve(response());await waiting;assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],grId);assert.equal(f.calls[0][1].grNumber,'GR-EXACT');assert.equal(trigger.disabled,false);
});
test('wrong source/logical bill or denied read never opens a fallback bill',async()=>{
 for(const res of [{success:false,message:'ไม่มีสิทธิ์อ่านบิล'}, {...response(),bills:[{grId,grIds:['33333333-3333-4333-8333-333333333333']}]}, {...response(),bills:[{grId:'33333333-3333-4333-8333-333333333333',grIds:[sourceId]}]}]){
  const f=await setup(),waiting=f.c.GrVendorCalendar.openBill(0,{disabled:false});f.pending[1].resolve(res);await waiting;assert.equal(f.calls.length,0);assert.ok(f.node('vc-bill-status').textContent);
 }
});
test('closing calendar or changing session retires in-flight bill reads',async()=>{
 for(const retire of [f=>f.c.GrVendorCalendar.close(),f=>f.c.window.appSession={token:'replacement'},f=>f.c.window.appSession.token='rotated',f=>f.api.tab('product')]){
  const f=await setup(),waiting=f.c.GrVendorCalendar.openBill(0,{disabled:false});retire(f);f.pending[1].resolve(response());await waiting;assert.equal(f.calls.length,0);
 }
});
test('calendar aggregate never renders after session owner or in-place token changes',async()=>{
 for(const retire of [f=>f.c.window.appSession={token:'replacement'},f=>f.c.window.appSession.token='rotated']){
  const f=await setup(retire);assert.equal(f.node('gr-vendor-calendar').hidden,true);assert.equal(f.calls.length,0);
 }
});
test('malformed per-day bill references fail without inventing clickable records',()=>{
 const calendar=require('../js/gr-vendor-calendar.js');for(const bills of [[],[{grId,sourceId:'bad'}],[{grId,sourceId},{grId,sourceId}]])assert.throws(()=>calendar.summarize([{date:'2026-10-06',billCount:1,bills}],'2026-10-01','2026-10-31'));
});
