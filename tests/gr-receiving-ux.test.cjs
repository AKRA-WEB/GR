const assert = require('node:assert/strict');
const UX = require('../js/gr-receiving-ux.js');
// Minimal input adapter for business validation; browser focus/rendering checked separately.
function fixture({ extra = false, split = false, values = {}, legacy = false } = {}) {
  const prefix = extra ? 'ex' : 'po';
  const fields = {};
  const defaults = { qty: '8', qty2: split ? '4' : '', unit: 'กล่อง', exp: '31/12/2569', 'loc-wh': 'W2', 'loc-floor': '1', 'loc-wh2': 'W3', 'loc-floor2': '1', 'old-stock': '0', 'old-stock2': '0', product: 'สินค้าจำลอง' };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) fields[`.${prefix}-${key}`] = { value, validity: {}, key };
  fields[`.${prefix}-no-expiry`] = { checked: false };
  fields['.po-split'] = { classList: { contains: () => !split } };
  fields['.po-product-name'] = { textContent: 'สินค้าจำลอง' };
  const row = { contains: field => Object.values(fields).includes(field), dataset: { legacy: String(legacy), ordered: '20' }, classList: { contains: cls => extra && cls === 'extra-item-row' }, querySelector: selector => fields[selector] };
  const date = { value: '2026-10-23' }, receiver = { value: 'พนักงานจำลอง' };
  const inputs = [date, receiver, ...Object.values(fields)];
  const form = { querySelectorAll: selector => selector === '.po-item-row, .extra-item-row' ? [row] : inputs,
    querySelector: selector => selector === '#r-ata' ? date : selector === '#r-receiver' ? receiver : selector === '.po-qty, .ex-qty' ? fields[`.${prefix}-qty`] : null };
  return { form, row, fields, date, receiver, errors: options => UX.collectErrors(form, options) };
}
let f = fixture({ split: true });
assert.equal(f.errors().length, 0, 'zero stock valid in both warehouses');
assert.match(UX.destinationSummary(f.row), /W2 รับ 8 \+ W3 รับ 4 = รวมรับครั้งนี้ 12 กล่อง/);
f = fixture({ split: true, values: { 'old-stock': '', 'old-stock2': '', exp: '', 'loc-floor': '' } });
f.receiver.value = '';
f.date.value = '';
assert.equal(f.errors().length, 6, 'collect all errors rather than first error only');
assert.equal(f.errors()[0].field, f.date, 'document order starts with date');
assert.equal(f.errors({ isDraft: true }).length, 0, 'draft remains optional');
f = fixture({ split: true, values: { 'loc-wh2': 'W2', 'old-stock2': '' } });
assert.equal(f.errors().length, 0, 'same warehouse has one old-stock count');
for (const qty2 of ['', '0']) {
  f = fixture({ split: true, values: { qty2, 'old-stock2': '', 'loc-floor2': '' } });
  assert.equal(f.errors().length, 0, 'blank/zero second quantity inactive');
  assert.match(UX.destinationSummary(f.row), /รวมรับครั้งนี้ 8 กล่อง/);
}
f = fixture({ split: false, values: { qty2: '4', 'old-stock2': '', 'loc-floor2': '' } });
assert.equal(f.errors().length, 0);
assert.match(UX.destinationSummary(f.row), /ข้อมูลส่วนนี้จะไม่ถูกส่ง/);
f = fixture({ split: true, values: { qty: '0' } });
assert.match(f.errors()[0].message, /ปลายทางที่ 1 มากกว่า 0/);
for (const values of [{ qty: '-1' }, { qty2: '-1' }, { 'old-stock': '-1' }, { 'old-stock2': '-1' }]) {
  assert.ok(fixture({ split: true, values }).errors().length, 'negative values must be explained');
}
f = fixture({ values: { qty: '20.25' } });
assert.equal(f.errors().length, 0, 'over-receipt and decimals are not prohibited');
f = fixture({ split: true, values: { qty: '0.1', qty2: '0.2' } });
assert.match(UX.destinationSummary(f.row), /รวมรับครั้งนี้ 0.3 กล่อง/);
assert.doesNotMatch(UX.destinationSummary(f.row), /0000000/, 'display does not expose binary floating-point noise');
f = fixture({ values: { exp: 'ฉลากเดิม' } });
assert.equal(f.errors().length, 0, 'raw label accepted');
f.fields['.po-exp'].value = 'x'.repeat(201);
assert.match(f.errors({ isDraft: true })[0].message, /200/);
f = fixture({ values: { exp: '' } });
f.fields['.po-no-expiry'].checked = true;
assert.equal(f.errors().length, 0, 'no-expiry permits optional empty Lot');
f = fixture({ extra: true, values: { unit: '' } });
assert.equal(f.errors({ requireExtraUnit: false }).length, 0, 'writer compatibility gate stays explicit');
assert.equal(f.errors({ requireExtraUnit: true }).length, 1);
assert.equal(f.errors({ requireExtraUnit: true, isDraft: true }).length, 0);
f.row.dataset.legacy = 'true';
assert.equal(f.errors({ requireExtraUnit: true }).length, 0, 'legacy blank unit is not retroactively required');
f = fixture({ values: { qty: '0' } });
assert.match(f.errors()[0].message, /อย่างน้อย 1 รายการ/);
delete f.row.dataset.ordered;
assert.doesNotMatch(UX.destinationSummary(f.row), /สั่ง|ยังเหลือ|รับเกิน/, 'ordered quantity remains permission gated');
console.log('PASS receiving UX: multi-error, draft, split, stock0, negative/decimal, raw/lot, conditional units, permission-aware summary');

