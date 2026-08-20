const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workspace = path.join(root, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'js', 'supabase-gr-client.js'), 'utf8');
const migrationPath = path.join(workspace, 'database', 'supabase', 'migrations', '202608200001_gr_transactional_api.sql');
const edgePath = path.join(workspace, 'database', 'supabase', 'functions', 'gr-api', 'index.ts');

assert.match(html, /js\/supabase-gr-client\.js/, 'GR must load the Supabase-primary client');
assert.match(html, /AkraSupabaseGR\.request\(action, payload, getSessionToken\(\)\)/,
  'GR data actions must use the authenticated Supabase endpoint');
assert.doesNotMatch(html, /Supabase GR .*fallback to GAS/i,
  'Canonical GR actions must not silently fall back to the stale Sheet authority');
assert.match(html, /expectedStatus:\s*itemMeta\.status/,
  'Each save must carry the item state displayed by the client for stale-write detection');
assert.match(html, /billRef:\s*usableBillRefUid\(group\.refPrUid\)/,
  'Reset/recall must send a stable bill reference for server-side whole-bill expansion');
assert.match(html, /loadedExtras\.forEach\(item => addExtraItemRow\(item\)\)/,
  'Canonical Supabase extras must be rendered before a later save can replace them');
assert.match(html, /replaceExtras:\s*currentBillHadLoadedExtras \|\| extraItemsData\.length > 0/,
  'The client must explicitly distinguish an extras replacement from an item-only save');

assert.doesNotMatch(clientSource, /service_role|SUPABASE_SERVICE_ROLE_KEY/i,
  'The browser client must never contain or reference a privileged Supabase key');
assert.match(clientSource, /functions\/v1\/gr-api/,
  'The browser client must call the trusted GR Edge Function');

assert.ok(fs.existsSync(migrationPath), 'The transactional GR migration must exist');
assert.ok(fs.existsSync(edgePath), 'The authenticated GR Edge Function must exist');

const migration = fs.readFileSync(migrationPath, 'utf8');
assert.match(migration, /create or replace function public\.gr_receive_v1/i);
assert.match(migration, /create or replace function public\.gr_recall_v1/i);
assert.match(migration, /for update/i, 'Receive/reset/recall must lock selected PO items');
assert.match(migration, /FROM public\.purchase_orders AS po[\s\S]*ORDER BY po\.id[\s\S]*FOR UPDATE/i,
  'Each transaction must lock the parent bill in deterministic order before recalculating status');
assert.match(migration, /WHERE po\.ref_pr_uid = v_bill_ref[\s\S]*FROM public\.purchase_orders AS po[\s\S]*WHERE po\.id = ANY\(v_po_ids\)[\s\S]*FOR UPDATE/i,
  'Receive must lock every parent row sharing the bill reference before replacing bill-wide extras');
assert.match(migration, /'Draft GR'.*'Pending Review'.*'GR Completed'/is,
  'Only canonical GR target statuses may reach the transaction');
assert.match(migration, /jsonb_array_elements\(p_payload->'items'\)/i,
  'The transaction must mutate only submitted item identities');
assert.match(migration, /stale_item_status/i,
  'The transaction must reject stale item state before replacing receipt data');
assert.match(migration, /completed_item_requires_recall/i,
  'Completed receipt data must reopen only through recall/reset');
assert.match(migration, /v_replace_extras/i,
  'Item-only saves must preserve canonical same-bill extras');
assert.match(migration, /gr\.status <> 'Cancelled'/i,
  'Receive/reset/recall must preserve cancelled receipt audit history');
assert.match(migration, /uq_gr_items_one_base_item_per_receipt/i,
  'Historical shared headers must be split and prevented from recurring');
assert.match(migration, /delete from public\.goods_receipt_items/i,
  'Reset must remove receipt details from Supabase');
assert.match(migration, /revoke execute on function public\.gr_receive_v1/i,
  'Transactional RPC execution must not be public');
assert.match(migration, /grant execute on function public\.gr_receive_v1.*service_role/is,
  'Only the trusted service role may execute the receive transaction');
assert.match(migration, /revoke all on table public\.goods_receipts from anon, authenticated/i,
  'Direct browser access to canonical GR records must be closed');
assert.match(migration, /FROM pg_policies[\s\S]*purchase_orders[\s\S]*goods_receipt_items/i,
  'Historical broad policies must be removed regardless of their old names');

const edge = fs.readFileSync(edgePath, 'utf8');
assert.match(edge, /action=verifyToken/,
  'The Edge Function must verify the Main SSO token server-side');
assert.match(edge, /appId=app-gr/,
  'Main verification must enforce access to GR');
assert.match(edge, /approveGR/,
  'Privileged completion/reset actions must enforce granular approval permission');
assert.match(edge, /gr_receive_v1/);
assert.match(edge, /gr_recall_v1/);
assert.match(edge, /action === 'bootstrap'[\s\S]*initialData: await getInitialData/is,
  'Authentication and lean initial data must share one Edge round trip');
assert.match(edge, /EdgeRuntime\.waitUntil\(notification\)/,
  'Completion notification must run after the Supabase commit without delaying the UI response');
assert.doesNotMatch(edge, /eyJ[a-zA-Z0-9_-]{20,}/,
  'The Edge Function source must not embed credentials');
assert.match(edge, /env\('GR_SUPABASE_SECRET_KEY'\)/,
  'The Edge Function must require a newly provisioned server-only key rather than the exposed legacy key');
assert.doesNotMatch(edge, /Authorization[^\n]+Bearer[^\n]+serviceKey/,
  'A modern Supabase secret key must be sent only in the apikey header');
assert.match(edge, /hasOwnProperty\.call\(user\.perms, 'app-gr'\)/,
  'An explicit empty app permission contract must deny access instead of falling back to role');

console.log('PASS gr-supabase-primary-contract: one authenticated Supabase authority and atomic GR mutations are wired');
