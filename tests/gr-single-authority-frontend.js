const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test=require('node:test'),vm=require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /js\/supabase-gr-client\.js/, 'GR must load its Supabase Edge client');
assert.match(
  html,
  /AkraSupabaseGR\.request\(action, payload, getSessionToken\(\)\)/,
  'All canonical GR reads and mutations must use the authenticated Supabase endpoint'
);
assert.doesNotMatch(
  html,
  /Supabase GR .*fallback to GAS/i,
  'GR must not fall back to a second Sheet authority after a Supabase failure'
);

assert.match(
  html,
  /async function readApiCall\(action, payload = null\)\s*{\s*return apiCall\(action, payload\);\s*}/,
  'All GR reads must use the same authenticated API path'
);

const authStart = html.indexOf('var AuthGuard = {');
const authEnd = html.indexOf("document.addEventListener('DOMContentLoaded', AuthGuard.init);");
assert.ok(authStart >= 0 && authEnd > authStart, 'AuthGuard block must exist');
const authBlock = html.slice(authStart, authEnd);
assert.doesNotMatch(authBlock, /isPreviewEnv|Preview mode/, 'Unauthenticated preview must not render cached GR data');
const verifyIndex = authBlock.indexOf("AkraModule.verifySession('app-gr'");
const sessionIndex = authBlock.indexOf('window.appSession = session');
const prefetchIndex = authBlock.indexOf("initialDataPrefetch = readApiCall('getInitialData'");
assert.ok(verifyIndex >= 0, 'AuthGuard must verify current Main identity before GR domain reads');
assert.doesNotMatch(authBlock, /fetch\(verifyURL\)/, 'Bootstrap must not repeat a direct browser-to-Main verification round trip');
assert.match(authBlock, /error\.reason === 'mandatory_password_change_required'/,
  'Main mandatory-password rejection must show the actionable password-change message');
assert.ok(sessionIndex > verifyIndex, 'Verified session must be established after Main verification');
assert.ok(prefetchIndex > sessionIndex, 'Initial GR read must start only after the verified session is established');

// Active Main contract14/current-session boundary: decode is a stamp utility only.
// Execute actual AuthGuard with contradictory unsigned claims and verified Main answers.
function actual(name){const match=html.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n    \\}'));assert.ok(match,name);return match[0];}
function fixture({verify,query=true}={}){
 const token='header.'+Buffer.from(JSON.stringify({id:'forged',name:'Forged admin',roles:['ADMIN'],perms:{'app-gr':['receiveGR']}})).toString('base64url')+'.unsigned';
 const store=new Map(),calls=[],errors=[],shown=[],nodes=new Map();
 const user={id:'fictional-current',name:'Verified warehouse',roles:['WAREHOUSE'],identityId:'10000000-0000-4000-8000-000000000011',sessionVersion:1,authorizationRevision:'fixture',perms:{'app-gr':['receiveGR']}};
 const window={location:{search:query?'?sso='+token:'',pathname:'/GR/'},history:{replaceState(){}},addEventListener(){},AkraModule:{embedded:false,getToken:()=>'',verifySession:async(appId,input)=>{calls.push({kind:'verify',appId,token:input});return verify?verify(user):user;},authRequired(){},home(){}}};
 const context=vm.createContext({window,document:{title:'GR',getElementById:id=>{if(!nodes.has(id))nodes.set(id,{classList:{add(){},remove(){}},addEventListener(){}});return nodes.get(id);}},URLSearchParams,JSON,console:{error(){}},
  APP_CONFIG:{STORAGE_KEY:'gr_session',PORTAL_URL:'/Main/',REQUIRED_ROLES:['ADMIN','SUPERVISOR','WAREHOUSE']},CURRENT_VERSION:'20261014.01',checkAppVersion:async()=>true,AppVersionGuard:{start(){}},lucide:{createIcons(){}},UI:{showLoading(){},showApp:name=>shown.push(name),showError:message=>errors.push(message)},
  localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},isLocalPreviewMode:()=>false,PERF_MODE:false,initialDataPrefetch:null,
  readApiCall:async(action,payload)=>{assert.ok(window.appSession,'domain reads require verified page owner');calls.push({kind:'domain',action,payload});return{success:true,pendingPOs:[]};},openReceiving:async()=>calls.push({kind:'open'})});
 vm.runInContext(['grErrorState','showGRAuthFailure','normalizeRole','normalizeRoles','getGrPerms','buildAppSession','hasGrAccess','decodeJwtPayload'].map(actual).join('\n')+'\n'+html.slice(html.indexOf('    var grAuthAttempt ='),authEnd),context);
 return{context,window,user,token,store,calls,errors,shown};
}
test('decoded forged admin never becomes owner while Main verification is pending; verified name wins before read',async()=>{
 let finish;const f=fixture({verify:user=>new Promise(resolve=>finish=()=>resolve(user))});const pending=f.context.AuthGuard.init();await new Promise(setImmediate);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,'verify');assert.equal(f.calls[0].appId,'app-gr');assert.equal(f.calls[0].token,f.token);
 assert.equal(f.window.appSession,undefined);assert.equal(f.shown.length,0);assert.equal(f.calls.filter(c=>c.kind==='domain').length,0);
 finish();await pending;assert.equal(f.window.appSession.id,f.user.id);assert.equal(f.window.currentUser,f.user.name);assert.deepEqual(f.shown,[f.user.name]);assert.equal(f.calls.filter(c=>c.kind==='domain').length,1);
 assert.equal(f.calls.find(c=>c.kind==='domain').action,'getInitialData');assert.equal(f.calls.find(c=>c.kind==='domain').payload.includeProducts,false);
});
test('Main denial and mandatory-password denial render no authenticated UI and make zero domain reads',async()=>{
 for(const reason of ['invalid_or_expired_token','permission_denied','mandatory_password_change_required']){
  const f=fixture({verify:async()=>{throw Object.assign(Error(reason),{reason});}});await f.context.AuthGuard.init();assert.equal(f.window.appSession,null);assert.equal(f.shown.length,0);assert.equal(f.calls.filter(c=>c.kind==='domain').length,0);assert.equal(f.errors.length,1);
 }
});
test('late verified owner cannot overwrite a replacement storage session or start domain reads',async()=>{
 let finish;const f=fixture({verify:user=>new Promise(resolve=>finish=()=>resolve(user))});const pending=f.context.AuthGuard.init();await new Promise(setImmediate);f.store.set('gr_session','new-tab-owner');finish();await pending;
 assert.equal(f.store.get('gr_session'),'new-tab-owner');assert.equal(f.window.appSession,undefined);assert.equal(f.shown.length,0);assert.equal(f.calls.filter(c=>c.kind==='domain').length,0);
});
test('missing token and wrong verified app role deny before domain access',async()=>{
 const missing=fixture({query:false});await missing.context.AuthGuard.init();assert.equal(missing.calls.length,0);assert.equal(missing.shown.length,0);
 const wrong=fixture({verify:user=>({...user,roles:['GUEST'],perms:{'app-gr':[]}})});await wrong.context.AuthGuard.init();assert.equal(wrong.window.appSession,null);assert.equal(wrong.shown.length,0);assert.equal(wrong.calls.filter(c=>c.kind==='domain').length,0);
});
