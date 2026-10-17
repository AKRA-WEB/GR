// Actual AuthGuard and Main bridge verifier; all version/auth/domain/storage work is synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.basename(path.dirname(__dirname)),isGR=repo==='GR';
const html=fs.readFileSync(process.env.AUTH_RETRY_UI_SOURCE||path.join(__dirname,'../index.html'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'../js/akra-shell-bridge.js'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
const tick=()=>new Promise(setImmediate),response=(status,payload)=>({ok:status<400,status,json:async()=>payload});
function fixture({embedded=false,versionPending=false}={}){
 const nodes=new Map(),storage=new Map(),events={},requests=[],domains=[],shown=[],retired=[],writes=[];let liveToken='cold-token',mainStamp='main-one',finishVersion;
 const node=id=>{if(!nodes.has(id)){const classes=new Set(['hidden']);nodes.set(id,{innerHTML:'',innerText:'',textContent:'',value:'',style:{},classList:{add(...ns){ns.forEach(n=>classes.add(n));},remove(...ns){ns.forEach(n=>classes.delete(n));},contains:n=>classes.has(n),toggle(n,v){v?classes.add(n):classes.delete(n);}},setAttribute(){},removeAttribute(){},appendChild(){},querySelector:()=>node(id+'-child'),querySelectorAll:()=>[],addEventListener(){},focus(){}});}return nodes.get(id);};
 const user={id:'fixture',identityId:'00000000-0000-4000-8000-000000000001',name:'Fixture',roles:['ADMIN'],sessionVersion:1,authorizationRevision:'one',perms:{'app-gr':['receiveGR','approveGR'],'app-tracking':['createPO','approvePR','closePO']}};
 const window={location:{search:embedded?'':'?sso=cold-token',pathname:'/'+repo+'/',hostname:'fixture.invalid'},history:{replaceState(){window.location.search='';}},addEventListener:(name,fn)=>(events[name]??=[]).push(fn),scrollTo(){},
  AkraModule:{embedded,getToken:()=>embedded?liveToken:'',isLocalPreview:()=>false,sessionStamp:()=>mainStamp,isMainSignedOut:()=>mainStamp==='signed-out',authRequired:()=>retired.push('auth'),home:()=>retired.push('home'),watchSession(){}}};
 const c=vm.createContext({window,self:window,document:{title:'Fixture',getElementById:node,querySelector:()=>node('query'),querySelectorAll:()=>[],addEventListener(){},createElement:node,head:node('head'),body:node('body')},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,String(v));writes.push(k);},removeItem:k=>storage.delete(k)},
  URL,URLSearchParams,AbortController,Date,Intl,Promise,Error,TypeError,console:{log(){},warn(){},error(){}},lucide:{createIcons(){}},setTimeout,clearTimeout,setInterval(){},clearInterval(){},requestAnimationFrame:fn=>fn(),navigator:{onLine:true},
  fetch:(url,init)=>new Promise((resolve,reject)=>requests.push({body:JSON.parse(init.body),resolve,reject})),shell:embedded?{}:null,sessionStamp:()=>mainStamp,isMainSignedOut:()=>mainStamp==='signed-out',SESSION_VERIFY_TIMEOUT_MS:10000});
 for(const script of scripts)vm.runInContext(script,c);
 const start=bridge.indexOf('        verifySession: async'),end=bridge.indexOf('        home: fallback',start);assert(start>=0&&end>start);vm.runInContext('Object.assign(window.AkraModule,{'+bridge.slice(start,end)+'});',c);
 c.checkAppVersion=versionPending?()=>new Promise(resolve=>finishVersion=resolve):async()=>true;
 vm.runInContext('AppVersionGuard.start=()=>{};',c);
 c.readApiCall=(action,payload)=>{assert(window.appSession,'domain needs fresh verified owner');domains.push({action,payload,owner:window.appSession});return Promise.resolve({success:true});};
 const oldShow=c.UI.showApp;c.UI.showApp=name=>{assert(window.appSession);shown.push(name);oldShow(name);};
 c[isGR?'openReceiving':'loadInitialData']=async()=>{};
 return{c,window,node,storage,events,requests,domains,shown,retired,writes,user,key:vm.runInContext('APP_CONFIG.STORAGE_KEY',c),setMain:value=>mainStamp=value,setToken:value=>liveToken=value,version:value=>finishVersion(value)};
}
test(repo+' cold standalone failed Main verification retries with the same memory-only token before domain/cache access',async()=>{
 for(const failure of ['network','server']){const f=fixture(),first=f.c.AuthGuard.init();await tick();assert.equal(f.requests[0].body.token,'cold-token');assert.equal(f.window.location.search,'');assert.equal(f.domains.length,0);assert.equal(f.shown.length,0);assert.equal(f.storage.has(f.key),false);
  if(failure==='network')f.requests[0].reject(new TypeError('offline'));else f.requests[0].resolve(response(500,{}));await first;assert.equal(f.domains.length,0);assert.equal(f.storage.has(f.key),false);assert.equal(f.window.appSession,null);
  const pending=f.node(isGR?'auth-error-action':'po-auth-error-action').onclick();await tick();assert.equal(f.requests.length,2,'retry must invoke fresh verification');assert.equal(f.requests[1].body.token,'cold-token');assert.equal(f.domains.length,0);assert.equal(f.shown.length,0);
  f.requests[1].resolve(response(200,{valid:true,user:f.user}));await pending;assert.equal(f.domains.length,1);assert.equal(f.shown.length,1);assert.equal(f.window.appSession.identityId,f.user.identityId);assert.equal(f.storage.has(f.key),true);
 }
});
test(repo+' old rejected or resolved init never clears or renders over a newer verified init',async()=>{
 for(const outcome of ['network','denied','success']){const f=fixture(),old=f.c.AuthGuard.init();await tick();const fresh=f.c.AuthGuard.init();await tick();assert.equal(f.requests.length,2);f.requests[1].resolve(response(200,{valid:true,user:f.user}));await fresh;const owner=f.window.appSession;
  if(outcome==='network')f.requests[0].reject(new TypeError('offline'));else f.requests[0].resolve(response(outcome==='denied'?401:200,outcome==='denied'?{reason:'invalid_or_expired_token'}:{valid:true,user:{...f.user,id:'old',identityId:'old'}}));await old;
  assert.equal(f.window.appSession,owner);assert.equal(f.domains.length,1);assert.equal(f.shown.length,1);assert.equal(f.node('app-content').classList.contains('hidden'),false);assert.equal(f.retired.length,0);
 }
});
test(repo+' stored app/Main stamp/token changes fence failure/success and clear cold pending retry',async()=>{
 for(const change of ['app','main','signed-out'])for(const outcome of ['network','success']){const f=fixture(),p=f.c.AuthGuard.init();await tick();if(change==='app')f.storage.set(f.key,'replacement');else f.setMain(change==='signed-out'?'signed-out':'main-two');
  if(outcome==='network')f.requests[0].reject(new TypeError('offline'));else f.requests[0].resolve(response(200,{valid:true,user:f.user}));await p;assert.equal(f.domains.length,0);assert.equal(f.shown.length,0);
  const retry=f.c.AuthGuard.init();await tick();if(change==='app'&&!isGR){assert.equal(f.requests[1]?.body.token,'replacement');f.requests[1]?.resolve(response(401,{reason:'invalid_or_expired_token'}));}else assert.equal(f.requests.length,1,'old cold token cannot survive changed ownership');await retry;
 }
});
test(repo+' init ownership is captured before awaited version, embedded retries verify current token and stale failures cannot retire',async()=>{
 const f=fixture({versionPending:true}),pending=f.c.AuthGuard.init();await tick();f.setMain('replacement');f.version(true);await pending;assert.equal(f.requests.length,0);assert.equal(f.domains.length,0);
 const e=fixture({embedded:true}),old=e.c.AuthGuard.init();await tick();e.setToken('fresh-token');const fresh=e.c.AuthGuard.init();await tick();assert.equal(e.requests[1].body.token,'fresh-token');e.requests[1].resolve(response(200,{valid:true,user:e.user}));await fresh;const owner=e.window.appSession;e.requests[0].resolve(response(401,{reason:'invalid_or_expired_token'}));await old;assert.equal(e.window.appSession,owner);assert.equal(e.retired.length,0);assert.equal(e.domains.length,1);
});
test(repo+' explicit denial and mandatory-password rejection never keep an unverified retry credential',async()=>{
 for(const reason of ['permission_denied','invalid_or_expired_token','mandatory_password_change_required']){const f=fixture(),p=f.c.AuthGuard.init();await tick();f.requests[0].resolve(response(reason==='permission_denied'?403:401,{reason}));await p;assert.equal(f.domains.length,0);assert.equal(f.storage.has(f.key),false);assert.equal(f.window.appSession,null);const retry=f.c.AuthGuard.init();await tick();assert.equal(f.requests.length,1);await retry;}
});

