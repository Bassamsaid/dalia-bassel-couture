'use strict';
/* Dalia Bassel Couture — ADMIN pages */

/* weekday chips for paid off-days (Egypt week: Sat first) */
const WEEKDAYS_LABELS = [['saturday', 'Sat'], ['sunday', 'Sun'], ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri']];

/* Dress measurement fields (key -> Arabic label) */
const MEASURE_FIELDS = [
  ['chest', 'د. صدر'], ['dart', 'ط. بنسة'], ['empire', 'ط. إمبير'], ['front_len', 'ط. أمام'],
  ['waist', 'وسط'], ['shoulder', 'ع. الكتف'], ['back_w', 'ع. الضهر'], ['back_len', 'ط. الخلف'],
  ['sleeve', 'كم'], ['wrist', 'معصم'], ['arm', 'د. دراع'], ['hip', 'هانش'], ['skirt_len', 'ط. اسكيرت'],
];

/* Egypt governorates (for student registration) */
const EG_GOV = ['Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Dakahlia', 'Sharqia', 'Gharbia', 'Monufia', 'Beheira', 'Kafr El Sheikh', 'Damietta', 'Port Said', 'Ismailia', 'Suez', 'Faiyum', 'Beni Suef', 'Minya', 'Asyut', 'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea', 'New Valley', 'Matrouh', 'North Sinai', 'South Sinai'];

/* generic form modal. fields: {name,label,type,options,required,value,accept,rows} */
function fmField(f) {
  if (f.type === 'hidden') return `<input type="hidden" name="${f.name}" value="${esc(f.value ?? '')}" />`;
  const v = f.value ?? '';
  const req = f.required ? ' data-req="1"' : '';
  if (f.type === 'select') return `<label>${f.label}${f.required ? ' *' : ''}</label><select name="${f.name}"${req}>${
    (f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  if (f.type === 'textarea') return `<label>${f.label}${f.required ? ' *' : ''}</label><textarea name="${f.name}"${req} ${f.rows ? `style="min-height:${f.rows * 22}px"` : ''}>${esc(v)}</textarea>`;
  if (f.type === 'image' || f.type === 'file') return `<label>${f.label}</label>
    <div class="row"><button type="button" class="btn ghost sm" onclick="pickForField('${f.name}','${f.type}','${f.accept || ''}')">📷 Choose ${f.type === 'file' ? 'file' : 'image'}</button>
    <span class="hint" id="fh_${f.name}" style="flex:2">${v ? 'Selected' : 'None'}</span></div>
    <input type="hidden" name="${f.name}" id="fi_${f.name}" value="${esc(v)}" />`;
  // numeric fields pop the number keypad on mobile; phone fields the tel keypad
  const isPhone = /phone|tel|mobile/i.test(f.name);
  const im = f.inputmode || (f.type === 'number' ? 'decimal' : (isPhone ? 'tel' : ''));
  // A phone field gets the same contact/paste pair as the dress forms; the id is
  // only for those buttons, the form still reads the value by name.
  const pid = isPhone ? ` id="fp_${f.name}"` : '';
  const input = `<input name="${f.name}"${pid} type="${f.type || 'text'}" value="${esc(v)}"${req}${im ? ` inputmode="${im}"` : ''}${isPhone ? ' autocomplete="tel"' : ''} ${f.step ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${isPhone ? 'style="flex:1;min-width:0"' : ''} />`;
  const body = isPhone
    ? `<div class="row" style="gap:6px;align-items:center">${input}${phoneButtons('fp_' + f.name)}</div>`
    : input;
  return `<label>${f.label}${f.required ? ' *' : ''}</label>${body}`;
}
function canPickContacts() { return !!(window.ContactsManager && navigator.contacts && navigator.contacts.select); }

/* A phone number is read off a client's WhatsApp and typed in by hand, which is
   where the wrong digit gets in. Three ways to avoid typing it:
   - Android Chrome opens the real contact list (Contact Picker API).
   - iOS has no web API for that, but a tel field with autocomplete="tel" makes
     the keyboard offer the contact itself, which is the same gesture.
   - Paste, for a number copied from anywhere at all.
   The buttons render everywhere; each one explains itself if it cannot deliver. */
function phoneField(id, value, opts = {}) {
  const name = opts.name ? ` data-name-target="${opts.name}"` : '';
  return `<div class="row" style="gap:6px;align-items:center">
    <input id="${id}" type="tel" inputmode="tel" autocomplete="tel" value="${esc(value || '')}"${name} style="flex:1;min-width:0" ${opts.readonly ? 'readonly' : ''} />
    ${opts.readonly ? '' : phoneButtons(id)}
  </div>`;
}
/* The contact button only exists where a contact list can actually be opened.
   Safari has no such API at all, so on an iPhone it could never do more than
   apologise — and a button that apologises is worse than no button. There,
   paste is the whole story, and the keyboard offers the contact on its own. */
function phoneButtons(id) {
  return `${canPickContacts() ? `<button type="button" class="btn ghost sm" style="flex:0 0 auto" onclick="pickContact('${id}')" title="Choose from contacts">👤</button>` : ''}
    <button type="button" class="btn ghost sm" style="flex:0 0 auto" onclick="pastePhone('${id}')" title="Paste a copied number">📋 Paste</button>`;
}
window.phoneButtons = phoneButtons;
window.phoneField = phoneField;
window.pickContact = async (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  if (!canPickContacts()) return;
  let picked;
  try { [picked] = await navigator.contacts.select(['tel', 'name'], { multiple: false }); }
  catch (e) { return; } // dismissed
  if (!picked) return;
  const tel = (picked.tel || []).find(Boolean);
  if (!tel) return toast('That contact has no number saved', 'error');
  setPhone(el, tel);
  // Fill the client's name too, but never over something already typed.
  const nameSel = el.getAttribute('data-name-target');
  const nameEl = nameSel && document.getElementById(nameSel);
  const who = (picked.name || []).find(Boolean);
  if (nameEl && who && !nameEl.value.trim()) { nameEl.value = who; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
  toast(`${who || 'Number'} added ✓`);
};
window.pastePhone = async (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch (e) { el.focus(); return toast('Long-press the field and choose Paste'); }
  if (!text || !text.trim()) return toast('Nothing copied yet');
  setPhone(el, text);
  toast('Pasted ✓');
};
/* Contacts hand back numbers spaced and bracketed however they were saved. */
function setPhone(el, raw) {
  el.value = String(raw).replace(/[^\d+]/g, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

let _wiz = null;
/* light step-by-step wizard: fields are shown a few at a time (calmer than a wall of inputs) */
function formModal(heading, fields, onSubmit, opts = {}) {
  const vis = fields.filter((f) => f.type !== 'hidden');
  const hid = fields.filter((f) => f.type === 'hidden');
  const per = opts.perStep || 3;
  const steps = [];
  for (let i = 0; i < vis.length; i += per) steps.push(vis.slice(i, i + per));
  if (!steps.length) steps.push([]);
  const multi = steps.length > 1;
  const stepsHtml = steps.map((grp, si) => `<div class="wstep" data-s="${si}" ${si ? 'style="display:none"' : ''}>${grp.map(fmField).join('')}</div>`).join('');
  const dots = multi ? `<div class="wdots">${steps.map((_, i) => `<span class="wdot ${i ? '' : 'on'}"></span>`).join('')}</div>` : '';
  modal(`<h3>${esc(heading)}</h3>${opts.hint ? `<p class="hint" style="margin:-6px 0 10px">${esc(opts.hint)}</p>` : ''}${dots}<form id="fm">${stepsHtml}${hid.map(fmField).join('')}
    <div class="err hidden" id="fmErr"></div>
    <div class="wnav">
      <button type="button" class="btn sec" id="wBack" onclick="wizNav(-1)" style="display:none">Back</button>
      <button type="button" class="btn" id="wNext" onclick="wizNav(1)" ${multi ? '' : 'style="display:none"'}>Next</button>
      <button class="btn" id="wSave" type="submit" ${multi ? 'style="display:none"' : ''}>${esc(opts.submitLabel || 'Save')}</button>
    </div></form>`);
  _wiz = { step: 0, count: steps.length };
  const form = $('#fm');
  let saving = false;
  // The form's submit and the button's own click both lead here. A submit event
  // can be swallowed — by a browser that will not submit while something it
  // cannot focus is invalid, by anything that stops the event on its way up —
  // and when it is, a Save button does nothing at all and says nothing either.
  // The click is the one thing that cannot be missed, so it is listened for too,
  // and the flag keeps the two from both going.
  const submitNow = async (e) => {
    if (e) e.preventDefault();
    if (saving) return;
    const data = {};
    fields.forEach((f) => {
      const el = $(`[name="${f.name}"]`, form); if (!el) return;
      let val = el.value;
      if (f.type === 'number') val = val === '' ? null : Number(val);
      data[f.name] = val;
    });
    // Sending a transfer screenshot takes seconds on a phone, and a button that
    // sits there saying Save through all of it looks like a button that did
    // nothing. It says what it is doing, and it cannot be pressed twice.
    const btn = $('#wSave');
    const label = btn ? btn.textContent : '';
    saving = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await onSubmit(data);
      closeModal();
    } catch (err) {
      const x = $('#fmErr');
      if (x) {
        x.textContent = err && err.message ? err.message : 'That did not save. Try again.';
        x.classList.remove('hidden');
        if (x.scrollIntoView) x.scrollIntoView({ block: 'nearest' });
      }
      if (btn) { btn.disabled = false; btn.textContent = label; }
    } finally { saving = false; }
  };
  if (form) form.onsubmit = submitNow;
  const saveBtn = $('#wSave');
  if (saveBtn) saveBtn.addEventListener('click', submitNow);
}
window.wizNav = (dir) => {
  if (!_wiz) return;
  const err = $('#fmErr'); if (err) err.classList.add('hidden');
  if (dir > 0) {
    const cur = document.querySelector(`.wstep[data-s="${_wiz.step}"]`);
    const missing = cur && [...cur.querySelectorAll('[data-req]')].some((el) => !String(el.value || '').trim());
    if (missing) { err.textContent = 'Please fill the required field(s)'; err.classList.remove('hidden'); return; }
  }
  _wiz.step = Math.max(0, Math.min(_wiz.count - 1, _wiz.step + dir));
  document.querySelectorAll('.wstep').forEach((d) => { d.style.display = Number(d.dataset.s) === _wiz.step ? '' : 'none'; });
  document.querySelectorAll('.wdot').forEach((d, i) => d.classList.toggle('on', i <= _wiz.step));
  const last = _wiz.step === _wiz.count - 1;
  const back = $('#wBack'), next = $('#wNext'), save = $('#wSave');
  if (back) back.style.display = _wiz.step ? '' : 'none';
  if (next) next.style.display = last ? 'none' : '';
  if (save) save.style.display = last ? '' : 'none';
};
/* The file goes up the moment it is chosen, as bytes, and the form carries only
   the name it was stored under. It used to ride inside the form as base64 — a
   third bigger than the file — so a transfer screenshot left Save sitting there
   for the best part of a minute on a phone and looked like a button that did
   nothing. If sending it fails, it falls back to the old way rather than losing
   the picture. */
window.pickForField = (name, type, accept) => pickImage(async (b64) => {
  const inp = $(`#fi_${name}`), hint = $(`#fh_${name}`);
  if (!inp) return;
  // a 'file' field is for video and already goes up its own way; this is the
  // photo case, which is the one that was riding inside the form
  if (type === 'file') { inp.value = b64; if (hint) hint.textContent = 'Selected ✓'; return; }
  try {
    if (hint) hint.textContent = 'Sending…';
    const up = await uploadDataUrl(b64, 'photo.jpg',
      (pc) => { if (hint) hint.textContent = `Sending… ${Math.round(pc * 100)}%`; });
    inp.value = up.file;
  } catch (e) {
    inp.value = b64;
  }
  if (hint) hint.textContent = 'Selected ✓';
}, accept || (type === 'file' ? 'video/*,image/*' : 'image/*'), type === 'file'); // file fields upload raw (HD, no compression)

function confirmDel(msg, fn) { if (confirm(msg || 'Delete this?')) fn(); }
window.confirmDel = confirmDel;
function dayEn(d) { return { friday: 'Friday', saturday: 'Saturday' }[d] || d || ''; }
function leaveEn(t) { return { annual: 'Annual', sick: 'Sick', unpaid: 'Unpaid' }[t] || t; }

/* The home cover photo was the backdrop of a banner the dashboard no longer
   carries — the top of Home is the books and the two houses now. The photo
   itself is kept on the server, and the studio's own photo and introduction
   live on the Dalia screen, so nothing of his is lost by its going. */

/* ============ HOME / DASHBOARD ============ */
/* What every shop has had out of us. Invoices carry either a vendor on the list
   or a shop typed by hand, so both are grouped by name — otherwise the halves
   never add up to the purchases total they sit under. */
function vendorSpendRows(invoices, expenses) {
  const by = {};
  const bucket = (name) => {
    const nm = String(name || '').trim() || 'No vendor named';
    const k = nm.toLowerCase();
    return (by[k] = by[k] || { name: nm, id: null, purchases: 0, costs: 0, invoices: 0 });
  };
  invoices.forEach((inv) => {
    const g = bucket(inv.vendor_name || inv.shop);
    if (!g.id && inv.vendor_id) g.id = inv.vendor_id;
    g.purchases += inv.total || 0;
    g.invoices += 1;
  });
  // a studio cost against a vendor belongs on its line too, told apart from materials
  (expenses || []).forEach((e) => {
    if (!e.vendor_name) return;
    const g = bucket(e.vendor_name);
    if (!g.id && e.vendor_id) g.id = e.vendor_id;
    g.costs += e.amount || 0;
  });
  return Object.values(by).sort((a, b) => (b.purchases + b.costs) - (a.purchases + a.costs));
}
/* What the studio's own costs went on, heading by heading. */
function expenseTypeRows(expenses) {
  const by = {};
  (expenses || []).forEach((e) => {
    const nm = String(e.type || '').trim() || 'Not filed under a type';
    const g = by[nm] = by[nm] || { name: nm, value: 0, n: 0 };
    g.value += e.amount || 0; g.n += 1;
  });
  return Object.values(by).sort((a, b) => b.value - a.value)
    .map((g) => ({ name: g.name, value: g.value, sub: `${g.n} entr${g.n === 1 ? 'y' : 'ies'}`, act: "go('expenses')" }));
}
/* Materials month by month, newest first — the shape of the buying, not a heap. */
function purchaseMonthRows(invoices) {
  const by = {};
  (invoices || []).forEach((i) => {
    const m = String(i.invoice_date || i.created_at || '').slice(0, 7);
    if (!m) return;
    const g = by[m] = by[m] || { m, value: 0, n: 0 };
    g.value += i.total || 0; g.n += 1;
  });
  return Object.values(by).sort((a, b) => b.m.localeCompare(a.m))
    .map((g) => ({ name: monthLabel(g.m), value: g.value, sub: `${g.n} invoice${g.n === 1 ? '' : 's'}`, act: "go('purchases')" }));
}
/* Vendors in the same shape as the other two, so one drawer reads like the next. */
function vendorBarRows(rows) {
  return rows.map((r) => ({
    name: r.name, value: r.purchases + r.costs,
    sub: `${r.invoices ? `🧾 ${money(r.purchases)} · ${r.invoices} invoice${r.invoices === 1 ? '' : 's'}` : 'no invoices'}${r.costs ? ` · 🏠 ${money(r.costs)} studio costs` : ''}`,
    act: r.id ? `openVendorReport(${r.id})` : "go('vendors')",
  }));
}
/* A list drawn as a bar each, so one glance says which takes the most. */
function spendBars(rows, limit, moreAct, moreLabel, emptyText) {
  const max = rows.reduce((a, r) => Math.max(a, r.value), 0) || 1;
  const n = limit || 6;
  const show = rows.slice(0, n);
  return `<div class="spend-pane">
    ${show.length ? show.map((r) => `<div class="sp-row"${r.act ? ` onclick="${r.act}"` : ''}>
      <div class="sp-top"><span class="sp-nm">${esc(r.name)}</span><span class="sp-v">${money(r.value)}</span></div>
      <div class="sp-bar"><i style="width:${Math.max(3, Math.round((r.value / max) * 100))}%"></i></div>
      ${r.sub ? `<div class="sp-sub">${r.sub}</div>` : ''}
    </div>`).join('') : `<div class="hint" style="padding:4px 2px">${esc(emptyText || 'Nothing yet.')}</div>`}
    ${rows.length > n ? `<div class="sp-more" onclick="${moreAct}">＋ ${rows.length - n} more · ${esc(moreLabel)} ›</div>` : ''}
  </div>`;
}

/* The spending rows open where they stand. Tapping one drops its own breakdown
   under it rather than throwing away the dashboard for another screen — and
   nothing is spread out until it is asked for. What is open is remembered, so a
   drawer left open is still open when the screen is drawn again. */
function spendAccordion(sections) {
  const open = window._spendOpen || (window._spendOpen = {});
  return `<div class="nav-list flush">${sections.map((s, i) => `
    <div class="acc${open[s.key] ? ' open' : ''}" data-k="${s.key}" style="${tintVars(s.page)}">
      <div class="nav-row" style="${tintVars(s.page)};--d:${(0.05 + i * 0.055).toFixed(3)}s" onclick="toggleSpend('${s.key}')">
        <span class="rail"></span>
        <span class="ic">${s.icon}</span>
        <span class="txt"><span class="nm">${esc(s.label)}</span><span class="meta">${s.meta || ''}</span></span>
        <span class="chev acc-chev">›</span>
      </div>
      <div class="acc-panel">
        ${s.panel}
        <div class="acc-open" onclick="go('${s.page}')">Open ${esc(s.label.toLowerCase())} ›</div>
      </div>
    </div>`).join('')}</div>`;
}
window.toggleSpend = (k) => {
  const el = document.querySelector(`.acc[data-k="${k}"]`);
  if (!el) return;
  window._spendOpen = window._spendOpen || {};
  window._spendOpen[k] = el.classList.toggle('open');
};

/* ============ THE BOOKS ============
   Money in, money out, what is left — set out the way a statement is, so the
   net profit is not a number to be taken on trust but the end of a sum you can
   follow line by line.

   A month is counted on the money that MOVED: payments that came in that month,
   invoices and costs dated to it. That is the only basis the records can carry
   honestly — a dress is not earned on any one day — so all time carries a second
   reading beside it: what everything is worth once what is owed comes in. The
   two answer different questions, and are never added together. */
const booksPct = (x) => (x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0).replace(/\.0$/, '') + '%';
function booksPeriod(books) {
  const key = window._booksMonth === undefined ? '' : window._booksMonth; // '' = all time
  return { key, b: (key && books.by[key]) ? books.by[key] : books.all, when: key ? monthLabel(key) : 'All time' };
}
/* The headline and the period it is for. Everything below it — each house's own
   slice, and the sum at the bottom — is counted for whichever period is chosen. */
function booksTop(books) {
  const { key, b } = booksPeriod(books);
  const chips = ['', ...books.months.slice(0, 11)];
  return `<div class="books">
    <div class="bk-net ${b.net >= 0 ? 'ok' : 'bad'}">
      <div class="bk-net-k">${b.net >= 0 ? 'Profit' : 'Loss'} · ${key ? esc(monthLabel(key)) : 'all time'}</div>
      <div class="bk-net-v" data-count="${Math.abs(b.net)}" data-fmt="money">${money(0)}</div>
      <div class="bk-net-m">${b.income ? `${moneyText(b.income)} came in · ${moneyText(b.cost)} went out` : 'No money came in this period'}</div>
    </div>
    <div class="filters wrap bk-chips">
      ${chips.map((k) => `<span class="chip ${key === k ? 'active' : ''}" onclick="setBooksMonth('${k}')">${k ? monthLabel(k) : 'All time'}</span>`).join('')}
    </div>
  </div>`;
}
/* The sum itself, in the plainest words there are: money in, money out, what is
   left. Nothing here is a term of art — anybody who can add can check it. */
function booksSum(books) {
  const { key, b } = booksPeriod(books);
  const w = books.worth;
  const when = key ? monthLabel(key) : 'All time';
  const head = (label, v, cls) => `<div class="bk-head-line ${cls || ''}">
    <span class="bk-k">${esc(label)}</span><span class="bk-v">${money(v)}</span></div>`;
  const sub = (ic, label, v) => `<div class="bk-sub-line">
    <span class="bk-ic">${ic}</span><span class="bk-k">${esc(label)}</span>
    <span class="bk-v">${money(v)}</span></div>`;
  return `<div class="books bk-sheet-card">
    <div class="bk-ttl">${esc(when)}</div>
    ${head('Money in', b.income, 'in')}
    ${sub('👗', 'From the dresses', b.dresses)}
    ${sub('🎓', 'From the academy', b.courses)}
    ${head('Money out', b.cost, 'out')}
    ${sub('🧾', 'Materials for the dresses', b.materials)}
    ${sub('🏠', 'The studio: rent, bills, wages', b.studio)}
    <div class="bk-line net ${b.net >= 0 ? 'ok' : 'bad'}">
      <span class="bk-k">${b.net >= 0 ? 'Profit' : 'Loss'}<i>money in, less money out</i></span>
      <span class="bk-v">${money(Math.abs(b.net))}</span></div>
    ${!key ? `<div class="bk-owed">
      <div class="bk-owed-t">Money people still owe us — not counted above, because it has not come in</div>
      <div class="bk-owed-r"><span>👗 Owed on dresses</span><b>${money(w.dueDresses)}</b></div>
      <div class="bk-owed-r"><span>🎓 Owed on courses</span><b>${money(w.dueCourses)}</b></div>
      <div class="bk-owed-r tot"><span>Profit once it is all paid</span><b class="${w.net >= 0 ? 'ok' : 'bad'}">${money(w.net)}</b></div>
    </div>` : `<div class="bk-foot">${esc(monthLabel(key))} counts only what moved that month — the money that came in, and the money that went out.</div>`}
  </div>`;
}
window.setBooksMonth = (k) => { window._booksMonth = k; go('home'); };

PAGES.home_admin = async (c) => {
  const [sheet, rounds, dresses, reminders, users, homeworks, quizzes, videos, invoices, expenses, books] = await Promise.all([
    GET('/api/finance/sheet'), GET('/api/rounds'), GET('/api/dresses'), GET('/api/reminders'), GET('/api/users'),
    GET('/api/homeworks'), GET('/api/quizzes'), GET('/api/videos'),
    GET('/api/purchases'), GET('/api/expenses'), GET('/api/books'),
  ]);
  const dueSoon = reminders.filter((r) => !r.done).length;
  const dTotal = dresses.reduce((a, x) => a + (x.price || 0), 0);
  const dPaid = dresses.reduce((a, x) => a + (x.paid || 0), 0);
  const dRem = dresses.reduce((a, x) => a + (x.remaining || 0), 0);
  const dMat = dresses.reduce((a, x) => a + (x.material_cost || 0), 0);
  const dMargin = dTotal - dMat; // what the dresses leave once their materials are paid for
  const dOpen = dresses.filter((x) => (x.status || 'open') !== 'done').length;
  const clients = users.filter((u) => u.role === 'customer').length;
  // Money out: material invoices on one side, the studio's own running costs on the other
  const pTotal = invoices.reduce((a, x) => a + (x.total || 0), 0);
  const eTotal = expenses.reduce((a, x) => a + (x.amount || 0), 0);
  const spendRows = vendorSpendRows(invoices, expenses);
  const { b: bk, when: bkWhen } = booksPeriod(books);
  c.innerHTML = luxBackdrop() + dressWatermark() + '<div class="home-lux">' + title('Welcome, Dalia', '') +
    booksTop(books) + `
    ${brandGroup({
      name: 'Daliessa', kind: 'Dresses · Couture', collapse: 'dresses',
      c1: '#c2185b', c2: '#d9a45f', glow: '194,24,91',
      summary: `${dOpen} dress${dOpen === 1 ? '' : 'es'} in progress · ${clients} client${clients === 1 ? '' : 's'}`,
      plWhen: bkWhen,
      pl: [
        ['Money in', bk.dresses],
        ['Materials', bk.materials, 'out'],
        ['Profit', bk.dresses - bk.materials, 'tot'],
      ],
      rows: [
        ['dresses', '👗', 'Dresses', `${big(dOpen)} in progress · ${big(dresses.length)} total`],
        ['dressmoney', '💰', 'Dress money', dRem ? `${big(moneyText(dRem))} still due` : `${big(moneyText(dPaid))} collected`, "go('dresses')"],
        ['dressmargin', '📈', 'Dress profit', `${big(moneyText(dMargin))} · ${big(dTotal ? Math.round((dMargin / dTotal) * 100) + '%' : '—')} of the price`, "go('dressprofit')"],
      ],
      figuresGo: "go('dresses')",
      figures: [
        { value: dPaid, label: 'Deposits in', money: true, color: 'var(--ok)' },
        { value: dRem, label: 'Remaining', money: true, color: dRem ? 'var(--bad)' : 'var(--ok)' },
        { value: dTotal, label: 'Total value', money: true },
        { value: dMat, label: 'Materials', money: true, color: 'var(--bad)' },
        { value: dMargin, label: 'Margin', money: true, color: dMargin >= 0 ? 'var(--ok)' : 'var(--bad)' },
      ],
    })}
    ${brandGroup({
      name: 'Dalia Bassel', kind: 'Academy', collapse: 'academy',
      c1: '#6d28d9', c2: '#a24fd6', glow: '109,40,217',
      summary: `${sheet.totals.count} students · ${rounds.length} round${rounds.length === 1 ? '' : 's'} · ${homeworks.length} task${homeworks.length === 1 ? '' : 's'}`,
      plWhen: bkWhen,
      pl: [
        ['Money in', bk.courses, 'tot'],
      ],
      rows: [
        ['students', '👩‍🎓', 'Students', `${big(sheet.totals.count)} enrolled`],
        ['rounds', '🗓', 'Rounds & groups', `${big(rounds.length)} round${rounds.length === 1 ? '' : 's'}`],
        ['courses', '🎬', 'Courses', `${big(videos.length)} video${videos.length === 1 ? '' : 's'}`],
        ['homework', '✎', 'Tasks', `${big(homeworks.length)} pattern${homeworks.length === 1 ? '' : 's'} set`],
        ['quizzes', '📝', 'Quizzes', `${big(quizzes.length)} quiz${quizzes.length === 1 ? '' : 'zes'}`],
        ['finance', '💳', 'Course money', sheet.totals.remaining ? `${big(moneyText(sheet.totals.remaining))} still due` : `${big(moneyText(sheet.totals.paid))} collected`],
      ],
      figuresGo: "go('finance')",
      figures: [
        { value: sheet.totals.paid, label: 'Collected', money: true, color: 'var(--ok)' },
        { value: sheet.totals.remaining, label: 'Still due', money: true, color: sheet.totals.remaining ? 'var(--bad)' : 'var(--ok)' },
        { value: sheet.totals.total_fee, label: 'Course fees', money: true },
      ],
    })}
    ${brandGroup({
      name: 'The studio', kind: 'What it costs to run', collapse: 'spending',
      c1: '#0f766e', c2: '#14b8a6', glow: '15,118,110',
      summary: `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} · ${expenses.length} studio cost${expenses.length === 1 ? '' : 's'} on record`,
      plWhen: bkWhen,
      // Materials are shown here too, but marked as already counted against the
      // dresses — the same money in two places reads like twice the money
      // otherwise, and the sum at the bottom only takes it off once.
      pl: [
        ['Rent, bills, wages', bk.studio, 'out'],
        ['Materials · already counted on the dresses', bk.materials, 'out note'],
        ['Money out, all of it', bk.cost, 'tot out'],
      ],
      content: spendAccordion([
        { key: 'purchases', page: 'purchases', icon: '🧾', label: 'Purchases',
          meta: `${big(moneyText(pTotal))} · ${big(invoices.length)} invoice${invoices.length === 1 ? '' : 's'}`,
          panel: spendBars(purchaseMonthRows(invoices), 6, "go('purchases')", 'see every invoice', 'Nothing bought yet.') },
        { key: 'expenses', page: 'expenses', icon: '🏠', label: 'Studio costs',
          meta: `${big(moneyText(eTotal))} · ${big(expenses.length)} entr${expenses.length === 1 ? 'y' : 'ies'}`,
          panel: spendBars(expenseTypeRows(expenses), 8, "go('expenses')", 'see every cost', 'Nothing spent on the studio yet.') },
        { key: 'vendors', page: 'vendors', icon: '🏬', label: 'Vendors',
          meta: `${big(spendRows.length)} shop${spendRows.length === 1 ? '' : 's'} supplied us`,
          panel: spendBars(vendorBarRows(spendRows), 6, "go('vendors')", 'see every vendor', 'Nobody has supplied us yet.') },
      ]),
      figuresGo: "go('purchases')",
      figures: [
        { value: pTotal, label: 'Purchases', money: true, color: 'var(--bad)' },
        { value: eTotal, label: 'Studio costs', money: true, color: 'var(--bad)' },
        { value: pTotal + eTotal, label: 'Total out', money: true },
      ],
    })}
    ${booksSum(books)}
    ${dueSoon ? `<div class="card"><div class="sec-title">Payment reminders (${dueSoon})</div>${
      reminders.filter((r) => !r.done).slice(0, 6).map((r) => `<div class="item"><div class="av">◷</div>
        <div class="main"><div class="nm">${esc(r.user_name)}</div><div class="sub">${dt(r.due_date)} · ${money(r.amount)} ${r.note ? '· ' + esc(r.note) : ''}</div></div>
        <button class="btn sm ghost" onclick="markReminder(${r.id})">Done</button></div>`).join('')}</div>` : ''}
    </div>`;
  runCounters(c);
};
window.markReminder = async (id) => { await PUT('/api/reminders/' + id, { done: 1 }); toast('Done'); go('home'); };

