// Actual GR startup and bridge work state, synthetic auth/version responses; no network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const startup=html.match(/    var grAuthAttempt = [\s\S]*?(?=    var AuthGuard =)/)[0];
const guard=html.match(/    var AuthGuard = ([\s\S]*?\n    };)/)[0];
const tick=()=>new Promise(setImmediate);
for(const denied of [false,true])test('GR startup stays busy through version/auth checks and releases on '+(denied?'denial':'successful form load'),async()=>{
 let busy=0,versionReply,verifyReply,shown=0;
 const window={addEventListener(){},AkraModule:{embedded:true,getToken:()=> 'old',sessionStamp:()=> 'old',
  startWork(){busy++;},endWork(){busy--;},isMainSignedOut:()=>false,
  verifySession:()=>new Promise(resolve=>verifyReply=resolve)}};
 const context=vm.createContext({window,localStorage:{getItem:()=>null},URLSearchParams,APP_CONFIG:{STORAGE_KEY:'legacy'},
  checkAppVersion:()=>new Promise(resolve=>versionReply=resolve),AppVersionGuard:{start(){}},CURRENT_VERSION:'fixture',
  lucide:{createIcons(){}},UI:{showLoading(){},showApp(){shown++;}},buildAppSession:(user,token)=>({...user,token}),hasGrAccess:()=>!denied,
  readApiCall:async()=>({}),openReceiving:async()=>{},PERF_MODE:false,console:{error(){}},
  grErrorState:()=>({type:'permission'}),showGRAuthFailure(){}});
 vm.runInContext(startup+'\n'+guard+'\nAuthGuard.bindEvents=()=>{this.bound=true;};',context);
 const pending=vm.runInContext('AuthGuard.init()',context);
 assert.equal(busy,1,'version check must hold the shared token');
 versionReply(true);await tick();assert.equal(busy,1,'bridge ready does not finish auth');
 verifyReply({id:'fixture',name:'Fixture'});await pending;
 assert.equal(busy,0);assert.equal(shown,denied?0:1);assert.equal(context.bound,denied?undefined:true);
});