test(repo+' same-object token refresh fences old startup success/rejection, and startup storage signout clears a pending cold token',async()=>{
 for(const outcome of ['network','success']){const f=fixture(),first=f.c.AuthGuard.init();await tick();f.requests[0].resolve(response(200,{valid:true,user:f.user}));await first;const owner=f.window.appSession,p=f.c.AuthGuard.init();await tick();owner.token='refreshed';if(outcome==='network')f.requests[1].reject(new TypeError('offline'));else f.requests[1].resolve(response(200,{valid:true,user:f.user}));await p;assert.equal(f.window.appSession,owner);assert.equal(owner.token,'refreshed');assert.equal(f.domains.length,1);assert.equal(f.shown.length,1);}
 const f=fixture(),pending=f.c.AuthGuard.init();await tick();f.requests[0].reject(new TypeError('offline'));await pending;f.setMain('signed-out');for(const callback of f.events.storage||[])callback({key:'akra_main_session',oldValue:'before',newValue:'signed-out'});const next=f.c.AuthGuard.init();await tick();assert.equal(f.requests.length,1);await next;assert.equal(f.domains.length,0);
});

test(repo+' superseded rejection cannot clear pending retry or paint an error while newer verification is still awaiting',async()=>{
 for(const outcome of ['network','denied']){const f=fixture(),old=f.c.AuthGuard.init();await tick();const fresh=f.c.AuthGuard.init();await tick();if(outcome==='network')f.requests[0].reject(new TypeError('offline'));else f.requests[0].resolve(response(401,{reason:'invalid_or_expired_token'}));await old;
  assert.equal(f.node('auth-error').classList.contains('hidden'),true);assert.equal(f.domains.length,0);assert.equal(f.shown.length,0);f.requests[1].resolve(response(200,{valid:true,user:f.user}));await fresh;assert.equal(f.domains.length,1);assert.equal(f.shown.length,1);
 }
});

