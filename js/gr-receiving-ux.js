/* Receiving presentation and validation. The existing writer remains the payload authority. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GrReceivingUX = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const text = field => String(field?.value ?? '').trim();
  const number = field => Number(text(field));
  const all = (scope, selector) => Array.from(scope.querySelectorAll(selector));
  let sequence = 0;

  function collectErrors(form, options = {}) {
    const errors = [];
    const add = (field, message) => {
      if (field && !errors.some(error => error.field === field)) errors.push({ field, message });
    };
    const required = (field, message) => { if (!text(field)) add(field, message); };
    const nonnegative = (field, title) => {
      if (field && (field.validity?.badInput || (text(field) && (!Number.isFinite(number(field)) || number(field) < 0)))) {
        add(field, `${title}: กรุณาใส่ตัวเลขตั้งแต่ 0 ขึ้นไป`);
      }
    };
    const final = !options.isDraft;
    if (final && !options.appendMode && !options.itemsOnly) {
      required(form.querySelector('#r-ata'), 'กรุณาระบุวันที่รับสินค้า');
      required(form.querySelector('#r-receiver'), 'กรุณาระบุชื่อผู้รับสินค้า');
    }
    const rounds = form.querySelector('#lift-fee-rounds');
    if (rounds && !options.appendMode && !options.itemsOnly && (final || text(rounds))) {
      if (!/^\d{1,4}$/.test(text(rounds))) add(rounds, 'กรุณาระบุรอบลิฟท์เป็นจำนวนเต็มตั้งแต่ 0 ถึง 9999 (ใส่ 0 หากไม่ใช้)');
      if (number(rounds) > 0 && !form.querySelector('[name="lift-fee"]:checked')) add(form.querySelector('[name="lift-fee"]'), 'กรุณาเลือกวิธีชำระค่าลิฟท์');
    }
    let receivingCount = 0;
    all(form, '.po-item-row, .extra-item-row').forEach(row => {
      const extra = row.classList.contains('extra-item-row');
      const prefix = extra ? 'ex' : 'po';
      const get = suffix => row.querySelector(`.${prefix}-${suffix}`);
      const name = extra ? text(get('product')) : row.querySelector('.po-product-name')?.textContent.trim();
      const qty = get('qty');
      const split = !extra && row.querySelector('.po-split');
      const splitOpen = split && !split.classList.contains('hidden');
      const qty2 = splitOpen ? get('qty2') : null;
      const splitActive = qty2 && number(qty2) > 0;
      nonnegative(qty, 'จำนวนรับ');
      if (qty2) nonnegative(qty2, 'จำนวนปลายทางที่ 2');
      const total = number(qty) + (splitActive ? number(qty2) : 0);
      const active = extra ? Boolean(name || text(qty)) : total > 0;
      const expiry = get('exp');
      if (text(expiry).length > 200) add(expiry, 'วันหมดอายุหรือเลข Lot ต้องไม่เกิน 200 ตัวอักษร');
      if (extra && active) {
        required(get('product'), 'กรุณาระบุชื่อสินค้า');
        required(qty, 'กรุณาระบุจำนวนรับ');
        if (final && text(qty) && total === 0) add(qty, 'จำนวนรับต้องมากกว่า 0');
        if (final && options.requireExtraUnit && row.dataset.legacy !== 'true') required(get('unit'), 'กรุณาระบุหน่วย เช่น กล่อง หรือ ถุง');
      }
      if (!active) return;
      if (total > 0) receivingCount++;
      nonnegative(get('old-stock'), 'สต๊อกเก่า');
      if (final) {
        if (!get('no-expiry')?.checked) required(expiry, 'กรอกวันหมดอายุ หรือเลือกสินค้าไม่มีวันหมดอายุ');
        required(get('loc-wh'), 'กรุณาเลือกคลังปลายทางที่ 1');
        required(get('loc-floor'), 'กรุณาเลือกชั้นปลายทางที่ 1');
        required(get('old-stock'), `กรอกสต๊อกเก่า ${text(get('loc-wh'))} (ใส่ 0 หากไม่มี)`);
      }
      if (splitActive) {
        if (final && number(qty) <= 0) add(qty, 'ระบุจำนวนปลายทางที่ 1 มากกว่า 0 หรือเลือกคลังที่รับจริงเป็นปลายทางแรก');
        if (final) {
          required(get('loc-wh2'), 'กรุณาเลือกคลังปลายทางที่ 2');
          required(get('loc-floor2'), 'กรุณาเลือกชั้นปลายทางที่ 2');
        }
        if (text(get('loc-wh2')) !== text(get('loc-wh'))) {
          nonnegative(get('old-stock2'), 'สต๊อกเก่าปลายทางที่ 2');
          if (final) required(get('old-stock2'), `กรอกสต๊อกเก่า ${text(get('loc-wh2'))} (ใส่ 0 หากไม่มี)`);
        }
      }
    });
    if (final && !receivingCount && !options.itemsOnly) add(form.querySelector('.po-qty, .ex-qty'), 'กรุณาระบุจำนวนรับมากกว่า 0 อย่างน้อย 1 รายการ');
    const fields = all(form, 'input, select, textarea');
    return errors.sort((a, b) => fields.indexOf(a.field) - fields.indexOf(b.field));
  }

  function identify(field) {
    if (!field.id) field.id = `gr-field-${++sequence}`;
    return field.id;
  }
  function focusError(field) {
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      if (parent.classList.contains('gr-collapsible')) parent.classList.remove('hidden');
    }
    field.scrollIntoView({ block: 'center', behavior: 'auto' });
    field.focus({ preventScroll: true });
  }
  function clearErrors(form) {
    all(form, '[data-gr-error]').forEach(message => message.remove());
    all(form, '[data-gr-invalid]').forEach(field => {
      field.classList.remove('input-error');
      field.removeAttribute('aria-invalid');
      field.removeAttribute('data-gr-invalid');
      const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== `${field.id}-error`);
      if (ids.length) field.setAttribute('aria-describedby', ids.join(' '));
      else field.removeAttribute('aria-describedby');
    });
  }
  function renderErrors(form, errors, focus) {
    clearErrors(form);
    if (!errors.length) return;
    errors.forEach(({ field, message }) => {
      identify(field);
      field.classList.add('input-error');
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('data-gr-invalid', 'true');
      const description = document.createElement('p');
      description.id = `${field.id}-error`;
      description.dataset.grError = 'true';
      description.className = 'gr-field-error';
      description.textContent = message;
      field.insertAdjacentElement('afterend', description);
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), description.id].filter(Boolean).join(' '));
    });
    if (focus) focusError(errors[0].field);
  }
  function validate(form, options, focus = true) {
    form.grValidationOptions = options;
    const errors = collectErrors(form, options);
    renderErrors(form, errors, focus);
    return errors.length === 0;
  }
  function refreshErrors(form) {
    if (!form.grValidationOptions) return;
    // Editing may clear a previous save warning, but only saving reveals new errors.
    const marked = new Set(all(form, '[data-gr-invalid]'));
    const errors = collectErrors(form, form.grValidationOptions).filter(error => marked.has(error.field));
    renderErrors(form, errors, false);
  }
  function serverError(form, message) {
    let notice = form.querySelector('.gr-server-error');
    if (!notice) {
      notice = document.createElement('p');
      notice.className = 'gr-server-error gr-error-summary';
      notice.setAttribute('role', 'alert');
      form.querySelector('#gr-receiving-summary').insertAdjacentElement('beforebegin', notice);
    }
    notice.textContent = message;
  }

  function destinationSummary(row) {
    const get = suffix => row.querySelector(`.po-${suffix}`);
    const split = row.querySelector('.po-split');
    const open = split && !split.classList.contains('hidden');
    const q1 = number(get('qty')) || 0;
    const q2 = open ? number(get('qty2')) || 0 : 0;
    const active = q2 > 0;
    const unit = text(get('unit'));
    let value = `${text(get('loc-wh')) || 'ปลายทางที่ 1'} รับ ${q1}`;
    if (active) value += ` + ${text(get('loc-wh2')) || 'ปลายทางที่ 2'} รับ ${q2}`;
    const displayQuantity = value => Number(value.toFixed(8)); // Display only; never alter the receiving payload.
    value += ` = รวมรับครั้งนี้ ${displayQuantity(q1 + (active ? q2 : 0))} ${unit}`;
    if (open && !active) value += ' · ยังไม่รับเข้าปลายทางที่ 2';
    if (!open && number(get('qty2')) > 0) value += ' · ปลายทางที่ 2 ปิดอยู่ ข้อมูลส่วนนี้จะไม่ถูกส่ง';
    if (row.dataset.ordered !== undefined) {
      const ordered = Number(row.dataset.ordered);
      const difference = displayQuantity(ordered - q1 - (active ? q2 : 0));
      value += ` · สั่ง ${ordered} ${unit} · ${difference > 0 ? `ยังเหลือ ${difference}` : difference < 0 ? `รับเกิน ${-difference}` : 'รับครบ'} ${difference ? unit : ''}`;
    }
    return value;
  }
  function itemStates(form) {
    // Progress describes final field completeness, not a save or receipt status.
    // Inactive PO rows remain optional for partial receiving.
    const errors = collectErrors(form, { itemsOnly: true, requireExtraUnit: true });
    return all(form, '.po-item-row, .extra-item-row').map((row, index) => {
      const extra = row.classList.contains('extra-item-row');
      const prefix = extra ? 'ex' : 'po';
      const get = suffix => row.querySelector(`.${prefix}-${suffix}`);
      const split = !extra && row.querySelector('.po-split');
      const q1 = number(get('qty')) || 0;
      const q2 = split && !split.classList.contains('hidden') ? number(get('qty2')) || 0 : 0;
      const quantity = q1 + (q2 > 0 ? q2 : 0);
      const rowErrors = errors.filter(error => row.contains(error.field));
      const receiving = quantity > 0;
      const state = rowErrors.length ? 'incomplete' : receiving ? 'complete' : 'unreceived';
      const name = extra ? text(get('product')) || 'รายการนอกบิลใหม่' : row.querySelector('.po-product-name')?.textContent.trim();
      const location = suffix => [text(get(`loc-wh${suffix}`)), text(get(`loc-floor${suffix}`)) && `ชั้น ${text(get(`loc-floor${suffix}`))}`, text(get(`loc-zone${suffix}`)) && `โซน ${text(get(`loc-zone${suffix}`))}`].filter(Boolean).join(' / ');
      const unit = text(get('unit'));
      const displayQuantity = value => Number(value.toFixed(8));
      let description = receiving ? `รับ ${displayQuantity(quantity)} ${unit}` : 'ยังไม่ระบุจำนวนรับ';
      if (receiving) description += q2 > 0
        ? ` · ${location('')} (${displayQuantity(q1)} ${unit}) + ${location('2')} (${displayQuantity(q2)} ${unit})`
        : ` · ${location('') || 'ยังไม่ระบุปลายทาง'}`;
      return { row, index, name, receiving, state, description, errors: rowErrors };
    });
  }
  function refreshItems(form) {
    const states = itemStates(form);
    for (const item of states) {
      const summary = item.row.querySelector('.gr-item-toggle');
      if (!summary) continue;
      summary.querySelector('.gr-item-title').textContent = `${item.index + 1}. ${item.name}`;
      summary.querySelector('.gr-item-meta').textContent = item.description;
      const status = summary.querySelector('.gr-item-status');
      status.dataset.state = item.state;
      status.hidden = item.state === 'incomplete';
      status.textContent = item.state === 'complete' ? 'กรอกครบแล้ว' : item.state === 'unreceived' ? 'ยังไม่รับ' : '';
      status.title = item.state === 'complete' ? 'ข้อมูลครบ ยังไม่ได้บันทึกรับสินค้า' : '';
    }
    return states;
  }
  function bindAutoFold(form) {
    const doc = form.ownerDocument;
    const edited = new WeakSet();
    const pending = new Set();
    let pointerDown = false;
    const rowOf = target => target?.closest?.('.po-item-row, .extra-item-row');
    const settle = () => {
      if (pointerDown || !doc.hasFocus()) return;
      for (const row of pending) {
        pending.delete(row);
        if (!edited.has(row) || row.contains(doc.activeElement) || !form.contains(row)) continue;
        const item = itemStates(form).find(item => item.row === row);
        if (item?.state === 'complete') {
          row.querySelector('.gr-item-disclosure').open = false;
          edited.delete(row);
        }
      }
    };
    const defer = () => setTimeout(settle, 0);
    const markEdited = event => { const row = rowOf(event.target); if (row) edited.add(row); };
    form.addEventListener('input', markEdited);
    form.addEventListener('change', markEdited);
    form.addEventListener('focusout', event => {
      const row = rowOf(event.target);
      if (row && !row.contains(event.relatedTarget)) { pending.add(row); defer(); }
    });
    form.addEventListener('click', event => {
      if (event.target.closest?.('.gr-item-toggle')) {
        const row = rowOf(event.target);
        edited.delete(row);
        pending.delete(row);
      }
    });
    // Wait until the click finishes so shrinking a row cannot move its target away.
    doc.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    doc.addEventListener('pointerup', () => { pointerDown = false; defer(); }, true);
    doc.addEventListener('pointercancel', () => { pointerDown = false; pending.clear(); }, true);
  }
  function makeDisclosure(row) {
    if (row.querySelector('.gr-item-disclosure')) return null;
    const details = document.createElement('details');
    details.className = 'gr-item-disclosure';
    const summary = document.createElement('summary');
    summary.className = 'gr-item-toggle';
    for (const name of ['title', 'meta', 'status']) {
      const span = document.createElement('span');
      span.className = `gr-item-${name}`;
      summary.appendChild(span);
    }
    const chevron = document.createElement('span');
    chevron.className = 'gr-item-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    summary.appendChild(chevron);
    const body = document.createElement('div');
    body.className = 'gr-item-body';
    while (row.firstChild) body.appendChild(row.firstChild);
    details.append(summary, body);
    row.appendChild(details);
    // Start open; only edited, complete rows fold after the employee leaves them.
    details.open = true;
    details.addEventListener('toggle', () => { const form = row.closest('form'); if (form) refreshItems(form); });
    return details;
  }
  function refreshSummary(form) {
    const date = form.querySelector('#r-ata');
    const dateHint = form.querySelector('#r-ata-date-hint');
    if (date && dateHint) dateHint.textContent = /^\d{4}-\d{2}-\d{2}$/.test(text(date))
      ? `วันที่รับ: ${new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(`${text(date)}T00:00:00+07:00`))}`
      : 'เลือกวันที่รับสินค้า · แสดงวัน เดือน ปี พ.ศ.';
    all(form, '.po-item-row').forEach(row => {
      const summary = row.querySelector('.gr-destination-summary');
      if (summary) summary.textContent = destinationSummary(row);
      const splitOpen = !row.querySelector('.po-split')?.classList.contains('hidden');
      row.classList.toggle('gr-has-split', splitOpen);
      if (summary) summary.hidden = !splitOpen && !(number(row.querySelector('.po-qty')) > 0);
    });
    refreshItems(form);
    const summary = form.querySelector('#gr-receiving-summary');
    if (summary) {
      const count = all(form, '.po-item-row, .extra-item-row').filter(row => {
        const qty = row.querySelector('.po-qty, .ex-qty');
        const second = row.querySelector('.po-split:not(.hidden) .po-qty2');
        return number(qty) > 0 || number(second) > 0;
      }).length;
      summary.textContent = `สรุปก่อนส่ง: รับสินค้า ${count} รายการ · ตรวจจำนวน หน่วย และปลายทางของแต่ละรายการก่อนยืนยัน`;
    }
  }
  function enhance(form) {
    if (!form) return;
    all(form, '.po-item-row, .extra-item-row').forEach((row, index) => {
      const prefix = row.classList.contains('po-item-row') ? 'po' : 'ex';
      const suffixes = {
        product: 'ชื่อสินค้า', qty: 'จำนวนรับปลายทางที่ 1', unit: 'หน่วย', exp: 'วันหมดอายุ หรือเลข Lot',
        'no-expiry': 'สินค้าไม่มีวันหมดอายุ', 'old-stock': 'สต๊อกเก่าปลายทางที่ 1',
        'loc-wh': 'คลังปลายทางที่ 1', 'loc-floor': 'ชั้นปลายทางที่ 1', 'loc-zone': 'โซนปลายทางที่ 1 (ไม่บังคับ)',
        qty2: 'จำนวนรับปลายทางที่ 2', 'old-stock2': 'สต๊อกเก่าปลายทางที่ 2',
        'loc-wh2': 'คลังปลายทางที่ 2', 'loc-floor2': 'ชั้นปลายทางที่ 2', 'loc-zone2': 'โซนปลายทางที่ 2 (ไม่บังคับ)'
      };
      Object.entries(suffixes).forEach(([suffix, title]) => {
        const field = row.querySelector(`.${prefix}-${suffix}`);
        if (!field) return;
        identify(field);
        const accessibleTitle = suffix === 'exp' && row.querySelector(`.${prefix}-no-expiry`)?.checked ? 'เลข Lot (ไม่บังคับ)' : title;
        field.setAttribute('aria-label', `รายการ ${index + 1}: ${accessibleTitle}`);
        if (field.type === 'number') { field.min = '0'; field.step = 'any'; field.inputMode = 'decimal'; }
        const label = field.parentElement.querySelector('label:not(:has(input))');
        if (label && !label.htmlFor) label.htmlFor = field.id;
      });
      const removal = row.querySelector('.gr-remove-extra');
      if (removal) removal.setAttribute('aria-label', `ลบรายการนอกบิล ${index + 1} ${text(row.querySelector('.ex-product'))}`);
      if (prefix === 'po' && !row.querySelector('.gr-destination-summary')) {
        const summary = document.createElement('p');
        summary.className = 'gr-destination-summary';
        summary.setAttribute('aria-live', 'polite');
        row.appendChild(summary);
      }
      makeDisclosure(row);
    });
    const rounds = form.querySelector('#lift-fee-rounds');
    if (rounds) rounds.setAttribute('aria-label', 'จำนวนรอบลิฟท์');
    if (!form.dataset.grUxBound) {
      form.dataset.grUxBound = 'true';
      bindAutoFold(form);
      const refresh = () => {
        refreshSummary(form);
        refreshErrors(form);
      };
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
    }
    refreshSummary(form);
  }
  function reset(form) {
    clearErrors(form);
    delete form.grValidationOptions;
    form.querySelector('.gr-server-error')?.remove();
  }
  return { collectErrors, validate, enhance, reset, refreshSummary, refreshErrors, destinationSummary, itemStates, bindAutoFold, focusError, serverError };
});