// Ten-item partial receipt: four complete, two incomplete, four intentionally unreceived.
const ten = Array.from({ length: 10 }, (_, i) => fixture({ values: i < 4 ? {} : i < 6 ? { 'old-stock': '' } : { qty: '0', exp: '', 'loc-floor': '', 'old-stock': '' } }));
const multi = {
  querySelectorAll: selector => selector === '.po-item-row, .extra-item-row' ? ten.map(f => f.row) : selector === '.gr-item-disclosure' ? ten.map(f => f.fields['.gr-item-disclosure']) : ten.flatMap(f => Object.values(f.fields)),
  querySelector: selector => selector === '.po-qty, .ex-qty' ? ten[0].fields['.po-qty'] : null
};
let states = UX.itemStates(multi);
assert.equal(states.filter(s => s.receiving).length, 6);
assert.equal(states.filter(s => s.state === 'complete').length, 4);
assert.equal(states.filter(s => s.state === 'incomplete').length, 2);
assert.equal(states.filter(s => s.state === 'unreceived').length, 4, 'partial receipt does not require untouched rows');
assert.equal(UX.collectErrors(multi, { itemsOnly: true }).length, 2, 'bill fields are outside item completeness');
f = fixture({ values: { qty: '0' } });
assert.equal(UX.itemStates(f.form)[0].state, 'unreceived', 'all-zero form is not falsely a row error');
assert.equal(f.errors().length, 1, 'final whole bill still requires at least one receiving row');
f = fixture({ extra: true, values: { unit: '' } });
assert.equal(UX.itemStates(f.form)[0].state, 'incomplete', 'extra unit is required for completeness even before submit');
f.row.dataset.legacy = 'true';
assert.equal(UX.itemStates(f.form)[0].state, 'complete', 'legacy unit exemption is preserved in progress');
f = fixture({ split: true, values: { qty: '0.1', qty2: '0.2' } });
assert.match(UX.itemStates(f.form)[0].description, /รับ 0.3 กล่อง.*W2.*W3/);
f = fixture({ split: false, values: { qty: '0', qty2: '4' } });
assert.equal(UX.itemStates(f.form)[0].receiving, false, 'hidden split values do not affect progress');
console.log('PASS compact item progress: 10-item partial receipt, zero rows, extra unit gate, decimals and hidden split');

ten.forEach(f => { f.fields['.gr-item-disclosure'] = { open: true }; });
const quantities = ten.map(f => f.fields['.po-qty'].value);
const events = target => {
  const listeners = {};
  target.addEventListener = (name, fn) => (listeners[name] ||= []).push(fn);
  target.emit = (name, event = {}) => (listeners[name] || []).forEach(fn => fn(event));
  return target;
};
const doc = events({ activeElement: null, hasFocus: () => true });
events(multi);
multi.ownerDocument = doc;
multi.contains = row => ten.some(f => f.row === row);
ten.forEach(f => Object.values(f.fields).forEach(field => { field.closest = () => f.row; }));
const timers = [], realTimeout = global.setTimeout;
global.setTimeout = fn => timers.push(fn);
const flush = () => { while (timers.length) timers.shift()(); };
const leave = f => { doc.activeElement = null; multi.emit('focusout', { target: f.fields['.po-qty'], relatedTarget: null }); flush(); };
try {
  UX.bindAutoFold(multi);
  f = ten[0];
  const qty = f.fields['.po-qty'], stock = f.fields['.po-old-stock'], details = f.fields['.gr-item-disclosure'];
  leave(f);
  assert.equal(details.open, true, 'loaded complete rows stay open until edited');
  doc.activeElement = qty;
  multi.emit('input', { target: qty }); flush();
  assert.equal(details.open, true, 'typing never folds a complete row');
  doc.activeElement = stock;
  multi.emit('focusout', { target: qty, relatedTarget: stock }); flush();
  assert.equal(details.open, true, 'moving between fields stays open');
  doc.emit('pointerdown');
  leave(f);
  assert.equal(details.open, true, 'held pointer cannot shrink the target before its click');
  doc.emit('pointerup');
  assert.equal(details.open, true, 'click handlers run before the deferred collapse');
  flush();
  assert.equal(details.open, false, 'completed edited row folds after leaving');
  details.open = true;
  leave(f);
  assert.equal(details.open, true, 'manual reopen without an edit remains open');
  multi.emit('input', { target: qty });
  multi.emit('click', { target: { closest: selector => selector === '.gr-item-toggle' ? {} : f.row } });
  leave(f);
  assert.equal(details.open, true, 'explicit manual toggle clears pending edit state');
  for (const item of ten) { multi.emit('change', { target: item.fields['.po-qty'] }); leave(item); }
  assert.deepEqual(ten.map(f => f.fields['.gr-item-disclosure'].open), [false, false, false, false, true, true, true, true, true, true], 'only complete rows fold, partial/invalid/unreceived rows stay open');
  details.open = true;
  multi.emit('input', { target: qty });
  doc.activeElement = null;
  multi.emit('focusout', { target: qty, relatedTarget: null });
  doc.activeElement = stock;
  flush();
  assert.equal(details.open, true, 'focus restored by save or internal action prevents collapse');
  assert.deepEqual(ten.map(f => f.fields['.po-qty'].value), quantities, 'automatic folding never changes quantities');
} finally { global.setTimeout = realTimeout; }
console.log('PASS automatic folding: typing/internal focus, pointer click order, manual reopen, optional rows and restored focus');