/* ============ MEMBERS (everyone who registered) ============ */
PAGES.members = async (c) => {
  const users = await GET('/api/users');
  window._members = users;
  const roles = ['all', 'admin', 'manager', 'trainee', 'customer', 'staff', 'visitor'];
  const lbl = { all: 'All', admin: 'Admins', manager: 'Managers', trainee: 'Students', customer: 'Clients', staff: 'Staff', visitor: 'Visitors' };
  const f = window._memF || 'all';
  const list = users.filter((u) => f === 'all' || u.role === f);
  c.innerHTML = title('Members', '') +
    `<div class="grid g2" style="margin-bottom:8px">
      <div class="stat"><div class="n">${users.length}</div><div class="l">Registered</div></div>
      <div class="stat"><div class="n">${users.filter((u) => u.role === 'trainee').length}</div><div class="l">Students</div></div>
    </div>
    <div class="filters wrap">${roles.map((r) => `<span class="chip ${f === r ? 'active' : ''}" onclick="memFilter('${r}')">${lbl[r]} (${r === 'all' ? users.length : users.filter((u) => u.role === r).length})</span>`).join('')}</div>
    <div class="card">${list.length ? list.map((u) => `<div class="item">
      <div class="av">${esc(initials(u.name))}</div>
      <div class="main"><div class="nm">${esc(u.name)}</div>
        <div class="sub">${u.job_title ? esc(u.job_title) + ' · ' : ''}${u.email ? esc(u.email) : 'no email'} · joined ${dt(u.created_at)}</div></div>
      <select onchange="setRole(${u.id},this.value)" style="width:auto;padding:6px 8px;font-size:12px" ${u.role === 'admin' ? 'disabled' : ''}>
        ${['visitor', 'trainee', 'customer', 'staff', 'manager', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${lbl[r] || r}</option>`).join('')}
      </select></div>`).join('') : empty('No members')}</div>`;
};
window.memFilter = (r) => { window._memF = r; go('members'); };
window.openMembers = (r) => { window._memF = r; go('members'); };
window.setRole = async (id, role) => { await PUT('/api/users/' + id, { role }); toast('Permission updated'); go('members'); };

/* ============ STUDENTS ============ */
PAGES.students = async (c) => {
  const [users, rounds, groups] = await Promise.all([GET('/api/users?role=trainee'), GET('/api/rounds'), GET('/api/groups')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const gMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  window._students = { users, rounds, groups };
  const filter = window._stF || 'all';
  const list = users.filter((u) => filter === 'all' || u.round_id == filter);
  const canEditStudents = ['admin', 'manager'].includes(state.user.role); // staff: view-only
  c.innerHTML = pageHead('Students') +
    `${canEditStudents ? '<button class="btn" onclick="editStudent()">＋ Add student</button>' : ''}
     <div class="filters" style="margin-top:12px">
       <span class="chip ${filter === 'all' ? 'active' : ''}" onclick="stFilter('all')">All (${users.length})</span>
       ${rounds.map((r) => `<span class="chip ${filter == r.id ? 'active' : ''}" onclick="stFilter(${r.id})">${esc(r.name)}</span>`).join('')}
     </div>
     <input placeholder="🔍 Search student by name" value="${esc(window._stSearch || '')}" oninput="window._stSearch=this.value; liveSearch(this.value,'#studentsList')" style="width:100%;padding:9px 12px;margin:12px 0 8px" />
     <div class="card" id="studentsList">${list.length ? list.map((u) => `
       <div class="item" data-name="${esc((u.name || '').toLowerCase())}" style="cursor:pointer" onclick="viewStudent(${u.id})">
         <div class="av">${esc(initials(u.name))}</div>
         <div class="main"><div class="nm">${esc(u.name)}</div>
           <div class="sub">${u.governorate ? esc(u.governorate) + ' · ' : ''}${u.phone ? esc(u.phone) + ' · ' : ''}${rMap[u.round_id] ? esc(rMap[u.round_id]) : 'No round'}${gMap[u.group_id] ? ' · ' + esc(gMap[u.group_id]) : ''}</div></div>
         <span class="muted" style="font-size:20px">›</span>
       </div>`).join('') : empty('No students yet')}</div>`;
  if (window._stSearch) liveSearch(window._stSearch, '#studentsList');
};
window.viewStudent = async (id) => {
  const { rounds, groups } = window._students;
  const u = window._students.users.find((x) => x.id === id);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const gMap = Object.fromEntries(groups.map((g) => [g.id, g.name + (g.day ? ' · ' + dayEn(g.day) : '') + (g.time_slot ? ' · ' + g.time_slot : '')]));
  const canSeeMoney = ['admin', 'manager'].includes(state.user.role); // course money: admin + manager
  const canEdit = ['admin', 'manager', 'staff'].includes(state.user.role); // staff may edit contact info
  const pays = canSeeMoney ? await GET('/api/payments?user_id=' + id) : [];
  const fin = canSeeMoney ? ((await GET('/api/finance/sheet')).rows.find((r) => r.id === id) || { total_fee: 0, paid: 0, remaining: 0 }) : null;
  modal(`
    <div style="text-align:center;margin-bottom:6px">
      <div class="av" style="width:64px;height:64px;font-size:22px;margin:0 auto 8px">${esc(initials(u.name))}</div>
      <div class="serif" style="font-size:22px;font-weight:700">${esc(u.name)}</div>
      <div class="muted" style="font-size:13px">${rMap[u.round_id] || 'No round'}${gMap[u.group_id] ? ' · ' + esc(gMap[u.group_id]) : ''}</div>
    </div>
    ${canSeeMoney ? `<div class="grid g3" style="margin:12px 0">
      <div class="stat"><div class="n">${money(fin.total_fee)}</div><div class="l">Total</div></div>
      <div class="stat"><div class="n" style="color:var(--ok)">${money(fin.paid)}</div><div class="l">Paid</div></div>
      <div class="stat"><div class="n" style="color:${fin.remaining ? 'var(--bad)' : 'var(--ok)'}">${money(fin.remaining)}</div><div class="l">Remaining</div></div>
    </div>` : ''}
    <div class="card" style="box-shadow:none;margin:12px 0 12px">
      <div class="item"><div class="main"><div class="sub">Phone</div><div class="nm">${u.phone ? esc(u.phone) : '—'}</div></div></div>
      <div class="item"><div class="main"><div class="sub">Governorate</div><div class="nm">${u.governorate ? esc(u.governorate) : '—'}</div></div></div>
      ${u.email ? `<div class="item"><div class="main"><div class="sub">Email (login)</div><div class="nm">${esc(u.email)}</div></div></div>` : ''}
    </div>
    ${canSeeMoney ? `<div class="sec-title">Payments (${pays.length})</div>
    <div class="card" style="box-shadow:none;margin:0">${pays.length ? pays.map((p) => `<div class="item">
      <div class="av">${p.image ? `<img class="thumb" style="width:42px;height:42px;aspect-ratio:1" src="${esc(mediaUrl(p.image))}" onclick="lightbox('${esc(mediaUrl(p.image))}')"/>` : '💵'}</div>
      <div class="main"><div class="nm">${money(p.amount)}</div><div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div></div>`).join('') : '<div class="hint">No payments yet</div>'}</div>` : ''}
    ${(canSeeMoney || canEdit) ? `<div class="row" style="margin-top:14px">
      ${canSeeMoney ? `<button class="btn ghost" onclick="closeModal();addPaymentFor(${id})">＋ Payment</button>` : ''}
      ${canEdit ? `<button class="btn sec" onclick="closeModal();editStudent(${id})">Edit</button>` : ''}
    </div>` : ''}`);
};
window.addPaymentFor = async (id) => {
  if (!window._fin || !window._fin.sheet) {
    const [users, sheet, payments] = await Promise.all([
      GET('/api/users?role=trainee'), GET('/api/finance/sheet'), GET('/api/payments')]);
    window._fin = { users, sheet, payments };
  }
  addPayment();
  // picking her here must prefill the amount just as choosing her in the list would
  setTimeout(() => { const s = $('select[name="user_id"]'); if (s) { s.value = id; s.dispatchEvent(new Event('change')); } }, 50);
};
window.stFilter = (f) => { window._stF = f; go('students'); };
window.editStudent = async (id) => {
  const canManageFull = ['admin', 'manager'].includes(state.user.role); // staff: contact only, no money/round/group
  const { rounds, groups } = window._students;
  const u = id ? window._students.users.find((x) => x.id === id) : {};
  const govField = { name: 'governorate', label: 'Governorate', type: 'select', value: u.governorate, options: [{ value: '', label: '—' }, ...EG_GOV.map((g) => ({ value: g, label: g }))] };
  if (!canManageFull) {
    // staff: edit contact info only
    formModal('Edit student', [
      { name: 'name', label: 'Name', required: true, value: u.name },
      { name: 'phone', label: 'Phone', value: u.phone },
      govField,
    ], async (d) => { await PUT('/api/users/' + id, d); toast('Saved'); go(state.page); });
    return;
  }
  let fee = 0;
  if (id) { try { const s = await GET('/api/finance/sheet'); fee = (s.rows.find((r) => r.id === id) || {}).total_fee || 0; } catch (e) {} }
  formModal(id ? 'Edit student' : 'New student', [
    { name: 'name', label: 'Name', required: true, value: u.name },
    { name: 'phone', label: 'Phone', value: u.phone },
    govField,
    { name: 'email', label: 'Email — she signs up with this one', type: 'email', value: u.email },
    { name: 'password', label: id ? 'Reset password (optional)' : 'Password (optional)', type: 'password', placeholder: id ? 'leave blank to keep current' : 'leave blank — she picks it when she signs up' },
    { name: 'round_id', label: 'Round', type: 'select', value: u.round_id, options: [{ value: '', label: '—' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'group_id', label: 'Group', type: 'select', value: u.group_id, options: [{ value: '', label: '—' }, ...groups.map((g) => ({ value: g.id, label: g.name + (g.day ? ' · ' + dayEn(g.day) : '') + (g.time_slot ? ' · ' + g.time_slot : '') }))] },
    { name: 'total_fee', label: 'Course fee (EGP)', type: 'number', value: fee },
  ], async (d) => {
    d.role = 'trainee';
    if (!d.password) delete d.password; // don't overwrite with a blank password on edit
    if (id) await PUT('/api/users/' + id, d); else await POST('/api/users', d);
    toast('Saved'); go(state.page);
  });
  if (id) $('#fm').insertAdjacentHTML('beforeend', `<button type="button" class="btn danger" style="margin-top:8px" onclick="delStudent(${id})">Delete student</button>`);
};
window.delStudent = (id) => confirmDel('Delete this student and all their data?', async () => { await DEL('/api/users/' + id); closeModal(); toast('Deleted'); go(state.page === 'round' ? 'round' : 'students'); });

/* ============ FINANCE (sheet + payments + reminders) ============ */
PAGES.finance = async (c) => {
  if (!['admin', 'manager'].includes(state.user.role)) { c.innerHTML = empty('Managers only', '💳'); return; }
  const [sheet, payments, reminders, users] = await Promise.all([
    GET('/api/finance/sheet'), GET('/api/payments'), GET('/api/reminders'), GET('/api/users?role=trainee'),
  ]);
  window._fin = { users, sheet, payments };
  const tab = window._finTab || 'sheet';
  const tabs = [['sheet', 'Sheet'], ['pay', 'Payments'], ['rem', 'Reminders']];
  let inner = '';
  if (tab === 'sheet') {
    const over = sheet.rows.filter((r) => r.over > 0);
    inner = `${over.length ? `<div class="card warn-card">
        <div class="wc-h">⚠ ${over.length} student${over.length === 1 ? '' : 's'} paid more than the course fee</div>
        <div class="wc-s">Almost always an amount typed wrong. Open the Payments tab and delete the wrong entry, or raise her course fee if it really did go up.</div>
        <div class="wc-list">${over.map((r) => `<div class="wc-row"><span>${esc(r.name)}</span><b>+${money(r.over)}</b></div>`).join('')}</div>
      </div>` : ''}
      <div class="card"><div class="tbl-wrap"><table class="sheet-tbl">
      <thead><tr><th>Name</th><th>Total</th><th>Paid</th><th>Remaining</th></tr></thead>
      <tbody>${sheet.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${money(r.total_fee)}</td>
        <td style="color:var(--${r.over ? 'bad' : 'ok'})">${money(r.paid)}${r.over ? ` <span class="over-tag">+${money(r.over)}</span>` : ''}</td>
        <td style="color:${r.remaining ? 'var(--bad)' : 'var(--ok)'}">${money(r.remaining)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total (${sheet.totals.count})</td><td>${money(sheet.totals.total_fee)}</td><td>${money(sheet.totals.paid)}</td><td>${money(sheet.totals.remaining)}</td></tr></tfoot>
      </table></div></div>`;
  } else if (tab === 'pay') {
    const pf = window._payMethod || 'all';
    const kf = window._payKind || 'all'; // all | installment | deposit
    const byKind = kf === 'all' ? payments : payments.filter((p) => (kf === 'deposit' ? p.kind === 'deposit' : p.kind !== 'deposit'));
    const cashTotal = byKind.filter((p) => p.method === 'cash').reduce((a, p) => a + (p.amount || 0), 0);
    const transferTotal = byKind.filter((p) => p.method !== 'cash').reduce((a, p) => a + (p.amount || 0), 0);
    const shown = pf === 'all' ? byKind : byKind.filter((p) => (pf === 'cash' ? p.method === 'cash' : p.method !== 'cash'));
    const shownTotal = shown.reduce((a, p) => a + (p.amount || 0), 0);
    const kfLbl = kf === 'installment' ? 'Installments' : kf === 'deposit' ? 'Deposits' : '';
    inner = `<div class="grid g2" style="margin-bottom:10px">
        <div class="stat"><div class="n serif" style="color:var(--ok)">${money(cashTotal)}</div><div class="l">💵 Cash${kfLbl ? ' · ' + kfLbl : ''}</div></div>
        <div class="stat"><div class="n serif" style="color:var(--ok)">${money(transferTotal)}</div><div class="l">🏦 Transfer${kfLbl ? ' · ' + kfLbl : ''}</div></div>
      </div>
      <div class="filters">
        <span class="chip ${kf === 'all' ? 'active' : ''}" onclick="payKind('all')">All types</span>
        <span class="chip ${kf === 'installment' ? 'active' : ''}" onclick="payKind('installment')">Installments</span>
        <span class="chip ${kf === 'deposit' ? 'active' : ''}" onclick="payKind('deposit')">Deposits</span>
      </div>
      <div class="filters">
        <span class="chip ${pf === 'all' ? 'active' : ''}" onclick="payFilter('all')">All · ${money(cashTotal + transferTotal)}</span>
        <span class="chip ${pf === 'cash' ? 'active' : ''}" onclick="payFilter('cash')">💵 Cash</span>
        <span class="chip ${pf === 'transfer' ? 'active' : ''}" onclick="payFilter('transfer')">🏦 Transfer</span>
      </div>
      <button class="btn" onclick="addPayment()">＋ Record payment</button>
      <div class="hint" style="margin:8px 2px">${shown.length} payment${shown.length === 1 ? '' : 's'}</div>
      <div class="card">${shown.length ? shown.map((p) => `
      <div class="item">
        <div class="av">${p.image ? `<img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="${esc(mediaUrl(p.image))}" onclick="lightbox('${esc(mediaUrl(p.image))}','Transfer ${esc(p.user_name || '')}')"/>` : (p.method === 'cash' ? '💵' : '🏦')}</div>
        <div class="main"><div class="nm">${esc(p.user_name || '')} · ${money(p.amount)}</div>
          <div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${p.method === 'cash' ? '💵 Cash' : '🏦 Transfer'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
        <button class="btn-icon" onclick="editPayment(${p.id})" aria-label="Edit payment">✎</button>
        <button class="btn-icon" onclick="delPayment(${p.id})" aria-label="Delete payment">🗑</button>
      </div>`).join('') : empty('No payments match this filter')}</div>
      <div class="item" style="background:var(--soft);border-radius:12px;padding:12px 14px;margin-top:10px;border:none">
        <div class="main"><div class="nm">TOTAL${kfLbl ? ' · ' + kfLbl : ''}${pf === 'cash' ? ' · 💵 Cash' : pf === 'transfer' ? ' · 🏦 Transfer' : ''}</div><div class="sub">${shown.length} payment${shown.length === 1 ? '' : 's'}</div></div>
        <div class="serif" style="font-size:20px;font-weight:800;color:var(--ok)">${money(shownTotal)}</div>
      </div>`;
  } else {
    inner = `<button class="btn" onclick="addReminder()">＋ Payment reminder</button>
      <div class="card" style="margin-top:12px">${reminders.length ? reminders.map((r) => `
      <div class="item"><div class="av">${r.done ? '✓' : '◷'}</div>
        <div class="main"><div class="nm">${esc(r.user_name)}</div>
          <div class="sub">${dt(r.due_date)} · ${money(r.amount)}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
        ${r.done ? '<span class="badge ok">Done</span>' : `<button class="btn sm ghost" onclick="markReminder2(${r.id})">Done</button>`}
        <button class="btn-icon" onclick="delReminder(${r.id})">🗑</button></div>`).join('') : empty('No reminders')}</div>`;
  }
  c.innerHTML = pageHead('Payments') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="finTab('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.finTab = (t) => { window._finTab = t; go('finance'); };
window.payFilter = (m) => { window._payMethod = m; go('finance'); };
window.payKind = (k) => { window._payKind = k; go('finance'); };
/* What each student still owes, so the form can say it and stop an overpayment early. */
function owedMap() {
  const m = {};
  ((window._fin.sheet || {}).rows || []).forEach((r) => { m[r.id] = r; });
  return m;
}
/* What she has paid apart from the payment being edited (none, when adding a new one). */
function paidByOthers(row, editing) {
  const mine = editing && Number(editing.user_id) === Number(row.id) ? (editing.amount || 0) : 0;
  return Math.max(0, (row.paid || 0) - mine);
}
function studentPayLabel(u, owed, editing) {
  const r = owed[u.id];
  if (!r || !r.total_fee) return u.name;
  const others = paidByOthers(r, editing);
  const left = r.total_fee - others;
  if (left < 0) return `${u.name} · overpaid by ${money(-left)}`;
  return left ? `${u.name} · ${money(left)} left` : `${u.name} · paid up`;
}
/* One rule for both forms: a payment may never carry her past her course fee. */
function guardPayment(d, owed, editing) {
  const r = owed[d.user_id];
  if (!r || !r.total_fee) return;
  const left = r.total_fee - paidByOthers(r, editing);
  if (Number(d.amount) <= left) return;
  throw new Error(left > 0
    ? `That is more than she still owes — only ${money(left)} is left on her ${money(r.total_fee)} course.`
    : `Her course fee of ${money(r.total_fee)} is already covered.`);
}
window.addPayment = () => {
  const owed = owedMap();
  formModal('Record payment', [
  { name: 'user_id', label: 'Student', type: 'select', required: true, options: window._fin.users.map((u) => ({ value: u.id, label: studentPayLabel(u, owed) })) },
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'kind', label: 'Type', type: 'select', options: [{ value: 'deposit', label: 'Deposit' }, { value: 'installment', label: 'Installment' }] },
  { name: 'method', label: 'Payment method', type: 'select', value: 'transfer', options: [{ value: 'transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }] },
  { name: 'paid_at', label: 'Date', type: 'date', value: today() },
  { name: 'note', label: 'Note', value: '' },
  { name: 'image', label: 'Transfer screenshot (if bank transfer)', type: 'image' },
  ], async (d) => {
    guardPayment(d, owed); // caught here as well as on the server, so she is told before it is sent
    await POST('/api/payments', d); toast('Recorded'); go(state.page);
  }, { perStep: 8 });
  prefillOwed(owed);
};
/* the amount opens on whatever is still owed */
function prefillOwed(owed, editing) {
  const sel = $('select[name="user_id"]'), amt = $('input[name="amount"]');
  if (!sel || !amt) return;
  const fill = () => {
    const r = owed[sel.value]; if (!r || !r.total_fee) return;
    const left = r.total_fee - paidByOthers(r, editing);
    if (left > 0) amt.value = left;
  };
  sel.onchange = fill;
  if (!editing) fill(); // an edit opens on the figure that was actually recorded
}

window.editPayment = (id) => {
  const p = (window._fin.payments || []).find((x) => x.id === id);
  if (!p) { toast('That payment is no longer here'); return; }
  const owed = owedMap();
  formModal('Edit payment', [
    { name: 'user_id', label: 'Student', type: 'select', required: true, value: p.user_id, options: window._fin.users.map((u) => ({ value: u.id, label: studentPayLabel(u, owed, p) })) },
    { name: 'amount', label: 'Amount', type: 'number', required: true, value: p.amount },
    { name: 'kind', label: 'Type', type: 'select', value: p.kind, options: [{ value: 'deposit', label: 'Deposit' }, { value: 'installment', label: 'Installment' }] },
    { name: 'method', label: 'Payment method', type: 'select', value: p.method, options: [{ value: 'transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }] },
    { name: 'paid_at', label: 'Date', type: 'date', value: dt(p.paid_at) },
    { name: 'note', label: 'Note', value: p.note || '' },
    { name: 'image', label: 'Transfer screenshot (if bank transfer)', type: 'image', value: p.image || '' },
  ], async (d) => {
    guardPayment(d, owed, p);
    await PUT('/api/payments/' + id, d); toast('Updated'); go(state.page);
  }, { submitLabel: 'Save changes', perStep: 8 });
  prefillOwed(owed, p);
};
window.delPayment = (id) => confirmDel('Delete this payment?', async () => { await DEL('/api/payments/' + id); toast('Deleted'); go('finance'); });
window.addReminder = () => formModal('Payment reminder', [
  { name: 'user_id', label: 'Student', type: 'select', required: true, options: window._fin.users.map((u) => ({ value: u.id, label: u.name })) },
  { name: 'due_date', label: 'Due date', type: 'date', required: true, value: today() },
  { name: 'amount', label: 'Expected amount', type: 'number' },
  { name: 'note', label: 'Note', value: '' },
], async (d) => { await POST('/api/reminders', d); toast('Added'); go('finance'); });
window.markReminder2 = async (id) => { await PUT('/api/reminders/' + id, { done: 1 }); go('finance'); };
window.delReminder = (id) => confirmDel('Delete reminder?', async () => { await DEL('/api/reminders/' + id); go('finance'); });

/* ============ ROUNDS & GROUPS ============ */
PAGES.rounds = async (c) => {
  const [rounds, groups, users] = await Promise.all([GET('/api/rounds'), GET('/api/groups'), GET('/api/users?role=trainee')]);
  const cnt = (rid) => users.filter((u) => u.round_id === rid).length;
  const gcnt = (gid) => users.filter((u) => u.group_id === gid).length;
  c.innerHTML = pageHead('Rounds & Groups') +
    `<div class="row"><button class="btn" onclick="addRound()">＋ Round</button><button class="btn sec" onclick="addGroup()">＋ Group</button></div>
    ${rounds.length ? rounds.map((r) => `<div class="card">
      <div class="item"><div class="av">${r.number || '#'}</div>
        <div class="main" style="cursor:pointer" onclick="openRound(${r.id})"><div class="nm">${esc(r.name)} <span class="badge ${r.kind === 'online' ? '' : 'ok'}">${r.kind === 'online' ? 'Online' : 'In‑person'}</span> <span class="badge">${cnt(r.id)} students</span></div>
          <div class="sub">${r.start_date ? 'Starts ' + dt(r.start_date) : ''} ${r.description ? '· ' + esc(r.description) : ''} · tap to open ›</div></div>
        <button class="btn-icon" onclick="delRound(${r.id})">🗑</button></div>
      ${groups.filter((g) => g.round_id === r.id).map((g) => `<div class="item" style="padding-inline-start:14px">
        <div class="av" style="background:#fff">◦</div>
        <div class="main" style="cursor:pointer" onclick="openGroup(${g.id})"><div class="nm">${esc(g.name)}</div>
          <div class="sub">${g.day ? dayEn(g.day) : ''} ${g.time_slot ? '· ' + g.time_slot : ''} · ${gcnt(g.id)}/${g.capacity || '∞'} · tap to add girls ›</div></div>
        <button class="btn-icon" onclick="delGroup(${g.id})">🗑</button></div>`).join('')}
    </div>`).join('') : empty('No rounds yet — start by adding a round')}`;
  window._rounds = rounds;
};
window.addRound = (kind) => formModal('New round', [
  { name: 'number', label: 'Round number', type: 'number' },
  { name: 'name', label: 'Name', required: true, placeholder: 'August Round' },
  // opened from a Courses tab the kind is already decided, so it stops being a question
  (kind === 'online' || kind === 'onsite')
    ? { name: 'kind', type: 'hidden', value: kind }
    : { name: 'kind', label: 'Course type', type: 'select', value: 'onsite', options: [{ value: 'online', label: 'Online Course' }, { value: 'onsite', label: 'In‑person' }] },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'description', label: 'Description', type: 'textarea' },
], async (d) => { await POST('/api/rounds', d); toast('Added'); go(state.page); }, { perStep: 6 });
window.delRound = (id) => confirmDel('Delete round?', async () => { await DEL('/api/rounds/' + id); go('rounds'); });
window.addGroup = async (presetRound) => {
  const rounds = window._rounds || await GET('/api/rounds');
  formModal('New group', [
    { name: 'round_id', label: 'Round', type: 'select', value: presetRound || '', options: rounds.map((r) => ({ value: r.id, label: r.name })) },
    { name: 'name', label: 'Group name', required: true, placeholder: 'Group 1' },
    { name: 'day', label: 'Day', type: 'select', options: [{ value: 'friday', label: 'Friday' }, { value: 'saturday', label: 'Saturday' }] },
    { name: 'time_slot', label: 'Time', type: 'select', options: [{ value: '11-3', label: '11 AM – 3 PM' }, { value: '5-9', label: '5 PM – 9 PM' }] },
    { name: 'capacity', label: 'Capacity', type: 'number', value: 6 },
  ], async (d) => { await POST('/api/groups', d); toast('Added'); go(state.page); });
};
window.delGroup = (id) => confirmDel('Delete group?', async () => { await DEL('/api/groups/' + id); go(state.page); });

/* open a group -> manage which students of the round are in it */
window.openGroup = async (gid) => {
  const canSeeMoney = ['admin', 'manager'].includes(state.user.role); // staff: no money, view-only
  const [groups, users, sheet] = await Promise.all([GET('/api/groups'), GET('/api/users?role=trainee'), canSeeMoney ? GET('/api/finance/sheet') : Promise.resolve({ rows: [] })]);
  const g = groups.find((x) => x.id === gid);
  if (!g) return;
  const fin = {}; (sheet.rows || []).forEach((r) => { fin[r.id] = r; });
  const roundStudents = users.filter((u) => u.round_id === g.round_id);
  const members = roundStudents.filter((u) => u.group_id === gid);
  const available = roundStudents.filter((u) => u.group_id !== gid);
  const gFee = members.reduce((a, u) => a + ((fin[u.id] || {}).total_fee || 0), 0);
  const gPaid = members.reduce((a, u) => a + ((fin[u.id] || {}).paid || 0), 0);
  const gRem = members.reduce((a, u) => a + ((fin[u.id] || {}).remaining || 0), 0);
  modal(`<h3>${esc(g.name)}</h3>
    <div class="sub muted">${g.day ? dayEn(g.day) : ''} ${g.time_slot ? '· ' + g.time_slot : ''} · ${members.length}/${g.capacity || '∞'} students</div>
    <div class="sec-title">In this group</div>
    <div class="card" style="box-shadow:none;margin:0 0 12px">${members.length ? members.map((u) => { const f = fin[u.id] || { total_fee: 0, paid: 0, remaining: 0 }; return `<div class="item">
      <div class="av">${esc(initials(u.name))}</div>
      <div class="main"><div class="nm">${esc(u.name)}</div>
        ${canSeeMoney ? `<div class="sub">Paid <b style="color:var(--ok)">${money(f.paid)}</b> · Remaining <b style="color:${f.remaining ? 'var(--bad)' : 'var(--ok)'}">${money(f.remaining)}</b></div>` : `<div class="sub">${u.phone ? esc(u.phone) : ''}</div>`}</div>
      ${canSeeMoney ? `<button class="btn sm danger" onclick="setStudentGroup(${u.id},'',${gid})">Remove</button>` : ''}</div>`; }).join('') : '<div class="hint">No students yet</div>'}
      ${(canSeeMoney && members.length) ? `<div class="item" style="background:var(--soft);border-radius:10px;border:none;margin-top:6px">
        <div class="main"><div class="nm">Group total</div><div class="sub">Fees ${money(gFee)}</div></div>
        <div style="text-align:end;font-size:12px;font-weight:700">Paid <span style="color:var(--ok)">${money(gPaid)}</span><br>Remaining <span style="color:${gRem ? 'var(--bad)' : 'var(--ok)'}">${money(gRem)}</span></div></div>` : ''}</div>
    ${canSeeMoney ? `<div class="sec-title">Add students from this round</div>
    <div class="card" style="box-shadow:none;margin:0">${available.length ? available.map((u) => `<div class="item">
      <div class="av">${esc(initials(u.name))}</div><div class="main"><div class="nm">${esc(u.name)}</div><div class="sub">${u.group_id ? 'in another group' : 'no group'}</div></div>
      <button class="btn sm ghost" onclick="setStudentGroup(${u.id},${gid},${gid})">Add</button></div>`).join('') : '<div class="hint">All round students are already in this group</div>'}</div>` : ''}`);
};
window.setStudentGroup = async (uid, gid, reopenGid) => {
  await PUT('/api/users/' + uid, { group_id: gid });
  toast('Updated'); await openGroup(reopenGid);
  if (state.page === 'round' || state.page === 'rounds') go(state.page); // refresh counts behind the modal
};

/* ============ COURSES / VIDEOS ============ */
PAGES.courses = async (c) => {
  if (!['admin', 'manager', 'staff'].includes(state.user.role)) return PAGES.courses_trainee(c);
  const canManage = ['admin', 'manager'].includes(state.user.role);
  const [rounds, students] = await Promise.all([GET('/api/rounds'), GET('/api/users?role=trainee')]);
  window._rounds = rounds;
  const cnt = (rid) => students.filter((u) => u.round_id === rid).length;

  const kinds = [
    { key: 'online', icon: '💻', name: 'Online', full: 'Online course',
      c1: '#6d28d9', c2: '#a24fd6', glow: '109,40,217',
      blurb: 'Taught over video — she follows the round from wherever she is' },
    { key: 'onsite', icon: '🏛', name: 'In‑person', full: 'In‑person course',
      c1: '#0f766e', c2: '#5eead4', glow: '15,118,110',
      blurb: 'Taught at the studio — patterns, fittings and the machines' },
  ];
  const of = (k) => rounds.filter((r) => (r.kind || 'onsite') === k);
  const tab = kinds.some((k) => k.key === window._courseTab) ? window._courseTab : 'online';
  window._courseTab = tab;
  const k = kinds.find((x) => x.key === tab);
  const list = of(tab);
  const enrolled = list.reduce((a, r) => a + cnt(r.id), 0);

  c.innerHTML = luxBackdrop() + '<div class="home-lux">' + pageHead('Courses') +
    `${rounds.length ? `<div class="card" style="margin-bottom:14px">
      <div class="nm serif" style="font-size:17px">${rounds.length} round${rounds.length === 1 ? '' : 's'} in the academy</div>
      <div class="sub muted" style="margin-top:4px">${students.length ? `${students.length} student${students.length === 1 ? '' : 's'} on the books` : 'No students enrolled yet'}</div>
    </div>` : ''}
    <div class="cat-row two">
      ${kinds.map((x) => {
        const n = of(x.key).length;
        return `<button class="cat${x.key === tab ? ' on' : ''}" style="--c1:${x.c1};--c2:${x.c2};--glow:${x.glow}"
          onclick="courseTab('${x.key}')" aria-pressed="${x.key === tab}">
          <span class="cat-ic">${x.icon}</span>
          <span class="cat-n">${x.name}</span>
          <span class="cat-c">${n ? n + (n === 1 ? ' round' : ' rounds') : 'none yet'}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="cat-head">
      <div class="ch-name">${esc(k.full)}</div>
      <div class="ch-sub">${esc(k.blurb)}${enrolled ? ` · ${enrolled} student${enrolled === 1 ? '' : 's'}` : ''}</div>
    </div>
    ${canManage && list.length ? `<button class="btn" style="margin-bottom:14px" onclick="addRound('${tab}')">＋ New ${k.name.toLowerCase()} round</button>` : ''}
    ${list.length ? `<div class="card rnd-list" style="--c1:${k.c1};--c2:${k.c2};--glow:${k.glow}">${list.map((r) => `<div class="item rnd" onclick="openRound(${r.id})">
        <div class="rnd-no">${esc(String(r.number || '#'))}</div>
        <div class="main"><div class="nm">${esc(r.name)}</div>
          <div class="sub">${cnt(r.id)} student${cnt(r.id) === 1 ? '' : 's'}${r.start_date ? ' · starts ' + dt(r.start_date) : ''}${r.description ? ' · ' + esc(r.description) : ''}</div></div>
        <span class="muted" style="font-size:20px">›</span></div>`).join('')}</div>`
      : `<div class="card nothing">
          <div class="nt-ic" style="--c1:${k.c1};--c2:${k.c2};--glow:${k.glow}">${k.icon}</div>
          <div class="nt-h">No ${k.name.toLowerCase()} round yet</div>
          <div class="nt-s">${canManage ? 'Open one and the students you add to it will see their lessons, tasks and fees here.' : 'Nothing has been opened in this part of the academy yet.'}</div>
          ${canManage ? `<button class="btn" style="margin-top:14px" onclick="addRound('${tab}')">＋ Open the first one</button>` : ''}
        </div>`}
    </div>`;
};
window.courseTab = (t) => { window._courseTab = t; go('courses'); };
window.openRound = (id) => { window._roundId = id; window._roundTab = 'students'; go('round'); };

/* Staff course space: view + upload videos/photos per group (no money, no student management) */
PAGES.courses_staff = async (c) => {
  const [videos, rounds] = await Promise.all([GET('/api/videos'), GET('/api/rounds')]);
  window._rounds = rounds;
  const rf = window._staffCourseRound || 'all';
  const list = rf === 'all' ? videos : videos.filter((v) => String(v.round_id) === String(rf));
  const chips = `<span class="chip ${rf === 'all' ? 'active' : ''}" onclick="staffCourseRound('all')">All</span>${rounds.map((r) => `<span class="chip ${String(rf) === String(r.id) ? 'active' : ''}" onclick="staffCourseRound(${r.id})">${esc(r.name)}</span>`).join('')}`;
  c.innerHTML = pageHead('Courses') +
    `<button class="btn" onclick="addVideo('onsite','')">＋ Add video / photo</button>
     <div class="filters" style="margin-top:12px">${chips}</div>
     <div class="grid g2">${list.length ? list.map((v) => `<div class="card" style="margin:0">
        <div class="nm" style="font-weight:600">${esc(v.title)}</div>
        <div style="margin:4px 0"><span class="badge ${v.group_name ? '' : 'ok'}">${v.group_name ? '👥 ' + esc(v.group_name) : (v.round_name ? esc(v.round_name) : 'All rounds')}</span></div>
        ${v.description ? `<div style="font-size:13px;margin:6px 0">${esc(v.description)}</div>` : ''}
        ${videoEmbed(v)}<button class="btn danger sm" style="margin-top:8px" onclick="delVideoStaff(${v.id})">Delete</button></div>`).join('') : empty('No course media yet — add a video or photo', '🎬')}</div>`;
};
window.staffCourseRound = (r) => { window._staffCourseRound = r; go('courses'); };
window.delVideoStaff = (id) => confirmDel('Delete this item?', async () => { await DEL('/api/videos/' + id); go('courses'); });

/* ---- Round detail: students / groups / payments / videos / attendance / quizzes ---- */
PAGES.round = async (c) => {
  const id = window._roundId;
  if (!id) return go('courses');
  const canSeeMoney = ['admin', 'manager'].includes(state.user.role); // course money: admin + manager (NOT staff)
  const canManage = canSeeMoney; // add/edit students, groups, payments
  const [rounds, groups, students, videos, quizzes, sheet, attendance] = await Promise.all([
    GET('/api/rounds'), GET('/api/groups'), GET('/api/users?round_id=' + id), GET('/api/videos'),
    GET('/api/quizzes'), canSeeMoney ? GET('/api/finance/sheet') : Promise.resolve({ rows: [] }), GET('/api/attendance?round_id=' + id),
  ]);
  const round = rounds.find((r) => r.id === id) || { name: 'Round' };
  window._rounds = rounds;
  window._students = { users: students, rounds, groups };  // enable viewStudent / editStudent
  window._fin = { users: students };                       // enable addPaymentFor
  const gList = groups.filter((g) => g.round_id === id);
  const vList = videos.filter((v) => v.round_id === id);
  const qList = quizzes.filter((q) => q.round_id === id);
  const finRows = sheet.rows.filter((r) => r.round_id === id);
  const gcnt = (gid) => students.filter((u) => u.group_id === gid).length;
  const isAdmin = state.user.role === 'admin';
  let tab = window._roundTab || 'students';
  if (tab === 'pay' && !canSeeMoney) tab = 'students'; // no Payments tab for staff
  const tabs = [['students', 'Students'], ['groups', 'Groups'], ...(canSeeMoney ? [['pay', 'Payments']] : []), ['videos', 'Videos'], ['att', 'Attendance'], ['quiz', 'Quizzes']];
  let inner = '';
  if (tab === 'students') {
    const payMap = {}; finRows.forEach((r) => { payMap[r.id] = r; });
    const payStatus = (uid) => { const r = payMap[uid]; if (!r || !r.total_fee) return null; if (r.remaining <= 0) return { t: 'Paid', c: 'ok' }; if (r.paid > 0) return { t: 'Partial', c: 'warn' }; return { t: 'Unpaid', c: 'bad' }; };
    const govs = [...new Set(students.map((s) => s.governorate).filter(Boolean))].sort();
    const gf = window._roundGov || 'all';
    const pf = canSeeMoney ? (window._roundPay || 'all') : 'all';
    let list = students.slice();
    if (gf !== 'all') list = list.filter((s) => (s.governorate || '') === gf);
    if (pf !== 'all') list = list.filter((s) => { const p = payStatus(s.id); return p && p.t.toLowerCase() === pf; });
    if (window._roundSortGov) list.sort((a, b) => (a.governorate || 'zzzz').localeCompare(b.governorate || 'zzzz') || a.name.localeCompare(b.name));
    inner = `${canManage ? '<button class="btn" onclick="editStudent()">＋ Add student</button>' : ''}
      <div class="row" style="margin:10px 2px 4px;align-items:center;gap:8px">
        <span style="font-weight:700">${list.length} registered</span>
        <select onchange="setRoundGov(this.value)" style="width:auto;padding:6px 8px;font-size:12px;margin-inline-start:auto">
          <option value="all">All governorates</option>${govs.map((g) => `<option value="${esc(g)}" ${gf === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
        <button class="btn ${window._roundSortGov ? '' : 'ghost'} sm" onclick="toggleGovSort()">Sort by gov.</button></div>
      ${canSeeMoney ? `<div class="filters" style="margin:0 2px 6px">${[['all', 'All'], ['paid', 'Paid'], ['partial', 'Partial'], ['unpaid', 'Unpaid']].map(([k, l]) => `<span class="chip ${pf === k ? 'active' : ''}" onclick="setRoundPay('${k}')">${l}</span>`).join('')}</div>` : ''}
      <input placeholder="🔍 Search student by name" value="${esc(window._roundSearch || '')}" oninput="window._roundSearch=this.value; liveSearch(this.value,'#roundStudentsList')" style="width:100%;padding:9px 12px;margin:0 0 8px" />
      <div class="card" id="roundStudentsList">${list.length ? list.map((u) => { const p = payStatus(u.id); const pr = payMap[u.id]; return `<div class="item" data-name="${esc((u.name || '').toLowerCase())}" style="cursor:pointer" onclick="viewStudent(${u.id})">
        <div class="av">${esc(initials(u.name))}</div>
        <div class="main"><div class="nm">${esc(u.name)}${(canSeeMoney && p) ? ` <span class="badge ${p.c}">${p.t}</span>` : ''}</div>
          <div class="sub">${u.governorate ? esc(u.governorate) + ' · ' : ''}${u.phone ? esc(u.phone) : 'no phone'}</div></div>
        ${canSeeMoney ? (pr && pr.remaining > 0 ? `<div style="text-align:end;white-space:nowrap"><div style="color:var(--bad);font-weight:700;font-size:13px">${money(pr.remaining)}</div><div class="muted" style="font-size:10px">remaining</div></div>` : (pr && pr.total_fee ? `<div style="color:var(--ok);font-weight:700;font-size:13px;white-space:nowrap">✓ Paid</div>` : '')) : ''}
        <span class="muted" style="font-size:20px">›</span></div>`; }).join('') : empty('No students in this round')}</div>`;
  } else if (tab === 'groups') {
    inner = `${canManage ? `<button class="btn" onclick="addGroup(${id})">＋ Group</button>` : ''}
      <div class="card" style="margin-top:12px">${gList.length ? gList.map((g) => `<div class="item"><div class="av">◦</div>
        <div class="main" style="cursor:pointer" onclick="openGroup(${g.id})"><div class="nm">${esc(g.name)}</div><div class="sub">${g.day ? dayEn(g.day) : ''} ${g.time_slot ? '· ' + g.time_slot : ''} · ${gcnt(g.id)}/${g.capacity || '∞'} · tap to view ›</div></div>
        ${canManage ? `<button class="btn-icon" onclick="delGroup(${g.id})">🗑</button>` : ''}</div>`).join('') : empty('No groups yet')}</div>`;
  } else if (tab === 'pay') {
    const tot = finRows.reduce((a, r) => { a.fee += r.total_fee; a.paid += r.paid; a.rem += r.remaining; return a; }, { fee: 0, paid: 0, rem: 0 });
    inner = `<div class="grid g3"><div class="stat"><div class="n">${money(tot.fee)}</div><div class="l">Total</div></div>
      <div class="stat"><div class="n" style="color:var(--ok)">${money(tot.paid)}</div><div class="l">Paid</div></div>
      <div class="stat"><div class="n" style="color:${tot.rem ? 'var(--bad)' : 'var(--ok)'}">${money(tot.rem)}</div><div class="l">Remaining</div></div></div>
      <div class="card" style="margin-top:10px">${finRows.length ? finRows.map((r) => `<div class="item">
        <div class="main"><div class="nm">${esc(r.name)}</div><div class="sub">Paid ${money(r.paid)} · <span style="color:${r.remaining ? 'var(--bad)' : 'var(--ok)'}">Rem ${money(r.remaining)}</span></div></div>
        <button class="btn sm ghost" onclick="addPaymentFor(${r.id})">＋ Pay</button></div>`).join('') : empty('No students yet')}</div>`;
  } else if (tab === 'videos') {
    inner = `<button class="btn" onclick="addVideo('${round.kind || 'onsite'}',${id})">＋ Add video</button>
      <div class="grid g2" style="margin-top:12px">${vList.length ? vList.map((v) => `<div class="card" style="margin:0">
        <div class="nm" style="font-weight:600">${esc(v.title)}</div>
        <div style="margin:4px 0"><span class="badge ${v.group_name ? '' : 'ok'}">${v.group_name ? '👥 ' + esc(v.group_name) : 'Whole round'}</span></div>
        ${v.description ? `<div style="font-size:13px;margin:6px 0">${esc(v.description)}</div>` : ''}
        ${videoEmbed(v)}<button class="btn danger sm" style="margin-top:8px" onclick="delVideo(${v.id})">Delete</button></div>`).join('') : empty('No videos yet', '🎬')}</div>`;
  } else if (tab === 'att') {
    inner = `<div class="hint" style="margin-bottom:8px">Students check themselves in/out from their own account.</div>
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Day</th><th>In</th><th>Out</th></tr></thead>
      <tbody>${attendance.length ? attendance.map((a) => `<tr><td>${esc(a.user_name)}</td><td>${dt(a.date)}</td><td>${a.check_in || '—'}</td><td>${a.check_out || '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No attendance yet</td></tr>'}</tbody></table></div></div>`;
  } else {
    inner = `${canSeeMoney ? `<button class="btn" onclick="newQuiz(${id})">＋ New quiz</button>` : ''}
      <div style="margin-top:12px">${qList.length ? qList.map((q) => `<div class="card"><div class="item"><div class="av">📝</div>
        <div class="main"><div class="nm">${esc(q.title)} <span class="badge">${q.ref_code}</span></div><div class="sub">${q.questions_count} questions · ${q.duration_min} min</div></div>
        ${canSeeMoney ? `<button class="btn sm sec" onclick="quizResults(${q.id},'${esc(q.title).replace(/'/g, "\\'")}')">Results</button><button class="btn-icon" onclick="delQuiz(${q.id})">🗑</button>` : ''}</div></div>`).join('') : empty('No quizzes yet', '📝')}</div>`;
  }
  c.innerHTML = title(round.name, '') +
    `<div class="sub muted" style="margin:-8px 2px 10px">${round.kind === 'online' ? 'Online Course' : 'In‑person'}${round.start_date ? ' · Starts ' + dt(round.start_date) : ''}</div>
    <div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="roundTab('${k}')">${l}</span>`).join('')}</div>` + inner;
  if (window._roundSearch) liveSearch(window._roundSearch, '#roundStudentsList');
};
window.roundTab = (t) => { window._roundTab = t; window._roundSearch = ''; go('round'); };
window.setRoundGov = (v) => { window._roundGov = v; go('round'); };
window.setRoundPay = (v) => { window._roundPay = v; go('round'); };
window.toggleGovSort = () => { window._roundSortGov = !window._roundSortGov; go('round'); };
/* A dress photo row is one of three things: a picture, an uploaded clip, or a
   link to a video living on Instagram, YouTube or TikTok. Each of those three
   offers an /embed address that plays inside an iframe, so the video plays in
   the app rather than throwing the studio out into another app. Anything else
   falls back to a button that opens it. */
function embedSrc(raw) {
  const u = String(raw || '');
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const ig = u.match(/instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
  if (ig) return `https://www.instagram.com/${ig[1] === 'reels' ? 'reel' : ig[1]}/${ig[2]}/embed`;
  const tt = u.match(/tiktok\.com\/.*\/video\/(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  return null;
}
window.isVideoFile = (f) => /\.(mp4|mov|webm)$/i.test(String(f || ''));
/* Instagram's embed is a post card, not a 16:9 frame — it needs the taller box. */
function linkedVideo(url, opts = {}) {
  const src = embedSrc(url);
  if (!src) return `<a class="btn sec sm" href="${esc(url)}" target="_blank" rel="noopener">▶ Open the video</a>`;
  const pad = /instagram\.com/.test(src) ? '125%' : '56.25%';
  return `<div style="position:relative;padding-top:${pad};border-radius:12px;overflow:hidden;background:#000">
    <iframe style="position:absolute;inset:0;width:100%;height:100%;border:0" src="${esc(src)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin" title="${esc(opts.title || 'Video')}"></iframe></div>`;
}
window.linkedVideo = linkedVideo;

function videoEmbed(v) {
  if (v.file) {
    if (/\.(png|jpe?g|webp|gif)$/i.test(v.file)) return `<img src="${esc(mediaUrl(v.file))}" style="width:100%;border-radius:10px;margin-top:6px;cursor:zoom-in" onclick="lightbox('${esc(mediaUrl(v.file))}')" alt=""/>
      <a class="btn sec sm" style="margin-top:6px;display:inline-block" href="${esc(mediaUrl(v.file))}" download>⬇ Download</a>`;
    return `<video controls style="width:100%;border-radius:10px;margin-top:6px" src="${esc(mediaUrl(v.file))}"></video>
      <a class="btn sec sm" style="margin-top:6px;display:inline-block" href="${esc(mediaUrl(v.file))}" download>⬇ Download</a>`;
  }
  if (v.url) {
    const yt = v.url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    if (yt) return `<div style="position:relative;padding-top:56%;margin-top:6px"><iframe style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px" src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
    return `<a class="btn sec sm" style="margin-top:6px" href="${esc(v.url)}" target="_blank">▶ Open video</a>`;
  }
  return '';
}
window.addVideo = async (kind, presetRound) => {
  const [rounds, groups] = await Promise.all([
    window._rounds ? Promise.resolve(window._rounds) : GET('/api/rounds'),
    GET('/api/groups'),
  ]);
  window._vidGroups = groups;
  const grpOpts = [{ value: '', label: 'Whole round (all groups)' },
    ...groups.filter((g) => !presetRound || g.round_id === Number(presetRound)).map((g) => ({ value: g.id, label: g.name }))];
  formModal('New video / photo', [
    { name: 'title', label: 'Title', required: true },
    { name: 'kind', label: 'Course type', type: 'select', value: kind === 'onsite' ? 'onsite' : 'online', options: [{ value: 'online', label: 'Online Course' }, { value: 'onsite', label: 'In‑person' }] },
    { name: 'round_id', label: 'Round', type: 'select', value: presetRound || '', options: [{ value: '', label: 'All rounds' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'group_id', label: 'Group (optional)', type: 'select', options: grpOpts },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'url', label: 'Link (YouTube or any URL)', placeholder: 'https://...' },
    { name: 'file', label: 'Upload a video', type: 'file', accept: 'video/*' },
    { name: 'photo', label: 'Or upload a photo (HD)', type: 'file', accept: 'image/*' },
  ], async (d) => {
    if (d.photo) { d.file = d.photo; } // a photo, if given, is the media file
    delete d.photo;
    if (d.group_id) { const g = (window._vidGroups || []).find((x) => x.id === Number(d.group_id)); if (g) d.round_id = g.round_id; } // group implies its round
    await POST('/api/videos', d); toast('Uploaded'); go(state.page);
  });
};
window.delVideo = (id) => confirmDel('Delete video?', async () => { await DEL('/api/videos/' + id); go('courses'); });

/* ============ CLASSROOM — tasks, quizzes and notes in one screen ============
   The three used to be three lines in the menu and three screens. They are the
   same work seen three ways, so they are now one screen with three tabs. The
   pages below are unchanged apart from their heading: when one is drawn inside
   this screen the screen carries the title, so the page leaves it out. */
function groupPage(key) {
  return async (c) => {
    const g = GROUPS[key];
    const tabs = groupTabs(key);
    if (!tabs.length) { c.innerHTML = empty('Nothing here for you', g.icon); return; }
    // one tab is not a choice — show that page as itself, under its own heading
    if (tabs.length === 1) return PAGES[tabs[0][0]](c);
    let tab = state.groupTab[key];
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
    state.groupTab[key] = tab;
    c.innerHTML = title(g.title, g.icon) +
      `<div class="dtabs grp-tabs">${tabs.map(([k, l, ic]) => `<button class="dtab${k === tab ? ' on' : ''}" onclick="groupTab('${key}','${k}')">
        <span class="dtab-ic">${ic}</span>${esc(l)}</button>`).join('')}</div>
       <div id="grpBody" class="grp-body"><div class="spinner"></div></div>`;
    const body = document.getElementById('grpBody');
    window._inGroup = key;
    try { await PAGES[tab](body); } finally { window._inGroup = null; }
    lazyImgs('#grpBody'); watchVideos(body);
  };
}
/* Picking a tab goes through go() like any other link — it is the same page it
   always was, so the back button and the saved route keep working. */
window.groupTab = (key, k) => { state.groupTab[key] = k; go(k); };

/* The heading belongs to whoever is showing the page: on its own it carries it,
   inside a merged screen the screen above it already has. */
function pageHead(t, ic) { return window._inGroup ? '' : title(t, ic || ''); }

PAGES.academy = groupPage('academy');
PAGES.me = groupPage('me');
PAGES.classroom = groupPage('classroom');
PAGES.spending = groupPage('spending');

/* A row of the months that actually have something in them, newest first.
   An empty <input type="month"> reads as a broken field — "-------- ----" —
   and these are the only months there is anything to look at anyway. */
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(m) {
  const [y, mo] = String(m).split('-');
  return `${MONTH_SHORT[Number(mo) - 1] || mo} ${y}`;
}
function monthChips(dates, current, fn) {
  const months = [...new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 7)))].sort().reverse();
  if (months.length < 2) return '';
  return `<div class="filters" style="margin-top:12px">
    <span class="chip ${current ? '' : 'active'}" onclick="${fn}('')">All</span>
    ${months.map((m) => `<span class="chip ${current === m ? 'active' : ''}" onclick="${fn}('${m}')">${monthLabel(m)}</span>`).join('')}</div>`;
}

/* ============ HOMEWORK / TASKS ============ */
PAGES.homework = async (c) => {
  if (!['admin', 'manager', 'staff'].includes(state.user.role)) return PAGES.homework_trainee(c);
  const canSend = state.user.role === 'admin';
  const [hw, rounds, groups] = await Promise.all([GET('/api/homeworks'), GET('/api/rounds'), GET('/api/groups')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const gMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  window._rounds = rounds; window._hwGroups = groups;
  c.innerHTML = pageHead('Tasks (Patterns)') +
    `${canSend ? '<button class="btn" onclick="addHomework()">＋ Send task</button>' : ''}
    ${hw.length ? hw.map((h) => {
      const done = h.submitted_count || 0, all = h.expected_count || 0;
      const pct = all ? Math.round((done / all) * 100) : 0;
      return `<div class="card">
      <div class="item" style="border-bottom:none;padding-bottom:4px"><div class="av">✎</div>
        <div class="main"><div class="nm">${esc(h.title)}</div>
          <div class="sub">${h.mode === 'online' ? '💻 Online' : '🏛 Studio'} · ${h.round_id ? esc(rMap[h.round_id] || '') : 'All rounds'}${h.group_id ? ' · ' + esc(gMap[h.group_id] || '') : ''}${h.due_date ? ' · due ' + dt(h.due_date) : ''}</div></div>
        ${canSend ? `<button class="btn-icon" onclick="delHomework(${h.id})">🗑</button>` : ''}</div>
      <div class="prog" onclick="viewSubs(${h.id})">
        <div class="prog-top"><span class="prog-n">${done} of ${all}</span><span class="prog-l">handed in</span></div>
        <div class="prog-bar"><span style="width:${pct}%"></span></div>
      </div>
      ${h.measurements ? `<div class="hint">Measurements: ${esc(h.measurements)}</div>` : ''}
      ${h.instructions ? `<div class="hint">${esc(h.instructions)}</div>` : ''}
      <button class="btn sec" style="margin-top:10px" onclick="viewSubs(${h.id})">See who handed in</button>
    </div>`;
    }).join('') : empty('No tasks yet', '✎')}`;
  // arriving from a "handed in" notification opens that task straight away
  const jump = window._openTaskAfter; window._openTaskAfter = null;
  if (jump && hw.some((h) => h.id === jump)) viewSubs(jump);
};
window.addHomework = async () => {
  const [rounds, groups] = await Promise.all([
    window._rounds ? Promise.resolve(window._rounds) : GET('/api/rounds'), GET('/api/groups'),
  ]);
  window._hwGroups = groups;
  modal(`<h3>New task</h3>
    <label>Title</label>
    <input id="hTitle" placeholder="Basic bodice pattern" />
    <label>Round</label>
    <select id="hRound" onchange="hwFillGroups()">
      <option value="">All rounds</option>
      ${rounds.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}
    </select>
    <label>Group</label>
    <select id="hGroup" onchange="hwWho()"><option value="">Every group in the round</option></select>
    <span class="hint" id="hWho">Everyone will get it</span>
    <label>How is it taught?</label>
    <select id="hMode">
      <option value="onsite">🏛 In the studio (onsite)</option>
      <option value="online">💻 Online</option>
    </select>
    <label>Measurements sent</label>
    <textarea id="hMeas" placeholder="Bust 90 / Waist 70 / Length 160 ..."></textarea>
    <label>Instructions</label>
    <textarea id="hInstr"></textarea>
    <label>Due date</label>
    <input id="hDue" type="date" />
    <button class="btn" style="margin-top:14px" id="hSend" onclick="sendHomework()">Send task</button>`);
  hwFillGroups();
};
/* the group list only ever shows the groups inside the chosen round */
window.hwFillGroups = () => {
  const rid = $('#hRound').value;
  const list = (window._hwGroups || []).filter((g) => !rid || String(g.round_id) === String(rid));
  const sel = $('#hGroup');
  sel.innerHTML = `<option value="">${rid ? 'Every group in this round' : 'Every group'}</option>` +
    list.map((g) => `<option value="${g.id}">${esc(g.name)}${g.day ? ' · ' + dayEn(g.day) : ''}${g.time_slot ? ' · ' + esc(g.time_slot) : ''}</option>`).join('');
  sel.disabled = !list.length;
  hwWho();
};
window.hwWho = async () => {
  const hint = $('#hWho'); if (!hint) return;
  const rid = $('#hRound').value, gid = $('#hGroup').value;
  const users = window._hwStudents || (window._hwStudents = await GET('/api/users?role=trainee'));
  // same rule as the server: a chosen group decides on its own, otherwise the round does
  const n = users.filter((u) => (gid ? String(u.group_id) === String(gid)
    : (!rid || String(u.round_id) === String(rid)))).length;
  hint.textContent = `${n} student${n === 1 ? '' : 's'} will get this task`;
};
window.sendHomework = async () => {
  const title = $('#hTitle').value.trim();
  if (!title) return toast('Give the task a title');
  const btn = $('#hSend'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await POST('/api/homeworks', {
      title, round_id: $('#hRound').value || null, group_id: $('#hGroup').value || null,
      mode: $('#hMode').value, measurements: $('#hMeas').value, instructions: $('#hInstr').value,
      due_date: $('#hDue').value || null,
    });
    closeModal(); toast('Sent ✓'); go('classroom');
  } catch (e) { btn.disabled = false; btn.textContent = 'Send task'; toast(e.message); }
};
window.delHomework = (id) => confirmDel('Delete task?', async () => { await DEL('/api/homeworks/' + id); go('classroom'); });
/* Who handed a task in — a screen, not a pop-up */
window.viewSubs = (id) => { window._taskId = id; go('task'); };

PAGES.task = async (c) => {
  const id = window._taskId;
  if (!id) return go('classroom');
  const [r, groups] = await Promise.all([GET(`/api/homeworks/${id}/submissions`), GET('/api/groups')]);
  window._hwGroups = groups;
  const canGrade = ['admin', 'manager'].includes(state.user.role);
  const pct = r.expected ? Math.round((r.submitted.length / r.expected) * 100) : 0;
  const gName = r.homework.group_id ? (groups.find((g) => g.id === r.homework.group_id) || {}).name : null;
  const tab = window._taskTab === 'waiting' ? 'waiting' : 'done';

  c.innerHTML = luxBackdrop() + '<div class="home-lux">' +
    `<div class="task-head">
      <div class="th-name">${esc(r.homework.title)}</div>
      <div class="th-sub">${r.homework.mode === 'online' ? '💻 Online' : '🏛 In the studio'}${gName ? ' · ' + esc(gName) : ''}${r.homework.due_date ? ' · due ' + dt(r.homework.due_date) : ''}</div>
      ${r.homework.measurements ? `<div class="th-note">Measurements: ${esc(r.homework.measurements)}</div>` : ''}
      ${r.homework.instructions ? `<div class="th-note">${esc(r.homework.instructions)}</div>` : ''}
      <div class="prog" style="margin:14px 0 0">
        <div class="prog-top"><span class="prog-n">${r.submitted.length} of ${r.expected}</span><span class="prog-l">handed in · ${pct}%</span></div>
        <div class="prog-bar"><span style="width:${pct}%"></span></div>
      </div>
    </div>
    <div class="dtabs">
      <button class="dtab${tab === 'done' ? ' on' : ''}" onclick="taskTab('done')"><span class="dtab-ic">✓</span>Handed in (${r.submitted.length})</button>
      <button class="dtab${tab === 'waiting' ? ' on' : ''}" onclick="taskTab('waiting')"><span class="dtab-ic">◷</span>Still waiting (${r.pending.length})</button>
    </div>
    <div class="card" style="padding:4px 15px 14px">
    ${tab === 'done'
      ? (r.submitted.length ? r.submitted.map((s) => `<div class="sub-row done">
          <div class="st-row">
            <span class="av">${esc(initials(s.user_name))}</span>
            <span class="st-txt"><span class="nm">${esc(s.user_name)}</span>
              <span class="st-grp">${esc(s.group_name || 'No group')}</span>
              <span class="st-when">${dt(s.submitted_at)} · ${s.images.length} photo${s.images.length === 1 ? '' : 's'}${s.grade ? ' · ' + esc(s.grade) : ''}</span></span>
            ${canGrade ? `<button class="btn sm ghost" onclick="gradeSub(${s.id},'${esc(s.grade || '')}')">Grade</button>` : '<span class="st-tick">✓</span>'}
          </div>
          ${s.images.length ? `<div class="scan-strip">${s.images.map((im) => `
            <img class="scan-thumb" src="${esc(mediaUrl(im.image))}" onclick="lightbox('${esc(mediaUrl(im.image))}','${esc(s.user_name)}')" alt=""/>`).join('')}</div>` : ''}
          ${s.note ? `<div class="hint">“${esc(s.note)}”</div>` : ''}
        </div>`).join('') : '<div class="hint" style="padding:14px 2px">Nobody has handed in yet</div>')
      : (r.pending.length ? r.pending.map((u) => `<div class="st-row waiting">
          <span class="av">${esc(initials(u.name))}</span>
          <span class="st-txt"><span class="nm">${esc(u.name)}</span>
            <span class="st-grp">${esc(u.group_name || 'No group')}</span></span>
          <span class="st-dot"></span>
        </div>`).join('') : '<div class="hint" style="padding:14px 2px">Everyone has handed in 🎉</div>')}
    </div></div>`;
};
window.taskTab = (t) => { window._taskTab = t; go('task'); };

window.gradeSub = (id, cur) => formModal('Grade submission', [
  { name: 'grade', label: 'Grade', value: cur },
  { name: 'feedback', label: 'Feedback', type: 'textarea' },
], async (d) => { await PUT('/api/submissions/' + id, d); toast('Saved'); closeModal(); go(state.page === 'task' ? 'task' : 'classroom'); });

/* ============ QUIZZES ============ */
PAGES.quizzes = async (c) => {
  if (state.user.role !== 'admin') return PAGES.quizzes_trainee(c);
  const [quizzes, rounds] = await Promise.all([GET('/api/quizzes'), GET('/api/rounds')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  window._rounds = rounds;
  c.innerHTML = pageHead('Quizzes') +
    `<button class="btn" onclick="newQuiz()">＋ New quiz</button>
    ${quizzes.length ? quizzes.map((q) => `<div class="card">
      <div class="item"><div class="av">📝</div>
        <div class="main"><div class="nm">${esc(q.title)} <span class="badge">${q.ref_code}</span></div>
          <div class="sub">${q.questions_count} questions · ${q.duration_min} min · ${q.round_id ? esc(rMap[q.round_id] || '') : 'All'} · ${q.active ? 'Active' : 'Off'}</div></div>
        <button class="btn sm sec" onclick="quizResults(${q.id},'${esc(q.title)}')">Results</button>
        <button class="btn-icon" onclick="delQuiz(${q.id})">🗑</button></div></div>`).join('') : empty('No quizzes yet', '📝')}`;
};
window.delQuiz = (id) => confirmDel('Delete quiz?', async () => { await DEL('/api/quizzes/' + id); go('classroom'); });
window.quizResults = async (id, tt) => {
  const rows = await GET(`/api/quizzes/${id}/results`);
  modal(`<h3>Results: ${esc(tt)}</h3>${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Score</th><th>Date</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.user_name)}</td><td>${r.score}/${r.total}</td><td>${dt(r.submitted_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No attempts yet')}`);
};
let _qDraft = [];
window.newQuiz = async () => {
  const rounds = window._rounds || await GET('/api/rounds');
  _qDraft = [];
  modal(`<h3>New quiz</h3>
    <label>Title *</label><input id="qTitle" />
    <label>Round</label><select id="qRound"><option value="">All</option>${rounds.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
    <label>Duration (minutes)</label><input id="qDur" type="number" inputmode="numeric" value="15" />
    <label>Reference code (optional)</label><input id="qRef" placeholder="auto-generated" />
    <div class="divider"></div>
    <div class="sec-title">Questions</div>
    <div id="qList"></div>
    <button class="btn ghost sm" onclick="addQ()">＋ Question</button>
    <div class="err hidden" id="qErr"></div>
    <button class="btn" style="margin-top:12px" onclick="saveQuiz()">Save quiz</button>`);
  addQ();
};
window.addQ = () => {
  const i = _qDraft.length; _qDraft.push({ text: '', options: ['', '', '', ''], correct_index: 0 });
  $('#qList').insertAdjacentHTML('beforeend', `<div class="card" style="padding:12px" id="q_${i}">
    <label>Question ${i + 1}</label><input oninput="_qDraft[${i}].text=this.value" />
    ${[0, 1, 2, 3].map((o) => `<div class="row" style="align-items:center;margin-top:4px">
      <input placeholder="Answer ${o + 1}" oninput="_qDraft[${i}].options[${o}]=this.value" style="flex:4" />
      <label style="margin:0;flex:1;white-space:nowrap"><input type="radio" name="correct_${i}" ${o === 0 ? 'checked' : ''} onchange="_qDraft[${i}].correct_index=${o}" style="width:auto"/> correct</label>
    </div>`).join('')}</div>`);
};
window.saveQuiz = async () => {
  const t = $('#qTitle').value.trim();
  if (!t) { const e = $('#qErr'); e.textContent = 'Enter a title'; e.classList.remove('hidden'); return; }
  const qs = _qDraft.filter((q) => q.text.trim());
  try {
    await POST('/api/quizzes', { title: t, round_id: $('#qRound').value || null, duration_min: Number($('#qDur').value) || 15, ref_code: $('#qRef').value || null, questions: qs });
    closeModal(); toast('Saved'); go('classroom');
  } catch (e) { const x = $('#qErr'); x.textContent = e.message; x.classList.remove('hidden'); }
};

/* ============ NOTES ============ */
PAGES.notes = async (c) => {
  if (state.user.role !== 'admin') return PAGES.notes_trainee(c);
  const [notes, rounds, users] = await Promise.all([GET('/api/notes'), GET('/api/rounds'), GET('/api/users?role=trainee')]);
  window._noteRef = { rounds, users };
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const uMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  c.innerHTML = pageHead('Notes & Instructions') +
    `<button class="btn" onclick="addNote()">＋ Send note</button>
    ${notes.length ? notes.map((n) => `<div class="card">
      <div class="item"><div class="av">📌</div>
        <div class="main"><div class="nm">${esc(n.title)}</div>
          <div class="sub">${n.scope === 'all' ? 'All students' : n.scope === 'round' ? esc(rMap[n.round_id] || 'Round') : esc(uMap[n.user_id] || 'Student')} · ${dt(n.created_at)}</div></div>
        <button class="btn-icon" onclick="delNote(${n.id})">🗑</button></div>
      ${n.body ? `<div style="font-size:14px;margin-top:6px">${esc(n.body)}</div>` : ''}</div>`).join('') : empty('No notes yet', '📌')}`;
};
window.addNote = () => {
  const { rounds, users } = window._noteRef;
  formModal('Note / instructions', [
    { name: 'title', label: 'Title', required: true },
    { name: 'body', label: 'Text', type: 'textarea', rows: 4 },
    { name: 'scope', label: 'Send to', type: 'select', options: [{ value: 'all', label: 'All students' }, { value: 'round', label: 'A specific round' }, { value: 'user', label: 'A specific student' }] },
    { name: 'round_id', label: 'Round (if round)', type: 'select', options: [{ value: '', label: '—' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'user_id', label: 'Student (if specific)', type: 'select', options: [{ value: '', label: '—' }, ...users.map((u) => ({ value: u.id, label: u.name }))] },
  ], async (d) => { await POST('/api/notes', d); toast('Sent'); go('classroom'); });
};
window.delNote = (id) => confirmDel('Delete note?', async () => { await DEL('/api/notes/' + id); go('classroom'); });

/* ============ ABOUT (edit) ============ */
PAGES.about = async (c) => {
  const a = await GET('/api/about');
  if (state.user.role !== 'admin') return PAGES.about_view(c, a);
  c.innerHTML = title('About the Academy', '') + `<div class="card">
    ${a.image ? `<div class="ph-frame" style="margin-bottom:10px;${frameStyle(frameVars(a))}">
      <i style="background-image:url('${esc(mediaUrl(a.image))}')" onclick="lightbox('${esc(mediaUrl(a.image))}')"></i></div>` : ''}
    <label>Title</label><input id="abT" value="${esc(a.title || '')}" />
    <label>Description</label><textarea id="abB" style="min-height:140px">${esc(a.body || '')}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn ghost" onclick="abPic()">📷 Cover image</button>
    ${a.image ? '<button class="btn ghost" onclick="frameAbout()">◳ Frame it</button>' : ''}
    <button class="btn" onclick="saveAbout()">Save</button></div>
    <span class="hint" id="abH"></span></div>`;
  window._abImg = null;
};
window.abPic = () => pickImage((b) => { window._abImg = b; $('#abH').textContent = 'Image selected ✓'; });
window.saveAbout = async () => { await PUT('/api/about', { title: $('#abT').value, body: $('#abB').value, image: window._abImg }); toast('Saved'); go('about'); };

/* ===== The studio photo and how it sits in its frame =====
   The file is never cut. We only remember a focal point, a zoom and the shape
   of the frame, so the framing can be redone at any time. */
window.frameVars = (a) => {
  const p = String((a && a.img_pos) || '50 50').split(/\s+/);
  const x = Number(p[0]); const y = Number(p[1]);
  return {
    x: isFinite(x) ? x : 50,
    y: isFinite(y) ? y : 50,
    z: Math.min(3, Math.max(1, Number((a && a.img_zoom) || 1) || 1)),
    shape: (a && a.img_shape) || '16/10',
  };
};
function frameStyle(f) {
  return `--ar:${f.shape};--pos:${f.x}% ${f.y}%;--z:${f.z}`;
}
function shPhoto(a, admin) {
  const f = frameVars(a), url = esc(mediaUrl(a.image));
  return `<div class="sh-photo" style="${frameStyle(f)}">
    <i style="background-image:url('${url}')" onclick="lightbox('${url}')"></i>
    ${admin ? `<button class="sh-frame" onclick="event.stopPropagation();frameAbout()">Frame photo</button>` : ''}
  </div>`;
}
window.shPhoto = shPhoto;

const FRAME_SHAPES = [['16/10', 'Wide'], ['3/2', 'Classic'], ['1/1', 'Square'], ['4/5', 'Portrait']];

window.frameAbout = async () => {
  const a = await GET('/api/about');
  if (!a.image) { toast('Add a photo first'); return; }
  const f = frameVars(a), url = esc(mediaUrl(a.image));
  modal(`<h3>Frame the photo</h3>
    <div class="hint" style="margin:-4px 0 12px">Drag the photo to choose what shows. Nothing is cut from the original.</div>
    <div class="sh-photo fr-stage" id="frStage" style="${frameStyle(f)}">
      <i id="frImg" style="background-image:url('${url}')"></i>
      <div class="fr-grid"></div>
    </div>
    <label style="margin-top:14px">Zoom</label>
    <input id="frZoom" type="range" min="1" max="3" step="0.01" value="${f.z}" />
    <label>Shape of the frame</label>
    <div class="filters wrap" id="frShapes">
      ${FRAME_SHAPES.map(([v, l]) => `<span class="chip ${v === f.shape ? 'active' : ''}" data-sh="${v}">${l}</span>`).join('')}
    </div>
    <div class="row" style="margin-top:14px;gap:8px">
      <button class="btn sec" onclick="frameReset()">Centre it again</button>
      <button class="btn" onclick="frameSave()">Save the framing</button>
    </div>`);

  const st = window._fr = { ...f };
  const stage = document.getElementById('frStage');
  const apply = () => { stage.setAttribute('style', frameStyle(st)); };
  window._frApply = apply;

  let drag = null;
  const at = (e) => ({ x: e.clientX, y: e.clientY });
  stage.addEventListener('pointerdown', (e) => {
    drag = at(e); stage.setPointerCapture(e.pointerId); stage.classList.add('fr-hold');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = at(e), r = stage.getBoundingClientRect();
    // Dragging down should bring the top of the photo into view.
    st.x = Math.min(100, Math.max(0, st.x - ((p.x - drag.x) / r.width) * 100 / st.z));
    st.y = Math.min(100, Math.max(0, st.y - ((p.y - drag.y) / r.height) * 100 / st.z));
    drag = p; apply(); e.preventDefault();
  });
  const drop = () => { drag = null; stage.classList.remove('fr-hold'); };
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);

  document.getElementById('frZoom').oninput = (e) => { st.z = Number(e.target.value); apply(); };
  document.getElementById('frShapes').onclick = (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    st.shape = chip.dataset.sh; apply();
    [...chip.parentNode.children].forEach((n) => n.classList.toggle('active', n === chip));
  };
};
window.frameReset = () => {
  const st = window._fr; if (!st) return;
  st.x = 50; st.y = 50; st.z = 1;
  document.getElementById('frZoom').value = 1;
  window._frApply();
};
window.frameSave = async () => {
  const st = window._fr;
  await PUT('/api/about/frame', { x: st.x, y: st.y, zoom: st.z, shape: st.shape });
  closeModal(); toast('Framing saved'); go(state.page || 'dalia');
};

/* ============ DALIA POSTS ============ */
PAGES.dalia = async (c) => {
  const [posts, about] = await Promise.all([GET('/api/dalia'), GET('/api/about')]);
  window._daliaPosts = posts;
  const admin = state.user.role === 'admin';
  const of = (sec) => posts.filter((p) => (p.section || 'studio') === sec);

  const houses = [
    { key: 'all', icon: '✦', name: 'All', full: 'Everything from the studio',
      c1: '#7c3aed', c2: '#e24a8b', glow: '124,58,237', blurb: 'The atelier, the academy and the studio' },
    { key: 'couture', icon: '👗', name: 'Couture', full: 'Daliessa Couture',
      c1: '#c2185b', c2: '#d9a45f', glow: '194,24,91', blurb: 'Gowns, fittings and the work coming out of the atelier' },
    { key: 'academy', icon: '🎓', name: 'Academy', full: 'Dalia Bassel Academy',
      c1: '#6d28d9', c2: '#a24fd6', glow: '109,40,217', blurb: 'Rounds, patterns and the students’ work' },
    { key: 'studio', icon: '📣', name: 'News', full: 'Studio news',
      c1: '#0f766e', c2: '#5eead4', glow: '15,118,110', blurb: 'Openings, hours and announcements' },
  ];
  const pick = houses.some((h) => h.key === window._daliaHouse) ? window._daliaHouse : 'all';
  window._daliaHouse = pick;
  const h = houses.find((x) => x.key === pick);
  const list = pick === 'all' ? posts : of(pick);
  const countOf = (k) => k === 'all' ? posts.length : of(k).length;

  c.innerHTML = luxBackdrop() + '<div class="home-lux">' +
    `<div class="studio-head">
      ${about.image ? shPhoto(about, admin) : ''}
      <div class="sh-body">
        <div class="sh-eyebrow">The Studio</div>
        <div class="sh-name">Dalia Bassel</div>
        <div class="sh-kind">Haute Couture · Cairo</div>
        <div class="sh-intro">${esc(about.body || 'Where fabric becomes feeling. Hand-crafted couture and a design academy — dressing you for the moments you will never forget.')}</div>
        <div class="sh-pills">
          <span class="sh-pill">👗 Couture atelier</span>
          <span class="sh-pill">🎓 Design academy</span>
        </div>
        ${admin ? `<button class="btn sm sec" style="margin-top:14px" onclick="go('about')">Edit this introduction</button>` : ''}
      </div>
    </div>
    ${admin ? '<button class="btn" style="margin:0 0 14px" onclick="addDalia()">＋ New post</button>' : ''}
    <div class="cat-row four">
      ${houses.map((x) => {
        const n = countOf(x.key);
        return `<button class="cat${x.key === pick ? ' on' : ''}" style="--c1:${x.c1};--c2:${x.c2};--glow:${x.glow}"
          onclick="daliaHouse('${x.key}')" aria-pressed="${x.key === pick}">
          <span class="cat-ic">${x.icon}</span>
          <span class="cat-n">${x.name}</span>
          <span class="cat-c">${n}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="cat-head">
      <div class="ch-name">${esc(h.full)}</div>
      <div class="ch-sub">${esc(h.blurb)}</div>
    </div>
    ${list.length ? list.map((p) => renderDaliaPost(p, admin)).join('')
      : `<div class="card"><div class="hint" style="padding:10px 2px">${admin
          ? (pick === 'all' ? 'Nothing posted yet — start with ＋ New post.' : 'Nothing here yet — add a post and pick this section.')
          : 'Nothing here yet — check back soon.'}</div></div>`}
    ${reachBlock(pick)}
    </div>`;
};

/* The way in matches whichever house you are reading */
function reachBlock(pick) {
  const studio = ['admin', 'manager', 'staff'].includes(state.user.role);
  if (studio) return `<div class="reach">
      <div class="reach-h">Customer service</div>
      <div class="reach-s">Everything clients, students and visitors have written to the studio.</div>
      <button class="btn" style="margin-top:14px" onclick="go('chats')">Open the inbox</button>
    </div>`;
  const dress = `<button class="reach-btn dress" onclick="askStudio('dress')">
      <span class="rb-ic">👗</span><span class="rb-t">Book an appointment</span><span class="rb-h">A consultation or a fitting</span></button>`;
  const course = `<button class="reach-btn course" onclick="askStudio('course')">
      <span class="rb-ic">🎓</span><span class="rb-t">Book a course</span><span class="rb-h">Pick a round and hold your place</span></button>`;
  const only = { couture: dress, academy: course };
  const heads = {
    couture: ['Book your appointment', 'Tell us about the occasion and when suits you — we confirm your consultation.'],
    academy: ['Book your place', 'Pick the round that suits you and we hold a place for you.'],
  };
  const [h, sub] = heads[pick] || ['Talk to the studio', 'Tell us what you need and we answer you inside the app.'];
  return `<div class="reach">
    <div class="reach-h">${esc(h)}</div>
    <div class="reach-s">${esc(sub)}</div>
    <div class="reach-btns">${only[pick] || (dress + course)}</div>
    <button class="btn sec" style="margin-top:10px" onclick="go('help')">All my conversations</button>
  </div>`;
}
window.daliaHouse = (k) => { window._daliaHouse = k; go('dalia'); };

function renderDaliaPost(p, admin) {
  const tpl = p.template || 'below';
  const media = p.media || [];
  const img = p.image ? esc(mediaUrl(p.image)) : '';
  const cap = esc((p.title || '').replace(/'/g, ''));
  const imgTag = media.length ? gallery(media) : '';
  const heads = `${p.title ? `<div class="ttl">${esc(p.title)}</div>` : ''}${p.subtitle ? `<div class="sub2">${esc(p.subtitle)}</div>` : ''}`;
  const txt = p.body ? `<div class="txt">${esc(p.body)}</div>` : '';
  let tbl = ''; try { const t = p.table_data && JSON.parse(p.table_data); if (t && t.rows) tbl = renderMiniTable(t); } catch (e) {}
  const date = `<div class="date">${dt(p.created_at)}</div>`;
  const del = admin ? `<div class="row" style="margin-top:12px"><button class="btn sec sm" onclick="editDalia(${p.id})">Edit / add photo</button><button class="btn danger sm" onclick="delDalia(${p.id})">Delete</button></div>` : '';
  if (tpl === 'hero') {
    const single = media.length === 1 && media[0].kind === 'image';
    const cover = single ? esc(mediaUrl(media[0].file)) : '';
    return `<div class="feed-post fp-hero">${single
      ? `<div class="hero-img" style="background-image:url('${cover}')" onclick="lightbox('${cover}','${cap}')"><div class="hero-ov">${heads}</div></div>`
      : `${imgTag}<div class="body">${heads}</div>`}<div class="body">${date}${txt}${tbl}${del}</div></div>`;
  }
  if (tpl === 'text') {
    return `<div class="feed-post fp-text"><div class="body">${date}${heads}${txt}${tbl}${del}</div></div>`;
  }
  if (tpl === 'side' && media.length === 1 && media[0].kind === 'image') {
    return `<div class="feed-post fp-side"><img class="ph" src="${esc(mediaUrl(media[0].file))}" onclick="lightbox('${esc(mediaUrl(media[0].file))}','${cap}')"/><div class="body">${date}${heads}${txt}${tbl}${del}</div></div>`;
  }
  if (tpl === 'side') {
    return `<div class="feed-post">${imgTag}<div class="body">${date}${heads}${txt}${tbl}${del}</div></div>`;
  }
  return `<div class="feed-post fp-below">${imgTag}<div class="body">${date}${heads}${txt}${tbl}${del}</div></div>`;
}
function renderMiniTable(t) {
  return `<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${(t.cols || []).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${(t.rows || []).map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
window.addDalia = () => daliaForm(null);
window.editDalia = (id) => daliaForm((window._daliaPosts || []).find((x) => x.id === id) || null);
function daliaForm(p) {
  p = p || {};
  window._dImg = p.image || null; window._dEditId = p.id || null;
  const tpls = [['below', '🖼️ Image on top · text below'], ['side', '↔️ Image beside text'], ['hero', '✨ Big image · title on it'], ['text', '📝 Text only (info block)']];
  const prev = p.image ? (String(p.image).startsWith('data:') ? p.image : esc(mediaUrl(p.image))) : '';
  const secs = [['couture', '👗 Daliessa Couture'], ['academy', '🎓 Dalia Bassel Academy'], ['studio', '✦ Studio news']];
  modal(`<h3>${p.id ? 'Edit post' : 'New post'}</h3>
    <label>Where does it belong?</label>
    <select id="dSec">${secs.map(([k, l]) => `<option value="${k}" ${(p.section || 'studio') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Template</label>
    <select id="dTpl">${tpls.map(([k, l]) => `<option value="${k}" ${(p.template || 'below') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Title</label><input id="dT" value="${esc(p.title || '')}" placeholder="Heading" />
    <label>Subtitle</label><input id="dSub" value="${esc(p.subtitle || '')}" placeholder="Second heading (optional)" />
    <label>Text / description</label><textarea id="dB" placeholder="Write about the dress, the collection, or Dalia...">${esc(p.body || '')}</textarea>
    <label>Photos & video</label>
    <p class="hint" style="margin-top:-2px">Add as many as you like — people swipe through them. Videos keep their full quality and play in place.</p>
    <button class="btn ghost sm" onclick="dAddMedia()">＋ Add photos or video</button>
    <div class="up-bar hidden" id="dUp"><span id="dUpFill"></span></div>
    <div id="dMedia" class="scan-grid" style="margin-top:12px"></div>
    <button class="btn" style="margin-top:16px" id="dSave" onclick="saveDalia()">${p.id ? 'Save' : 'Publish'}</button>`);
  window._dOld = p.media || [];
  window._dNew = [];
  dPaintMedia();
}
function dPaintMedia() {
  const g = $('#dMedia'); if (!g) return;
  const cell = (src, kind, del, tag) => `<div class="scan-cell">
      ${kind === 'video'
        ? `<video src="${src}" muted playsinline preload="metadata"></video><span class="scan-play">▶</span>`
        : `<img src="${src}" alt=""/>`}
      <button class="scan-del" onclick="${del}" aria-label="Remove">✕</button>
      <span class="scan-tag${tag === 'new' ? ' new' : ''}">${tag}</span></div>`;
  const old = (window._dOld || []).filter((m) => m.id).map((m) => {
    const c = cell(m.kind === 'video' && m.poster ? esc(mediaUrl(m.poster)) : esc(mediaUrl(m.file)),
      m.kind === 'video' && m.poster ? 'image' : m.kind, `dDelOld(${m.id})`, m.kind === 'video' ? 'video' : 'live');
    // a video can be given a cover of your choosing
    return m.kind === 'video'
      ? c.replace('</div>', `<button class="scan-cover" onclick="setPoster(${m.id})">Cover</button></div>`)
      : c;
  }).join('');
  const fresh = (window._dNew || []).map((m, i) =>
    cell(esc(mediaUrl(m.file)), m.kind, `dDelNew(${i})`, 'new')).join('');
  g.innerHTML = (old + fresh) || '<div class="scan-empty">No photos yet</div>';
}
window.dAddMedia = () => {
  const bar = $('#dUp'), fill = $('#dUpFill');
  pickMedia((m) => { window._dNew.push(m); if (bar) bar.classList.add('hidden'); dPaintMedia(); },
    (pct) => { if (bar && fill) { bar.classList.remove('hidden'); fill.style.width = Math.round(pct * 100) + '%'; } });
};
window.dDelNew = (i) => { window._dNew.splice(i, 1); dPaintMedia(); };
window.setPoster = (mediaId) => pickImage(async (b64) => {
  await PUT('/api/dalia-media/' + mediaId, { poster: b64 });
  toast('Cover set ✓');
  const post = (window._daliaPosts || []).find((x) => (x.media || []).some((m) => m.id === mediaId));
  if (post) { const m = post.media.find((x) => x.id === mediaId); if (m) m.poster = null; }
  window._daliaPosts = await GET('/api/dalia');
  const p2 = (window._daliaPosts || []).find((x) => (x.media || []).some((m) => m.id === mediaId));
  window._dOld = p2 ? p2.media : window._dOld;
  dPaintMedia();
});
window.dDelOld = (id) => confirmDel('Remove this from the post?', async () => {
  await DEL('/api/dalia-media/' + id);
  window._dOld = window._dOld.filter((m) => m.id !== id);
  dPaintMedia(); toast('Removed');
});
window.saveDalia = async () => {
  const btn = $('#dSave'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const body = { template: $('#dTpl').value, section: $('#dSec').value, title: $('#dT').value,
    subtitle: $('#dSub').value, body: $('#dB').value, media: window._dNew || [] };
  try {
    if (window._dEditId) await PUT('/api/dalia/' + window._dEditId, body);
    else await POST('/api/dalia', body);
    closeModal(); toast('Saved'); go('dalia');
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } toast(e.message); }
};
window.delDalia = (id) => confirmDel('Delete post?', async () => { await DEL('/api/dalia/' + id); go('dalia'); });

/* ============ DRESSES ============ */
PAGES.dresses = async (c) => {
  if (!['admin', 'manager', 'staff'].includes(state.user.role)) return PAGES.mydresses(c); // customers: own only
  const canEdit = ['admin', 'manager'].includes(state.user.role); // staff: browse + read-only detail
  const isStaff = state.user.role === 'staff'; // sees the garment, never whose it is
  const [dresses, customers, allUsers] = await Promise.all([GET('/api/dresses'), GET('/api/users?role=customer'), GET('/api/users')]);
  const staff = allUsers.filter((u) => u.role === 'staff' || u.role === 'manager');
  window._dressRef = { customers, staff };
  window._dresses = dresses;
  const stEn = { open: 'New', in_progress: 'In progress', delivered: 'Delivered' };
  const stCls = { open: 'warn', in_progress: '', delivered: 'ok' };
  const f = window._dressF || { status: 'all', month: '', assigned: false };
  let list = dresses.slice();
  if (f.status !== 'all') list = list.filter((d) => d.status === f.status);
  if (f.assigned) list = list.filter((d) => d.assigned_to);
  if (f.month) list = list.filter((d) => (d.delivery_date || '').slice(0, 7) === f.month);
  // sort: soonest UPCOMING delivery first, then past (most recent first), no-date last
  const tday = today();
  list.sort((a, b) => {
    const A = a.delivery_date || '', B = b.delivery_date || '';
    if (!A && !B) return 0; if (!A) return 1; if (!B) return -1;
    const au = A >= tday, bu = B >= tday;
    if (au && bu) return A < B ? -1 : 1;
    if (au) return -1; if (bu) return 1;
    return A > B ? -1 : 1;
  });
  const statuses = [['all', 'All'], ['open', 'New'], ['in_progress', 'In progress'], ['delivered', 'Delivered']];
  c.innerHTML = title('Dresses', '') +
    dressTotals(list) +
    `${canEdit ? '<button class="btn" onclick="addDress()">＋ Register a dress</button>' : ''}
    <div class="filters" style="margin-top:12px">${statuses.map(([k, l]) => `<span class="chip ${f.status === k && !f.assigned ? 'active' : ''}" onclick="dressFilter('status','${k}')">${l}</span>`).join('')}
      <span class="chip ${f.assigned ? 'active' : ''}" onclick="dressFilter('assigned','x')">👤 Assigned</span></div>
    <div class="row" style="margin:0 0 12px;align-items:center;gap:8px">
      <input type="month" value="${f.month}" onchange="dressFilter('month',this.value)" style="width:auto;padding:8px" />
      ${f.month ? `<button class="btn ghost sm" onclick="dressFilter('month','')">Clear month</button>` : ''}
      <span class="hint">${list.length} dress(es)</span></div>
    <input placeholder="${isStaff ? '🔍 Search by dress number' : '🔍 Search by client name'}" value="${esc(window._dressSearch || '')}" oninput="window._dressSearch=this.value; liveSearch(this.value,'#dressList')" style="width:100%;padding:9px 12px;margin:0 0 10px" />
    <div class="grid g2" id="dressList">${list.length ? list.map((d) => `
      <div class="card" data-name="${esc(isStaff ? 'dress #' + d.id : (d.customer_name || '').toLowerCase())}" style="margin:0;position:relative">
        ${d.unread ? `<span class="notif-dot" title="New update">${d.unread}</span>` : ''}
        ${d.cover_image ? `<img class="thumb" style="object-position:${esc(d.cover_pos || '50% 50%')}" src="${esc(mediaUrl(d.cover_image))}" onclick="openDress(${d.id})"/>` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:30px" onclick="openDress(${d.id})">👗</div>`}
        <div class="nm" style="font-weight:600;margin-top:8px">${isStaff ? 'Dress #' + d.id : esc(d.customer_name)}</div>
        <div class="sub muted" style="font-size:12px">Delivery ${dt(d.delivery_date)} · <span class="badge ${stCls[d.status] || ''}">${stEn[d.status] || d.status}</span></div>
        <div class="sub muted" style="font-size:12px">${d.assignee_name ? '👤 ' + esc(d.assignee_name) : '<span style="color:var(--warn)">Unassigned</span>'}${isStaff ? '' : ' · ' + d.fittings.length + ' fittings'}</div>
        ${dressMoney(d)}
        <button class="btn sec sm" style="margin-top:8px" onclick="openDress(${d.id})">Details</button>
      </div>`).join('') : empty('No dresses match this filter', '👗')}</div>`;
  if (window._dressSearch) liveSearch(window._dressSearch, '#dressList');
  if (window._openDressAfter) { const oid = window._openDressAfter; window._openDressAfter = null; if (dresses.some((x) => x.id === oid)) setTimeout(() => openDress(oid), 30); }
};
/* The whole filtered list added up: what it is worth, what came in, what the
   fabric cost and what is left over. Follows the filters, so a month chosen
   above is the month these totals are for. Admin only — nobody else has prices. */
function dressTotals(list) {
  if (state.user.role !== 'admin' || !list.length) return '';
  const val = list.reduce((a, x) => a + (x.price || 0), 0);
  const paid = list.reduce((a, x) => a + (x.paid || 0), 0);
  const rem = list.reduce((a, x) => a + (x.remaining || 0), 0);
  const mat = list.reduce((a, x) => a + (x.material_cost || 0), 0);
  const margin = val - mat;
  const pct = val ? Math.round((margin / val) * 100) : 0;
  const cell = (label, v, cls, note) => `<div class="dt-cell"><div class="dt-k">${label}</div>
    <div class="dt-v ${cls || ''}">${money(v)}</div>${note ? `<div class="dt-n">${note}</div>` : ''}</div>`;
  return `<div class="dress-tot">
    <div class="dt-ttl">${list.length} dress${list.length === 1 ? '' : 'es'} in this view</div>
    <div class="dt-grid">
      ${cell('Total value', val)}
      ${cell('Collected', paid, 'ok')}
      ${cell(rem ? 'Remaining' : 'Settled', rem, rem ? 'bad' : 'ok')}
      ${cell('Materials', mat, 'bad')}
      ${cell('Profit', margin, margin >= 0 ? 'ok' : 'bad', val ? pct + '% of the price' : '')}
    </div>
    <div class="dt-more" onclick="go('dressprofit')">📈 Profit, dress by dress ›</div>
  </div>`;
}
/* What the dress is worth, what has come in, what is still owed — and what it
   actually leaves once its fabric is paid for. Only the admin sees it: the
   price is hidden from everybody else, here as everywhere. */
function dressMoney(d) {
  if (state.user.role !== 'admin') return '';
  if (!d.price) return '<div class="dr-money none">Price not set yet</div>';
  const left = d.remaining || 0;
  const mat = d.material_cost || 0;
  const profit = (d.price || 0) - mat;
  return `<div class="dr-money">
    <div class="dr-row"><span class="k">Price</span><span class="v">${money(d.price)}</span></div>
    <div class="dr-row"><span class="k">Paid</span><span class="v ok">${money(d.paid || 0)}</span></div>
    <div class="dr-row"><span class="k">${left ? 'Remaining' : 'Settled'}</span><span class="v ${left ? 'bad' : 'ok'}">${money(left)}</span></div>
    <div class="dr-row"><span class="k">Materials</span><span class="v bad">${money(mat)}</span></div>
    <div class="dr-row profit"><span class="k">Profit</span><span class="v ${profit >= 0 ? 'ok' : 'bad'}">${money(profit)}${mat ? ` <i>${Math.round((profit / d.price) * 100)}%</i>` : ''}</span></div>
    ${mat ? '' : '<div class="dr-warn">No materials put against it yet</div>'}
  </div>`;
}

/* ============ DRESS PROFIT ============
   Every dress: what it sold for, what its fabric cost, what it left. One screen
   that answers "which dresses actually made money" — which the dashboard, built
   on the money that moved in a month, can never answer on its own, because a
   dress is paid for over months and its fabric is bought in a lump. */
PAGES.dressprofit = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '📈'); return; }
  const dresses = await GET('/api/dresses');
  window._dresses = dresses; // so opening one from here does not fetch the list again
  const priced = dresses.filter((d) => d.price > 0);
  const noPrice = dresses.length - priced.length;
  const sort = window._dpSort || 'profit';
  const rows = priced.map((d) => {
    const mat = d.material_cost || 0;
    const profit = (d.price || 0) - mat;
    return { ...d, mat, profit, pct: d.price ? profit / d.price : 0 };
  });
  rows.sort((a, b) => sort === 'pct' ? b.pct - a.pct : sort === 'price' ? b.price - a.price : b.profit - a.profit);
  const val = rows.reduce((a, x) => a + x.price, 0);
  const mat = rows.reduce((a, x) => a + x.mat, 0);
  const profit = val - mat;
  const noMat = rows.filter((x) => !x.mat).length;
  const sorts = [['profit', 'Most profit'], ['pct', 'Best %'], ['price', 'Priciest']];
  c.innerHTML = `<div class="row" style="margin-bottom:4px"><button class="btn sec sm" onclick="goBack()">‹ Back</button></div>` +
    title('Dress profit', '📈') +
    `<div class="dp-tot">
       <div class="dp-tot-k">${rows.length} dress${rows.length === 1 ? '' : 'es'} with a price on them</div>
       <div class="dp-tot-v ${profit >= 0 ? 'ok' : 'bad'}">${money(profit)}</div>
       <div class="dp-tot-m">${money(val)} in prices, less ${money(mat)} of materials${val ? ` · ${Math.round((profit / val) * 100)}%` : ''}</div>
     </div>
     ${noMat || noPrice ? `<div class="card dp-note">
       ${noMat ? `<div>⚠️ <b>${noMat} dress${noMat === 1 ? '' : 'es'}</b> ${noMat === 1 ? 'has' : 'have'} no materials put against ${noMat === 1 ? 'it' : 'them'} yet, so ${noMat === 1 ? 'its' : 'their'} profit here is the whole price. Put the invoices on ${noMat === 1 ? 'it' : 'them'} under Purchases and this comes right.</div>` : ''}
       ${noPrice ? `<div>${noMat ? '<br>' : ''}👗 <b>${noPrice} dress${noPrice === 1 ? '' : 'es'}</b> ${noPrice === 1 ? 'has' : 'have'} no price set, so ${noPrice === 1 ? 'it is' : 'they are'} left out of this.</div>` : ''}
     </div>` : ''}
     <div class="filters" style="margin:12px 0 10px">${sorts.map(([k, l]) => `<span class="chip ${sort === k ? 'active' : ''}" onclick="dpSort('${k}')">${l}</span>`).join('')}</div>
     ${rows.length ? rows.map((d) => {
      const matShare = d.price ? Math.max(0, Math.min(100, (d.mat / d.price) * 100)) : 0;
      return `<div class="dp-row" onclick="openDress(${d.id})">
        <div class="dp-top"><span class="dp-nm">${esc(d.customer_name)}</span>
          <span class="dp-v ${d.profit >= 0 ? 'ok' : 'bad'}">${money(d.profit)}</span></div>
        <div class="dp-bar"><i class="mat" style="width:${matShare}%"></i><i class="pro" style="width:${100 - matShare}%"></i></div>
        <div class="dp-sub">${money(d.price)} price · ${money(d.mat)} materials${d.mat ? ` · <b class="${d.profit >= 0 ? '' : 'bad'}">${Math.round(d.pct * 100)}%</b> profit` : ' · <span class="dp-flag">no materials yet</span>'}</div>
      </div>`;
    }).join('') : empty('No dress has a price on it yet', '📈')}`;
};
window.dpSort = (k) => { window._dpSort = k; go('dressprofit'); };

window.dressFilter = (k, v) => {
  const f = window._dressF || { status: 'all', month: '', assigned: false };
  if (k === 'assigned') f.assigned = !f.assigned;
  else if (k === 'status') { f.status = v; f.assigned = false; }
  else f[k] = v;
  window._dressF = f; go('dresses');
};
/* Registering a dress is a screen with two tabs — not a wizard */
window.addDress = () => { window._newDressTab = 'dress'; go('newdress'); };

PAGES.newdress = async (c) => {
  const ref = window._dressRef || {};
  const customers = ref.customers || (await GET('/api/users')).filter((u) => u.role === 'customer');
  const staff = ref.staff || [];
  const tab = window._newDressTab === 'occasion' ? 'occasion' : 'dress';
  window._newDressCover = window._newDressCover || null;

  c.innerHTML = luxBackdrop() + '<div class="home-lux">' + title('Register a dress', '') +
    `<div class="dtabs">
      <button class="dtab${tab === 'dress' ? ' on' : ''}" onclick="newDressTab('dress')"><span class="dtab-ic">👗</span>The dress</button>
      <button class="dtab${tab === 'occasion' ? ' on' : ''}" onclick="newDressTab('occasion')"><span class="dtab-ic">✨</span>The occasion</button>
    </div>
    <div class="card" style="padding:4px 15px 18px">
      <div class="dpane${tab === 'dress' ? ' on' : ''}" data-pane="dress">
        <label>Client name</label><input id="nd_name" placeholder="Her name" />
        <label>Phone</label>${phoneField('nd_phone', '', { name: 'nd_name' })}
        <label>Delivery date</label><input id="nd_date" type="date" />
        <label>Status</label>
        <select id="nd_status">
          <option value="open">New</option><option value="in_progress">In progress</option><option value="delivered">Delivered</option>
        </select>
        <label>Assign to</label>
        <select id="nd_assigned"><option value="">— unassigned —</option>
          ${staff.map((x) => `<option value="${x.id}">${esc(x.name)}${x.role === 'manager' ? ' (Manager)' : ''}</option>`).join('')}</select>
        <label>Link to a client account <span class="hint">(optional)</span></label>
        <select id="nd_client"><option value="">—</option>
          ${customers.map((u) => `<option value="${u.id}">${esc(u.name)}${u.email ? ' · ' + esc(u.email) : ''}</option>`).join('')}</select>
        <label>Notes</label><textarea id="nd_note" placeholder="Navy evening gown, low back..."></textarea>
        <label>Dress photo <span class="hint">(required)</span></label>
        <button class="btn ghost sm" onclick="ndPic()">📷 Add a photo</button>
        <div id="nd_prev" style="margin-top:10px"></div>
      </div>
      <div class="dpane${tab === 'occasion' ? ' on' : ''}" data-pane="occasion">
        <p class="hint">The same questions a client answers when she writes to you — so the atelier knows what it is making before the first fitting.</p>
        ${briefFields(window._newDressBrief, 'nd_')}
      </div>
    </div>
    <button class="btn" id="ndSave" onclick="saveNewDress()">Register the dress</button>
    <button class="btn sec" style="margin-top:10px" onclick="go('dresses')">Cancel</button>
    </div>`;
  briefLookToggle('nd_');
  ndPaint();
};
window.newDressTab = (t) => {
  // keep what is typed on the tab we are leaving
  const name = document.getElementById('nd_name');
  if (name) window._newDressDraft = {
    name: name.value, phone: $('#nd_phone').value, date: $('#nd_date').value,
    status: $('#nd_status').value, assigned: $('#nd_assigned').value,
    client: $('#nd_client').value, note: $('#nd_note').value,
  };
  if (document.getElementById('nd_garment')) window._newDressBrief = readBrief('nd_');
  window._newDressTab = t; go('newdress');
};
function ndPaint() {
  const d = window._newDressDraft;
  if (d && document.getElementById('nd_name')) {
    $('#nd_name').value = d.name || ''; $('#nd_phone').value = d.phone || '';
    $('#nd_date').value = d.date || ''; $('#nd_status').value = d.status || 'open';
    $('#nd_assigned').value = d.assigned || ''; $('#nd_client').value = d.client || '';
    $('#nd_note').value = d.note || '';
  }
  const box = document.getElementById('nd_prev');
  if (box) box.innerHTML = window._newDressCover
    ? `<div class="scan-cell" style="width:110px"><img src="${window._newDressCover}" alt=""/>
        <button class="scan-del" onclick="window._newDressCover=null;ndPaint()" aria-label="Remove">✕</button></div>` : '';
}
window.ndPic = () => pickImage((b64) => { window._newDressCover = b64; ndPaint(); });
window.saveNewDress = async () => {
  const nameEl = document.getElementById('nd_name');
  const draft = nameEl ? {
    name: nameEl.value, phone: $('#nd_phone').value, date: $('#nd_date').value,
    status: $('#nd_status').value, assigned: $('#nd_assigned').value,
    client: $('#nd_client').value, note: $('#nd_note').value,
  } : (window._newDressDraft || {});
  const brief = document.getElementById('nd_garment') ? readBrief('nd_') : window._newDressBrief;
  if (!String(draft.name || '').trim() || !window._newDressCover) {
    window._newDressDraft = draft;
    if (window._newDressTab !== 'dress') { window._newDressTab = 'dress'; go('newdress'); }
    return toast(!String(draft.name || '').trim() ? 'The client name is needed' : 'Add a photo of the dress', 'error');
  }
  const btn = $('#ndSave'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await POST('/api/dresses', {
      customer_name: draft.name.trim(), phone: draft.phone, delivery_date: draft.date,
      status: draft.status, assigned_to: draft.assigned || null, customer_user_id: draft.client || null,
      note: draft.note, cover_image: window._newDressCover, brief,
    });
    window._newDressDraft = null; window._newDressBrief = null; window._newDressCover = null;
    toast('Dress registered ✓'); go('dresses');
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Register the dress'; } toast(e.message); }
};

/* Opening a dress leaves the list and goes to its own screen. */
window.openDress = (id) => { window._dressId = id; go('dress'); };

PAGES.dress = async (c) => {
  const id = window._dressId;
  if (!id) return go('dresses');
  // arriving straight from a notification or a refresh: fetch what the list would have held
  if (!window._dresses || !window._dresses.some((x) => x.id === id)) {
    const [dresses, allUsers] = await Promise.all([GET('/api/dresses'), GET('/api/users')]);
    window._dresses = dresses;
    window._dressRef = { customers: allUsers.filter((u) => u.role === 'customer'),
      staff: allUsers.filter((u) => u.role === 'staff' || u.role === 'manager') };
  }
  const d = window._dresses.find((x) => x.id === id);
  if (!d) return go('dresses');
  const staff = (window._dressRef && window._dressRef.staff) || [];
  const canEdit = ['admin', 'manager'].includes(state.user.role); // staff: read-only
  const isAdmin = state.user.role === 'admin';
  const isStaff = state.user.role === 'staff';
  const ro = canEdit ? '' : ' readonly';
  const stEn = { open: 'New', in_progress: 'In progress', delivered: 'Delivered' };
  const stCls = { open: 'warn', in_progress: '', delivered: 'ok' };
  const pane = (key, html) => `<div class="dpane" data-pane="${key}">${html}</div>`;

  const details = pane('details', `
    <label>Client name</label><input id="dName_${id}" value="${esc(d.customer_name || '')}"${ro} />
    ${isAdmin ? `<label>Phone</label>${phoneField(`dPhone_${id}`, d.phone, { name: `dName_${id}`, readonly: !!ro })}` : ''}
    <label>Delivery date</label><input id="dDate_${id}" type="date" value="${d.delivery_date ? String(d.delivery_date).slice(0, 10) : ''}"${ro} />
    <label>Notes</label><textarea id="dNote_${id}"${ro}>${esc(d.note || '')}</textarea>
    <label>Status</label>
    ${canEdit ? `<select id="statSel_${id}" onchange="saveDressStatus(${id})">${[['open', 'New'], ['in_progress', 'In progress'], ['delivered', 'Delivered']].map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`
      : `<span class="badge ${d.status === 'delivered' ? 'ok' : 'warn'}">${stEn[d.status] || d.status}</span>`}
    <label>Assigned staff</label>
    ${canEdit ? `<select id="assignSel_${id}" onchange="saveAssign(${id})"><option value="">— unassigned —</option>${staff.map((s) => `<option value="${s.id}" ${d.assigned_to === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`
      : `<div class="hint">${d.assignee_name ? '👤 ' + esc(d.assignee_name) : 'Unassigned'}</div>`}
    ${canEdit ? `<div class="divider"></div>
      <div class="row">
        <button class="btn" onclick="saveDressDetails(${id})">Save changes</button>
        <button class="btn danger" onclick="delDress(${id})">Delete booking</button>
      </div>` : ''}`);

  const measure = pane('measure', `
    <p class="hint">Every measurement for this gown, in one sheet.</p>
    <button class="btn sec" onclick="openMeasurements(${id})">📐 Open the measurement sheet</button>`);

  const occasion = pane('occasion', `
    ${d.brief ? briefCard(d.brief) : '<p class="hint">Nothing recorded about the occasion yet.</p>'}
    ${canEdit ? `<div class="sec-title">Edit the occasion</div>
      ${briefFields(d.brief, 'od_')}
      <button class="btn" style="margin-top:14px" onclick="saveDressBrief(${id})">Save the occasion</button>` : ''}`);

  // Uploaded files carry the gallery and the reorder strip; linked videos cannot
  // be part of either, so they sit under their own heading as players.
  const files = d.images.filter((im) => im.image);
  const links = d.images.filter((im) => !im.image && im.video_url);
  // Counting links as "photos" put a count above a pane reading "No photos yet".
  const mediaTab = links.length
    ? (files.length ? `Photos (${files.length}) · 🎬 ${links.length}` : `Videos (${links.length})`)
    : `Photos${files.length ? ' (' + files.length + ')' : ''}`;
  const photos = pane('photos', `
    ${files.length ? gallery(files.map((im) => ({ file: im.image, kind: isVideoFile(im.image) ? 'video' : 'image' }))) : ''}
    <div class="sec-title">All photos ${(canEdit && files.length > 1) ? '<span class="hint" style="font-weight:400">· drag to reorder · first = cover</span>' : ''}</div>
    <div class="dphotos" id="dphotos_${id}">${files.map((im, i) => `<div class="dphoto" data-id="${im.id}">
      ${isVideoFile(im.image)
        ? `<video class="thumb" style="aspect-ratio:3/4;object-fit:cover;${canEdit ? 'pointer-events:none' : ''}" src="${esc(mediaUrl(im.image))}" muted playsinline preload="metadata"></video>
           <span class="cover-badge" style="left:6px;right:auto">▶ Video</span>`
        : `<img class="thumb" style="aspect-ratio:3/4;${canEdit ? 'pointer-events:none' : 'cursor:zoom-in'}" src="${esc(mediaUrl(im.image))}"${canEdit ? '' : ` onclick="lightbox('${esc(mediaUrl(im.image))}')"`} />
           ${i === 0 ? '<span class="cover-badge">★ Cover</span>' : ''}`}
      ${canEdit ? `<button class="dphoto-del" onclick="delDressImg(${im.id},${id})">✕</button>` : ''}</div>`).join('') || '<div class="hint">No photos yet</div>'}</div>
    ${links.length ? `<div class="sec-title">Videos 🎬</div>
      ${links.map((im) => `<div style="margin-bottom:12px">
        ${linkedVideo(im.video_url, { title: im.caption || 'Dress video' })}
        <div class="row" style="margin-top:6px;align-items:center">
          <span class="hint" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(im.caption || im.video_url)}</span>
          ${canEdit ? `<button class="btn-icon" onclick="delDressImg(${im.id},${id})">🗑</button>` : ''}</div>
      </div>`).join('')}` : ''}
    ${canEdit ? `<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
      <button class="btn ghost sm" onclick="addDressImg(${id})">＋ Photo</button>
      <button class="btn ghost sm" onclick="addDressVideo(${id})">🎬 Video</button>
      <button class="btn ghost sm" onclick="addDressVideoLink(${id})">🔗 Video link</button>
      ${d.cover_image ? `<button class="btn ghost sm" onclick="adjustCover(${id})">⛶ Adjust preview</button>` : ''}</div>` : ''}`);

  // The money is the admin's alone — the tab itself does not exist for anybody
  // else, rather than existing and being empty.
  const moneyPane = isAdmin ? pane('money', `
    ${isAdmin ? `<label>Price 🔒 <span class="hint">(admin only — hidden from others)</span></label>
      <input id="dPrice_${id}" type="number" inputmode="decimal" value="${d.price || 0}" oninput="dressPriceLive(${id})" />
      <div class="row" id="dPriceSave_${id}" style="display:none;margin-top:10px">
        <button class="btn sm" onclick="saveDressPrice(${id})">Save the price</button>
        <button class="btn ghost sm" onclick="undoDressPrice(${id})">Undo</button>
      </div>
      <div class="sec-title">Pricing & deposits 💰</div>
      <div class="card" style="box-shadow:none;margin:0 0 8px">
        ${kv('Material cost', money(d.material_cost || 0), 'bad')}
        <span id="dProfit_${id}">${kv('Profit', money(d.profit || 0), (d.profit || 0) >= 0 ? 'ok' : 'bad')}</span>
        ${kv('Paid (deposits)', money(d.paid || 0), 'ok')}
        <span id="dRemain_${id}">${kv('Remaining', money(d.remaining || 0), (d.remaining || 0) ? 'bad' : 'ok')}</span>
      </div>
      <div id="dpay_${id}"><div class="hint">Loading…</div></div>
      <button class="btn sec sm" style="margin-top:6px" onclick="addDressPayment(${id})">＋ Add payment / deposit</button>` : ''}`) : '';

  const materials = canEdit ? pane('materials', `
    <div id="dmat_${id}"><div class="hint">Loading…</div></div>
    <button class="btn sec sm" style="margin-top:10px" onclick="newPurchase(${id})">＋ Add material purchase</button>`) : '';

  const client = pane('client', `
    <div class="sec-title">Fittings</div>
    ${d.fittings.length ? d.fittings.map((f) => `<div class="item"><div class="av">${f.done ? '✓' : '◷'}</div>
      <div class="main"><div class="nm">${dt(f.fitting_date)}</div><div class="sub">${f.note ? esc(f.note) : ''}</div></div>
      ${canEdit ? `<button class="btn-icon" onclick="delFitting(${f.id},${id})">🗑</button>` : ''}</div>`).join('') : '<div class="hint">No fittings scheduled</div>'}
    ${canEdit ? `<button class="btn ghost sm" style="margin-top:8px" onclick="addFitting(${id})">＋ Fitting date</button>` : ''}
    <div class="sec-title">Client updates 💬</div>
    <div id="dupd_${id}"><div class="hint">Loading…</div></div>
    <button class="btn sec" style="margin-top:8px" onclick="updateClient(${id})">📨 Send an update / photo to the client</button>`);

  // Staff get the garment and nothing about the woman wearing it: the photos to
  // work from and the measurements to cut to. The other panes are not rendered
  // at all, so there is nothing to reach by switching tabs.
  // Staff are shown the gown and nothing else: the occasion it is for, its
  // photos and its measurements — to read, never to change. No client, no
  // money, no status, and every pane below drops its controls for them.
  const tabs = isStaff ? [
    ['occasion', '✨', 'Occasion'],
    ['photos', '📷', mediaTab],
    ['measure', '📐', 'Measurements'],
  ] : [
    ['details', '📋', 'Client info'],
    ['occasion', '✨', 'Occasion'],
    ['photos', '📷', mediaTab],
    ['measure', '📐', 'Measurements'],
    ...(moneyPane ? [['money', '💰', 'Fees']] : []),
    ...(materials ? [['materials', '🧵', 'Purchases']] : []),
    ['client', '💬', `Client${d.fittings.length ? ' (' + d.fittings.length + ')' : ''}`],
  ];
  const firstTab = tabs.some(([k]) => k === window._dressTab) ? window._dressTab : tabs[0][0];

  c.innerHTML = luxBackdrop() + '<div class="home-lux">' +
    `<div class="dress-head">
      ${d.cover_image ? `<div class="dh-photo" style="background-image:url('${esc(mediaUrl(d.cover_image))}');background-position:${esc(d.cover_pos || '50% 50%')}" onclick="dressTab(${id},'photos')"></div>`
        : '<div class="dh-photo dh-none">👗</div>'}
      <div class="dh-body">
        <div class="dh-name">${isStaff ? 'Dress #' + id : esc(d.customer_name)}</div>
        <div class="dh-sub">${d.delivery_date ? 'Delivery ' + dt(d.delivery_date) : 'No delivery date'}
          · <span class="badge ${stCls[d.status] || ''}">${stEn[d.status] || d.status}</span></div>
        ${(!isStaff && d.note) ? `<div class="dh-note">${esc(d.note)}</div>` : ''}
        <div class="dh-sub">${d.assignee_name ? '👤 ' + esc(d.assignee_name) : '<span style="color:var(--warn)">Unassigned</span>'}</div>
      </div>
    </div>
    <div class="dtabs" id="dtabs_${id}">
      ${tabs.map(([k, ic, label]) => `<button class="dtab${k === firstTab ? ' on' : ''}" data-tab="${k}" onclick="dressTab(${id},'${k}')">
        <span class="dtab-ic">${ic}</span>${esc(label)}</button>`).join('')}
    </div>
    <div class="dpanes card" id="dpanes_${id}">${isStaff ? photos + measure : details + occasion + photos + measure + moneyPane + materials + client}</div>
    </div>`;
  dressTab(id, firstTab);
  briefLookToggle('od_');
  if (canEdit) wireDressPhotos(id);
  loadDressUpdates(id);
  if (canEdit) loadDressMaterials(id);
  if (isAdmin) loadDressPayments(id);
};

/* switch tab: panes stay in the DOM so their loaders keep working */
window.dressTab = (id, key) => {
  window._dressTab = key;
  const bar = document.getElementById('dtabs_' + id), panes = document.getElementById('dpanes_' + id);
  if (!bar || !panes) return;
  [...bar.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
  [...panes.children].forEach((p) => p.classList.toggle('on', p.dataset.pane === key));
  const active = bar.querySelector('.dtab.on');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

async function loadDressMaterials(id) {
  const box = document.getElementById('dmat_' + id); if (!box) return;
  try {
    const items = await GET('/api/dresses/' + id + '/purchases');
    const total = items.reduce((a, x) => a + (x.amount || 0), 0);
    // Tapping a material opens the invoice it came from, where it can be edited.
    box.innerHTML = items.length ? `<div class="card" style="box-shadow:none;margin:0">${items.map((x) => `<div class="item" style="cursor:pointer" onclick="openInvoiceFor(${x.invoice_id})">
      <div class="av" style="background:#fff">🧾</div>
      <div class="main"><div class="nm">${esc(x.item || '—')}</div><div class="sub">${x.vendor_name ? esc(x.vendor_name) + ' · ' : ''}${!x.vendor_name && x.shop ? esc(x.shop) + ' · ' : ''}${x.invoice_date ? dt(x.invoice_date) : dt(x.created_at)} · tap to open the invoice ›</div></div>
      <div class="sub" style="font-weight:700">${money(x.amount)}</div></div>`).join('')}
      <div class="item" style="border-top:2px solid var(--line)"><div class="main"><div class="nm">Total materials</div></div><div style="font-weight:800;letter-spacing:-.3px">${money(total)}</div></div></div>` : '<div class="hint">No materials bought yet — add the first invoice below</div>';
  } catch (e) { box.innerHTML = '<div class="hint">Could not load materials</div>'; }
}
/* From a dress, open the invoice a material came from. The purchases page may
   never have been visited, so the invoices and the dress list are fetched first. */
window.openInvoiceFor = async (invoiceId) => {
  if (!invoiceId) return;
  try {
    const [invoices, dresses] = await Promise.all([
      GET('/api/purchases'),
      window._allDressesForPurchase ? Promise.resolve(window._allDressesForPurchase) : GET('/api/dresses'),
    ]);
    window._purchases = invoices; window._allDressesForPurchase = dresses;
    if (state.user.role === 'admin' && !window._purVendors) window._purVendors = await GET('/api/vendors');
    if (!invoices.some((x) => x.id === invoiceId)) return toast('That invoice is gone', 'error');
    openPurchase(invoiceId);
  } catch (e) { toast(e.message, 'error'); }
};
async function loadDressPayments(id) {
  const box = document.getElementById('dpay_' + id); if (!box) return;
  try {
    const pays = await GET('/api/dresses/' + id + '/payments');
    box.innerHTML = pays.length ? `<div class="card" style="box-shadow:none;margin:0">${pays.map((p) => `<div class="item">
      <div class="av">${p.image ? `<img class="thumb" style="width:40px;height:40px;aspect-ratio:1" src="${esc(mediaUrl(p.image))}" onclick="lightbox('${esc(mediaUrl(p.image))}')"/>` : (p.method === 'cash' ? '💵' : '🏦')}</div>
      <div class="main"><div class="nm">${money(p.amount)}</div><div class="sub">${p.method === 'cash' ? '💵 Cash' : '🏦 Transfer'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
      <button class="btn-icon" onclick="delDressPayment(${p.id},${id})">🗑</button></div>`).join('')}</div>` : '<div class="hint">No payments yet</div>';
  } catch (e) { box.innerHTML = '<div class="hint">Could not load payments</div>'; }
}
window.addDressPayment = (id) => formModal('Add dress payment', [
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'method', label: 'Method', type: 'select', value: 'transfer', options: [{ value: 'transfer', label: 'Bank transfer / Instapay' }, { value: 'cash', label: 'Cash' }] },
  { name: 'paid_at', label: 'Date', type: 'date', value: today() },
  { name: 'note', label: 'Note (e.g. deposit)', value: '' },
  { name: 'image', label: 'Receipt (optional)', type: 'image' },
], async (d) => { await POST('/api/dresses/' + id + '/payments', d); toast('Payment added'); closeModal(); refreshDress(id); });
window.delDressPayment = (pid, id) => confirmDel('Delete this payment?', async () => { await DEL('/api/dress-payments/' + pid); refreshDress(id); });
async function loadDressUpdates(id) {
  const box = document.getElementById('dupd_' + id); if (!box) return;
  try {
    const ups = await GET('/api/dresses/' + id + '/updates');
    box.innerHTML = ups.length ? ups.map(renderUpdate).join('') : '<div class="hint">No updates yet</div>';
    refreshNotifBadge(); // opening the thread marks this dress's notifications read
  } catch (e) { box.innerHTML = '<div class="hint">Failed to load updates</div>'; }
}
function renderUpdate(u) {
  const studio = ['admin', 'manager', 'staff'].includes(u.author_role);
  return `<div class="upd ${studio ? 'upd-studio' : 'upd-client'}">
    <div class="upd-h">${esc(u.author_name || '')} · <span class="muted">${timeago(u.created_at)}</span></div>
    ${u.body ? `<div class="upd-b">${esc(u.body)}</div>` : ''}
    ${u.image ? `<img class="thumb" style="max-width:170px;height:auto;aspect-ratio:auto;border-radius:8px;margin-top:6px" src="${esc(mediaUrl(u.image))}" onclick="lightbox('${esc(mediaUrl(u.image))}')"/>` : ''}
  </div>`;
}
window.updateClient = (id) => formModal('Update for the client', [
  { name: 'body', label: 'Note', type: 'textarea' },
  { name: 'image', label: 'Photo (optional)', type: 'image' },
], async (d) => { await POST('/api/dresses/' + id + '/updates', d); toast('Sent to the client ✅'); closeModal(); refreshDress(id); });
window.saveDressDetails = async (id) => {
  const name = document.getElementById('dName_' + id).value.trim();
  if (!name) return toast('Client name is required');
  const body = {
    customer_name: name,
    ...(document.getElementById('dPhone_' + id) ? { phone: document.getElementById('dPhone_' + id).value } : {}),
    delivery_date: document.getElementById('dDate_' + id).value,
    note: document.getElementById('dNote_' + id).value,
  };
  const priceEl = document.getElementById('dPrice_' + id);
  if (priceEl) body.price = Number(priceEl.value) || 0;
  await PUT('/api/dresses/' + id, body);
  toast('Changes saved'); refreshDress(id);
};

/* The figures under the price follow it as it is typed. They are worked out the
   same way the server works them out, so what is on screen while typing is what
   will be there once it is saved — and the Save button only shows itself once
   the number is no longer the one on file. */
window.dressPriceLive = (id) => {
  const el = document.getElementById('dPrice_' + id);
  const d = (window._dresses || []).find((x) => x.id === id);
  if (!el || !d) return;
  const price = Number(el.value) || 0;
  const profit = price - (d.material_cost || 0);
  const remaining = Math.max(0, price - (d.paid || 0));
  const p = document.getElementById('dProfit_' + id);
  const r = document.getElementById('dRemain_' + id);
  if (p) p.innerHTML = kv('Profit', money(profit), profit >= 0 ? 'ok' : 'bad');
  if (r) r.innerHTML = kv('Remaining', money(remaining), remaining ? 'bad' : 'ok');
  const save = document.getElementById('dPriceSave_' + id);
  if (save) save.style.display = price === (d.price || 0) ? 'none' : '';
};
window.undoDressPrice = (id) => {
  const d = (window._dresses || []).find((x) => x.id === id);
  const el = document.getElementById('dPrice_' + id);
  if (!d || !el) return;
  el.value = d.price || 0;
  dressPriceLive(id);
};
window.saveDressPrice = async (id) => {
  const el = document.getElementById('dPrice_' + id);
  if (!el) return;
  await PUT('/api/dresses/' + id, { price: Number(el.value) || 0 });
  toast('Price saved ✓');
  window._dressTab = 'money'; // stay where she was working
  refreshDress(id);
};

/* ---- Dress measurements editor + printable PDF sheet ---- */
window.openMeasurements = (id) => {
  const d = window._dresses.find((x) => x.id === id) || {};
  let m = {}; try { m = JSON.parse(d.measurements || '{}'); } catch (e) {}
  window._measImg = d.measure_image || null;
  const canEdit = ['admin', 'manager'].includes(state.user.role); // staff: view-only
  const ro = canEdit ? '' : ' readonly';
  const who = state.user.role === 'staff' ? 'Dress #' + id : esc(d.customer_name || '');
  modal(`<h3>Measurements — ${who}</h3>
    ${canEdit ? '' : '<p class="hint" style="margin-top:-6px">Read and print. Only the studio changes a measurement.</p>'}
    <div class="grid g2">${MEASURE_FIELDS.map(([k, l]) => `<div><label>${l}</label><input id="ms_${k}" type="number" inputmode="decimal" step="0.5" value="${m[k] != null ? m[k] : ''}"${ro} /></div>`).join('')}
      <div><label>Fit</label><select id="ms_fit" ${canEdit ? '' : 'disabled'}><option value="">—</option>${['Slim', 'Front', 'Back'].map((o) => `<option ${m.fit === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
    </div>
    <label>Note</label><textarea id="ms_note"${ro}>${esc(d.measure_note || '')}</textarea>
    ${canEdit ? `<div class="row" style="margin-top:8px"><button class="btn ghost sm" onclick="pickMeasImg()">📷 Reference photo</button><span class="hint" id="msImgLbl">${d.measure_image ? 'Selected ✓' : 'None'}</span></div>` : (d.measure_image ? `<div class="ref" style="margin-top:8px"><img class="thumb" style="max-width:200px" src="${esc(mediaUrl(d.measure_image))}" onclick="lightbox('${esc(mediaUrl(d.measure_image))}')"/></div>` : '')}
    <div class="row" style="margin-top:14px">${canEdit ? `<button class="btn" onclick="saveMeasurements(${id})">Save</button>` : ''}
      <button class="btn sec" onclick="printMeasurements(${id})">🖨 PDF</button></div>`);
};
window.pickMeasImg = () => pickImage((b64) => { window._measImg = b64; const el = document.getElementById('msImgLbl'); if (el) el.textContent = 'Selected ✓'; });
window.saveMeasurements = async (id) => {
  const m = {}; MEASURE_FIELDS.forEach(([k]) => { const v = document.getElementById('ms_' + k).value; if (v !== '') m[k] = Number(v); });
  m.fit = document.getElementById('ms_fit').value;
  await PUT('/api/dresses/' + id, { measurements: m, measure_note: document.getElementById('ms_note').value, measure_image: window._measImg });
  toast('Measurements saved'); window._dresses = await GET('/api/dresses'); closeModal();
};
window.printMeasurements = (id) => {
  const d = window._dresses.find((x) => x.id === id) || {};
  const vals = {}; MEASURE_FIELDS.forEach(([k]) => { const el = document.getElementById('ms_' + k); vals[k] = el ? el.value : ''; });
  const fit = (document.getElementById('ms_fit') || {}).value || '';
  const note = (document.getElementById('ms_note') || {}).value || '';
  const img = window._measImg;
  const rows = MEASURE_FIELDS.map(([k, l]) => `<tr><td>${l}</td><td>${vals[k] || '—'}</td></tr>`).join('');
  // The sheet goes to whoever is cutting; for staff it names the dress, not her.
  const who = state.user.role === 'staff' ? 'Dress #' + id : esc(d.customer_name || '—');
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>Measurements — ${who}</title>
  <style>
    html,body{background:#fff}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#14101a;padding:32px;max-width:760px;margin:auto}
    .head{text-align:center;border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:18px}
    .brand{font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;letter-spacing:3px;color:#7c3aed}
    .sub{color:#777;font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-top:4px}
    .meta{display:flex;gap:20px;flex-wrap:wrap;justify-content:space-between;margin:0 4px 16px;font-size:14px}
    table{width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden}
    td{border:1px solid #e9e2f7;padding:10px 14px;font-size:15px}
    td:first-child{background:#f6f2fe;font-weight:700;width:60%;color:#4a2f8f}
    .note{margin-top:16px;background:#faf7ff;border:1px solid #e9e2f7;border-radius:10px;padding:12px;font-size:14px}
    .ref{margin-top:18px;text-align:center}.ref img{max-width:320px;border-radius:12px;border:1px solid #e9e2f7}
    @media print{body{padding:6px}}
  </style></head><body>
    <div class="head"><div class="brand">DALIA BASSEL</div><div class="sub">Haute Couture · Measurements Sheet</div></div>
    <div class="meta"><div><b>${state.user.role === 'staff' ? 'Dress' : 'Client'}:</b> ${who}</div><div><b>Delivery:</b> ${d.delivery_date ? dt(d.delivery_date) : '—'}</div><div><b>Fit:</b> ${esc(fit || '—')}</div></div>
    <table>${rows}</table>
    ${note ? `<div class="note"><b>Note:</b> ${esc(note)}</div>` : ''}
    ${img ? `<div class="ref"><div style="font-weight:700;margin-bottom:6px">Reference</div><img src="${img.startsWith('data:') ? img : mediaUrl(img)}"></div>` : ''}
    <scr` + `ipt>window.onload=function(){setTimeout(function(){window.print()},400)}</scr` + `ipt>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(html); w.document.close();
};

/* ============ DRESS MATERIAL PURCHASES (invoices with dress-linked items) ============ */
PAGES.purchases = async (c) => {
  if (state.user.role !== 'admin' && state.user.role !== 'manager') { c.innerHTML = empty('Managers only', '🧾'); return; }
  const [invoices, dresses, vendors] = await Promise.all([GET('/api/purchases'), GET('/api/dresses'), (state.user.role === 'admin' ? GET('/api/vendors') : Promise.resolve([]))]);
  window._allDressesForPurchase = dresses;
  window._purchases = invoices;
  window._purVendors = vendors;
  const f = window._purMonth || '';
  // newest invoice first — they arrive in the order they were typed in, which is
  // no order at all once a month has been caught up on out of sequence
  const byDate = (a, b) => String(b.invoice_date || b.created_at || '').localeCompare(String(a.invoice_date || a.created_at || ''));
  invoices.sort(byDate);
  const list = f ? invoices.filter((inv) => ((inv.invoice_date || inv.created_at || '').slice(0, 7) === f)) : invoices;
  const total = list.reduce((a, inv) => a + (inv.total || 0), 0);
  const items = list.reduce((a, inv) => a + (inv.lines ? inv.lines.length : 0), 0);
  c.innerHTML = pageHead('Purchases', '🧾') +
    `<div class="grid g2" style="margin-bottom:10px">
       <div class="stat"><div class="n serif" style="color:var(--bad)">${money(total)}</div><div class="l">${f ? monthLabel(f) : 'All-time'} spent</div></div>
       <div class="stat"><div class="n serif">${list.length}</div><div class="l">${items} item${items === 1 ? '' : 's'} · invoices</div></div>
     </div>
    <button class="btn" onclick="newPurchase()">＋ New purchase (invoice)</button>
    ${monthChips(invoices.map((inv) => inv.invoice_date || inv.created_at), f, 'setPurMonth')}
    <div style="margin-top:12px">${list.length ? list.map((inv) => {
      const n = inv.lines ? inv.lines.length : 0;
      // the date first, then who it is from, then what it was and which dress it
      // went on — the order somebody reads an invoice in
      return `<div class="card pu-card" onclick="openPurchase(${inv.id})">
      <div class="inv-head">
        ${inv.image ? `<img class="inv-scan" src="${esc(mediaUrl(inv.image))}" alt=""/>` : '<div class="inv-scan pu-noscan">🧾</div>'}
        <div class="inv-who">
          <div class="inv-name"><span class="inv-date">${inv.invoice_date ? dt(inv.invoice_date) : dt(inv.created_at)}</span><bdi>${esc(inv.vendor_name || inv.shop || 'Shop')}</bdi></div>
          <div class="inv-meta">${n} item${n === 1 ? '' : 's'}${inv.note ? ` · <bdi>${esc(inv.note)}</bdi>` : ''}${inv.paid_by_name ? ` · 🧰 <bdi>${esc(inv.paid_by_name)}</bdi>` : ''}</div>
        </div>
        <div class="inv-total">${money(inv.total)}</div>
      </div>
      ${n ? `<div class="inv-lines">${inv.lines.map((li) => `<div class="inv-line">
        <span class="inv-item"><bdi>${esc(li.item || '—')}</bdi></span>
        ${li.dress_name ? `<span class="inv-for">👗 <bdi>${esc(li.dress_name)}</bdi></span>` : '<span class="inv-for none">no dress</span>'}
        ${n > 1 ? `<span class="inv-amt">${money(li.amount)}</span>` : ''}</div>`).join('')}</div>` : ''}
    </div>`; }).join('') : empty(f ? 'No purchases this month' : 'No purchases yet', '🧾')}</div>`;
};
window.setPurMonth = (m) => { window._purMonth = m; go('purchases'); };
window.setExpMonth = (m) => { window._expMonth = m; go('expenses'); };
window.openPurchase = async (id) => {
  const inv = (window._purchases || []).find((x) => x.id === id);
  if (!inv) return;
  if (!window._allDressesForPurchase) window._allDressesForPurchase = await GET('/api/dresses');
  modal(`<h3>${esc(inv.vendor_name || inv.shop || 'Purchase')}</h3>
    <div class="sub muted">${inv.invoice_date ? dt(inv.invoice_date) : dt(inv.created_at)} · Total ${money(inv.total)}</div>
    ${inv.note ? `<div class="hint">${esc(inv.note)}</div>` : ''}
    <button class="btn ghost sm" style="margin-top:8px" onclick="editPurchase(${id})">✏️ Edit shop, date & note</button>
    ${(window._purVendors && window._purVendors.length) ? `<label style="margin-top:8px">Vendor</label>
      <select id="pv_${id}" onchange="setPurchaseVendor(${id},this.value)" style="width:100%"><option value="">— none —</option>${window._purVendors.map((v) => `<option value="${v.id}" ${inv.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : ''}
    <div class="sec-title">Invoice</div>
    ${inv.image
      ? `<img style="width:100%;max-height:360px;object-fit:contain;background:#faf7ff;border-radius:12px;cursor:zoom-in" src="${esc(mediaUrl(inv.image))}" onclick="lightbox('${esc(mediaUrl(inv.image))}','${esc(inv.shop || '')}')"/>
         <button class="btn ghost sm" style="margin-top:8px" onclick="addPurchaseImg(${id})">📷 Replace invoice photo</button>`
      : `<div class="hint">No invoice photo yet</div><button class="btn ghost sm" style="margin-top:6px" onclick="addPurchaseImg(${id})">📷 Add invoice photo</button>`}
    <div class="sec-title">Items</div>
    <p class="hint" style="margin-top:-4px">Each item counts as material cost on the dress named here. Edit the name or the amount, move it to another dress, or take it off.</p>
    <div class="card" style="box-shadow:none;margin:0" id="plines_${id}">${inv.lines.map((li) => purchaseLineRow(li, id)).join('') || '<div class="hint">No items on this invoice</div>'}</div>
    <button class="btn ghost sm" style="margin-top:8px" onclick="addInvoiceLine(${id})">＋ Add item</button>
    <div class="item" style="border-top:2px solid var(--line);margin-top:8px">
      <div class="main"><div class="nm">Total</div></div>
      <div style="font-weight:800;letter-spacing:-.3px">${money(inv.total)}</div></div>
    <div class="divider"></div>
    <button class="btn danger" onclick="delPurchase(${id})">Delete purchase</button>`);
};
/* One item on an invoice: its name and amount are editable in place, and the
   select moves it to whichever dress it was really bought for. */
function purchaseLineRow(li, invId) {
  return `<div class="pl-row" data-line="${li.id}">
    <div class="row" style="gap:6px;align-items:center">
      <input value="${esc(li.item || '')}" placeholder="Item" id="li_item_${li.id}" style="flex:2;min-width:0" />
      <input value="${li.amount || 0}" type="number" inputmode="decimal" id="li_amt_${li.id}" style="flex:1;min-width:0" />
    </div>
    <select id="li_dress_${li.id}">
      <option value="">— not on a dress —</option>
      ${(window._allDressesForPurchase || []).map((d) => `<option value="${d.id}" ${d.id === li.dress_id ? 'selected' : ''}>${esc(dressOptionLabel(d))}</option>`).join('')}
    </select>
    <div class="row" style="gap:6px;margin-top:6px">
      <button class="btn sec sm" style="flex:1" onclick="saveInvoiceLine(${li.id},${invId})">Save item</button>
      <button class="btn-icon" onclick="delInvoiceLine(${li.id},${invId})">🗑</button>
    </div></div>`;
}
window.saveInvoiceLine = async (lineId, invId) => {
  const item = document.getElementById('li_item_' + lineId).value;
  const amount = Number(document.getElementById('li_amt_' + lineId).value) || 0;
  const dress = document.getElementById('li_dress_' + lineId).value;
  try {
    await PUT('/api/purchase-lines/' + lineId, { item, amount, dress_id: dress ? Number(dress) : null });
    toast('Item saved ✓');
    window._purchases = await GET('/api/purchases'); openPurchase(invId);
  } catch (e) { toast(e.message, 'error'); }
};
window.delInvoiceLine = (lineId, invId) => confirmDel('Take this item off the invoice?', async () => {
  await DEL('/api/purchase-lines/' + lineId);
  toast('Item removed'); window._purchases = await GET('/api/purchases'); openPurchase(invId);
});
window.addInvoiceLine = (invId) => formModal('Add an item', [
  { name: 'item', label: 'What was bought', required: true, placeholder: 'Swiss tulle, 9.5m' },
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'dress_id', label: 'For which dress', type: 'select',
    options: [{ value: '', label: '— not on a dress —' }, ...(window._allDressesForPurchase || []).map((d) => ({ value: d.id, label: dressOptionLabel(d) }))] },
], async (d) => {
  await POST('/api/purchases/' + invId + '/lines', d);
  toast('Item added ✓'); closeModal();
  window._purchases = await GET('/api/purchases'); openPurchase(invId);
});
/* The invoice's own details — which shop, when, and the note on it. */
window.editPurchase = (id) => {
  const inv = (window._purchases || []).find((x) => x.id === id); if (!inv) return;
  formModal('Edit the invoice', [
    { name: 'shop', label: 'Shop name', value: inv.shop || '' },
    { name: 'invoice_date', label: 'Invoice date', type: 'date', value: (inv.invoice_date || '').slice(0, 10) },
    { name: 'note', label: 'Note', value: inv.note || '' },
  ], async (d) => {
    await PUT('/api/purchases/' + id, d);
    toast('Invoice saved ✓'); closeModal();
    window._purchases = await GET('/api/purchases'); openPurchase(id);
  });
};
window.setPurchaseVendor = async (id, vid) => { await PUT('/api/purchases/' + id, { vendor_id: Number(vid) || null }); toast('Vendor saved ✅'); window._purchases = await GET('/api/purchases'); const inv = window._purchases.find((x) => x.id === id); if (inv) window._purVendors = await GET('/api/vendors'); };
window.addPurchaseImg = (id) => pickImage(async (b64) => { await PUT('/api/purchases/' + id, { image: b64 }); toast('Invoice photo saved'); window._purchases = await GET('/api/purchases'); openPurchase(id); });

/* ============ EXPENSES (entries · analysis · vendors · types) ============ */
PAGES.expenses = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '💸'); return; }
  const [expenses, vendors, types, purchases] = await Promise.all([GET('/api/expenses'), GET('/api/vendors'), GET('/api/expense-types'), GET('/api/purchases'), loadFloatHolders()]);
  // vendors are still read for the New expense form's dropdown
  window._expRef = { vendors, types }; window._expenses = expenses;
  const tab = window._expTab || 'entries';
  const tabs = [['entries', 'All costs'], ['analysis', 'Analysis'], ['types', 'Types']];
  let inner = '';
  if (tab === 'entries') {
    const ef = window._expMonth || '';
    const pf = window._expPaid || ''; // '' all · 'bank' · a float holder's id
    expenses.sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')));
    const mlist = ef ? expenses.filter((e) => String(e.date || e.created_at || '').slice(0, 7) === ef) : expenses;
    const elist = pf === 'bank' ? mlist.filter((e) => !e.paid_by)
      : pf ? mlist.filter((e) => String(e.paid_by) === String(pf)) : mlist;
    const etotal = elist.reduce((a, e) => a + (e.amount || 0), 0);
    const holders = window._floatHolders || [];
    // each chip totals the month, not the chip already chosen — otherwise
    // picking one makes the others read zero
    const sumWhere = (x) => mlist.filter(x).reduce((a, e) => a + (e.amount || 0), 0);
    // The same salary sent twice sits here twice, and the studio costs carry it
    // twice with it. Two salary costs for the same person and the same month is
    // never right, so they are named rather than left to be spotted.
    const salCount = {};
    expenses.forEach((e) => { if (e.salary_payment_id && e.note) salCount[e.note] = (salCount[e.note] || 0) + 1; });
    const dupNotes = Object.keys(salCount).filter((k) => salCount[k] > 1);
    const dupTotal = expenses.filter((e) => dupNotes.includes(e.note)).reduce((a, e) => a + (e.amount || 0), 0);
    inner = `<div class="grid g2" style="margin-bottom:10px">
        <div class="stat"><div class="n serif" style="color:var(--bad)">${money(etotal)}</div><div class="l">${ef ? monthLabel(ef) : 'All-time'} spent</div></div>
        <div class="stat"><div class="n serif">${elist.length}</div><div class="l">cost${elist.length === 1 ? '' : 's'} recorded</div></div>
      </div>
      <button class="btn" onclick="addExpense()">＋ New studio cost</button>
      ${monthChips(expenses.map((e) => e.date || e.created_at), ef, 'setExpMonth')}
      <div class="filters wrap" style="margin-top:8px">
        <span class="chip ${pf === '' ? 'active' : ''}" onclick="setExpPaid('')">Paid from: any</span>
        <span class="chip ${pf === 'bank' ? 'active' : ''}" onclick="setExpPaid('bank')">🏦 The bank · ${moneyText(sumWhere((e) => !e.paid_by))}</span>
        ${holders.map((h) => `<span class="chip ${String(pf) === String(h.id) ? 'active' : ''}" onclick="setExpPaid('${h.id}')">🧰 ${esc(h.name)} · ${moneyText(sumWhere((e) => String(e.paid_by) === String(h.id)))}</span>`).join('')}
      </div>
      ${dupNotes.length ? `<div class="card dup-warn" style="margin-top:12px">
        <div class="nm">⚠️ ${dupNotes.length} salar${dupNotes.length === 1 ? 'y was' : 'ies were'} sent more than once</div>
        <div class="sub">${money(dupTotal)} is counted here, where only part of it was really paid out.</div>
        <button class="btn" style="margin-top:10px" onclick="go('dupsalaries')">Sort these out ›</button>
      </div>` : ''}
      <div class="card" style="margin-top:12px">${elist.length ? elist.map((e) => `<div class="item${dupNotes.includes(e.note) ? ' dup' : ''}">
        ${e.image ? `<div class="av"><img class="thumb" style="width:42px;height:42px;aspect-ratio:1" src="${esc(mediaUrl(e.image))}" onclick="lightbox('${esc(mediaUrl(e.image))}')"/></div>` : `<div class="av">${e.salary_payment_id ? '💼' : '💸'}</div>`}
        <div class="main"><div class="nm">${money(e.amount)} · ${esc(e.type || '—')}</div><div class="sub">${e.vendor_name ? esc(e.vendor_name) + ' · ' : ''}${e.date ? dt(e.date) : dt(e.created_at)}${e.note ? ' · ' + esc(e.note) : ''} · ${e.paid_by_name ? `🧰 <bdi>${esc(e.paid_by_name)}</bdi>'s float` : '🏦 the bank'}</div></div>
        ${e.salary_payment_id
          ? `<button class="btn-icon" title="Drop this salary record" onclick="dropSalaryCost(${e.salary_payment_id},'${esc(String(e.note || 'this salary')).replace(/'/g, "\\'")}')">💼</button>`
          : `<div class="row" style="gap:2px">
          <button class="btn-icon" title="Move to Purchases" onclick="moveCostToPurchase(${e.id})">↗</button>
          <button class="btn-icon" onclick="delExpense(${e.id})">🗑</button></div>`}</div>`).join('') : empty(ef || pf ? 'Nothing matches this filter' : 'Nothing here yet', '🏠')}</div>`;
  } else if (tab === 'analysis') {
    const byMonth = {};
    const addTo = (m, t, amt) => { byMonth[m] = byMonth[m] || { total: 0, types: {} }; byMonth[m].total += amt; byMonth[m].types[t] = (byMonth[m].types[t] || 0) + amt; };
    expenses.forEach((e) => { const m = (e.date || e.created_at || '').slice(0, 7); if (m) addTo(m, e.type || 'Other', e.amount || 0); });
    purchases.forEach((p) => { const m = (p.invoice_date || p.created_at || '').slice(0, 7); if (m) addTo(m, 'Dress materials', p.total || 0); });
    const months = Object.keys(byMonth).sort().reverse();
    inner = months.length ? months.map((m) => { const d = byMonth[m]; const ts = Object.entries(d.types).sort((a, b) => b[1] - a[1]);
      return `<div class="card"><div class="item"><div class="main"><div class="nm serif" style="font-size:18px">${monthLabel(m)}</div><div class="sub">Total spent</div></div><div class="serif" style="font-size:20px;font-weight:700;color:var(--bad)">${money(d.total)}</div></div>
        ${ts.map(([t, a]) => `<div class="item" style="padding-inline-start:14px"><div class="av" style="background:#fff">◦</div><div class="main"><div class="nm">${esc(t)}</div></div><div class="sub">${money(a)}</div></div>`).join('')}</div>`;
    }).join('') : empty('No spending data yet', '📊');
  } else {
    inner = `<button class="btn" onclick="addExpType()">＋ Add a type of cost</button>
      <div class="hint" style="margin:10px 2px 6px">Rent, electricity, marketing, repairs — the headings a studio cost can be filed under.</div>
      <div class="card">${types.length ? types.map((t) => `<div class="item"><div class="av">🏷️</div><div class="main"><div class="nm">${esc(t.name)}</div></div><button class="btn-icon" onclick="delExpType(${t.id})">🗑</button></div>`).join('') : empty('No types yet')}</div>`;
  }
  c.innerHTML = pageHead('Studio costs', '🏠') +
    `<p class="hint" style="margin:2px 2px 10px">What the studio itself costs — rent, bills, marketing, anything that is not materials for a dress. Materials go on an invoice under Purchases.</p>
     <div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="expTab('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.expTab = (t) => { window._expTab = t; go('expenses'); };
window.setExpPaid = (v) => { window._expPaid = v; go('expenses'); };
/* ============ SALARIES SENT MORE THAN ONCE ============
   Naming the duplicates was not enough: they were still sitting there. This is
   the screen that clears them — every month that was paid twice, its payments
   side by side, and one tap to drop the one that should not be there. Which to
   keep is not guessed at: where the two amounts differ, only the studio knows
   which is right, and the screen says so instead of choosing. */
PAGES.dupsalaries = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '💼'); return; }
  const pays = await GET('/api/salary-payments');
  const groups = {};
  pays.forEach((p) => {
    const k = `${p.user_id}|${String(p.month || '—')}`;
    (groups[k] = groups[k] || { name: p.user_name, month: p.month, rows: [] }).rows.push(p);
  });
  const dups = Object.values(groups).filter((g) => g.rows.length > 1);
  dups.forEach((g) => g.rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
  const over = dups.reduce((a, g) => a + g.rows.slice(1).reduce((x, r) => x + (r.amount || 0), 0), 0);
  c.innerHTML = `<div class="row" style="margin-bottom:4px"><button class="btn sec sm" onclick="goBack()">‹ Back</button></div>` +
    title('Sent more than once', '💼') +
    (dups.length ? `<div class="card dup-warn">
      <div class="nm">${dups.length} month${dups.length === 1 ? '' : 's'} ${dups.length === 1 ? 'was' : 'were'} paid more than once</div>
      <div class="sub">Up to ${money(over)} of this was never really paid out. Keep the one that is right and drop the rest — dropping takes the payment off her salary record and off the studio costs together.</div>
    </div>
    ${dups.map((g) => {
      const same = g.rows.every((r) => Math.abs((r.amount || 0) - (g.rows[0].amount || 0)) < 0.005);
      return `<div class="card dsg">
        <div class="dsg-h">${esc(g.name)} · ${esc(g.month ? monthLabel(g.month) : 'no month on it')}</div>
        ${g.rows.map((r, i) => `<div class="dsg-r">
          <div class="dsg-m"><b>${money(r.amount)}</b>
            <span>sent ${dt(r.created_at)}${r.status === 'confirmed' ? ' · she confirmed it ✓' : ' · not confirmed'}${i === 0 ? ' · the first one' : ''}</span></div>
          <button class="btn sec sm" onclick="dropDupSalary(${r.id},'${esc(g.name).replace(/'/g, "\\'")}','${esc(g.month ? monthLabel(g.month) : '')}',${r.amount || 0})">Drop this</button>
        </div>`).join('')}
        <div class="dsg-n ${same ? '' : 'warn'}">${same
          ? 'Both are for the same amount, so they are the same payment entered twice — drop either one.'
          : '⚠️ These are for different amounts, so only you know which is the right one. Nothing here is guessed.'}</div>
      </div>`;
    }).join('')}`
    : empty('Nothing has been paid twice. The salaries are clean.', '✓'));
};
window.dropDupSalary = (payId, name, month, amount) => {
  if (!confirm(`Drop this salary?\n\n${name} · ${month}\n${moneyText(amount)}\n\nIt comes off her salary record AND off the studio costs, together. This cannot be undone.`)) return;
  DEL('/api/salary-payments/' + payId)
    .then(() => { toast('Dropped ✓'); go('dupsalaries'); })
    .catch((e) => toast(e.message || 'Could not drop it', 'error'));
};

/* A salary cost is the salary: taking it off here takes the payment off her
   record too, which is the only way the two can stay telling the same story. */
window.dropSalaryCost = (payId, label) => {
  if (!confirm(`Drop this salary?\n\n${label}\n\nIt comes off the staff member's salary record AND off the studio costs, together. This cannot be undone.`)) return;
  DEL('/api/salary-payments/' + payId)
    .then(() => { toast('Dropped — off her record and off the costs ✓'); go('expenses'); })
    .catch((e) => toast(e.message || 'Could not drop it', 'error'));
};
window.addExpense = async () => { await loadFloatHolders(); const { vendors, types } = window._expRef; formModal('New studio cost', [
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'type', label: 'Type', type: 'select', options: [{ value: '', label: '—' }, ...types.map((t) => ({ value: t.name, label: t.name }))] },
  // a cost like electricity or rent has no vendor to name, so this stays optional
  { name: 'vendor_id', label: 'Vendor (optional)', type: 'select', options: [{ value: '', label: '— none —' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))] },
  // whose money it came out of: the bank, or a float somebody is holding
  { name: 'paid_by', label: 'Paid from', type: 'select', options: paidFromOptions() },
  { name: 'date', label: 'Date', type: 'date', value: today() },
  { name: 'note', label: 'Note' },
  { name: 'image', label: 'Invoice photo (optional)', type: 'image' },
], async (d) => { await POST('/api/expenses', d); toast('Saved'); go('expenses'); }); };

/* Where the money came from — the studio's own account, or cash somebody is
   holding. Only people who actually have a float are offered, so this does not
   quietly open one for somebody who was never given any. */
function paidFromOptions() {
  const holders = window._floatHolders || [];
  return [{ value: '', label: '🏦 The bank' },
    ...holders.map((h) => ({ value: h.id, label: `🧰 ${h.name}'s float · ${moneyText(h.balance)} in hand` }))];
}
/* kept fresh wherever spending is recorded, so the list is never a guess */
async function loadFloatHolders() {
  try { const r = await GET('/api/floats'); window._floatHolders = r.rows || []; window._floatStaff = r.staff || []; }
  catch (e) { window._floatHolders = window._floatHolders || []; }
}
/* A cost filed in the wrong place. Materials bought for a dress belong on an
   invoice, so this opens the invoice form already filled in from the cost and
   takes the cost away once the invoice is saved — the one thing it cannot
   carry over is which dress the materials were for, which is the question the
   form is now asking. */
window.moveCostToPurchase = async (id) => {
  const e = (window._expenses || []).find((x) => x.id === id);
  if (!e) return;
  await newPurchase();
  const set = (sel, v) => { const el = document.querySelector(sel); if (el && v != null && v !== '') el.value = v; };
  set('#pu_vendor', e.vendor_id || '');
  set('#pu_shop', e.vendor_name || '');
  set('#pu_date', e.date || (e.created_at || '').slice(0, 10));
  set('#pu_note', e.note || '');
  set('#pu_paidby', e.paid_by || '');
  set('.pu-item', e.type || '');
  set('.pu-amt', e.amount);
  window._puFromExpense = id;
  const h = document.querySelector('#modal-root h3');
  if (h) h.textContent = 'Move this cost to Purchases';
  toast('Choose which dress it was for');
};
window.delExpense = (id) => confirmDel('Delete this cost?', async () => { await DEL('/api/expenses/' + id); go('expenses'); });
/* ============ FLOATS (عهدة) ============
   Cash handed to somebody to keep at the studio and spend from. What she still
   holds is never typed in: it is what was handed to her, less what she has
   given back, less what has been spent on her float — so the figure cannot
   drift away from the invoices and the costs behind it. */
PAGES.floats = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '🧰'); return; }
  const { rows, staff } = await GET('/api/floats');
  window._floatStaff = staff; window._floatHolders = rows;
  const out = rows.reduce((a, r) => a + r.balance, 0);
  c.innerHTML = pageHead('Floats', '🧰') +
    `<p class="hint" style="margin:2px 2px 10px">Cash handed to somebody to keep at the studio and spend from. What she holds is what you gave her, less what she gave back, less what she has spent.</p>
    <div class="grid g2" style="margin-bottom:10px">
      <div class="stat"><div class="n serif" style="color:${out ? 'var(--warn)' : 'var(--ok)'}">${money(out)}</div><div class="l">out of the drawer</div></div>
      <div class="stat"><div class="n serif">${rows.length}</div><div class="l">holding a float</div></div>
    </div>
    <button class="btn" onclick="handFloat()">＋ Hand over cash</button>
    ${rows.length ? `<div class="card" style="margin-top:12px">${rows.map((r) => `<div class="item" style="cursor:pointer" onclick="openFloat(${r.id})">
      <div class="av">🧰</div>
      <div class="main"><div class="nm">${esc(r.name)}</div>
        <div class="sub">${money(r.handed)} handed${r.spent ? ' · ' + money(r.spent) + ' spent' : ''}${r.back ? ' · ' + money(r.back) + ' back' : ''}</div></div>
      <div style="text-align:end">
        <div class="serif" style="font-weight:700;font-size:17px;color:var(--${r.balance > 0 ? 'ink' : r.balance < 0 ? 'bad' : 'ok'})">${money(r.balance)}</div>
        <div class="sub muted" style="font-size:11px">${r.balance < 0 ? 'overspent' : r.balance ? 'in hand' : 'settled'}</div></div>
    </div>`).join('')}</div>`
      : empty('Nobody is holding a float yet', '🧰')}`;
};

window.handFloat = (userId) => {
  const staff = window._floatStaff || [];
  formModal('Hand over cash', [
    { name: 'user_id', label: 'To whom', type: 'select', value: userId || '',
      options: [{ value: '', label: '—' }, ...staff.map((s) => ({ value: s.id, label: s.name }))] },
    { name: 'amount', label: 'How much', type: 'number', required: true },
    { name: 'date', label: 'Date', type: 'date', value: today() },
    { name: 'note', label: 'What for', placeholder: 'Petty cash for the studio' },
  ], async (d) => {
    if (!d.user_id) return toast('Pick who is holding it');
    await POST('/api/floats', { ...d, kind: 'in' });
    toast('Handed over ✓'); go('floats');
  });
};
window.returnFloat = (userId) => {
  formModal('Take cash back', [
    { name: 'amount', label: 'How much', type: 'number', required: true },
    { name: 'date', label: 'Date', type: 'date', value: today() },
    { name: 'note', label: 'Note' },
  ], async (d) => {
    await POST('/api/floats', { ...d, user_id: userId, kind: 'out' });
    toast('Taken back ✓'); window._floatId = userId; go('float');
  });
};
window.openFloat = (id) => { window._floatId = id; go('float'); };
window.delFloatMove = (id, userId) => confirmDel('Delete this cash movement?', async () => {
  await DEL('/api/floats/' + id); window._floatId = userId; go('float');
});

const FLOAT_ENTRY = {
  handed: { ic: '＋', label: 'Handed over', cls: 'ok', sign: '+' },
  back: { ic: '↩', label: 'Given back', cls: 'muted', sign: '−' },
  cost: { ic: '🏠', label: 'Studio cost', cls: 'bad', sign: '−' },
  invoice: { ic: '🧾', label: 'Invoice', cls: 'bad', sign: '−' },
};

PAGES.float = async (c) => {
  const id = window._floatId;
  if (!id) return go('floats');
  const f = await GET('/api/floats/' + id);
  window._float = f;
  const spending = f.entries.filter((e) => e.kind === 'cost' || e.kind === 'invoice');
  c.innerHTML = `<div class="row" style="margin-bottom:4px">
      <button class="btn sec sm" onclick="go('floats')">‹ All floats</button>
    </div>` + title(f.user.name, '🧰') +
    `<div class="grid g3 fl-figs">
      <div class="stat"><div class="n serif">${money(f.handed)}</div><div class="l">received</div></div>
      <div class="stat"><div class="n serif" style="color:var(--bad)">${money(f.spent)}</div><div class="l">spent</div></div>
      <div class="stat fl-left"><div class="n serif" style="color:var(--${f.balance < 0 ? 'bad' : 'ok'})">${money(f.balance)}</div><div class="l">still in hand</div></div>
    </div>
    ${f.spent ? `<div class="hint" style="margin:2px 2px 8px">Of what she spent: <b>${money(f.invoices)}</b> on dresses · <b>${money(f.costs)}</b> on the studio.</div>` : ''}
    ${f.back ? `<div class="hint" style="margin:2px 2px 8px">${money(f.back)} of it was given back.</div>` : ''}
    ${f.balance < 0 ? `<div class="card" style="border-inline-start:4px solid var(--bad)"><div class="nm" style="color:var(--bad)">She has spent ${money(-f.balance)} of her own</div>
      <div class="sub muted">Hand that over to settle it, or take the spending off this float.</div></div>` : ''}
    <button class="btn" style="margin-top:10px" onclick="spendFromFloat(${f.user.id})">＋ Record something she spent</button>
    <div class="row" style="margin-top:8px">
      <button class="btn sec sm" onclick="handFloat(${f.user.id})">＋ Hand over more</button>
      <button class="btn sec sm" onclick="returnFloat(${f.user.id})">↩ Take cash back</button>
      <button class="btn ghost sm" onclick="openFloatSheet()">🖨 Settlement</button>
    </div>

    <div class="sec-title">Spent out of it <span class="hint" style="font-weight:400">· ${spending.length}</span></div>
    ${spending.length ? `<div class="card">${spending.map((e) => floatRow(e, f.user.id)).join('')}</div>`
      : `<p class="hint">Nothing has been spent from this float yet. Use the button above, or choose <b>${esc(f.user.name)}'s float</b> under <b>Paid from</b> when recording a studio cost or an invoice.</p>`}

    <div class="sec-title">The cash itself</div>
    <div class="card">${f.entries.filter((e) => e.kind === 'handed' || e.kind === 'back').map((e) => floatRow(e, f.user.id)).join('')}</div>`;
};

/* One line of a float, whichever of the four kinds it is. The cash movements
   can be put right; a cost or an invoice is corrected where it was recorded. */
function floatRow(e, userId) {
  const m = FLOAT_ENTRY[e.kind] || FLOAT_ENTRY.cost;
  const cash = e.kind === 'handed' || e.kind === 'back';
  return `<div class="item">
    <div class="av">${m.ic}</div>
    <div class="main"><div class="nm">${m.label}${e.note ? ' · ' + esc(e.note) : ''}</div>
      <div class="sub">${e.date ? dt(e.date) : ''}</div></div>
    <div style="text-align:end;display:flex;flex-direction:column;align-items:flex-end;gap:2px">
      <div class="serif" style="font-weight:700;color:var(--${m.cls === 'muted' ? 'muted' : m.cls})">${m.sign} ${money(e.amount)}</div>
      ${cash ? `<div class="row" style="gap:2px">
        <button class="btn-icon" onclick="editFloatMove(${e.id},${userId})">✏️</button>
        <button class="btn-icon" onclick="delFloatMove(${e.id},${userId})">🗑</button></div>` : ''}</div>
  </div>`;
}

window.editFloatMove = (id, userId) => {
  const e = ((window._float || {}).entries || []).find((x) => x.id === id && (x.kind === 'handed' || x.kind === 'back'));
  if (!e) return;
  const out = e.kind === 'back';
  formModal(out ? 'Edit cash taken back' : 'Edit the handover', [
    { name: 'amount', label: 'How much', type: 'number', required: true, value: e.amount },
    { name: 'date', label: 'Date', type: 'date', value: e.date || today() },
    { name: 'note', label: out ? 'Note' : 'What for', value: e.note || '' },
  ], async (d) => {
    await PUT('/api/floats/' + id, { ...d, kind: out ? 'out' : 'in' });
    toast('Saved ✓'); window._floatId = userId; go('float');
  });
};

/* Recording what the cash went on, from the float itself. Float money only ever
   goes one of two ways — onto a dress, or onto the studio — so the first thing
   it asks is which, and then it files itself there: a purchase invoice against
   that dress, or a studio cost. Either way it is marked as hers, so it comes
   off her float on its own; there is no third place for float spending to sit. */
window.spendFromFloat = async (userId) => {
  await loadFloatHolders();
  const her = (window._floatHolders || []).find((h) => h.id === userId);
  const whose = her ? `${her.name}'s float` : 'the float';
  modal(`<h3>🧰 Spent from ${esc(whose)}</h3>
    <p class="hint" style="margin:2px 2px 14px">What did the cash go on? It is recorded where it belongs, and comes off ${her ? esc(her.name) + "'s" : 'the'} float either way.</p>
    <div class="nav-list flush">
      <div class="nav-row" style="${tintVars('dresses')}" onclick="closeModal();floatOnDress(${userId})">
        <span class="rail"></span><span class="ic">👗</span>
        <span class="txt"><span class="nm">Materials for a dress</span><span class="meta">Goes on that dress as an invoice — and into its material cost</span></span>
        <span class="chev">›</span></div>
      <div class="nav-row" style="${tintVars('expenses')}" onclick="closeModal();floatOnStudio(${userId})">
        <span class="rail"></span><span class="ic">🏠</span>
        <span class="txt"><span class="nm">Something for the studio</span><span class="meta">Rent, bills, coffee corner, cleaning — goes into studio costs</span></span>
        <span class="chev">›</span></div>
    </div>`);
};

/* the two headings a float can be spent under — kept fresh so the lists are never stale */
async function spendRefs() {
  let types = (window._expRef && window._expRef.types) || [];
  let vendors = (window._expRef && window._expRef.vendors) || [];
  if (!types.length || !vendors.length) {
    try { [types, vendors] = await Promise.all([GET('/api/expense-types'), GET('/api/vendors')]); window._expRef = { types, vendors }; } catch (e) {}
  }
  return { types, vendors };
}

window.floatOnStudio = async (userId) => {
  const { types, vendors } = await spendRefs();
  const her = (window._floatHolders || []).find((h) => h.id === userId);
  formModal(her ? `Studio cost from ${her.name}'s float` : 'Studio cost from the float', [
    { name: 'amount', label: 'How much', type: 'number', required: true },
    { name: 'type', label: 'What for', type: 'select', options: [{ value: '', label: '—' }, ...types.map((t) => ({ value: t.name, label: t.name }))] },
    { name: 'vendor_id', label: 'Vendor (optional)', type: 'select', options: [{ value: '', label: '— none —' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))] },
    { name: 'date', label: 'Date', type: 'date', value: today() },
    { name: 'note', label: 'Note' },
    { name: 'image', label: 'Receipt photo (optional)', type: 'image' },
  ], async (d) => {
    await POST('/api/expenses', { ...d, paid_by: userId });
    toast('In studio costs, off her float ✓');
    window._floatId = userId; go('float');
  });
};

/* Materials bought with float cash: an invoice against that dress, so the money
   lands in the dress's material cost and in the vendor's total, not in a pile
   of its own. The shop has to be named — same rule as any other invoice. */
window.floatOnDress = async (userId) => {
  const { vendors } = await spendRefs();
  let dresses = window._dresses || [];
  if (!dresses.length) { try { dresses = await GET('/api/dresses'); window._dresses = dresses; } catch (e) {} }
  const open = dresses.filter((d) => d.status !== 'delivered');
  const pick = (open.length ? open : dresses).map((d) => ({ value: d.id, label: `${d.customer_name}${d.delivery_date ? ' · ' + d.delivery_date : ''}` }));
  const her = (window._floatHolders || []).find((h) => h.id === userId);
  formModal(her ? `Materials from ${her.name}'s float` : 'Materials from the float', [
    { name: 'amount', label: 'How much', type: 'number', required: true },
    { name: 'dress_id', label: 'Which dress', type: 'select', required: true, options: [{ value: '', label: '—' }, ...pick] },
    { name: 'item', label: 'What was bought', placeholder: 'Lace · tulle · beads · thread' },
    { name: 'vendor_id', label: 'Vendor', type: 'select', options: [{ value: '', label: '— or type the shop below —' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))] },
    { name: 'shop', label: 'Shop (if not on the list)' },
    { name: 'date', label: 'Date', type: 'date', value: today() },
    { name: 'note', label: 'Note' },
    { name: 'image', label: 'Invoice photo (optional)', type: 'image' },
  ], async (d) => {
    if (!d.dress_id) throw new Error('Which dress was it for?');
    if (!d.vendor_id && !String(d.shop || '').trim()) throw new Error('Name the shop it came from.');
    await POST('/api/purchases', {
      vendor_id: d.vendor_id || null, shop: d.shop || null, invoice_date: d.date || null,
      note: d.note || null, image: d.image || null, paid_by: userId,
      lines: [{ dress_id: Number(d.dress_id), item: d.item || null, amount: Number(d.amount) }],
    });
    toast('On the dress, off her float ✓');
    window._floatId = userId; go('float');
  });
};

/* The settlement — what she took, what it went on, what is left — on one sheet
   she can sign when the cash is counted back. */
window.openFloatSheet = () => { window._floatSheet = window._float; go('floatsheet'); };

PAGES.floatsheet = async (c) => {
  const f = window._floatSheet;
  if (!f) return goBack();
  const row = (label, detail, amount, cls) => `<tr class="${cls || ''}">
    <td>${esc(label)}${detail ? `<span class="ps-detail">${esc(detail)}</span>` : ''}</td>
    <td class="ps-amt">${amount}</td></tr>`;
  const spending = f.entries.filter((e) => e.kind === 'cost' || e.kind === 'invoice');
  const handovers = f.entries.filter((e) => e.kind === 'handed');
  const backs = f.entries.filter((e) => e.kind === 'back');
  c.innerHTML = `<div class="rc-actions no-print">
      <button class="btn sec" onclick="goBack()">‹ Back</button>
      <button class="btn" onclick="window.print()">🖨 Print / Save as PDF</button>
    </div>
    <div class="receipt-sheet ps-sheet">
      <div class="rc-head">
        <div class="rc-brand">DALIA BASSEL</div>
        <div class="rc-sub">Haute Couture · Float settlement</div>
      </div>

      <div class="ps-who">
        <div><div class="ps-k">Held by</div><div class="ps-v">${esc(f.user.name)}</div></div>
        <div><div class="ps-k">Counted on</div><div class="ps-v">${esc(dt(today()))}</div></div>
      </div>

      <table class="rc-table ps-table"><tbody>
        ${handovers.map((e) => row('Received', e.date ? dt(e.date) + (e.note ? ' · ' + e.note : '') : (e.note || ''), money(e.amount), 'ps-plus')).join('')
          || row('Received', '', money(0))}
        ${spending.length ? `<tr class="ps-head-row"><td colspan="2">Spent</td></tr>` : ''}
        ${spending.map((e) => row(e.kind === 'invoice' ? 'Invoice' : 'Studio cost', [e.date ? dt(e.date) : '', e.note].filter(Boolean).join(' · '), '− ' + money(e.amount), 'ps-minus')).join('')}
        ${backs.map((e) => row('Given back', e.date ? dt(e.date) : '', '− ' + money(e.amount), 'ps-minus')).join('')}
      </tbody></table>

      <div class="ps-days">
        <span><b>${moneyText(f.handed)}</b> received</span>
        <span><b>${moneyText(f.spent)}</b> spent</span>
        ${f.back ? `<span><b>${moneyText(f.back)}</b> given back</span>` : ''}
      </div>

      <div class="ps-net">
        <div class="ps-net-k">Still in hand</div>
        <div class="ps-net-v">${money(f.balance)}</div>
      </div>

      <div class="ps-sign">
        <div><div class="ps-line"></div>Counted back by</div>
        <div><div class="ps-line"></div>Dalia Bassel Couture</div>
      </div>
      <div class="rc-foot">Float settlement · ${esc(f.user.name)} · issued ${esc(dt(today()))}</div>
    </div>`;
};

/* ============ VENDORS ============
   Everyone the studio buys from, in one place: the directory that used to sit
   under Configuration and the spending report that used to sit under Expenses
   were two halves of the same list. Grouped by what they supply, because that
   is how a vendor is looked for — not "who was that shop" but "who do we get
   beading from". */
PAGES.vendors = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '🏬'); return; }
  const [vendors, orphans] = await Promise.all([GET('/api/vendors'), GET('/api/vendors/unlinked-shops')]);
  window._cfgVendors = vendors;
  const groups = {};
  vendors.forEach((v) => { const k = (v.specialty || '').trim() || 'Not set'; (groups[k] = groups[k] || []).push(v); });
  const keys = Object.keys(groups).sort((a, b) => (a === 'Not set') - (b === 'Not set') || a.localeCompare(b));
  keys.forEach((k) => groups[k].sort((a, b) => (b.total || 0) - (a.total || 0)));
  const spent = vendors.reduce((a, v) => a + (v.total || 0), 0);
  c.innerHTML = pageHead('Vendors', '🏬') +
    `<div class="grid g2" style="margin-bottom:10px">
       <div class="stat"><div class="n serif" style="color:var(--bad)">${money(spent)}</div><div class="l">spent with them</div></div>
       <div class="stat"><div class="n serif">${vendors.length}</div><div class="l">vendor${vendors.length === 1 ? '' : 's'}</div></div>
     </div>
    <button class="btn" onclick="addVendor()">＋ Add a vendor</button>
    <div class="hint" style="margin:10px 2px 6px">Tap one to see its full report — invoices and studio costs together — or ✏️ to edit its details.</div>
    ${vendors.length ? keys.map((k) => `<div class="sec-title">${esc(k)} <span class="hint" style="font-weight:400">· ${groups[k].length}</span></div>
      <div class="card" style="margin:0 0 10px">${groups[k].map((v) => `<div class="item" style="cursor:pointer" onclick="openVendorReport(${v.id})">
        <div class="av">🏬</div>
        <div class="main"><div class="nm">${esc(v.name)}</div>
          <div class="sub">${v.total ? '🧾 ' + money(v.purchases_total) + ' · 💸 ' + money(v.expenses_total) : 'No activity yet'}${v.phone ? ' · ' + esc(v.phone) : ''}</div></div>
        <div style="text-align:end;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          ${v.total ? `<div class="serif" style="font-weight:700;color:var(--bad)">${money(v.total)}</div>` : ''}
          <div class="row" style="gap:2px">
            <button class="btn-icon" onclick="event.stopPropagation();editVendor(${v.id})">✏️</button>
            <button class="btn-icon" onclick="event.stopPropagation();delVendor(${v.id})">🗑</button></div></div>
      </div>`).join('')}</div>`).join('') : empty('No vendors yet — add the first one', '🏬')}
    ${orphans.length ? `<div class="sec-title">Shops not on the list yet</div>
      <p class="hint" style="margin-top:-4px">These were typed onto invoices, so their spending shows against no vendor. Add one as a vendor of its own, or say it is one you already have — a name typed two ways is one shop.</p>
      <div class="card">${orphans.map((o) => { const q = esc(o.shop).replace(/'/g, "\\'"); return `<div class="item">
        <div class="av">❓</div>
        <div class="main"><div class="nm">${esc(o.shop)}</div><div class="sub">${o.invoices} invoice${o.invoices === 1 ? '' : 's'}</div></div>
        <div style="text-align:end;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div class="serif" style="font-weight:700;color:var(--bad)">${money(o.total)}</div>
          <div class="row" style="gap:4px">
            <button class="btn ghost sm" onclick="linkShop('${q}')">↔ Same as…</button>
            <button class="btn sec sm" onclick="adoptShop('${q}')">＋ Add</button></div></div>
      </div>`; }).join('')}</div>` : ''}`;
};

/* Two spellings of the same shop. Joining them puts every invoice still
   carrying the loose name onto the vendor it was always from. */
window.linkShop = (shop) => {
  const vendors = window._cfgVendors || [];
  if (!vendors.length) return toast('Add a vendor first');
  formModal(`"${shop}" is really…`, [
    { name: 'vendor_id', label: 'Which vendor is it?', type: 'select', required: true,
      options: [{ value: '', label: '—' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))] },
  ], async (d) => {
    if (!d.vendor_id) return toast('Pick the vendor');
    const r = await POST('/api/vendors/link-shop', { shop, vendor_id: Number(d.vendor_id) });
    toast(`${r.moved} invoice${r.moved === 1 ? '' : 's'} joined ${r.vendor} ✓`);
    go('vendors');
  });
};

const VENDOR_FIELDS = (v = {}) => [
  { name: 'name', label: 'Vendor name', required: true, value: v.name || '' },
  { name: 'specialty', label: 'What they supply', value: v.specialty || '', placeholder: 'Lace · Tulle · Beading · Silk' },
  { name: 'phone', label: 'Phone', value: v.phone || '' },
  { name: 'email', label: 'Email', type: 'email', value: v.email || '' },
  { name: 'address', label: 'Address / area', value: v.address || '' },
  { name: 'note', label: 'Note', value: v.note || '' },
];
window.addVendor = () => formModal('Add a vendor', VENDOR_FIELDS(), async (d) => {
  await POST('/api/vendors', d); toast('Vendor added ✓'); go('vendors');
}, { perStep: 6 });
/* A shop that was only ever typed onto invoices. Adding it under exactly that
   name is what joins the spending to it — so the name is fixed, not a suggestion. */
window.adoptShop = (shop) => formModal('Add ' + shop, VENDOR_FIELDS({ name: shop }).map((f) => (
  f.name === 'name' ? { ...f, label: 'Vendor name (keep it as written on the invoices)' } : f
)), async (d) => {
  await POST('/api/vendors', { ...d, name: shop });
  toast('Vendor added — its invoices are on it now ✓'); go('vendors');
}, { perStep: 6 });
window.editVendor = (id) => {
  const v = (window._cfgVendors || window._expRef?.vendors || []).find((x) => x.id === id);
  if (!v) return;
  formModal('Edit ' + v.name, VENDOR_FIELDS(v), async (d) => {
    await PUT('/api/vendors/' + id, d); toast('Vendor saved ✓'); go('vendors');
  }, { perStep: 6 });
};
window.delVendor = (id) => confirmDel('Delete this vendor?', async () => { await DEL('/api/vendors/' + id); go('vendors'); });
/* ---- Vendor report: unified spend (material purchases + general expenses) + printable PDF ---- */
window.openVendorReport = async (id) => {
  const rep = await GET('/api/vendors/' + id + '/report');
  window._vendorRep = rep;
  const { vendor, purchases, expenses, totals } = rep;
  modal(`<h3>🏬 ${esc(vendor.name)}</h3>
    ${(vendor.phone || vendor.note) ? `<div class="sub muted">${[vendor.phone, vendor.note].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
    <div class="grid g2" style="margin-top:12px">
      <div class="stat"><div class="n serif" style="color:var(--bad)">${money(totals.grand)}</div><div class="l">Total spent</div></div>
      <div class="stat"><div class="n serif">${purchases.length + expenses.length}</div><div class="l">transactions</div></div>
    </div>
    <div class="card" style="box-shadow:none;margin:10px 0">
      ${kv('🧾 Material purchases', money(totals.purchases), 'bad')}
      ${kv('🏠 Studio costs', money(totals.expenses), 'bad')}
    </div>
    ${purchases.length ? `<div class="sec-title">Purchase invoices</div>${purchases.map((inv) => `<div class="card" style="box-shadow:none;margin:0 0 8px">
      <div class="item"><div class="av">🧾</div><div class="main"><div class="nm">${money(inv.total)}</div><div class="sub">${inv.invoice_date ? dt(inv.invoice_date) : dt(inv.created_at)}${inv.note ? ' · ' + esc(inv.note) : ''}</div></div></div>
      ${inv.lines.map((li) => `<div class="item" style="padding-inline-start:12px"><div class="av" style="background:#fff">◦</div><div class="main"><div class="nm">${esc(li.dress_name || '—')}</div><div class="sub">${li.item ? esc(li.item) + ' · ' : ''}${money(li.amount)}</div></div></div>`).join('')}
    </div>`).join('')}` : ''}
    ${expenses.length ? `<div class="sec-title">Studio costs</div><div class="card" style="box-shadow:none;margin:0">${expenses.map((e) => `<div class="item"><div class="av">💸</div><div class="main"><div class="nm">${money(e.amount)} · ${esc(e.type || '—')}</div><div class="sub">${e.date ? dt(e.date) : dt(e.created_at)}${e.note ? ' · ' + esc(e.note) : ''}</div></div></div>`).join('')}</div>` : ''}
    ${(!purchases.length && !expenses.length) ? '<div class="hint">No activity for this vendor yet</div>' : ''}
    <div class="divider"></div>
    <button class="btn" onclick="printVendorReport(${id})">🖨 Print PDF report</button>`);
};
window.printVendorReport = async (id) => {
  const rep = (window._vendorRep && window._vendorRep.vendor.id === Number(id)) ? window._vendorRep : await GET('/api/vendors/' + id + '/report');
  const { vendor, purchases, expenses, totals } = rep;
  const cur = (window._cfg && window._cfg.currency) || 'EGP';
  const m = (n) => (Number(n || 0)).toLocaleString('en-US') + ' ' + cur;
  const purchaseRows = purchases.map((inv) => `
    <tr class="grp"><td>${inv.invoice_date ? dt(inv.invoice_date) : dt(inv.created_at)}</td><td>Material invoice${inv.note ? ' — ' + esc(inv.note) : ''}</td><td class="amt">${m(inv.total)}</td></tr>
    ${inv.lines.map((li) => `<tr class="ln"><td></td><td>${esc(li.dress_name || '—')}${li.item ? ' · ' + esc(li.item) : ''}</td><td class="amt">${m(li.amount)}</td></tr>`).join('')}`).join('');
  const expenseRows = expenses.map((e) => `<tr><td>${e.date ? dt(e.date) : dt(e.created_at)}</td><td>${esc(e.type || 'Expense')}${e.note ? ' — ' + esc(e.note) : ''}</td><td class="amt">${m(e.amount)}</td></tr>`).join('');
  const html = `<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>Vendor report — ${esc(vendor.name)}</title>
  <style>
    html,body{background:#fff}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#14101a;padding:32px;max-width:820px;margin:auto}
    .head{text-align:center;border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:18px}
    .brand{font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;letter-spacing:3px;color:#7c3aed}
    .sub{color:#777;font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-top:4px}
    .meta{display:flex;gap:20px;flex-wrap:wrap;justify-content:space-between;margin:0 4px 16px;font-size:14px}
    .totals{display:flex;gap:12px;margin:0 0 18px}
    .tbox{flex:1;background:#faf7ff;border:1px solid #e9e2f7;border-radius:12px;padding:12px;text-align:center}
    .tbox span{display:block;font-size:20px;font-weight:800;color:#7c3aed;font-family:Georgia,serif}
    .tbox label{font-size:11px;color:#777;letter-spacing:1px}
    h3{margin:18px 0 8px;color:#4a2f8f}
    table{width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;font-size:14px}
    th{background:#4a2f8f;color:#fff;padding:9px 12px;text-align:start;font-size:12px}
    td{border:1px solid #e9e2f7;padding:8px 12px}
    td.amt{text-align:end;white-space:nowrap;font-weight:700}
    tr.grp td{background:#f6f2fe;font-weight:700}
    tr.ln td{color:#555;font-size:13px}
    .grand{margin-top:18px;text-align:end;font-size:18px;font-weight:800;color:#7c3aed;border-top:2px solid #7c3aed;padding-top:10px}
    @media print{body{padding:6px}}
  </style></head><body>
    <div class="head"><div class="brand">DALIA BASSEL</div><div class="sub">Haute Couture · Vendor Statement</div></div>
    <div class="meta"><div><b>Vendor:</b> ${esc(vendor.name)}</div>${vendor.phone ? `<div><b>Phone:</b> ${esc(vendor.phone)}</div>` : ''}<div><b>Report date:</b> ${dt(today())}</div></div>
    <div class="totals">
      <div class="tbox"><span>${m(totals.grand)}</span><label>Total spent</label></div>
      <div class="tbox"><span>${m(totals.purchases)}</span><label>Material purchases</label></div>
      <div class="tbox"><span>${m(totals.expenses)}</span><label>General expenses</label></div>
    </div>
    ${purchases.length ? `<h3>Purchases (materials)</h3><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>${purchaseRows}</tbody></table>` : ''}
    ${expenses.length ? `<h3>General expenses</h3><table><thead><tr><th>Date</th><th>Type / Description</th><th>Amount</th></tr></thead><tbody>${expenseRows}</tbody></table>` : ''}
    ${(!purchases.length && !expenses.length) ? '<p>No activity for this vendor.</p>' : ''}
    <div class="grand">Grand total: ${m(totals.grand)}</div>
    <scr` + `ipt>window.onload=function(){setTimeout(function(){window.print()},400)}</scr` + `ipt>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(html); w.document.close();
};
window.addExpType = () => formModal('Add a type of cost', [{ name: 'name', label: 'Type name', placeholder: 'Rent · Electricity · Marketing', required: true }], async (d) => { await POST('/api/expense-types', d); toast('Added'); go('expenses'); });
window.delExpType = (id) => confirmDel('Delete type?', async () => { await DEL('/api/expense-types/' + id); go('expenses'); });
window.delPurchase = (id) => confirmDel('Delete this purchase?', async () => { await DEL('/api/purchases/' + id); closeModal(); go('purchases'); });
let _puLineN = 0;
window.newPurchase = async (presetDressId) => {
  window._puFromExpense = null; // a plain new invoice, not one being moved across
  if (state.user.role === 'admin') await loadFloatHolders();
  const [dresses, vendors] = await Promise.all([
    window._allDressesForPurchase ? Promise.resolve(window._allDressesForPurchase) : GET('/api/dresses'),
    (state.user.role === 'admin' ? GET('/api/vendors') : Promise.resolve(window._purVendors || [])),
  ]);
  window._puDresses = dresses; window._puImg = null; window._puPreset = presetDressId || ''; _puLineN = 0;
  const forDress = presetDressId ? dresses.find((d) => String(d.id) === String(presetDressId)) : null;
  modal(`<h3>${forDress ? 'Materials for ' + esc(forDress.customer_name) : 'New purchase (invoice)'}</h3>
    ${forDress ? `<div class="pu-for">Everything you add here goes on <b>${esc(forDress.customer_name)}</b>${forDress.note ? ' · ' + esc(forDress.note) : ''}</div>` : ''}
    ${vendors.length ? `<label>Vendor *</label>
    <select id="pu_vendor" style="width:100%"><option value="">— a one-off shop, named below —</option>${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>` : '<input id="pu_vendor" type="hidden" value="" />'}
    <label>Shop name * <span class="hint">(if not a regular vendor above)</span></label><input id="pu_shop" placeholder="Who the invoice is from" />
    <label>Paid from</label>
    <select id="pu_paidby" style="width:100%">${paidFromOptions().map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>
    <label>Invoice date</label><input id="pu_date" type="date" value="${today()}" />
    <label>Note</label><input id="pu_note" />
    <div class="row" style="margin-top:6px"><button class="btn ghost sm" onclick="pickPuImg()">📷 Invoice photo</button><span class="hint" id="puImgLbl">None</span></div>
    <div class="sec-title">Items — each linked to a dress</div>
    <div id="pu_lines"></div>
    <button class="btn ghost sm" onclick="addPuLine()">＋ Add item</button>
    <button class="btn" style="margin-top:14px" onclick="savePurchase()">Save purchase</button>`);
  addPuLine();
};
window.pickPuImg = () => pickImage((b64) => { window._puImg = b64; const el = document.getElementById('puImgLbl'); if (el) el.textContent = 'Selected ✓'; });
/* Two dresses can share a client name — say enough to tell them apart */
function dressOptionLabel(d) {
  const bits = [d.customer_name];
  if (d.note) bits.push(String(d.note).slice(0, 26));
  if (d.delivery_date) bits.push(dt(d.delivery_date));
  return bits.join(' · ');
}
window.addPuLine = () => {
  const box = document.getElementById('pu_lines'); if (!box) return;
  const preset = window._puPreset;
  const div = document.createElement('div'); div.className = 'pu-line';
  if (preset) {
    // opened from a dress: it cannot land anywhere else
    div.innerHTML = `<input type="hidden" class="pu-dress" value="${esc(String(preset))}" />
      <input class="pu-item" placeholder="Item — fabric, beading, lining..." />
      <input class="pu-amt" type="number" inputmode="decimal" placeholder="Amount" />
      <button class="btn-icon" onclick="this.parentElement.remove()" aria-label="Remove">✕</button>`;
  } else {
    const opts = (window._puDresses || []).map((d) => `<option value="${d.id}">${esc(dressOptionLabel(d))}</option>`).join('');
    div.innerHTML = `<select class="pu-dress"><option value="">— which dress? —</option>${opts}</select>
      <input class="pu-item" placeholder="Item — fabric, beading, lining..." />
      <input class="pu-amt" type="number" inputmode="decimal" placeholder="Amount" />
      <button class="btn-icon" onclick="this.parentElement.remove()" aria-label="Remove">✕</button>`;
  }
  box.appendChild(div);
};
window.savePurchase = async () => {
  const rows = [...document.querySelectorAll('.pu-line')];
  const filled = rows.filter((l) => Number(l.querySelector('.pu-amt').value) > 0);
  if (!filled.length) return toast('Add at least one item with an amount');
  // never let an item quietly land on the wrong dress — or on none at all
  const orphan = filled.find((l) => !Number(l.querySelector('.pu-dress').value));
  if (orphan) {
    const sel = orphan.querySelector('.pu-dress');
    if (sel && sel.focus) sel.focus();
    return toast('Choose which dress that item is for');
  }
  const lines = filled.map((l) => ({
    dress_id: Number(l.querySelector('.pu-dress').value),
    item: l.querySelector('.pu-item').value,
    amount: Number(l.querySelector('.pu-amt').value),
  }));
  const vSel = document.getElementById('pu_vendor');
  const vendorId = Number(vSel.value) || null;
  const vendorName = vendorId ? vSel.selectedOptions[0].textContent : '';
  const shopEl = document.getElementById('pu_shop');
  const shop = shopEl.value.trim() || vendorName;
  // an invoice is from somebody — without a name the spending shows against
  // nobody, and the vendor reports quietly lose it
  if (!shop) {
    if (shopEl.focus) shopEl.focus();
    return toast('Who is the invoice from? Pick a vendor or type the shop name');
  }
  const paidBy = Number((document.getElementById('pu_paidby') || {}).value) || null;
  await POST('/api/purchases', { vendor_id: vendorId, shop, invoice_date: document.getElementById('pu_date').value, note: document.getElementById('pu_note').value, image: window._puImg, lines, paid_by: paidBy });
  if (window._puFromExpense) {
    await DEL('/api/expenses/' + window._puFromExpense);
    window._puFromExpense = null;
    closeModal(); toast('Moved to Purchases ✓'); return go('purchases');
  }
  closeModal(); toast('Purchase saved');
  // added from a dress? go back to it so the cost is there in front of you
  if (window._puPreset) { window._dressTab = 'materials'; refreshDress(Number(window._puPreset)); }
  else go('purchases');
};
window.delDressImg = async (imgId, dressId) => { await DEL('/api/dress-images/' + imgId); toast('Photo deleted'); refreshDress(dressId); };
/* pointer-based drag-reorder for dress photos (works on touch + mouse); first photo = cover */
function wireDressPhotos(dressId) {
  const box = document.getElementById('dphotos_' + dressId);
  if (!box) return;
  let drag = null;
  box.querySelectorAll('.dphoto').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dphoto-del')) return;
      drag = el; try { el.setPointerCapture(e.pointerId); } catch (_) {} el.style.opacity = '.45';
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const over = (document.elementFromPoint(e.clientX, e.clientY) || {}).closest ? document.elementFromPoint(e.clientX, e.clientY).closest('.dphoto') : null;
      if (over && over !== drag && over.parentElement === box) {
        const r = over.getBoundingClientRect();
        box.insertBefore(drag, (e.clientY < r.top + r.height / 2 || e.clientX < r.left + r.width / 2) ? over : over.nextSibling);
      }
    });
    el.addEventListener('pointerup', async () => {
      if (!drag) return;
      drag.style.opacity = ''; drag = null;
      const order = [...box.querySelectorAll('.dphoto')].map((x) => Number(x.dataset.id));
      await PUT('/api/dresses/' + dressId + '/image-order', { order });
      refreshDress(dressId);
    });
  });
}
window.addFitting = (id) => formModal('Fitting date', [
  { name: 'fitting_date', label: 'Date', type: 'date', required: true, value: today() },
  { name: 'note', label: 'Note' },
], async (d) => { await POST(`/api/dresses/${id}/fittings`, d); toast('Added'); closeModal(); refreshDress(id); });
window.delFitting = async (fid, id) => { await DEL('/api/fittings/' + fid); refreshDress(id); };
window.addDressImg = (id) => pickImages(async (b64) => { await POST(`/api/dresses/${id}/images`, { image: b64 }); toast('Photo added'); refreshDress(id); });
/* A clip off the phone goes up as a file — streamed, never squeezed through a
   data URL like the photos, because a fitting video is tens of megabytes. */
window.addDressVideo = (id) => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'video/*';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    toast('Uploading the video…');
    try {
      const up = await uploadFile(f, (p) => { if (p < 1) toast(`Uploading… ${Math.round(p * 100)}%`); });
      await POST(`/api/dresses/${id}/images`, { image: up.file });
      toast('Video added ✓'); refreshDress(id);
    } catch (e) { toast(e.message, 'error'); }
  };
  inp.click();
};
/* A video that already lives on Instagram, YouTube or TikTok is linked, not
   re-uploaded — it plays inside the app from its own address. */
window.addDressVideoLink = (id) => formModal('Add a video link', [
  { name: 'video_url', label: 'Paste the link', required: true, placeholder: 'https://www.instagram.com/reel/…' },
  { name: 'caption', label: 'What is it? (optional)', placeholder: 'Second fitting' },
], async (d) => {
  await POST(`/api/dresses/${id}/images`, { video_url: d.video_url, caption: d.caption });
  toast('Video added ✓'); closeModal(); refreshDress(id);
}, { hint: 'Instagram, YouTube and TikTok play inside the app. Any other link opens in a new tab.' });
/* "Adjust preview": the card crops the cover to a tall rectangle, and a cover
   shot wide often loses the face to that crop. Dragging moves the photo inside
   the very rectangle the card uses, so what is dragged into view is exactly what
   the card will show. Stored as an object-position, not a new cropped file, so
   the original photo is never touched. */
let _coverPos = null;
window.adjustCover = (id) => {
  const d = (window._dresses || []).find((x) => x.id === id);
  if (!d || !d.cover_image) return toast('Add a cover photo first');
  const [sx, sy] = String(d.cover_pos || '50% 50%').split(' ').map((n) => parseFloat(n) || 50);
  _coverPos = { x: sx, y: sy };
  modal(`<h3>Adjust preview</h3>
    <p class="hint" style="margin-top:-4px">Drag the photo to choose what the card shows.</p>
    <div id="acBox" style="position:relative;width:100%;max-width:280px;margin:0 auto;aspect-ratio:3/4;
      border-radius:14px;overflow:hidden;background:#000;touch-action:none;cursor:grab">
      <img id="acImg" src="${esc(mediaUrl(d.cover_image))}" alt=""
        style="width:100%;height:100%;object-fit:cover;object-position:${sx}% ${sy}%;pointer-events:none;user-select:none" />
      <div id="acGrid" style="position:absolute;inset:0;pointer-events:none;opacity:.55;
        background:linear-gradient(to right,transparent 0 33.2%,#fff 33.2% 33.5%,transparent 33.5% 66.5%,#fff 66.5% 66.8%,transparent 66.8%),
                   linear-gradient(to bottom,transparent 0 33.2%,#fff 33.2% 33.5%,transparent 33.5% 66.5%,#fff 66.5% 66.8%,transparent 66.8%)"></div>
    </div>
    <div class="hint" style="text-align:center;margin-top:8px" id="acLbl">${Math.round(sx)}% · ${Math.round(sy)}%</div>
    <div class="row" style="margin-top:12px;gap:8px">
      <button class="btn sec" style="flex:1" onclick="centreCover()">Centre</button>
      <button class="btn" style="flex:2" onclick="saveCover(${id})">Save</button>
    </div>`);
  wireCoverDrag();
};
function paintCover() {
  const img = document.getElementById('acImg'), lbl = document.getElementById('acLbl');
  if (!img || !_coverPos) return;
  img.style.objectPosition = `${_coverPos.x}% ${_coverPos.y}%`;
  if (lbl) lbl.textContent = `${Math.round(_coverPos.x)}% · ${Math.round(_coverPos.y)}%`;
}
window.centreCover = () => { _coverPos = { x: 50, y: 50 }; paintCover(); };
function wireCoverDrag() {
  const box = document.getElementById('acBox'); if (!box) return;
  let from = null;
  const clamp = (n) => Math.min(100, Math.max(0, n));
  box.addEventListener('pointerdown', (e) => {
    from = { px: e.clientX, py: e.clientY, x: _coverPos.x, y: _coverPos.y };
    box.setPointerCapture(e.pointerId); box.style.cursor = 'grabbing';
  });
  box.addEventListener('pointermove', (e) => {
    if (!from) return;
    e.preventDefault();
    const r = box.getBoundingClientRect();
    // Dragging the photo down reveals what sits above it, so the focus moves up.
    _coverPos.x = clamp(from.x - ((e.clientX - from.px) / r.width) * 100);
    _coverPos.y = clamp(from.y - ((e.clientY - from.py) / r.height) * 100);
    paintCover();
  });
  const stop = () => { from = null; box.style.cursor = 'grab'; };
  box.addEventListener('pointerup', stop);
  box.addEventListener('pointercancel', stop);
}
window.saveCover = async (id) => {
  if (!_coverPos) return;
  try {
    await PUT('/api/dresses/' + id, { cover_pos: `${Math.round(_coverPos.x)}% ${Math.round(_coverPos.y)}%` });
    toast('Preview saved ✓'); closeModal(); refreshDress(id);
  } catch (e) { toast(e.message, 'error'); }
};
window.delDress = (id) => confirmDel('Delete dress booking?', async () => { await DEL('/api/dresses/' + id); closeModal(); go('dresses'); });
async function refreshDress(id) { window._dresses = await GET('/api/dresses'); openDress(id); }
window.saveAssign = async (id) => { await PUT('/api/dresses/' + id, { assigned_to: document.getElementById('assignSel_' + id).value }); toast('Saved'); refreshDress(id); };
window.saveDressStatus = async (id) => { await PUT('/api/dresses/' + id, { status: document.getElementById('statSel_' + id).value }); toast('Saved'); refreshDress(id); };

/* ============ STAFF HR ============ */
PAGES.staff = async (c) => {
  const allUsers = await GET('/api/users');
  const staff = allUsers.filter((u) => u.role === 'staff' || u.role === 'manager');
  window._staff = staff;
  const month = window._payrollMonth || today().slice(0, 7);
  c.innerHTML = title('Staff', '') +
    `<button class="btn" onclick="addStaff()">＋ Staff member</button>
    <div class="filters" style="margin-top:12px"><input type="month" value="${month}" onchange="setPayrollMonth(this.value)" style="width:auto;padding:8px" /></div>
    <div id="payroll"><div class="card"><div class="hint" style="margin:0">Working out the month…</div></div></div>
    <div class="card">${staff.length ? staff.map((s) => `<div class="item" style="cursor:pointer" onclick="openStaff(${s.id})">
      <div class="av">${esc(initials(s.name))}</div>
      <div class="main"><div class="nm">${esc(s.name)}${s.role === 'manager' ? ' <span class="badge">Manager</span>' : ''}</div>
        <div class="sub">${s.job_title ? esc(s.job_title) + ' · ' : ''}${money(s.base_salary)}${s.hire_date ? ' · since ' + dt(s.hire_date) : ''}</div></div>
      <span class="muted" style="font-size:20px">›</span></div>`).join('') : empty('No staff yet', '💼')}</div>`;
  payrollFor(staff, month);
};
window.setPayrollMonth = (m) => { window._payrollMonth = m; go('staff'); };

/* What the month costs in wages: every net added up, with what each person's
   comes to. Worked out after the list is drawn, because it is one request per
   person and the names should not wait for it. */
async function payrollFor(staff, month) {
  const el = document.getElementById('payroll');
  if (!el) return;
  const sheets = await Promise.all(staff.map((s) =>
    GET(`/api/staff/${s.id}/salary?month=${month}`).then((x) => ({ s, x })).catch(() => null)));
  const rows = sheets.filter(Boolean);
  if (!rows.length) { el.innerHTML = ''; return; }
  const total = rows.reduce((t, r) => t + (r.x.net || 0), 0);
  const base = rows.reduce((t, r) => t + (r.x.base || 0), 0);
  const sent = await GET(`/api/salary-payments`).then((p) => p
    .filter((x) => x.month === month).reduce((t, x) => t + (x.amount || 0), 0)).catch(() => 0);
  el.innerHTML = `<div class="card pr-card">
      <div class="pr-k">Wages for ${esc(monthLabel(month))}</div>
      <div class="pr-v">${money(total)}</div>
      <div class="pr-m">${rows.length} on the payroll · ${money(base)} in basic salaries${sent ? ` · ${moneyText(sent)} already sent` : ''}</div>
    </div>
    <div class="card" style="margin-bottom:12px">${rows
      .slice().sort((a, b) => b.x.net - a.x.net)
      .map((r) => `<div class="item" style="cursor:pointer" onclick="openStaff(${r.s.id})">
        <div class="main"><div class="nm">${esc(r.s.name)}</div>
          <div class="sub">${r.x.present_days} present${r.x.absent_days ? ' · ' + r.x.absent_days + ' absent' : ''}${r.x.advances ? ' · ' + moneyText(r.x.advances) + ' advance' : ''}</div></div>
        <div class="serif" style="font-weight:700;white-space:nowrap">${money(r.x.net)}</div></div>`).join('')}</div>`;
}
window.openStaff = (id) => { window._staffId = id; window._staffTab2 = 'overview'; go('staffmember'); };
window.staffTab2 = (t) => { window._staffTab2 = t; go('staffmember'); };
window.setSalMonth = (m) => { window._salMonth = m; go('staffmember'); };
function kv(label, val, cls) { return `<div class="item"><div class="main"><div class="sub">${esc(label)}</div><div class="nm" ${cls ? `style="color:var(--${cls})"` : ''}>${val}</div></div></div>`; }

/* per-staff detail: overview / salary (auto) / absences / advances / attendance */
PAGES.staffmember = async (c) => {
  const id = window._staffId;
  if (!id) return go('staff');
  const [allUsers, attendance, absences, advances] = await Promise.all([
    GET('/api/users'), GET('/api/attendance?user_id=' + id), GET('/api/absences?user_id=' + id), GET('/api/advances?user_id=' + id),
  ]);
  const s = allUsers.find((u) => u.id === id) || {};
  window._staff = allUsers.filter((u) => u.role === 'staff' || u.role === 'manager');
  const month = window._salMonth || today().slice(0, 7);
  const tab = window._staffTab2 || 'overview';
  const tabs = [['overview', 'Overview'], ['salary', 'Salary'], ['absence', 'Absences'], ['advance', 'Advances'], ['att', 'Attendance']];
  let inner = '';
  if (tab === 'overview') {
    const offSet = new Set((s.off_days || '').split(',').map((x) => x.trim()).filter(Boolean));
    inner = `<div class="card">
      ${kv('Role', roleLabel(s.role))}${kv('Job title', s.job_title || '—')}${kv('Base salary', money(s.base_salary))}
      ${kv('Working hours', (s.shift_start || s.shift_end)
        ? `${esc(s.shift_start || '—')} – ${esc(s.shift_end || '—')}`
        : `${esc((window._cfg && window._cfg.check_in_time) || '09:00')} – ${esc((window._cfg && window._cfg.check_out_time) || '17:00')} <span class="hint">· the studio's</span>`)}
      ${kv('Phone', s.phone || '—')}${kv('Email', s.email || '—')}${kv('Hired', s.hire_date ? dt(s.hire_date) : '—')}
      <button class="btn sec" style="margin-top:10px" onclick="editStaff(${id})">Edit details</button></div>
      <div class="sec-title">Paid weekly off-days</div>
      <div class="hint" style="margin:0 2px 6px">Tap the day(s) off — not counted as absence or lateness, and paid.</div>
      <div class="filters">${WEEKDAYS_LABELS.map(([k, l]) => `<span class="chip ${offSet.has(k) ? 'active' : ''}" onclick="toggleOffDay(${id},'${k}')">${l}</span>`).join('')}</div>
      <div class="sec-title">This month so far</div>
      <div id="mtdCard" class="card"><div class="hint" style="margin:0">Working it out…</div></div>`;
  } else if (tab === 'salary') {
    const sal = await GET(`/api/staff/${id}/salary?month=${month}`);
    window._salSheet = sal; // the payslip prints exactly what is on screen
    const [pays, adjustments] = await Promise.all([GET(`/api/salary-payments?user_id=${id}`), GET(`/api/adjustments?user_id=${id}`)]);
    inner = `<div class="filters"><input type="month" value="${month}" onchange="setSalMonth(this.value)" style="width:auto;padding:8px" /></div>
      <div class="card">
        ${kv('Base salary', money(sal.base))}
        ${kv('Working days / month', sal.work_days + '  ·  daily ' + money(sal.daily))}
        ${kv('Absent days', sal.absent_days + ' day(s)')}
        ${kv('− Absence deduction', money(sal.absence_deduction), 'bad')}
        ${kv('Late (beyond grace)', (sal.late_minutes || 0) + ' min')}
        ${kv('− Lateness deduction', money(sal.late_deduction || 0), 'bad')}
        ${kv('Overtime', (sal.overtime_minutes || 0) + ' min ×' + (sal.overtime_mult || 1.5))}
        ${kv('+ Overtime pay', money(sal.overtime_pay || 0), 'ok')}
        ${sal.extra_hours ? kv('Extra task hours', sal.extra_hours + ' h at the plain rate') + kv('+ Extra task pay', money(sal.extra_task_pay || 0), 'ok') : ''}
        ${kv('+ Bonus', money(sal.bonus || 0), 'ok')}
        ${kv('− Deductions', money(sal.deductions || 0), 'bad')}
        ${kv('− Advances this month', money(sal.advances), 'bad')}
        <div class="divider"></div>
        <div class="item"><div class="main"><div class="sub">Net salary · ${month}</div><div class="serif" style="font-size:24px;font-weight:700;color:var(--ok)">${money(sal.net)}</div></div></div>
      </div>
      <button class="btn sec" style="margin-top:10px" onclick="openPayslip(window._salSheet)">🖨 Print payslip</button>
      <div class="row" style="margin-top:10px"><button class="btn sec" onclick="addAdjustment(${id},'bonus','${month}')">＋ Bonus</button><button class="btn danger" onclick="addAdjustment(${id},'deduction','${month}')">＋ Deduction</button></div>
      ${adjustments.length ? `<div class="card" style="margin-top:10px">${adjustments.map((a) => `<div class="item"><div class="av">${a.type === 'bonus' ? '➕' : '➖'}</div>
        <div class="main"><div class="nm" style="color:var(--${a.type === 'bonus' ? 'ok' : 'bad'})">${a.type === 'bonus' ? '+' : '−'} ${money(a.amount)} <span class="badge">${esc(a.month || '')}</span></div><div class="sub">${a.note ? esc(a.note) : a.type}</div></div>
        <button class="btn-icon" onclick="delAdjustment(${a.id})">🗑</button></div>`).join('')}</div>` : ''}
      <button class="btn" style="margin-top:12px" onclick="sendSalary(${id},${sal.net},'${month}')">＋ Send salary (with transfer)</button>
      <div class="sec-title">Salary sent</div>
      <div class="card">${pays.length ? pays.map((p) => `<div class="item">
        ${p.image ? `<div class="av"><img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="${esc(mediaUrl(p.image))}" onclick="lightbox('${esc(mediaUrl(p.image))}')"/></div>` : '<div class="av">💵</div>'}
        <div class="main"><div class="nm">${money(p.amount)} · ${esc(p.month || '')}</div><div class="sub">${p.note ? esc(p.note) + ' · ' : ''}Sent ${dt(p.created_at)}</div></div>
        <span class="badge ${p.status === 'confirmed' ? 'ok' : 'warn'}">${p.status === 'confirmed' ? 'Confirmed ✓' : 'Sent'}</span>
        <button class="btn-icon" onclick="delSalaryPay(${p.id})">🗑</button></div>`).join('') : empty('No salary sent yet')}</div>`;
  } else if (tab === 'absence') {
    inner = `<button class="btn" onclick="addAbsence(${id})">＋ Add absence</button>
      <div class="card" style="margin-top:12px">${absences.length ? absences.map((a) => { const st = a.status || 'confirmed'; return `<div class="item"><div class="av">✕</div>
        <div class="main"><div class="nm">${dt(a.date)} <span class="badge ${st === 'confirmed' ? 'ok' : 'warn'}">${st === 'confirmed' ? 'Confirmed' : 'Pending'}</span></div><div class="sub">${a.reason ? esc(a.reason) : 'Absent day'}</div></div>
        ${st === 'pending' ? `<button class="btn sm ghost" onclick="confirmAbsence(${a.id})">Confirm</button>` : ''}
        <button class="btn-icon" onclick="delAbsence(${a.id})">🗑</button></div>`; }).join('') : empty('No absences recorded')}</div>`;
  } else if (tab === 'advance') {
    const owing = advances.filter((a) => !a.complete && (a.status || 'approved') === 'approved')
      .reduce((t, a) => t + (a.total - a.paid_amount), 0);
    inner = `<button class="btn" onclick="addAdvance(${id})">＋ Add advance</button>
      ${owing ? `<div class="card" style="margin-top:12px;text-align:center">
        <div class="sub muted" style="letter-spacing:2px;text-transform:uppercase;font-size:11px;font-weight:700">Still to come off</div>
        <div class="serif" style="font-size:28px;font-weight:700;color:var(--bad);margin-top:2px">${money(owing)}</div></div>` : ''}
      <div style="margin-top:12px">${advances.length ? advances.map((a) => advanceCard(a, true)).join('') : empty('No advances')}</div>`;
  } else {
    // The whole month, not only the days somebody turned up. A sheet that lists
    // nine days out of thirty does not say whether the other twenty-one were
    // days off, leave, or absence — which is the thing being looked for.
    const sheet = await GET(`/api/staff/${id}/salary?month=${month}`);
    const shown = sheet.days.filter((d) => d.status !== 'future').reverse();
    inner = `<div class="filters"><input type="month" value="${month}" onchange="setSalMonth(this.value)" style="width:auto;padding:8px" /></div>
      <div class="hint" style="margin-bottom:8px">Staff check themselves in/out from their account. Every other working day counts as an absence.</div>
      <div class="card"><div class="tbl-wrap"><table class="att-tbl"><thead><tr><th>Day</th><th>Status</th><th>In</th><th>Out</th></tr></thead>
      <tbody>${shown.length ? shown.map((d) => `<tr class="${d.status}">
        <td>${dt(d.date)}</td>
        <td>${attBadge(d)}</td>
        <td>${d.check_in || '—'}${d.late_min ? ` <span class="att-note bad">+${d.late_min}m</span>` : ''}</td>
        <td>${d.check_out || '—'}${d.ot_min ? ` <span class="att-note ok">+${d.ot_min}m</span>` : ''}${d.extra_hours ? `<div class="att-note ok" title="${esc(d.extra_note || '')}">+${d.extra_hours}h home</div>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted">Nothing for this month</td></tr>'}</tbody></table></div></div>
      <div class="hint" style="margin-top:8px">${sheet.present_days} present · ${sheet.absent_days} absent · ${sheet.paid_leave_days} paid leave · ${sheet.off_days} day(s) off${sheet.extra_hours ? ` · ${sheet.extra_hours}h worked from home` : ''}</div>`;
  }
  c.innerHTML = title(s.name || 'Staff', '') +
    `<div class="sub muted" style="margin:-8px 2px 10px">${roleLabel(s.role)}${s.job_title ? ' · ' + esc(s.job_title) : ''}</div>
    <div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="staffTab2('${k}')">${l}</span>`).join('')}</div>` + inner;
  // Only once the card is actually in the page: called any earlier it looks for
  // an element that is still a string.
  if (tab === 'overview') runningMonth(id);
};
// What a day on the sheet is, in one word.
window.attBadge = (d) => ({
  present:      '<span class="badge ok">Present</span>',
  absent:       '<span class="badge bad">Absent</span>',
  paid_leave:   '<span class="badge ok">Paid absence</span>',
  unpaid_leave: '<span class="badge bad">Unpaid leave</span>',
  off:          '<span class="badge">Day off</span>',
  today:        '<span class="badge warn">Today — not in yet</span>',
}[d.status] || '');

/* What the month has come to so far, filled in after the page draws so the rest
   of the screen is not held up waiting for it. It moves with every check-in and
   check-out, because the days are counted up to today rather than taken off a
   full month at the end of it. */
window.runningMonth = async (id) => {
  const el = document.getElementById('mtdCard');
  if (!el) return;
  let m;
  try { m = await GET(`/api/staff/${id}/salary`); }
  catch (e) { el.innerHTML = '<div class="hint" style="margin:0">Could not work it out just now.</div>'; return; }
  if (!document.getElementById('mtdCard')) return; // the page moved on
  el.innerHTML = `
    <div class="item"><div class="main">
      <div class="sub">Earned up to ${esc(dt(m.as_of))}</div>
      <div class="serif" style="font-size:26px;font-weight:700;color:var(--ok)">${money(m.earned_to_date)}</div>
    </div></div>
    <div class="divider"></div>
    ${kv('Days paid so far', `${m.paid_days} × ${moneyText(m.daily)}`)}
    ${kv('Present', `${m.present_days} day(s)`)}
    ${kv('Absent so far', `${m.absent_days} day(s)`, m.absent_days ? 'bad' : '')}
    ${m.paid_leave_days ? kv('Paid leave', `${m.paid_leave_days} day(s)`, 'ok') : ''}
    ${m.late_minutes ? kv('− Late', `${m.late_minutes} min · ${moneyText(m.late_deduction)}`, 'bad') : ''}
    ${m.overtime_minutes ? kv('+ Overtime', `${m.overtime_minutes} min · ${moneyText(m.overtime_pay)}`, 'ok') : ''}
    ${m.advances ? kv('− Advances', money(m.advances), 'bad') : ''}
    <div class="hint" style="margin:8px 2px 0">Updates itself as the day is checked in and out. The full month's figure is on the Salary tab.</div>`;
};

window.addStaff = () => formModal('New staff member', [
  { name: 'name', label: 'Name', required: true },
  { name: 'role', label: 'Role', type: 'select', value: 'staff', options: [{ value: 'staff', label: 'Staff (dresses + attendance)' }, { value: 'manager', label: 'Manager (students, payments, rounds, courses)' }] },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email (login)', type: 'email' },
  { name: 'password', label: 'Password' },
  { name: 'job_title', label: 'Job title' },
  { name: 'base_salary', label: 'Base salary', type: 'number' },
  { name: 'shift_start', label: 'Starts at (leave empty for the studio hours)', type: 'time' },
  { name: 'shift_end', label: 'Ends at', type: 'time' },
  { name: 'hire_date', label: 'Hire date', type: 'date' },
], async (d) => { d.role = d.role === 'manager' ? 'manager' : 'staff'; await POST('/api/users', d); toast('Added'); go('staff'); });
window.editStaff = (id) => {
  const s = window._staff.find((x) => x.id === id);
  formModal('Edit staff', [
    { name: 'name', label: 'Name', required: true, value: s.name },
    { name: 'role', label: 'Role', type: 'select', value: s.role, options: [{ value: 'staff', label: 'Staff (dresses + attendance)' }, { value: 'manager', label: 'Manager (students, payments, rounds, courses)' }] },
    { name: 'phone', label: 'Phone', value: s.phone },
    { name: 'email', label: 'Email', type: 'email', value: s.email },
    { name: 'password', label: 'New password (optional)' },
    { name: 'job_title', label: 'Job title', value: s.job_title },
    { name: 'base_salary', label: 'Base salary', type: 'number', value: s.base_salary },
    { name: 'shift_start', label: 'Starts at (empty = the studio hours)', type: 'time', value: s.shift_start },
    { name: 'shift_end', label: 'Ends at', type: 'time', value: s.shift_end },
    { name: 'hire_date', label: 'Hire date', type: 'date', value: s.hire_date },
  ], async (d) => { d.role = d.role === 'manager' ? 'manager' : 'staff'; await PUT('/api/users/' + id, d); toast('Saved'); go(state.page); });
};
window.addAbsence = (id) => formModal('Add absence', [
  { name: 'date', label: 'Date', type: 'date', required: true, value: today() },
  { name: 'reason', label: 'Reason (optional)' },
], async (d) => { d.user_id = id; await POST('/api/absences', d); toast('Added'); go('staffmember'); });
window.delAbsence = (aid) => confirmDel('Delete this absence?', async () => { await DEL('/api/absences/' + aid); go('staffmember'); });
window.confirmAbsence = async (aid) => { await PUT('/api/absences/' + aid + '/confirm', {}); toast('Confirmed'); go('staffmember'); };
window.toggleOffDay = async (id, day) => {
  const s = (window._staff || []).find((x) => x.id === id) || {};
  const set = new Set((s.off_days || '').split(',').map((x) => x.trim()).filter(Boolean));
  set.has(day) ? set.delete(day) : set.add(day);
  await PUT('/api/users/' + id, { off_days: [...set].join(',') });
  toast('Saved'); go('staffmember');
};
window.addAdjustment = (id, type, month) => formModal(type === 'bonus' ? 'Add bonus' : 'Add deduction', [
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'month', label: 'Month', type: 'month', value: month },
  { name: 'note', label: 'Note (optional)' },
], async (d) => { d.user_id = id; d.type = type; await POST('/api/adjustments', d); toast('Saved'); go('staffmember'); });
window.delAdjustment = (aid) => confirmDel('Delete this?', async () => { await DEL('/api/adjustments/' + aid); go('staffmember'); });
window.addAdvance = (id) => formModal('Add advance', [
  { name: 'amount', label: 'Amount handed over', type: 'number', required: true },
  { name: 'instalments', label: 'Over how many months', type: 'number', value: 1 },
  { name: 'month', label: 'First deduction from', type: 'month', value: today().slice(0, 7) },
  { name: 'note', label: 'Note (optional)' },
], async (d) => {
  d.user_id = id;
  const r = await POST('/api/advances', d);
  toast(r.instalments > 1 ? `Split over ${r.instalments} months ✓` : 'Added');
  go('staffmember');
});
window.markInstalment = async (aid, paid) => {
  await PUT('/api/advances/' + aid + '/paid', { paid: paid ? 1 : 0 });
  go(state.page);
};

/* An advance as the thing it is: what was handed over, over how many months, how
   much of it has come off a salary, and what is left. Each month underneath says
   whether it has been taken yet. */
function advanceCard(a, canEdit) {
  const st = a.status || 'approved';
  const stBadge = `<span class="badge ${st === 'approved' ? 'ok' : st === 'rejected' ? 'bad' : 'warn'}">${st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : 'Pending'}</span>`;
  const multi = a.instalments > 1;
  const left = Math.round((a.total - a.paid_amount) * 100) / 100;
  return `<div class="card adv-card${a.complete ? ' done' : ''}">
    <div class="item" style="border-bottom:none;padding-bottom:4px">
      <div class="av">${a.complete ? '✓' : '💵'}</div>
      <div class="main">
        <div class="nm">${money(a.total)} ${a.complete ? '<span class="badge ok">Complete</span>' : stBadge}</div>
        <div class="sub">${multi ? `${a.instalments} month(s) · ${a.paid_count} paid` : (a.month ? 'Deduct ' + a.month : 'No month set')}${a.note ? ' · ' + esc(a.note) : ''}</div>
      </div>
      ${st === 'pending' && canEdit ? `<button class="btn sm ghost" onclick="approveAdvance(${a.id},1)">Approve</button><button class="btn sm danger" onclick="approveAdvance(${a.id},0)">Reject</button>`
        : canEdit ? `<button class="btn-icon" onclick="delAdvance(${a.id})">🗑</button>` : ''}
    </div>
    ${multi ? `<div class="adv-bar"><span style="width:${Math.round((a.paid_count / a.instalments) * 100)}%"></span></div>
      <div class="adv-left">${a.complete ? 'Paid off in full' : `${money(left)} still to come off`}</div>
      <div class="adv-parts">${a.parts.map((p) => `<div class="adv-part${p.paid ? ' paid' : ''}">
        <span class="ap-m">${esc(p.month || '—')}</span>
        <span class="ap-a">${money(p.amount)}</span>
        ${canEdit
          ? `<button class="ap-s" onclick="markInstalment(${p.id},${p.paid ? 0 : 1})">${p.paid ? 'Paid ✓' : 'Mark paid'}</button>`
          : `<span class="ap-s ${p.paid ? 'on' : ''}">${p.paid ? 'Paid ✓' : 'Due'}</span>`}
      </div>`).join('')}</div>` : ''}
  </div>`;
}
window.delAdvance = (aid) => confirmDel('Delete this advance?', async () => { await DEL('/api/advances/' + aid); go('staffmember'); });
window.sendSalary = (id, net, month) => formModal('Send salary', [
  { name: 'month', label: 'Month', type: 'month', value: month },
  { name: 'amount', label: 'Amount', type: 'number', value: net },
  { name: 'note', label: 'Note (optional)' },
  { name: 'image', label: 'Transfer screenshot', type: 'image' },
], async (d) => {
  d.user_id = id;
  if (!d.amount && d.amount !== 0) d.amount = net; // keep the prefilled amount if the field was left as-is
  try { await POST('/api/salary-payments', d); toast('Salary sent ✓'); go('staffmember'); }
  catch (e) {
    // That month is already paid. It is nearly always a second tap on Send, so
    // the question is asked rather than the money quietly sent twice.
    if (/already sent/i.test(e.message || '')) {
      if (!confirm(`${e.message}\n\nSend it anyway, as a second payment for that month?`)) throw e;
      await POST('/api/salary-payments', { ...d, force: 1 });
      toast('Sent as a second payment ✓'); go('staffmember');
      return;
    }
    toast(e.message || 'Could not send salary — try again', 'error'); throw e;
  }
});
window.delSalaryPay = (pid) => confirmDel('Delete this salary payment?', async () => { await DEL('/api/salary-payments/' + pid); go('staffmember'); });
window.approveAdvance = async (aid, ok) => { await PUT('/api/advances/' + aid, { status: ok ? 'approved' : 'rejected' }); toast(ok ? 'Approved' : 'Rejected'); go('staffmember'); };

/* ============ CONFIGURATION (admin settings) ============ */
/* ============ ATTENDANCE REQUESTS (manual log approvals) ============ */
PAGES.attreqs = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '🕒'); return; }
  const reqs = await GET('/api/attendance-requests');
  const pending = reqs.filter((r) => r.status === 'pending');
  const decided = reqs.filter((r) => r.status !== 'pending');
  const kindLbl = (k) => (k === 'in' ? 'Check-in' : 'Check-out');
  const row = (r, act) => `<div class="item">
    <div class="av">🕒</div>
    <div class="main"><div class="nm">${esc(r.user_name || '')} · ${kindLbl(r.kind)}${r.time ? ' ' + esc(r.time) : ''}</div>
      <div class="sub">${dt(r.date)}${r.reason ? ' · ' + esc(r.reason) : ''}${r.status !== 'pending' ? ' · ' + (r.status === 'approved' ? '✅ Approved' : '❌ Rejected') : ''}</div></div>
    ${act ? `<div class="row" style="flex:0 0 auto;gap:6px"><button class="btn sm" onclick="decideAttReq(${r.id},'approved')">Approve</button><button class="btn sm danger" onclick="decideAttReq(${r.id},'rejected')">Reject</button></div>` : ''}</div>`;
  c.innerHTML = title('Attendance requests', '🕒') +
    `<div class="sec-title">Pending (${pending.length})</div>
     <div class="card">${pending.length ? pending.map((r) => row(r, true)).join('') : empty('No pending requests', '🕒')}</div>
     ${decided.length ? `<div class="sec-title">History</div><div class="card">${decided.slice(0, 40).map((r) => row(r, false)).join('')}</div>` : ''}`;
};
window.decideAttReq = async (id, status) => { await PUT('/api/attendance-requests/' + id + '/decide', { status }); toast(status === 'approved' ? 'Approved ✓' : 'Rejected'); go('attreqs'); };

PAGES.config = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '⚙'); return; }
  const s = await GET('/api/settings');
  const tab = window._cfgTab || 'academy';
  const tabs = [['academy', 'Academy'], ['salary', 'Salary & Work'], ['location', 'Location'], ['payment', 'Payment'], ['perms', 'Who sees what'], ['backup', 'Backup']];
  let inner = '';
  if (tab === 'academy') {
    inner = `<div class="card"><label>Academy name</label><input id="cfg_academy_name" value="${esc(s.academy_name || '')}" />
      <button class="btn" style="margin-top:12px" onclick="saveCfg(['academy_name'])">Save</button></div>`;
  } else if (tab === 'salary') {
    inner = `<div class="card">
      <label>Working days per month</label><input id="cfg_work_days_per_month" type="number" inputmode="numeric" value="${esc(s.work_days_per_month || '30')}" />
      <div class="hint" style="margin-top:6px">The salary is divided over this many days. Days off and approved leave are paid, so this is the whole month — 30 — not just the days somebody is expected in.</div>
      <label>Check-in time</label><input id="cfg_check_in_time" type="time" value="${esc(s.check_in_time || '09:00')}" />
      <label>Check-out time</label><input id="cfg_check_out_time" type="time" value="${esc(s.check_out_time || '17:00')}" />
      <label>Late grace (minutes)</label><input id="cfg_late_grace_min" type="number" inputmode="numeric" value="${esc(s.late_grace_min || '15')}" />
      <label>Overtime multiplier (×)</label><input id="cfg_overtime_mult" type="number" inputmode="decimal" step="0.1" value="${esc(s.overtime_mult || '1.5')}" />
      <div class="hint" style="margin-top:6px">Daily = base ÷ working days · Hourly = daily ÷ (check-out − check-in). Lateness beyond the grace deducts at the hourly rate; overtime pays at the multiplier. Each staff's paid weekly off-days are set on their profile.</div>
      <button class="btn" style="margin-top:12px" onclick="saveCfg(['work_days_per_month','check_in_time','check_out_time','late_grace_min','overtime_mult'])">Save</button></div>`;
  } else if (tab === 'location') {
    const gLat = esc(s.geo_lat || ''), gLng = esc(s.geo_lng || '');
    inner = `<div class="card">
        <label style="margin:0 0 7px">The studio pin</label>
        <div class="geo-pin" id="geoPin">${geoPinHtml(gLat, gLng)}</div>

        <label style="margin-top:18px">1 · I'm at the studio now</label>
        <button class="btn sec" style="margin-top:6px" onclick="captureGeo()">Use my current location</button>

        <label style="margin-top:18px">2 · Paste a Google Maps link</label>
        <input id="geoPaste" placeholder="https://www.google.com/maps/@30.0444,31.2357,17z" />
        <button class="btn sec" style="margin-top:8px" onclick="geoFromLink()">Read the pin from this link</button>
        <div class="hint" id="geoPasteHint" style="margin-top:6px">On Google Maps, long-press the exact spot, then Share → Copy link. A short <span dir="ltr">maps.app.goo.gl</span> link works — it gets opened for you.</div>

        <label style="margin-top:18px">3 · Type the coordinates</label>
        <div class="row" style="gap:8px">
          <div style="flex:1;min-width:0"><label>Latitude</label><input id="cfg_geo_lat" inputmode="decimal" value="${gLat}" oninput="geoEcho()" placeholder="30.044400" /></div>
          <div style="flex:1;min-width:0"><label>Longitude</label><input id="cfg_geo_lng" inputmode="decimal" value="${gLng}" oninput="geoEcho()" placeholder="31.235700" /></div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <label style="margin-top:0">Require location for check-in / out</label>
        <select id="cfg_geo_enabled"><option value="0" ${s.geo_enabled !== '1' ? 'selected' : ''}>No — allow from anywhere</option><option value="1" ${s.geo_enabled === '1' ? 'selected' : ''}>Yes — only at the studio</option></select>
        <label style="margin-top:12px">Allowed radius (metres)</label>
        <input id="cfg_geo_radius" type="number" inputmode="numeric" value="${esc(s.geo_radius || '150')}" />
        <div class="hint" style="margin-top:6px">Staff & students can only check in or out inside a circle this wide around the pin. Set the switch to “No” to allow from anywhere.</div>
        <button class="btn" style="margin-top:12px" onclick="saveCfg(['geo_enabled','geo_lat','geo_lng','geo_radius'])">Save the pin & the rule</button>
      </div>`;
  } else if (tab === 'backup') {
    const st = await GET('/api/storage').catch(() => null);
    inner = `${st ? `<div class="card" style="border-inline-start:4px solid ${st.persistent ? 'var(--ok)' : 'var(--bad)'}">
        <label style="margin-top:0">${st.persistent ? '✅ Your data is on a permanent disk' : '⚠️ Your data is NOT on a permanent disk'}</label>
        <div class="hint" style="margin-top:6px">${st.persistent
          ? 'It survives a restart and a new version. Nothing to do.'
          : 'It is inside the app, so a restart or a new version wipes it. Set DATA_DIR to a mounted volume on your host, then restart.'}</div>
        <div class="hint" style="margin-top:8px;font-family:ui-monospace,monospace;font-size:11.5px;word-break:break-all">
          database → ${esc(st.data_dir)}<br/>photos &nbsp;&nbsp;→ ${esc(st.upload_dir)} ${st.uploads_persistent ? '' : '⚠️'}</div>
      </div>` : ''}
      <div class="card">
        <label style="margin-top:0">Download a copy of everything</label>
        <div class="hint" style="margin-top:6px">Students, dresses, payments, salaries, attendance — the whole database in one file. Keep it somewhere safe: on hosting without a permanent disk, the app's own copy is wiped every time it restarts.</div>
        <button class="btn" style="margin-top:12px" onclick="downloadBackup('db')">⬇︎ Download backup</button>
        <button class="btn sec" style="margin-top:8px" onclick="downloadBackup('json')">⬇︎ Readable copy (JSON)</button>
        <div class="hint" style="margin-top:10px">The backup restores the app exactly as it is now. The readable copy opens in any browser or notes app if you just need to look something up. Neither includes uploaded photos.</div>
      </div>
      ${st && st.photos ? `<div class="card">
        <label style="margin-top:0">Download the photos</label>
        <div class="hint" style="margin-top:6px">${st.photos} file${st.photos === 1 ? '' : 's'} (${mb(st.photos_bytes)}) — dress photos, fitting shots, receipts and profile pictures. These are files, not rows, so no backup above contains them: leaving this hosting without them loses them.</div>
        <button class="btn sec" style="margin-top:12px" onclick="downloadPhotos()">⬇︎ Download all photos (ZIP)</button>
        <div class="hint" style="margin-top:10px">Opens on any phone or computer without installing anything. To put them back, upload them again — or copy them into the new host's uploads folder under the same names.</div>
      </div>` : ''}
      <div class="card">
        <label style="margin-top:0">Put a backup back</label>
        <div class="hint" style="margin-top:6px">Pick a backup file you downloaded before. Anything already here is kept — only what is missing is put back — so this is safe to run even if the app is not empty.</div>
        <button class="btn sec" style="margin-top:12px" onclick="pickRestore()">⬆︎ Restore from a backup file</button>
      </div>`;
  } else if (tab === 'perms') {
    inner = await permissionsPane();
  } else {
    inner = `<div class="card"><label>Currency</label><input id="cfg_currency" value="${esc(s.currency || 'EGP')}" />
      <div class="hint" style="margin-top:6px">Shown next to all amounts across the app.</div>
      <button class="btn" style="margin-top:12px" onclick="saveCfg(['currency'])">Save</button></div>`;
  }
  c.innerHTML = title('Configuration', '⚙') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="cfgTab('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.cfgTab = (t) => { window._cfgTab = t; go('config'); };
/* Straight navigation rather than fetch-to-blob: the endpoint sends the filename
   in Content-Disposition, and phone browsers save that far more reliably than a
   blob URL. The service worker leaves /api alone, so this is a real download. */
/* Restoring from the phone. Hosting without a permanent disk starts the app
   empty after a redeploy, and there is no terminal to run the script on — so the
   file goes back the same way it came out. */
window.pickRestore = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let payload;
    try { payload = JSON.parse(await f.text()); }
    catch (e) { return toast('That file is not a backup', 'error'); }
    const taken = payload.exported_at ? new Date(payload.exported_at).toLocaleString() : 'an unknown date';
    if (!confirm(`Restore from this backup?\n\nTaken: ${taken}\n\nAnything already in the app is kept — only what is missing is put back.`)) return;
    toast('Restoring…');
    try {
      const r = await POST('/api/restore', { backup: payload });
      toast(`Restored ${r.written} row(s) ✓`);
      if (r.needPassword) alert(`${r.needPassword} account(s) came back without a password — nobody can sign in to them until you set one.\n\nAsk for a password reset for each, or add them again.`);
      go('config');
    } catch (e) { toast(e.message, 'error'); }
  };
  inp.click();
};
// Bytes as a person reads them, so "how big is this download" has an answer.
const mb = (n) => {
  const b = Number(n || 0);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
};
window.downloadPhotos = () => {
  const a = document.createElement('a');
  a.href = '/api/uploads.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Packing the photos… a large one takes a moment');
};
window.downloadBackup = (kind) => {
  const a = document.createElement('a');
  a.href = kind === 'json' ? '/api/backup.json' : '/api/backup';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Preparing your backup…');
};
window.geoPinHtml = (lat, lng) => {
  if (!lat || !lng) return `<span class="gp-dot">📍</span><span class="gp-txt" style="opacity:.6">No pin set yet — choose one of the three ways below.</span>`;
  const q = encodeURIComponent(lat + ',' + lng);
  return `<span class="gp-dot">📍</span><span class="gp-txt">${esc(lat)}, ${esc(lng)}</span>` +
    `<a class="gp-open" href="https://www.google.com/maps?q=${q}" target="_blank" rel="noopener">Check on the map ↗</a>`;
};
window.geoEcho = () => {
  const lat = (document.getElementById('cfg_geo_lat') || {}).value || '';
  const lng = (document.getElementById('cfg_geo_lng') || {}).value || '';
  const pin = document.getElementById('geoPin');
  if (pin) pin.innerHTML = geoPinHtml(lat.trim(), lng.trim());
};
window.setGeo = (lat, lng) => {
  document.getElementById('cfg_geo_lat').value = lat;
  document.getElementById('cfg_geo_lng').value = lng;
  geoEcho();
};
/* Pull "lat,lng" out of whatever Google Maps handed the user. */
window.parseLatLng = (text) => {
  const t = String(text || '').trim();
  if (!t) return null;
  const ok = (a, b) => {
    const la = parseFloat(a), ln = parseFloat(b);
    if (!isFinite(la) || !isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    return { lat: la.toFixed(6), lng: ln.toFixed(6) };
  };
  const N = '(-?\\d{1,3}(?:\\.\\d+)?)';
  let m = t.match(new RegExp('!3d' + N + '.*?!4d' + N));           // place pages
  if (m) return ok(m[1], m[2]);
  m = t.match(new RegExp('@' + N + ',' + N));                       // /maps/@lat,lng,17z
  if (m) return ok(m[1], m[2]);
  m = t.match(new RegExp('[?&](?:q|ll|sll|daddr|center|destination)=' + N + '(?:,|%2C)\\s*' + N, 'i'));
  if (m) return ok(m[1], m[2]);
  m = t.match(new RegExp('^' + N + '\\s*,\\s*' + N + '$'));          // plain "30.04, 31.23"
  if (m) return ok(m[1], m[2]);
  return null;
};
window.geoFromLink = async () => {
  const el = document.getElementById('geoPaste'), hint = document.getElementById('geoPasteHint');
  const raw = (el.value || '').trim();
  const done = (h) => {
    setGeo(h.lat, h.lng);
    hint.className = 'hint';
    hint.textContent = 'Pin read from the link ✓ — now press Save below.';
    toast('Pin set ✓ — now Save');
  };
  const hit = parseLatLng(raw);
  if (hit) return done(hit);

  // A link shared from the Maps app carries an identifier, not coordinates. The
  // app cannot open it — Google answers the browser without the header that
  // would let this page read the reply — so the server opens it instead.
  if (/goo\.gl|maps\.app|g\.co|google\./i.test(raw)) {
    hint.className = 'hint';
    hint.textContent = 'Opening the link…';
    try { return done(await POST('/api/geo/resolve', { link: raw })); }
    catch (e) {
      hint.className = 'hint err';
      hint.textContent = e.message || 'Could not read a pin from that link.';
      buzz();
      return;
    }
  }
  hint.className = 'hint err';
  hint.textContent = 'No coordinates in this text. It should carry something like @30.0444,31.2357 — or just type the two numbers below.';
  buzz();
};
window.captureGeo = async () => {
  toast('Getting location…');
  try {
    const pos = await getPosition(); // defined in portal.js
    setGeo(pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6));
    toast(`Location captured (±${Math.round(pos.coords.accuracy)}m) ✓ — now Save`);
  } catch (e) { toast(e && e.code === 1 ? 'Please allow location access' : 'Could not get location'); }
};
window.saveCfg = async (keys) => {
  const body = {};
  keys.forEach((k) => { const el = document.getElementById('cfg_' + k); if (el) body[k] = el.value; });
  await PUT('/api/settings', body);
  await loadConfig();
  toast('Saved'); go('config');
};

/* ============ PERMISSIONS (per-role section visibility) ============ */
/* Who sees what — a tab of Configuration, and still its own screen for anyone
   who arrives at it by its old address. */
async function permissionsPane() {
  const data = await GET('/api/permissions');
  const hidden = data.hidden || {};
  const roles = [['trainee', 'Students'], ['manager', 'Managers'], ['staff', 'Staff'], ['customer', 'Clients']];
  const role = window._permRole || 'trainee';
  // skip the landing (home) — always visible. A merged screen opens out into the
  // sections inside it, so each one can still be allowed or taken away on its own.
  const pages = (NAV[role] || []).slice(1).flatMap(([k, l, ic]) => (GROUPS[k]
    ? GROUPS[k].tabs.filter(([, , , roles]) => roles.includes(role)).map(([tk, tl, tic]) => [tk, `${l} · ${tl}`, tic])
    : [[k, l, ic]]));
  const hiddenForRole = hidden[role] || [];
  const isHid = (p) => hiddenForRole.includes(p);
  // its own card, so the row of roles is never mistaken for the row of tabs above it
  return `<div class="card" style="margin-top:12px">
      <label style="margin-top:0">Who are you setting up?</label>
      <div class="filters" style="margin-top:8px">${roles.map(([k, l]) => `<span class="chip ${role === k ? 'active' : ''}" onclick="permRole('${k}')">${l}</span>`).join('')}</div>
      <div class="hint" style="margin-top:8px">Choose what <b>${esc(roles.find((r) => r[0] === role)[1])}</b> can see when they log in. Home is always visible.</div>
    </div>
    <div class="card">${pages.map(([k, l, ic]) => `
      <div class="item">
        <div class="av">${ic}</div>
        <div class="main"><div class="nm">${esc(l)}</div><div class="sub muted">${isHid(k) ? 'Hidden from this role' : 'Visible'}</div></div>
        <button class="btn sm ${isHid(k) ? 'sec' : ''}" onclick="togglePerm('${role}','${k}',${isHid(k) ? 1 : 0})">${isHid(k) ? '🚫 Hidden' : '✓ Visible'}</button>
      </div>`).join('')}</div>`;
}
PAGES.permissions = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '🔒'); return; }
  c.innerHTML = title('Permissions', '🔒') + await permissionsPane();
};
/* redraw wherever it is being shown from, on the tab it is being shown on */
const permsRefresh = () => {
  if (state.page !== 'config') return go('permissions');
  window._cfgTab = 'perms'; go('config');
};
window.permRole = (r) => { window._permRole = r; permsRefresh(); };
window.togglePerm = async (role, page, currentlyHidden) => {
  // if it's currently hidden, clicking makes it visible (and vice-versa)
  await PUT('/api/permissions', { role, page, visible: currentlyHidden ? 1 : 0 });
  toast('Updated'); permsRefresh();
};


/* ============ CUSTOMER SERVICE — the studio's inbox ============ */
PAGES.chats = async (c) => {
  const { threads } = await GET('/api/chats');
  window._chatsRefresh = () => go('chats');
  window._chatThreads = threads;
  const groups = [
    { key: 'dress', icon: '👗', name: 'Couture', full: 'Daliessa Couture',
      c1: '#c2185b', c2: '#d9a45f', glow: '194,24,91', blurb: 'Bookings, fittings and gown questions' },
    { key: 'course', icon: '🎓', name: 'Academy', full: 'Dalia Bassel Academy',
      c1: '#6d28d9', c2: '#a24fd6', glow: '109,40,217', blurb: 'Rounds, fees and joining the course' },
    { key: 'general', icon: '✦', name: 'Visitors', full: 'Visitors & general',
      c1: '#0f766e', c2: '#5eead4', glow: '15,118,110', blurb: 'Everything else that comes in' },
  ];
  const of = (k) => threads.filter((t) => (t.topic || 'general') === k);
  const unreadOf = (k) => of(k).reduce((a, t) => a + (t.unread || 0), 0);
  // open on the pile that needs you, unless you already picked one
  const withNew = groups.find((g) => unreadOf(g.key));
  const cat = groups.some((g) => g.key === window._chatCat) ? window._chatCat : (withNew ? withNew.key : 'dress');
  window._chatCat = cat;
  const g = groups.find((x) => x.key === cat);
  const list = of(cat);
  const open = list.filter((t) => t.status !== 'closed').length;
  const total = threads.reduce((a, t) => a + (t.unread || 0), 0);

  c.innerHTML = luxBackdrop() + '<div class="home-lux">' + title('Customer service', '') +
    `<div class="card" style="margin-bottom:14px"><div class="nm serif" style="font-size:17px">${total ? `${total} new message${total === 1 ? '' : 's'}` : 'Nothing new'}</div>
      <div class="sub muted" style="margin-top:4px">${threads.length} conversation${threads.length === 1 ? '' : 's'} in total</div></div>
    <div class="cat-row">
      ${groups.map((x) => {
        const n = of(x.key).length, u = unreadOf(x.key);
        return `<button class="cat${x.key === cat ? ' on' : ''}" style="--c1:${x.c1};--c2:${x.c2};--glow:${x.glow}"
          onclick="chatCat('${x.key}')" aria-pressed="${x.key === cat}">
          ${u ? `<span class="cat-badge">${u}</span>` : ''}
          <span class="cat-ic">${x.icon}</span>
          <span class="cat-n">${x.name}</span>
          <span class="cat-c">${n} chat${n === 1 ? '' : 's'}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="cat-head" style="--c1:${g.c1};--c2:${g.c2}">
      <div class="ch-name">${esc(g.full)}</div>
      <div class="ch-sub">${esc(g.blurb)} · ${open} open</div>
    </div>
    ${list.length ? `<div class="nav-list">${list.map(studioChatRow).join('')}</div>`
      : '<div class="card"><div class="hint" style="padding:8px 2px">Nothing here yet</div></div>'}
    </div>`;
  if (window._openChatAfter) { const id = window._openChatAfter; window._openChatAfter = null; openChat(id); }
};
window.chatCat = (k) => { window._chatCat = k; go('chats'); };

function studioChatRow(t) {
  const m = (window.TOPIC_META || {})[t.topic] || { icon: '✦' };
  return `<div class="chat-row studio" onclick="openChat(${t.id})">
    <span class="ic">${esc(initials(t.user_name))}</span>
    <span class="txt">
      <span class="nm">${esc(t.user_name)} <span class="badge">${esc(roleLabel(t.user_role))}</span>${t.status === 'closed' ? ' <span class="badge ok">handled</span>' : ''}</span>
      <span class="meta">${t.brief_line ? esc(t.brief_line) : (t.last_from_studio ? '↩ ' : '') + esc((t.last_body || '').slice(0, 62) || 'No messages yet')}</span>
      <span class="when">${esc(t.subject || '')}${t.subject ? ' · ' : ''}${dt(t.last_at)}</span></span>
    ${t.unread ? `<span class="chat-badge">${t.unread}</span>` : '<span class="chev">›</span>'}
  </div>`;
}


window.moveLine = async (lineId, dressId) => {
  await PUT('/api/purchase-lines/' + lineId, { dress_id: dressId ? Number(dressId) : null });
  toast(dressId ? 'Moved ✓' : 'Taken off the dress');
  window._purchases = await GET('/api/purchases');
  window._allDressesForPurchase = await GET('/api/dresses');
  window._dresses = window._allDressesForPurchase;
};

window.saveDressBrief = async (id) => {
  await PUT('/api/dresses/' + id, { brief: readBrief('od_') });
  toast('Saved ✓'); window._dressTab = 'occasion'; refreshDress(id);
};

