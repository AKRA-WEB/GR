const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const nodes=new Map(),events={},pending=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',innerHTML:'',children:[],classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(type,fn){events[id+':'+type]=fn;},add(){}});return nodes.get(id);};
 const state={preset:'today',limit:50,loaded:true,loading:false,offset:0,hasMore:false};
 const c={document:{getElementById:node,addEventListener(type,fn){events[type]=fn;},querySelectorAll(){return [];},querySelector(){return null;}},crypto:require('node:crypto').webcrypto,console,Date,setTimeout,clearTimeout,matchMedia:()=>({matches:true}),grDashboardState:state,grDashboardSearchTimer:null,currentVendorLeadtimeTab:'overview',canApproveGR:()=>true,prepareProductHistoryDashboard(){},renderGrDashboardBillsLoading(){},updateGrDashboardLoadMoreState(){},renderGrDailyChart(){},renderGrDashboardBillsTable(){},mergeGrDashboardBills:(a=[],b=[])=>[...a,...b],apiCall:(action,query)=>new Promise(resolve=>pending.push({action,query,resolve}))};
 c.appData={grSchemaVersion:2};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/gr-dashboard-v2.js'),'utf8'),c);events.DOMContentLoaded();
 return {api:c.GrDashboard,node,state,pending,events,c};
}
function result(total){return {success:true,schemaVersion:2,total,bills:[{grId:String(total)}],filters:{dateFrom:'2026-09-25',dateTo:'2026-09-25'},summary:{approvedBills:total,problemBills:0,liftRounds:0,overallAvgLeadDays:null,leadtimeSamples:0},receivers:[],dailyStats:[],vendorBreakdown:[]};}
test('slow earlier filter response cannot replace the newest report',async()=>{
 const f=fixture();const first=f.api.load();f.state.warehouse='W2';const second=f.api.load();
 f.pending[1].resolve(result(2));await second;f.pending[0].resolve(result(8));await first;
 assert.equal(f.state.analytics.total,2);assert.equal(f.pending[1].query.warehouse,'W2');assert.equal(f.state.loading,false);
});
test('card drilldown keeps date, search and warehouse while applying issue filter',async()=>{
 const f=fixture();Object.assign(f.state,{exactDate:'2026-09-24',warehouse:'W2',search:'flour'});
 f.events['vendor-leadtime-view:click']({target:{closest:selector=>selector==='[data-card]'?{dataset:{card:'issues'}}:null}});
 assert.equal(f.c.currentVendorLeadtimeTab,'bills');assert.equal(f.pending.length,1);
 assert.equal(f.pending[0].query.exactDate,'2026-09-24');assert.equal(f.pending[0].query.issue,'any');assert.equal(f.pending[0].query.search,'flour');
 f.pending[0].resolve(result(0));
});
test('privileged completion defaults to normal; unchanged retries reuse request ID and changed data receives a new ID',()=>{
 const f=fixture();f.node('lift-fee-rounds').value='0';
 const a=f.api.writeMetadata({targetStatus:'GR Completed',items:[{grQty:1}]});
 const b=f.api.writeMetadata({targetStatus:'GR Completed',items:[{grQty:1}]});
 const c=f.api.writeMetadata({targetStatus:'GR Completed',items:[{grQty:2}]});
 assert.equal(a.requestId,b.requestId);assert.notEqual(a.requestId,c.requestId);assert.equal(a.lift.rounds,0);assert.equal(a.issueReview.codes.length,0);
 f.c.canApproveGR=()=>false;
 assert.throws(()=>f.api.writeMetadata({targetStatus:'GR Completed'}),/หมายเหตุ/);
});
test('each carousel loops independently and supports reduced motion',()=>{
 const f=fixture(),a=f.node('gr-kpi-row'),b=f.node('gr-chart-row');
 for(const row of [a,b]){Object.assign(row,{offsetLeft:12,scrollLeft:0,children:[0,1,2,3].map(i=>({offsetLeft:i*300})),scrollTo({left,behavior}){this.scrollLeft=left;assert.equal(behavior,'instant');}});}
 f.api.move('gr-kpi-row',-1);assert.equal(a.scrollLeft,900);assert.equal(b.scrollLeft,0);
 f.api.move('gr-kpi-row',1);assert.equal(a.scrollLeft,0);assert.equal(f.node('gr-kpi-row-position').textContent,'1 / 4');
});
test('canonical dates are Gregorian dd/mm/yyyy, while non-date lot text stays unchanged',()=>{
 const f=fixture();assert.equal(f.api.date('2026-09-25'),'25/09/2026');assert.equal(f.api.date('G2C'),'G2C');assert.equal(f.api.issueText(null),'ยังไม่ได้ระบุ');assert.notEqual(f.api.issueText([]),f.api.issueText(null));
});

test('new UI blocks writes against an old backend capability response',()=>{
 const f=fixture();f.c.appData={};assert.throws(()=>f.api.writeMetadata({targetStatus:'Draft GR'}),/อัปเดต/);
});