test(repo+' version reload keeps original entry URL token until version acceptance and explicit demo remains local',async()=>{
 const f=fixture();f.c.checkAppVersion=async()=>false;await f.c.AuthGuard.init();assert.equal(f.window.location.search,'?sso=cold-token');assert.equal(f.requests.length,0);assert.equal(f.domains.length,0);assert.equal(f.storage.has(f.key),false);
 const preview=fixture();preview.window.location.search=isGR?'?demo=1&sso=cold-token':'?demo=1';preview.window.location.hostname='127.0.0.1';preview.window.AkraModule.isLocalPreview=()=>new URLSearchParams(preview.window.location.search).get('demo')==='1';if(isGR){preview.c.isLocalPreviewMode=()=>preview.window.AkraModule.isLocalPreview();preview.c.getLocalPreviewData=()=>({products:[],pendingPOs:[]});preview.c.getLocalPreviewSession=()=>({id:'preview',name:'Preview',roles:['ADMIN']});}
 await preview.c.AuthGuard.init();assert.equal(preview.requests.length,0);assert.equal(preview.window.location.search,isGR?'?demo=1&sso=cold-token':'?demo=1');assert.equal(preview.window.appSession.id,isGR?'preview':'preview-user');assert.equal(preview.storage.has(preview.key),false);
});