// Execute validation rendering with an input adapter; native focus/geometry is checked in-browser.
f = fixture({ values: { 'old-stock': '', 'loc-floor': '' } });
const messages = [], focusEvents = [];
const details = { tagName: 'DETAILS', open: false, classList: { contains: () => false } };
const inputs = [f.date, f.receiver, ...Object.values(f.fields)];
for (const field of inputs) {
  const attrs = new Map(), classes = new Set();
  field.classList = { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) };
  field.setAttribute = (key, value) => attrs.set(key, value);
  field.getAttribute = key => attrs.get(key) || null;
  field.removeAttribute = key => attrs.delete(key);
  field.insertAdjacentElement = (_, message) => messages.push(message);
  field.parentElement = details;
  field.scrollIntoView = () => {};
  field.focus = () => focusEvents.push(field);
}
const queryAll = f.form.querySelectorAll;
f.form.querySelectorAll = selector => selector === '[data-gr-error]' ? [...messages] : selector === '[data-gr-invalid]' ? inputs.filter(field => field.getAttribute('data-gr-invalid')) : queryAll(selector);
const previousDocument = global.document;
global.document = { createElement(tag) {
  assert.equal(tag, 'p', 'validation creates only inline messages, never a summary or error list');
  const message = { dataset: {}, remove() { messages.splice(messages.indexOf(message), 1); } };
  return message;
} };
try {
  f.fields['.po-old-stock'].setAttribute('aria-describedby', 'stock-help');
  UX.refreshErrors(f.form);
  assert.equal(messages.length, 0, 'incomplete input remains quiet before save');
  assert.equal(UX.validate(f.form, { requireExtraUnit: true }), false);
  assert.equal(messages.length, 2);
  assert.equal(details.open, true, 'save opens a folded invalid row');
  assert.equal(focusEvents[0], f.fields['.po-loc-floor'], 'save focuses first missing field in adapter order');
  assert.equal(f.fields['.po-old-stock'].getAttribute('aria-invalid'), 'true');
  assert.ok(f.fields['.po-old-stock'].classList.contains('input-error'));
  assert.ok(messages.every(message => !message.textContent.includes('สินค้าจำลอง')), 'inline messages omit repeated product names');
  f.fields['.po-loc-floor'].value = '1';
  f.fields['.po-exp'].value = '';
  UX.refreshErrors(f.form);
  assert.equal(messages.length, 1, 'editing clears resolved warnings without flagging newly missing fields');
  assert.equal(f.fields['.po-exp'].getAttribute('aria-invalid'), null);
  assert.equal(focusEvents.length, 1, 'editing never jumps focus');
  f.fields['.po-old-stock'].value = '0';
  UX.refreshErrors(f.form);
  assert.equal(messages.length, 0);
  assert.equal(f.fields['.po-old-stock'].getAttribute('aria-describedby'), 'stock-help', 'existing field help survives error cleanup');
  assert.equal(UX.validate(f.form, { requireExtraUnit: true }), false);
  assert.equal(messages.length, 1, 'next save reveals the newly missing expiry');
  assert.equal(focusEvents[1], f.fields['.po-exp']);
  assert.equal(UX.validate(f.form, { isDraft: true }), true, 'Draft still permits missing final-only fields');
  assert.equal(messages.length, 0);
  UX.reset(f.form);
  assert.equal(f.form.grValidationOptions, undefined);
} finally { global.document = previousDocument; }
console.log('PASS save-only warnings: no summary/live discovery, focus/open on save, corrected warnings clear, Draft/help preserved');
