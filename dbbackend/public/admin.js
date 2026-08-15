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
  return `<label>${f.label}${f.required ? ' *' : ''}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}"${req} ${f.step ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} />`;
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
  modal(`<h3>${esc(heading)}</h3>${dots}<form id="fm">${stepsHtml}${hid.map(fmField).join('')}
    <div class="err hidden" id="fmErr"></div>
    <div class="wnav">
      <button type="button" class="btn sec" id="wBack" onclick="wizNav(-1)" style="display:none">Back</button>
      <button type="button" class="btn" id="wNext" onclick="wizNav(1)" ${multi ? '' : 'style="display:none"'}>Next</button>
      <button class="btn" id="wSave" type="submit" ${multi ? 'style="display:none"' : ''}>${esc(opts.submitLabel || 'Save')}</button>
    </div></form>`);
  _wiz = { step: 0, count: steps.length };
  $('#fm').onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    fields.forEach((f) => {
      const el = $(`[name="${f.name}"]`, e.target); if (!el) return;
      let val = el.value;
      if (f.type === 'number') val = val === '' ? null : Number(val);
      data[f.name] = val;
    });
    try { await onSubmit(data); closeModal(); } catch (err) { const x = $('#fmErr'); x.textContent = err.message; x.classList.remove('hidden'); }
  };
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
window.pickForField = (name, type, accept) => pickImage((b64) => {
  $(`#fi_${name}`).value = b64; $(`#fh_${name}`).textContent = 'Selected ✓';
}, accept || (type === 'file' ? 'video/*,image/*' : 'image/*'));

function confirmDel(msg, fn) { if (confirm(msg || 'Delete this?')) fn(); }
window.confirmDel = confirmDel;
function dayEn(d) { return { friday: 'Friday', saturday: 'Saturday' }[d] || d || ''; }
function leaveEn(t) { return { annual: 'Annual', sick: 'Sick', unpaid: 'Unpaid' }[t] || t; }

/* branded hero (uses uploaded cover photo if set, else brand banner) */
function heroBanner(about, admin) {
  const inner = about && about.home_image
    ? `<div class="hero hero-photo" style="background-image:url('/uploads/${esc(about.home_image)}')" onclick="lightbox('/uploads/${esc(about.home_image)}')"></div>`
    : `<div class="hero hero-brand"><div class="hero-mark">DB</div><div class="hero-name">Dalia Bassel</div><div class="hero-sub">Haute Couture</div></div>`;
  return `<div style="position:relative">${inner}${admin ? `<button class="hero-cta" onclick="event.stopPropagation();uploadCover()">📷 ${about && about.home_image ? 'Change photo' : 'Add photo'}</button>` : ''}</div>`;
}
window.uploadCover = () => pickImage((b64) => cropImage(b64, 16 / 10, async (cropped) => { await PUT('/api/home-cover', { image: cropped }); toast('Cover updated'); go('home'); }));

/* ============ HOME / DASHBOARD ============ */
PAGES.home_admin = async (c) => {
  const [sheet, rounds, dresses, reminders, about, users] = await Promise.all([
    GET('/api/finance/sheet'), GET('/api/rounds'), GET('/api/dresses'), GET('/api/reminders'), GET('/api/about'), GET('/api/users'),
  ]);
  const dueSoon = reminders.filter((r) => !r.done).length;
  c.innerHTML = title('Welcome, Dalia', '') +
    heroBanner(about, true) + `
    <div class="grid g3" style="margin-bottom:14px">
      <div class="stat" onclick="go('members')"><div class="n">${users.length}</div><div class="l">Members</div></div>
      <div class="stat"><div class="n">${sheet.totals.count}</div><div class="l">Students</div></div>
      <div class="stat"><div class="n">${dresses.length}</div><div class="l">Dresses</div></div>
    </div>
    <div class="sec-title">Menu</div>
    <div class="tiles">
      ${[['students', '👩‍🎓', 'Students'], ['finance', '💳', 'Payments'], ['courses', '🎬', 'Courses'], ['homework', '✎', 'Tasks'], ['quizzes', '📝', 'Quizzes'], ['dresses', '👗', 'Dresses']]
        .map(([p, e, t]) => `<div class="tile" onclick="go('${p}')"><div class="em">${e}</div><div class="t">${t}</div></div>`).join('')}
    </div>
    ${dueSoon ? `<div class="card"><div class="sec-title">Payment reminders (${dueSoon})</div>${
      reminders.filter((r) => !r.done).slice(0, 6).map((r) => `<div class="item"><div class="av">◷</div>
        <div class="main"><div class="nm">${esc(r.user_name)}</div><div class="sub">${dt(r.due_date)} · ${money(r.amount)} ${r.note ? '· ' + esc(r.note) : ''}</div></div>
        <button class="btn sm ghost" onclick="markReminder(${r.id})">Done</button></div>`).join('')}</div>` : ''}
    <div class="card">
      <div class="sec-title">Payments summary</div>
      <div class="grid g3">
        <div class="stat"><div class="n">${money(sheet.totals.paid)}</div><div class="l">Collected</div></div>
        <div class="stat"><div class="n">${money(sheet.totals.remaining)}</div><div class="l">Remaining</div></div>
        <div class="stat"><div class="n">${money(sheet.totals.total_fee)}</div><div class="l">Total</div></div>
      </div>
    </div>`;
};
window.markReminder = async (id) => { await PUT('/api/reminders/' + id, { done: 1 }); toast('Done'); go('home'); };

/* ============ MEMBERS (everyone who registered) ============ */
PAGES.members = async (c) => {
  const users = await GET('/api/users');
  window._members = users;
  const roles = ['all', 'admin', 'manager', 'trainee', 'customer', 'staff'];
  const lbl = { all: 'All', admin: 'Admins', manager: 'Managers', trainee: 'Students', customer: 'Clients', staff: 'Staff' };
  const f = window._memF || 'all';
  const list = users.filter((u) => f === 'all' || u.role === f);
  c.innerHTML = title('Members', '') +
    `<div class="grid g2" style="margin-bottom:8px">
      <div class="stat"><div class="n">${users.length}</div><div class="l">Registered</div></div>
      <div class="stat"><div class="n">${users.filter((u) => u.role === 'trainee').length}</div><div class="l">Students</div></div>
    </div>
    <div class="filters">${roles.map((r) => `<span class="chip ${f === r ? 'active' : ''}" onclick="memFilter('${r}')">${lbl[r]} (${r === 'all' ? users.length : users.filter((u) => u.role === r).length})</span>`).join('')}</div>
    <div class="card">${list.length ? list.map((u) => `<div class="item">
      <div class="av">${esc(initials(u.name))}</div>
      <div class="main"><div class="nm">${esc(u.name)}</div><div class="sub">${u.email ? esc(u.email) : 'no email'} · joined ${dt(u.created_at)}</div></div>
      <select onchange="setRole(${u.id},this.value)" style="width:auto;padding:6px 8px;font-size:12px" ${u.role === 'admin' ? 'disabled' : ''}>
        ${['trainee', 'customer', 'staff', 'manager', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${lbl[r] || r}</option>`).join('')}
      </select></div>`).join('') : empty('No members')}</div>`;
};
window.memFilter = (r) => { window._memF = r; go('members'); };
window.setRole = async (id, role) => { await PUT('/api/users/' + id, { role }); toast('Permission updated'); go('members'); };

/* ============ STUDENTS ============ */
PAGES.students = async (c) => {
  const [users, rounds, groups] = await Promise.all([GET('/api/users?role=trainee'), GET('/api/rounds'), GET('/api/groups')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const gMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  window._students = { users, rounds, groups };
  const filter = window._stF || 'all';
  const list = users.filter((u) => filter === 'all' || u.round_id == filter);
  c.innerHTML = title('Students', '') +
    `<button class="btn" onclick="editStudent()">＋ Add student</button>
     <div class="filters" style="margin-top:12px">
       <span class="chip ${filter === 'all' ? 'active' : ''}" onclick="stFilter('all')">All (${users.length})</span>
       ${rounds.map((r) => `<span class="chip ${filter == r.id ? 'active' : ''}" onclick="stFilter(${r.id})">${esc(r.name)}</span>`).join('')}
     </div>
     <input placeholder="🔍 Search student by name" value="${esc(window._stSearch || '')}" oninput="window._stSearch=this.value; liveSearch(this.value,'#studentsList')" style="width:100%;padding:9px 12px;margin:12px 0 8px" />
     <div class="card" id="studentsList">${list.length ? list.map((u) => `
       <div class="item" data-name="${esc((u.name || '').toLowerCase())}" style="cursor:pointer" onclick="viewStudent(${u.id})">
         <div class="av">${esc(initials(u.name))}</div>
         <div class="main"><div class="nm">${esc(u.name)}</div>
           <div class="sub">${u.phone ? esc(u.phone) + ' · ' : ''}${rMap[u.round_id] ? esc(rMap[u.round_id]) : 'No round'}${gMap[u.group_id] ? ' · ' + esc(gMap[u.group_id]) : ''}</div></div>
         <span class="muted" style="font-size:20px">›</span>
       </div>`).join('') : empty('No students yet')}</div>`;
  if (window._stSearch) liveSearch(window._stSearch, '#studentsList');
};
window.viewStudent = async (id) => {
  const { rounds, groups } = window._students;
  const u = window._students.users.find((x) => x.id === id);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const gMap = Object.fromEntries(groups.map((g) => [g.id, g.name + (g.day ? ' · ' + dayEn(g.day) : '') + (g.time_slot ? ' · ' + g.time_slot : '')]));
  const [pays, sheet] = await Promise.all([GET('/api/payments?user_id=' + id), GET('/api/finance/sheet')]);
  const fin = sheet.rows.find((r) => r.id === id) || { total_fee: 0, paid: 0, remaining: 0 };
  modal(`
    <div style="text-align:center;margin-bottom:6px">
      <div class="av" style="width:64px;height:64px;font-size:22px;margin:0 auto 8px">${esc(initials(u.name))}</div>
      <div class="serif" style="font-size:22px;font-weight:700">${esc(u.name)}</div>
      <div class="muted" style="font-size:13px">${rMap[u.round_id] || 'No round'}${gMap[u.group_id] ? ' · ' + esc(gMap[u.group_id]) : ''}</div>
    </div>
    <div class="grid g3" style="margin:12px 0">
      <div class="stat"><div class="n">${money(fin.total_fee)}</div><div class="l">Total</div></div>
      <div class="stat"><div class="n" style="color:var(--ok)">${money(fin.paid)}</div><div class="l">Paid</div></div>
      <div class="stat"><div class="n" style="color:${fin.remaining ? 'var(--bad)' : 'var(--ok)'}">${money(fin.remaining)}</div><div class="l">Remaining</div></div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 12px">
      ${u.governorate ? `<div class="item"><div class="main"><div class="sub">Governorate</div><div class="nm">${esc(u.governorate)}</div></div></div>` : ''}
      ${u.phone ? `<div class="item"><div class="main"><div class="sub">Phone</div><div class="nm">${esc(u.phone)}</div></div></div>` : ''}
      ${u.email ? `<div class="item"><div class="main"><div class="sub">Email (login)</div><div class="nm">${esc(u.email)}</div></div></div>` : ''}
    </div>
    <div class="sec-title">Payments (${pays.length})</div>
    <div class="card" style="box-shadow:none;margin:0">${pays.length ? pays.map((p) => `<div class="item">
      <div class="av">${p.image ? `<img class="thumb" style="width:42px;height:42px;aspect-ratio:1" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}')"/>` : '💵'}</div>
      <div class="main"><div class="nm">${money(p.amount)}</div><div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div></div>`).join('') : '<div class="hint">No payments yet</div>'}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn ghost" onclick="closeModal();addPaymentFor(${id})">＋ Payment</button>
      <button class="btn sec" onclick="closeModal();editStudent(${id})">Edit</button>
    </div>`);
};
window.addPaymentFor = async (id) => {
  window._fin = window._fin || { users: await GET('/api/users?role=trainee') };
  addPayment();
  setTimeout(() => { const s = $('select[name="user_id"]'); if (s) s.value = id; }, 50);
};
window.stFilter = (f) => { window._stF = f; go('students'); };
window.editStudent = async (id) => {
  const { rounds, groups } = window._students;
  const u = id ? window._students.users.find((x) => x.id === id) : {};
  let fee = 0;
  if (id) { try { const s = await GET('/api/finance/sheet'); fee = (s.rows.find((r) => r.id === id) || {}).total_fee || 0; } catch (e) {} }
  formModal(id ? 'Edit student' : 'New student', [
    { name: 'name', label: 'Name', required: true, value: u.name },
    { name: 'phone', label: 'Phone', value: u.phone },
    { name: 'governorate', label: 'Governorate', type: 'select', value: u.governorate, options: [{ value: '', label: '—' }, ...EG_GOV.map((g) => ({ value: g, label: g }))] },
    { name: 'email', label: 'Email (for login code)', type: 'email', value: u.email },
    { name: 'round_id', label: 'Round', type: 'select', value: u.round_id, options: [{ value: '', label: '—' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'group_id', label: 'Group', type: 'select', value: u.group_id, options: [{ value: '', label: '—' }, ...groups.map((g) => ({ value: g.id, label: g.name + (g.day ? ' · ' + dayEn(g.day) : '') + (g.time_slot ? ' · ' + g.time_slot : '') }))] },
    { name: 'total_fee', label: 'Course fee (EGP)', type: 'number', value: fee },
  ], async (d) => {
    d.role = 'trainee';
    if (id) await PUT('/api/users/' + id, d); else await POST('/api/users', d);
    toast('Saved'); go(state.page);
  });
  if (id) $('#fm').insertAdjacentHTML('beforeend', `<button type="button" class="btn danger" style="margin-top:8px" onclick="delStudent(${id})">Delete student</button>`);
};
window.delStudent = (id) => confirmDel('Delete this student and all their data?', async () => { await DEL('/api/users/' + id); closeModal(); toast('Deleted'); go(state.page === 'round' ? 'round' : 'students'); });

/* ============ FINANCE (sheet + payments + reminders) ============ */
PAGES.finance = async (c) => {
  const [sheet, payments, reminders, users] = await Promise.all([
    GET('/api/finance/sheet'), GET('/api/payments'), GET('/api/reminders'), GET('/api/users?role=trainee'),
  ]);
  window._fin = { users };
  const tab = window._finTab || 'sheet';
  const tabs = [['sheet', 'Sheet'], ['pay', 'Payments'], ['rem', 'Reminders']];
  let inner = '';
  if (tab === 'sheet') {
    inner = `<div class="card"><div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Total</th><th>Paid</th><th>Remaining</th></tr></thead>
      <tbody>${sheet.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${money(r.total_fee)}</td>
        <td style="color:var(--ok)">${money(r.paid)}</td><td style="color:${r.remaining ? 'var(--bad)' : 'var(--ok)'}">${money(r.remaining)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total (${sheet.totals.count})</td><td>${money(sheet.totals.total_fee)}</td><td>${money(sheet.totals.paid)}</td><td>${money(sheet.totals.remaining)}</td></tr></tfoot>
      </table></div></div>`;
  } else if (tab === 'pay') {
    inner = `<button class="btn" onclick="addPayment()">＋ Record payment</button>
      <div class="card" style="margin-top:12px">${payments.length ? payments.map((p) => `
      <div class="item">
        <div class="av">${p.image ? `<img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}','Transfer ${esc(p.user_name || '')}')"/>` : '💵'}</div>
        <div class="main"><div class="nm">${esc(p.user_name || '')} · ${money(p.amount)}</div>
          <div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${p.method === 'cash' ? '💵 Cash' : '🏦 Transfer'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
        <button class="btn-icon" onclick="delPayment(${p.id})">🗑</button>
      </div>`).join('') : empty('No payments yet')}</div>`;
  } else {
    inner = `<button class="btn" onclick="addReminder()">＋ Payment reminder</button>
      <div class="card" style="margin-top:12px">${reminders.length ? reminders.map((r) => `
      <div class="item"><div class="av">${r.done ? '✓' : '◷'}</div>
        <div class="main"><div class="nm">${esc(r.user_name)}</div>
          <div class="sub">${dt(r.due_date)} · ${money(r.amount)}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
        ${r.done ? '<span class="badge ok">Done</span>' : `<button class="btn sm ghost" onclick="markReminder2(${r.id})">Done</button>`}
        <button class="btn-icon" onclick="delReminder(${r.id})">🗑</button></div>`).join('') : empty('No reminders')}</div>`;
  }
  c.innerHTML = title('Payments', '') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="finTab('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.finTab = (t) => { window._finTab = t; go('finance'); };
window.addPayment = () => formModal('Record payment', [
  { name: 'user_id', label: 'Student', type: 'select', required: true, options: window._fin.users.map((u) => ({ value: u.id, label: u.name })) },
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'kind', label: 'Type', type: 'select', options: [{ value: 'deposit', label: 'Deposit' }, { value: 'installment', label: 'Installment' }] },
  { name: 'method', label: 'Payment method', type: 'select', value: 'transfer', options: [{ value: 'transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }] },
  { name: 'paid_at', label: 'Date', type: 'date', value: today() },
  { name: 'note', label: 'Note', value: '' },
  { name: 'image', label: 'Transfer screenshot (if bank transfer)', type: 'image' },
], async (d) => { await POST('/api/payments', d); toast('Recorded'); go(state.page); });
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
  c.innerHTML = title('Rounds & Groups', '') +
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
window.addRound = () => formModal('New round', [
  { name: 'number', label: 'Round number', type: 'number' },
  { name: 'name', label: 'Name', required: true, placeholder: 'August Round' },
  { name: 'kind', label: 'Course type', type: 'select', value: 'onsite', options: [{ value: 'online', label: 'Online Course' }, { value: 'onsite', label: 'In‑person' }] },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'description', label: 'Description', type: 'textarea' },
], async (d) => { await POST('/api/rounds', d); toast('Added'); go('rounds'); });
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
  const [groups, users] = await Promise.all([GET('/api/groups'), GET('/api/users?role=trainee')]);
  const g = groups.find((x) => x.id === gid);
  if (!g) return;
  const roundStudents = users.filter((u) => u.round_id === g.round_id);
  const members = roundStudents.filter((u) => u.group_id === gid);
  const available = roundStudents.filter((u) => u.group_id !== gid);
  modal(`<h3>${esc(g.name)}</h3>
    <div class="sub muted">${g.day ? dayEn(g.day) : ''} ${g.time_slot ? '· ' + g.time_slot : ''} · ${members.length}/${g.capacity || '∞'} students</div>
    <div class="sec-title">In this group</div>
    <div class="card" style="box-shadow:none;margin:0 0 12px">${members.length ? members.map((u) => `<div class="item">
      <div class="av">${esc(initials(u.name))}</div><div class="main"><div class="nm">${esc(u.name)}</div></div>
      <button class="btn sm danger" onclick="setStudentGroup(${u.id},'',${gid})">Remove</button></div>`).join('') : '<div class="hint">No students yet — add from below</div>'}</div>
    <div class="sec-title">Add students from this round</div>
    <div class="card" style="box-shadow:none;margin:0">${available.length ? available.map((u) => `<div class="item">
      <div class="av">${esc(initials(u.name))}</div><div class="main"><div class="nm">${esc(u.name)}</div><div class="sub">${u.group_id ? 'in another group' : 'no group'}</div></div>
      <button class="btn sm ghost" onclick="setStudentGroup(${u.id},${gid},${gid})">Add</button></div>`).join('') : '<div class="hint">All round students are already in this group</div>'}</div>`);
};
window.setStudentGroup = async (uid, gid, reopenGid) => {
  await PUT('/api/users/' + uid, { group_id: gid });
  toast('Updated'); await openGroup(reopenGid);
  if (state.page === 'round' || state.page === 'rounds') go(state.page); // refresh counts behind the modal
};

/* ============ COURSES / VIDEOS ============ */
PAGES.courses = async (c) => {
  if (state.user.role !== 'admin' && state.user.role !== 'manager') return PAGES.courses_trainee(c);
  const [rounds, students] = await Promise.all([GET('/api/rounds'), GET('/api/users?role=trainee')]);
  window._rounds = rounds;
  const cnt = (rid) => students.filter((u) => u.round_id === rid).length;
  const tab = window._courseTab === 'onsite' ? 'onsite' : 'online';
  const tabs = [['online', 'Online Course'], ['onsite', 'In‑person']];
  const list = rounds.filter((r) => (r.kind || 'onsite') === tab);
  c.innerHTML = title('Courses', '') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="courseTab('${k}')">${l}</span>`).join('')}</div>
    <button class="btn sec sm" onclick="addRound()">＋ New round</button>
    <div style="margin-top:12px">${list.length ? list.map((r) => `<div class="card" style="cursor:pointer" onclick="openRound(${r.id})">
      <div class="item"><div class="av">${r.number || '#'}</div>
        <div class="main"><div class="nm">${esc(r.name)} <span class="badge">${cnt(r.id)} students</span></div>
          <div class="sub">${r.start_date ? 'Starts ' + dt(r.start_date) : ''}${r.description ? ' · ' + esc(r.description) : ''}</div></div>
        <span class="muted" style="font-size:20px">›</span></div>
    </div>`).join('') : empty(tab === 'onsite' ? 'No in‑person rounds yet' : 'No online rounds yet', '🎓')}</div>`;
};
window.courseTab = (t) => { window._courseTab = t; go('courses'); };
window.openRound = (id) => { window._roundId = id; window._roundTab = 'students'; go('round'); };

/* ---- Round detail: students / groups / payments / videos / attendance / quizzes ---- */
PAGES.round = async (c) => {
  const id = window._roundId;
  if (!id) return go('courses');
  const [rounds, groups, students, videos, quizzes, sheet, attendance] = await Promise.all([
    GET('/api/rounds'), GET('/api/groups'), GET('/api/users?round_id=' + id), GET('/api/videos'),
    GET('/api/quizzes'), GET('/api/finance/sheet'), GET('/api/attendance?round_id=' + id),
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
  const tab = window._roundTab || 'students';
  const tabs = [['students', 'Students'], ['groups', 'Groups'], ['pay', 'Payments'], ['videos', 'Videos'], ['att', 'Attendance'], ['quiz', 'Quizzes']];
  let inner = '';
  if (tab === 'students') {
    const payMap = {}; finRows.forEach((r) => { payMap[r.id] = r; });
    const payStatus = (uid) => { const r = payMap[uid]; if (!r || !r.total_fee) return null; if (r.remaining <= 0) return { t: 'Paid', c: 'ok' }; if (r.paid > 0) return { t: 'Partial', c: 'warn' }; return { t: 'Unpaid', c: 'bad' }; };
    const govs = [...new Set(students.map((s) => s.governorate).filter(Boolean))].sort();
    const gf = window._roundGov || 'all';
    const pf = window._roundPay || 'all';
    let list = students.slice();
    if (gf !== 'all') list = list.filter((s) => (s.governorate || '') === gf);
    if (pf !== 'all') list = list.filter((s) => { const p = payStatus(s.id); return p && p.t.toLowerCase() === pf; });
    if (window._roundSortGov) list.sort((a, b) => (a.governorate || 'زzz').localeCompare(b.governorate || 'زzz') || a.name.localeCompare(b.name));
    inner = `<button class="btn" onclick="editStudent()">＋ Add student</button>
      <div class="row" style="margin:10px 2px 4px;align-items:center;gap:8px">
        <span style="font-weight:700">${list.length} registered</span>
        <select onchange="setRoundGov(this.value)" style="width:auto;padding:6px 8px;font-size:12px;margin-inline-start:auto">
          <option value="all">All governorates</option>${govs.map((g) => `<option value="${esc(g)}" ${gf === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
        <button class="btn ${window._roundSortGov ? '' : 'ghost'} sm" onclick="toggleGovSort()">Sort by gov.</button></div>
      <div class="filters" style="margin:0 2px 6px">${[['all', 'All'], ['paid', 'Paid'], ['partial', 'Partial'], ['unpaid', 'Unpaid']].map(([k, l]) => `<span class="chip ${pf === k ? 'active' : ''}" onclick="setRoundPay('${k}')">${l}</span>`).join('')}</div>
      <input placeholder="🔍 Search student by name" value="${esc(window._roundSearch || '')}" oninput="window._roundSearch=this.value; liveSearch(this.value,'#roundStudentsList')" style="width:100%;padding:9px 12px;margin:0 0 8px" />
      <div class="card" id="roundStudentsList">${list.length ? list.map((u) => { const p = payStatus(u.id); const pr = payMap[u.id]; return `<div class="item" data-name="${esc((u.name || '').toLowerCase())}" style="cursor:pointer" onclick="viewStudent(${u.id})">
        <div class="av">${esc(initials(u.name))}</div>
        <div class="main"><div class="nm">${esc(u.name)}${p ? ` <span class="badge ${p.c}">${p.t}</span>` : ''}</div>
          <div class="sub">${u.governorate ? esc(u.governorate) + ' · ' : ''}${u.phone ? esc(u.phone) : 'no phone'}</div></div>
        ${pr && pr.remaining > 0 ? `<div style="text-align:end;white-space:nowrap"><div style="color:var(--bad);font-weight:700;font-size:13px">${money(pr.remaining)}</div><div class="muted" style="font-size:10px">remaining</div></div>` : (pr && pr.total_fee ? `<div style="color:var(--ok);font-weight:700;font-size:13px;white-space:nowrap">✓ Paid</div>` : '')}
        <span class="muted" style="font-size:20px">›</span></div>`; }).join('') : empty('No students in this round')}</div>`;
  } else if (tab === 'groups') {
    inner = `<button class="btn" onclick="addGroup(${id})">＋ Group</button>
      <div class="card" style="margin-top:12px">${gList.length ? gList.map((g) => `<div class="item"><div class="av">◦</div>
        <div class="main" style="cursor:pointer" onclick="openGroup(${g.id})"><div class="nm">${esc(g.name)}</div><div class="sub">${g.day ? dayEn(g.day) : ''} ${g.time_slot ? '· ' + g.time_slot : ''} · ${gcnt(g.id)}/${g.capacity || '∞'} · tap to add girls ›</div></div>
        <button class="btn-icon" onclick="delGroup(${g.id})">🗑</button></div>`).join('') : empty('No groups yet')}</div>`;
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
        <div class="nm" style="font-weight:600">${esc(v.title)}</div>${v.description ? `<div style="font-size:13px;margin:6px 0">${esc(v.description)}</div>` : ''}
        ${videoEmbed(v)}<button class="btn danger sm" style="margin-top:8px" onclick="delVideo(${v.id})">Delete</button></div>`).join('') : empty('No videos yet', '🎬')}</div>`;
  } else if (tab === 'att') {
    inner = `<div class="hint" style="margin-bottom:8px">Students check themselves in/out from their own account.</div>
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Day</th><th>In</th><th>Out</th></tr></thead>
      <tbody>${attendance.length ? attendance.map((a) => `<tr><td>${esc(a.user_name)}</td><td>${dt(a.date)}</td><td>${a.check_in || '—'}</td><td>${a.check_out || '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No attendance yet</td></tr>'}</tbody></table></div></div>`;
  } else {
    inner = `${isAdmin ? '<button class="btn" onclick="newQuiz()">＋ New quiz</button>' : ''}
      <div style="margin-top:12px">${qList.length ? qList.map((q) => `<div class="card"><div class="item"><div class="av">📝</div>
        <div class="main"><div class="nm">${esc(q.title)} <span class="badge">${q.ref_code}</span></div><div class="sub">${q.questions_count} questions · ${q.duration_min} min</div></div>
        <button class="btn sm sec" onclick="quizResults(${q.id},'${esc(q.title).replace(/'/g, "\\'")}')">Results</button>${isAdmin ? `<button class="btn-icon" onclick="delQuiz(${q.id})">🗑</button>` : ''}</div></div>`).join('') : empty('No quizzes yet', '📝')}</div>`;
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
function videoEmbed(v) {
  if (v.file) return `<video controls style="width:100%;border-radius:10px;margin-top:6px" src="/uploads/${esc(v.file)}"></video>`;
  if (v.url) {
    const yt = v.url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    if (yt) return `<div style="position:relative;padding-top:56%;margin-top:6px"><iframe style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px" src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
    return `<a class="btn sec sm" style="margin-top:6px" href="${esc(v.url)}" target="_blank">▶ Open video</a>`;
  }
  return '';
}
window.addVideo = async (kind, presetRound) => {
  const rounds = window._rounds || await GET('/api/rounds');
  formModal('New video', [
    { name: 'title', label: 'Title', required: true },
    { name: 'kind', label: 'Course type', type: 'select', value: kind === 'onsite' ? 'onsite' : 'online', options: [{ value: 'online', label: 'Online Course' }, { value: 'onsite', label: 'In‑person' }] },
    { name: 'round_id', label: 'Round', type: 'select', value: presetRound || '', options: [{ value: '', label: 'All rounds' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'url', label: 'Link (YouTube or any URL)', placeholder: 'https://...' },
    { name: 'file', label: 'Or upload a video from device', type: 'file', accept: 'video/*' },
  ], async (d) => { await POST('/api/videos', d); toast('Uploaded'); go(state.page); });
};
window.delVideo = (id) => confirmDel('Delete video?', async () => { await DEL('/api/videos/' + id); go('courses'); });

/* ============ HOMEWORK / TASKS ============ */
PAGES.homework = async (c) => {
  if (state.user.role !== 'admin') return PAGES.homework_trainee(c);
  const [hw, rounds] = await Promise.all([GET('/api/homeworks'), GET('/api/rounds')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  window._rounds = rounds;
  c.innerHTML = title('Tasks (Patterns)', '') +
    `<button class="btn" onclick="addHomework()">＋ Send task</button>
    ${hw.length ? hw.map((h) => `<div class="card">
      <div class="item"><div class="av">✎</div>
        <div class="main"><div class="nm">${esc(h.title)}</div>
          <div class="sub">${h.round_id ? esc(rMap[h.round_id] || '') : 'All'} ${h.due_date ? '· due ' + dt(h.due_date) : ''}</div></div>
        <button class="btn sm sec" onclick="viewSubs(${h.id},'${esc(h.title)}')">Submissions</button>
        <button class="btn-icon" onclick="delHomework(${h.id})">🗑</button></div>
      ${h.measurements ? `<div class="hint">Measurements: ${esc(h.measurements)}</div>` : ''}
      ${h.instructions ? `<div class="hint">${esc(h.instructions)}</div>` : ''}
    </div>`).join('') : empty('No tasks yet', '✎')}`;
};
window.addHomework = async () => {
  const rounds = window._rounds || await GET('/api/rounds');
  formModal('New task', [
    { name: 'title', label: 'Title', required: true, placeholder: 'Basic bodice pattern' },
    { name: 'round_id', label: 'Round', type: 'select', options: [{ value: '', label: 'All rounds' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'measurements', label: 'Measurements sent', type: 'textarea', placeholder: 'Bust 90 / Waist 70 / Length 160 ...' },
    { name: 'instructions', label: 'Instructions', type: 'textarea' },
    { name: 'due_date', label: 'Due date', type: 'date' },
  ], async (d) => { await POST('/api/homeworks', d); toast('Sent'); go('homework'); });
};
window.delHomework = (id) => confirmDel('Delete task?', async () => { await DEL('/api/homeworks/' + id); go('homework'); });
window.viewSubs = async (id, tt) => {
  const subs = await GET(`/api/homeworks/${id}/submissions`);
  modal(`<h3>Submissions: ${esc(tt)}</h3>${subs.length ? subs.map((s) => `
    <div class="item"><div class="av">${s.image ? `<img class="thumb" style="width:46px;height:46px;aspect-ratio:1" src="/uploads/${esc(s.image)}" onclick="lightbox('/uploads/${esc(s.image)}','${esc(s.user_name)}')"/>` : '▤'}</div>
      <div class="main"><div class="nm">${esc(s.user_name)}</div><div class="sub">${dt(s.submitted_at)}${s.note ? ' · ' + esc(s.note) : ''}${s.grade ? ' · ' + esc(s.grade) : ''}</div></div>
      <button class="btn sm ghost" onclick="gradeSub(${s.id},'${esc(s.grade || '')}')">Grade</button></div>`).join('') : empty('No submissions')}`);
};
window.gradeSub = (id, cur) => formModal('Grade submission', [
  { name: 'grade', label: 'Grade', value: cur },
  { name: 'feedback', label: 'Feedback', type: 'textarea' },
], async (d) => { await PUT('/api/submissions/' + id, d); toast('Saved'); closeModal(); });

/* ============ QUIZZES ============ */
PAGES.quizzes = async (c) => {
  if (state.user.role !== 'admin') return PAGES.quizzes_trainee(c);
  const [quizzes, rounds] = await Promise.all([GET('/api/quizzes'), GET('/api/rounds')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  window._rounds = rounds;
  c.innerHTML = title('Quizzes', '') +
    `<button class="btn" onclick="newQuiz()">＋ New quiz</button>
    ${quizzes.length ? quizzes.map((q) => `<div class="card">
      <div class="item"><div class="av">📝</div>
        <div class="main"><div class="nm">${esc(q.title)} <span class="badge">${q.ref_code}</span></div>
          <div class="sub">${q.questions_count} questions · ${q.duration_min} min · ${q.round_id ? esc(rMap[q.round_id] || '') : 'All'} · ${q.active ? 'Active' : 'Off'}</div></div>
        <button class="btn sm sec" onclick="quizResults(${q.id},'${esc(q.title)}')">Results</button>
        <button class="btn-icon" onclick="delQuiz(${q.id})">🗑</button></div></div>`).join('') : empty('No quizzes yet', '📝')}`;
};
window.delQuiz = (id) => confirmDel('Delete quiz?', async () => { await DEL('/api/quizzes/' + id); go('quizzes'); });
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
    <label>Duration (minutes)</label><input id="qDur" type="number" value="15" />
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
    closeModal(); toast('Saved'); go('quizzes');
  } catch (e) { const x = $('#qErr'); x.textContent = e.message; x.classList.remove('hidden'); }
};

/* ============ NOTES ============ */
PAGES.notes = async (c) => {
  if (state.user.role !== 'admin') return PAGES.notes_trainee(c);
  const [notes, rounds, users] = await Promise.all([GET('/api/notes'), GET('/api/rounds'), GET('/api/users?role=trainee')]);
  window._noteRef = { rounds, users };
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  const uMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  c.innerHTML = title('Notes & Instructions', '') +
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
  ], async (d) => { await POST('/api/notes', d); toast('Sent'); go('notes'); });
};
window.delNote = (id) => confirmDel('Delete note?', async () => { await DEL('/api/notes/' + id); go('notes'); });

/* ============ ABOUT (edit) ============ */
PAGES.about = async (c) => {
  const a = await GET('/api/about');
  if (state.user.role !== 'admin') return PAGES.about_view(c, a);
  c.innerHTML = title('About the Academy', '') + `<div class="card">
    ${a.image ? `<img class="thumb" style="aspect-ratio:16/9;margin-bottom:10px" src="/uploads/${esc(a.image)}" onclick="lightbox('/uploads/${esc(a.image)}')"/>` : ''}
    <label>Title</label><input id="abT" value="${esc(a.title || '')}" />
    <label>Description</label><textarea id="abB" style="min-height:140px">${esc(a.body || '')}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn ghost" onclick="abPic()">📷 Cover image</button>
    <button class="btn" onclick="saveAbout()">Save</button></div>
    <span class="hint" id="abH"></span></div>`;
  window._abImg = null;
};
window.abPic = () => pickImage((b) => { window._abImg = b; $('#abH').textContent = 'Image selected ✓'; });
window.saveAbout = async () => { await PUT('/api/about', { title: $('#abT').value, body: $('#abB').value, image: window._abImg }); toast('Saved'); go('about'); };

/* ============ DALIA POSTS ============ */
PAGES.dalia = async (c) => {
  const posts = await GET('/api/dalia');
  window._daliaPosts = posts;
  const admin = state.user.role === 'admin';
  c.innerHTML = title('Dalia Bassel', '') +
    `<div class="feed-hero"><div class="fn">Dalia Bassel</div><div class="fs">Haute Couture · News & Highlights</div></div>` +
    (admin ? `<button class="btn" style="margin-bottom:14px" onclick="addDalia()">＋ New post</button>` : '') +
    (posts.length ? posts.map((p) => renderDaliaPost(p, admin)).join('') : empty('No posts yet — add photos & news', '✦'));
};
function renderDaliaPost(p, admin) {
  const tpl = p.template || 'below';
  const img = p.image ? '/uploads/' + esc(p.image) : '';
  const cap = esc((p.title || '').replace(/'/g, ''));
  const imgTag = img ? `<img class="ph" src="${img}" onclick="lightbox('${img}','${cap}')"/>` : '';
  const heads = `${p.title ? `<div class="ttl">${esc(p.title)}</div>` : ''}${p.subtitle ? `<div class="sub2">${esc(p.subtitle)}</div>` : ''}`;
  const txt = p.body ? `<div class="txt">${esc(p.body)}</div>` : '';
  let tbl = ''; try { const t = p.table_data && JSON.parse(p.table_data); if (t && t.rows) tbl = renderMiniTable(t); } catch (e) {}
  const date = `<div class="date">${dt(p.created_at)}</div>`;
  const del = admin ? `<div class="row" style="margin-top:12px"><button class="btn sec sm" onclick="editDalia(${p.id})">Edit / add photo</button><button class="btn danger sm" onclick="delDalia(${p.id})">Delete</button></div>` : '';
  if (tpl === 'hero') {
    return `<div class="feed-post fp-hero">${img ? `<div class="hero-img" style="background-image:url('${img}')" onclick="lightbox('${img}','${cap}')"><div class="hero-ov">${heads}</div></div>` : `<div class="body">${heads}</div>`}<div class="body">${date}${txt}${tbl}${del}</div></div>`;
  }
  if (tpl === 'text') {
    return `<div class="feed-post fp-text"><div class="body">${date}${heads}${txt}${tbl}${del}</div></div>`;
  }
  if (tpl === 'side') {
    return `<div class="feed-post fp-side">${imgTag}<div class="body">${date}${heads}${txt}${tbl}${del}</div></div>`;
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
  modal(`<h3>${p.id ? 'Edit post' : 'New post'}</h3>
    <label>Template</label>
    <select id="dTpl">${tpls.map(([k, l]) => `<option value="${k}" ${(p.template || 'below') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Title</label><input id="dT" value="${esc(p.title || '')}" placeholder="Heading" />
    <label>Subtitle</label><input id="dSub" value="${esc(p.subtitle || '')}" placeholder="Second heading (optional)" />
    <label>Text / description</label><textarea id="dB" placeholder="Write about the dress, the collection, or Dalia...">${esc(p.body || '')}</textarea>
    <div class="row"><button class="btn ghost sm" onclick="dPic()">📷 Photo</button><span class="hint" id="dH">${p.image ? 'Selected ✓' : 'optional'}</span></div>
    ${p.image ? `<img class="thumb" style="width:90px;aspect-ratio:3/4;margin-top:8px" src="/uploads/${esc(p.image)}"/>` : ''}
    <button class="btn" style="margin-top:14px" onclick="saveDalia()">${p.id ? 'Save' : 'Publish'}</button>`);
}
window.dPic = () => pickImage((b) => { window._dImg = b; $('#dH').textContent = 'Selected ✓'; });
window.saveDalia = async () => {
  const body = { template: $('#dTpl').value, title: $('#dT').value, subtitle: $('#dSub').value, body: $('#dB').value, image: window._dImg };
  if (window._dEditId) await PUT('/api/dalia/' + window._dEditId, body);
  else await POST('/api/dalia', body);
  closeModal(); toast('Saved'); go('dalia');
};
window.delDalia = (id) => confirmDel('Delete post?', async () => { await DEL('/api/dalia/' + id); go('dalia'); });

/* ============ DRESSES ============ */
PAGES.dresses = async (c) => {
  if (state.user.role === 'staff') return PAGES.mydresses(c, { title: 'Dresses' }); // staff: read-only view of all dresses
  if (state.user.role !== 'admin' && state.user.role !== 'manager') return PAGES.mydresses(c); // customer: own only
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
    `<button class="btn" onclick="addDress()">＋ Book a dress</button>
    <div class="filters" style="margin-top:12px">${statuses.map(([k, l]) => `<span class="chip ${f.status === k && !f.assigned ? 'active' : ''}" onclick="dressFilter('status','${k}')">${l}</span>`).join('')}
      <span class="chip ${f.assigned ? 'active' : ''}" onclick="dressFilter('assigned','x')">👤 Assigned</span></div>
    <div class="row" style="margin:0 0 12px;align-items:center;gap:8px">
      <input type="month" value="${f.month}" onchange="dressFilter('month',this.value)" style="width:auto;padding:8px" />
      ${f.month ? `<button class="btn ghost sm" onclick="dressFilter('month','')">Clear month</button>` : ''}
      <span class="hint">${list.length} dress(es)</span></div>
    <input placeholder="🔍 Search by client name" value="${esc(window._dressSearch || '')}" oninput="window._dressSearch=this.value; liveSearch(this.value,'#dressList')" style="width:100%;padding:9px 12px;margin:0 0 10px" />
    <div class="grid g2" id="dressList">${list.length ? list.map((d) => `
      <div class="card" data-name="${esc((d.customer_name || '').toLowerCase())}" style="margin:0">
        ${d.cover_image ? `<img class="thumb" src="/uploads/${esc(d.cover_image)}" onclick="openDress(${d.id})"/>` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:30px" onclick="openDress(${d.id})">👗</div>`}
        <div class="nm" style="font-weight:600;margin-top:8px">${esc(d.customer_name)}</div>
        <div class="sub muted" style="font-size:12px">Delivery ${dt(d.delivery_date)} · <span class="badge ${stCls[d.status] || ''}">${stEn[d.status] || d.status}</span></div>
        <div class="sub muted" style="font-size:12px">${d.assignee_name ? '👤 ' + esc(d.assignee_name) : '<span style="color:var(--warn)">Unassigned</span>'} · ${d.fittings.length} fittings</div>
        <button class="btn sec sm" style="margin-top:8px" onclick="openDress(${d.id})">Details</button>
      </div>`).join('') : empty('No dresses match this filter', '👗')}</div>`;
  if (window._dressSearch) liveSearch(window._dressSearch, '#dressList');
};
window.dressFilter = (k, v) => {
  const f = window._dressF || { status: 'all', month: '', assigned: false };
  if (k === 'assigned') f.assigned = !f.assigned;
  else if (k === 'status') { f.status = v; f.assigned = false; }
  else f[k] = v;
  window._dressF = f; go('dresses');
};
window.addDress = () => {
  const { customers, staff } = window._dressRef;
  formModal('Book a dress', [
    { name: 'customer_name', label: 'Client name', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'delivery_date', label: 'Delivery date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'New' }, { value: 'in_progress', label: 'In progress' }, { value: 'delivered', label: 'Delivered' }] },
    { name: 'assigned_to', label: 'Assign to (staff)', type: 'select', options: [{ value: '', label: '— unassigned —' }, ...(staff || []).map((s) => ({ value: s.id, label: s.name + (s.role === 'manager' ? ' (Manager)' : '') }))] },
    { name: 'customer_user_id', label: 'Link to client account (optional)', type: 'select', options: [{ value: '', label: '—' }, ...customers.map((u) => ({ value: u.id, label: u.name + (u.email ? ' · ' + u.email : '') }))] },
    { name: 'note', label: 'Notes', type: 'textarea' },
    { name: 'cover_image', label: 'Dress photo', type: 'image' },
  ], async (d) => { await POST('/api/dresses', d); toast('Booked'); go('dresses'); });
};
window.openDress = (id) => {
  const d = window._dresses.find((x) => x.id === id);
  const staff = (window._dressRef && window._dressRef.staff) || [];
  modal(`<h3>${esc(d.customer_name)}</h3>
    <label>Client name</label><input id="dName_${id}" value="${esc(d.customer_name || '')}" />
    <label>Phone</label><input id="dPhone_${id}" value="${esc(d.phone || '')}" />
    <label>Delivery date</label><input id="dDate_${id}" type="date" value="${d.delivery_date ? String(d.delivery_date).slice(0, 10) : ''}" />
    <label>Notes</label><textarea id="dNote_${id}">${esc(d.note || '')}</textarea>
    ${state.user.role === 'admin' ? `<label>Price 🔒 <span class="hint">(admin only — hidden from others)</span></label><input id="dPrice_${id}" type="number" value="${d.price || 0}" />` : ''}
    <button class="btn sec" style="margin-top:10px" onclick="openMeasurements(${id})">📐 Measurements</button>
    ${state.user.role === 'admin' ? `<div class="sec-title">Material & profit</div>
      <div class="card" style="box-shadow:none;margin:0 0 8px">
        ${kv('Material cost', money(d.material_cost || 0), 'bad')}
        ${kv('Profit', money(d.profit || 0), (d.profit || 0) >= 0 ? 'ok' : 'bad')}
      </div>
      <button class="btn sec sm" onclick="closeModal();newPurchase(${id})">＋ Add material purchase</button>` : ''}
    <div class="sec-title">Status</div>
    <select id="statSel_${id}" onchange="saveDressStatus(${id})" style="width:100%">${[['open', 'New'], ['in_progress', 'In progress'], ['delivered', 'Delivered']].map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="sec-title">Assigned staff</div>
    <select id="assignSel_${id}" onchange="saveAssign(${id})" style="width:100%"><option value="">— unassigned —</option>${staff.map((s) => `<option value="${s.id}" ${d.assigned_to === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <div class="sec-title">Fittings</div>
    ${d.fittings.length ? d.fittings.map((f) => `<div class="item"><div class="av">${f.done ? '✓' : '◷'}</div>
      <div class="main"><div class="nm">${dt(f.fitting_date)}</div><div class="sub">${f.note ? esc(f.note) : ''}</div></div>
      <button class="btn-icon" onclick="delFitting(${f.id},${id})">🗑</button></div>`).join('') : '<div class="hint">No fittings scheduled</div>'}
    <button class="btn ghost sm" style="margin-top:8px" onclick="addFitting(${id})">＋ Fitting date</button>
    <div class="sec-title">Dress photos ${d.images.length > 1 ? '<span class="hint" style="font-weight:400">· drag to reorder · first = cover</span>' : ''}</div>
    <div class="dphotos" id="dphotos_${id}">${d.images.map((im, i) => `<div class="dphoto" data-id="${im.id}">
      <img class="thumb" style="aspect-ratio:3/4;pointer-events:none" src="/uploads/${esc(im.image)}" />
      ${i === 0 ? '<span class="cover-badge">★ Cover</span>' : ''}
      <button class="dphoto-del" onclick="delDressImg(${im.id},${id})">✕</button></div>`).join('')}</div>
    <button class="btn ghost sm" style="margin-top:8px" onclick="addDressImg(${id})">＋ Photo</button>
    <div class="divider"></div>
    <div class="row">
      <button class="btn" onclick="saveDressDetails(${id})">Save changes</button>
      <button class="btn danger" onclick="delDress(${id})">Delete booking</button>
    </div>`);
  wireDressPhotos(id);
};
window.saveDressDetails = async (id) => {
  const name = document.getElementById('dName_' + id).value.trim();
  if (!name) return toast('Client name is required');
  const body = {
    customer_name: name,
    phone: document.getElementById('dPhone_' + id).value,
    delivery_date: document.getElementById('dDate_' + id).value,
    note: document.getElementById('dNote_' + id).value,
  };
  const priceEl = document.getElementById('dPrice_' + id);
  if (priceEl) body.price = Number(priceEl.value) || 0;
  await PUT('/api/dresses/' + id, body);
  toast('Changes saved'); closeModal(); window._dresses = await GET('/api/dresses'); go('dresses');
};

/* ---- Dress measurements editor + printable PDF sheet ---- */
window.openMeasurements = (id) => {
  const d = window._dresses.find((x) => x.id === id) || {};
  let m = {}; try { m = JSON.parse(d.measurements || '{}'); } catch (e) {}
  window._measImg = d.measure_image || null;
  modal(`<h3>Measurements — ${esc(d.customer_name || '')}</h3>
    <div class="grid g2">${MEASURE_FIELDS.map(([k, l]) => `<div><label>${l}</label><input id="ms_${k}" type="number" step="0.5" value="${m[k] != null ? m[k] : ''}" /></div>`).join('')}
      <div><label>Fit</label><select id="ms_fit"><option value="">—</option>${['Slim', 'Front', 'Back'].map((o) => `<option ${m.fit === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
    </div>
    <label>Note</label><textarea id="ms_note">${esc(d.measure_note || '')}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn ghost sm" onclick="pickMeasImg()">📷 Reference photo</button><span class="hint" id="msImgLbl">${d.measure_image ? 'Selected ✓' : 'None'}</span></div>
    <div class="row" style="margin-top:14px"><button class="btn" onclick="saveMeasurements(${id})">Save</button>
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
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>Measurements — ${esc(d.customer_name || '')}</title>
  <style>
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
    <div class="meta"><div><b>Client:</b> ${esc(d.customer_name || '—')}</div><div><b>Delivery:</b> ${d.delivery_date ? dt(d.delivery_date) : '—'}</div><div><b>Fit:</b> ${esc(fit || '—')}</div></div>
    <table>${rows}</table>
    ${note ? `<div class="note"><b>Note:</b> ${esc(note)}</div>` : ''}
    ${img ? `<div class="ref"><div style="font-weight:700;margin-bottom:6px">Reference</div><img src="${img.startsWith('data:') ? img : '/uploads/' + img}"></div>` : ''}
    <scr` + `ipt>window.onload=function(){setTimeout(function(){window.print()},400)}</scr` + `ipt>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(html); w.document.close();
};

/* ============ DRESS MATERIAL PURCHASES (invoices with dress-linked items) ============ */
PAGES.purchases = async (c) => {
  const [invoices, dresses] = await Promise.all([GET('/api/purchases'), GET('/api/dresses')]);
  window._allDressesForPurchase = dresses;
  window._purchases = invoices;
  c.innerHTML = title('Purchases', '🧾') +
    `<button class="btn" onclick="newPurchase()">＋ New purchase (فاتورة)</button>
    <div style="margin-top:12px">${invoices.length ? invoices.map((inv) => `<div class="card">
      <div class="item" style="cursor:pointer" onclick="openPurchase(${inv.id})">${inv.image ? `<div class="av"><img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="/uploads/${esc(inv.image)}"/></div>` : '<div class="av">🧾</div>'}
        <div class="main"><div class="nm">${esc(inv.shop || 'Shop')} · ${money(inv.total)}</div><div class="sub">${inv.invoice_date ? dt(inv.invoice_date) : dt(inv.created_at)}${inv.note ? ' · ' + esc(inv.note) : ''} · tap to view ›</div></div>
        <span class="muted" style="font-size:20px">›</span></div>
      ${inv.lines.map((li) => `<div class="item" style="padding-inline-start:14px"><div class="av" style="background:#fff">◦</div>
        <div class="main"><div class="nm">${esc(li.dress_name || '—')}</div><div class="sub">${li.item ? esc(li.item) + ' · ' : ''}${money(li.amount)}</div></div></div>`).join('')}
    </div>`).join('') : empty('No purchases yet', '🧾')}</div>`;
};
window.openPurchase = (id) => {
  const inv = (window._purchases || []).find((x) => x.id === id);
  if (!inv) return;
  modal(`<h3>${esc(inv.shop || 'Purchase')}</h3>
    <div class="sub muted">${inv.invoice_date ? dt(inv.invoice_date) : dt(inv.created_at)} · Total ${money(inv.total)}</div>
    ${inv.note ? `<div class="hint">${esc(inv.note)}</div>` : ''}
    <div class="sec-title">Invoice</div>
    ${inv.image
      ? `<img style="width:100%;max-height:360px;object-fit:contain;background:#faf7ff;border-radius:12px;cursor:zoom-in" src="/uploads/${esc(inv.image)}" onclick="lightbox('/uploads/${esc(inv.image)}','${esc(inv.shop || '')}')"/>
         <button class="btn ghost sm" style="margin-top:8px" onclick="addPurchaseImg(${id})">📷 Replace invoice photo</button>`
      : `<div class="hint">No invoice photo yet</div><button class="btn ghost sm" style="margin-top:6px" onclick="addPurchaseImg(${id})">📷 Add invoice photo</button>`}
    <div class="sec-title">Items</div>
    <div class="card" style="box-shadow:none;margin:0">${inv.lines.map((li) => `<div class="item"><div class="av" style="background:#fff">◦</div>
      <div class="main"><div class="nm">${esc(li.dress_name || '—')}</div><div class="sub">${li.item ? esc(li.item) + ' · ' : ''}${money(li.amount)}</div></div></div>`).join('')}</div>
    <div class="divider"></div>
    <button class="btn danger" onclick="delPurchase(${id})">Delete purchase</button>`);
};
window.addPurchaseImg = (id) => pickImage(async (b64) => { await PUT('/api/purchases/' + id, { image: b64 }); toast('Invoice photo saved'); window._purchases = await GET('/api/purchases'); openPurchase(id); });
window.delPurchase = (id) => confirmDel('Delete this purchase?', async () => { await DEL('/api/purchases/' + id); closeModal(); go('purchases'); });
let _puLineN = 0;
window.newPurchase = async (presetDressId) => {
  const dresses = window._allDressesForPurchase || await GET('/api/dresses');
  window._puDresses = dresses; window._puImg = null; window._puPreset = presetDressId || ''; _puLineN = 0;
  modal(`<h3>New purchase (فاتورة)</h3>
    <label>Shop</label><input id="pu_shop" placeholder="Shop name" />
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
window.addPuLine = () => {
  const box = document.getElementById('pu_lines'); if (!box) return;
  const opts = (window._puDresses || []).map((d) => `<option value="${d.id}" ${String(window._puPreset) === String(d.id) ? 'selected' : ''}>${esc(d.customer_name)}</option>`).join('');
  const div = document.createElement('div'); div.className = 'pu-line';
  div.style = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  div.innerHTML = `<select class="pu-dress" style="flex:2;min-width:0">${opts}</select><input class="pu-item" placeholder="Item" style="flex:2;min-width:0"/><input class="pu-amt" type="number" placeholder="Amount" style="flex:1;min-width:0"/><button class="btn-icon" onclick="this.parentElement.remove()">✕</button>`;
  box.appendChild(div);
};
window.savePurchase = async () => {
  const lines = [...document.querySelectorAll('.pu-line')].map((l) => ({ dress_id: Number(l.querySelector('.pu-dress').value) || null, item: l.querySelector('.pu-item').value, amount: Number(l.querySelector('.pu-amt').value) || 0 })).filter((x) => x.dress_id && x.amount > 0);
  if (!lines.length) return toast('Add at least one item (dress + amount)');
  await POST('/api/purchases', { shop: document.getElementById('pu_shop').value, invoice_date: document.getElementById('pu_date').value, note: document.getElementById('pu_note').value, image: window._puImg, lines });
  toast('Purchase saved'); closeModal(); go('purchases');
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
window.delDress = (id) => confirmDel('Delete dress booking?', async () => { await DEL('/api/dresses/' + id); closeModal(); go('dresses'); });
async function refreshDress(id) { window._dresses = await GET('/api/dresses'); openDress(id); }
window.saveAssign = async (id) => { await PUT('/api/dresses/' + id, { assigned_to: document.getElementById('assignSel_' + id).value }); toast('Saved'); window._dresses = await GET('/api/dresses'); go('dresses'); };
window.saveDressStatus = async (id) => { await PUT('/api/dresses/' + id, { status: document.getElementById('statSel_' + id).value }); toast('Saved'); window._dresses = await GET('/api/dresses'); go('dresses'); };

/* ============ STAFF HR ============ */
PAGES.staff = async (c) => {
  const allUsers = await GET('/api/users');
  const staff = allUsers.filter((u) => u.role === 'staff' || u.role === 'manager');
  window._staff = staff;
  c.innerHTML = title('Staff', '') +
    `<button class="btn" onclick="addStaff()">＋ Staff member</button>
    <div class="card" style="margin-top:12px">${staff.length ? staff.map((s) => `<div class="item" style="cursor:pointer" onclick="openStaff(${s.id})">
      <div class="av">${esc(initials(s.name))}</div>
      <div class="main"><div class="nm">${esc(s.name)}${s.role === 'manager' ? ' <span class="badge">Manager</span>' : ''}</div>
        <div class="sub">${s.job_title ? esc(s.job_title) + ' · ' : ''}${money(s.base_salary)}${s.hire_date ? ' · since ' + dt(s.hire_date) : ''}</div></div>
      <span class="muted" style="font-size:20px">›</span></div>`).join('') : empty('No staff yet', '💼')}</div>`;
};
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
      ${kv('Phone', s.phone || '—')}${kv('Email', s.email || '—')}${kv('Hired', s.hire_date ? dt(s.hire_date) : '—')}
      <button class="btn sec" style="margin-top:10px" onclick="editStaff(${id})">Edit details</button></div>
      <div class="sec-title">Paid weekly off-days</div>
      <div class="hint" style="margin:0 2px 6px">Tap the day(s) off — not counted as absence or lateness, and paid.</div>
      <div class="filters">${WEEKDAYS_LABELS.map(([k, l]) => `<span class="chip ${offSet.has(k) ? 'active' : ''}" onclick="toggleOffDay(${id},'${k}')">${l}</span>`).join('')}</div>`;
  } else if (tab === 'salary') {
    const sal = await GET(`/api/staff/${id}/salary?month=${month}`);
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
        ${kv('+ Bonus', money(sal.bonus || 0), 'ok')}
        ${kv('− Deductions', money(sal.deductions || 0), 'bad')}
        ${kv('− Advances (سلف) this month', money(sal.advances), 'bad')}
        <div class="divider"></div>
        <div class="item"><div class="main"><div class="sub">Net salary · ${month}</div><div class="serif" style="font-size:24px;font-weight:700;color:var(--ok)">${money(sal.net)}</div></div></div>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn sec" onclick="addAdjustment(${id},'bonus','${month}')">＋ Bonus</button><button class="btn danger" onclick="addAdjustment(${id},'deduction','${month}')">＋ Deduction</button></div>
      ${adjustments.length ? `<div class="card" style="margin-top:10px">${adjustments.map((a) => `<div class="item"><div class="av">${a.type === 'bonus' ? '➕' : '➖'}</div>
        <div class="main"><div class="nm" style="color:var(--${a.type === 'bonus' ? 'ok' : 'bad'})">${a.type === 'bonus' ? '+' : '−'} ${money(a.amount)} <span class="badge">${esc(a.month || '')}</span></div><div class="sub">${a.note ? esc(a.note) : a.type}</div></div>
        <button class="btn-icon" onclick="delAdjustment(${a.id})">🗑</button></div>`).join('')}</div>` : ''}
      <button class="btn" style="margin-top:12px" onclick="sendSalary(${id},${sal.net},'${month}')">＋ Send salary (with transfer)</button>
      <div class="sec-title">Salary sent</div>
      <div class="card">${pays.length ? pays.map((p) => `<div class="item">
        ${p.image ? `<div class="av"><img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}')"/></div>` : '<div class="av">💵</div>'}
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
    inner = `<button class="btn" onclick="addAdvance(${id})">＋ Add advance (سلفة)</button>
      <div class="card" style="margin-top:12px">${advances.length ? advances.map((a) => { const st = a.status || 'approved'; return `<div class="item"><div class="av">💵</div>
        <div class="main"><div class="nm">${money(a.amount)} <span class="badge ${st === 'approved' ? 'ok' : st === 'rejected' ? 'bad' : 'warn'}">${st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : 'Pending'}</span></div><div class="sub">${a.month ? 'Deduct ' + a.month : 'No month set'}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
        ${st === 'pending' ? `<button class="btn sm ghost" onclick="approveAdvance(${a.id},1)">Approve</button><button class="btn sm danger" onclick="approveAdvance(${a.id},0)">Reject</button>` : `<button class="btn-icon" onclick="delAdvance(${a.id})">🗑</button>`}</div>`; }).join('') : empty('No advances')}</div>`;
  } else {
    inner = `<div class="hint" style="margin-bottom:8px">Staff check themselves in/out from their account.</div>
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Day</th><th>In</th><th>Out</th></tr></thead>
      <tbody>${attendance.length ? attendance.map((a) => `<tr><td>${dt(a.date)}</td><td>${a.check_in || '—'}</td><td>${a.check_out || '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No records</td></tr>'}</tbody></table></div></div>`;
  }
  c.innerHTML = title(s.name || 'Staff', '') +
    `<div class="sub muted" style="margin:-8px 2px 10px">${roleLabel(s.role)}${s.job_title ? ' · ' + esc(s.job_title) : ''}</div>
    <div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="staffTab2('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.addStaff = () => formModal('New staff member', [
  { name: 'name', label: 'Name', required: true },
  { name: 'role', label: 'Role', type: 'select', value: 'staff', options: [{ value: 'staff', label: 'Staff (dresses + attendance)' }, { value: 'manager', label: 'Manager (students, payments, rounds, courses)' }] },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email (login)', type: 'email' },
  { name: 'password', label: 'Password' },
  { name: 'job_title', label: 'Job title' },
  { name: 'base_salary', label: 'Base salary', type: 'number' },
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
window.addAdvance = (id) => formModal('Add advance (سلفة)', [
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'month', label: 'Deduct from month', type: 'month', value: today().slice(0, 7) },
  { name: 'note', label: 'Note (optional)' },
], async (d) => { d.user_id = id; await POST('/api/advances', d); toast('Added'); go('staffmember'); });
window.delAdvance = (aid) => confirmDel('Delete this advance?', async () => { await DEL('/api/advances/' + aid); go('staffmember'); });
window.sendSalary = (id, net, month) => formModal('Send salary', [
  { name: 'month', label: 'Month', type: 'month', value: month },
  { name: 'amount', label: 'Amount', type: 'number', value: net },
  { name: 'note', label: 'Note (optional)' },
  { name: 'image', label: 'Transfer screenshot', type: 'image' },
], async (d) => { d.user_id = id; await POST('/api/salary-payments', d); toast('Salary sent'); go('staffmember'); });
window.delSalaryPay = (pid) => confirmDel('Delete this salary payment?', async () => { await DEL('/api/salary-payments/' + pid); go('staffmember'); });
window.approveAdvance = async (aid, ok) => { await PUT('/api/advances/' + aid, { status: ok ? 'approved' : 'rejected' }); toast(ok ? 'Approved' : 'Rejected'); go('staffmember'); };

/* ============ CONFIGURATION (admin settings) ============ */
PAGES.config = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '⚙'); return; }
  const s = await GET('/api/settings');
  const tab = window._cfgTab || 'academy';
  const tabs = [['academy', 'Academy'], ['salary', 'Salary & Work'], ['payment', 'Payment']];
  let inner = '';
  if (tab === 'academy') {
    inner = `<div class="card"><label>Academy name</label><input id="cfg_academy_name" value="${esc(s.academy_name || '')}" />
      <button class="btn" style="margin-top:12px" onclick="saveCfg(['academy_name'])">Save</button></div>`;
  } else if (tab === 'salary') {
    inner = `<div class="card">
      <label>Working days per month</label><input id="cfg_work_days_per_month" type="number" value="${esc(s.work_days_per_month || '30')}" />
      <label>Check-in time</label><input id="cfg_check_in_time" type="time" value="${esc(s.check_in_time || '09:00')}" />
      <label>Check-out time</label><input id="cfg_check_out_time" type="time" value="${esc(s.check_out_time || '17:00')}" />
      <label>Late grace (minutes)</label><input id="cfg_late_grace_min" type="number" value="${esc(s.late_grace_min || '15')}" />
      <label>Overtime multiplier (×)</label><input id="cfg_overtime_mult" type="number" step="0.1" value="${esc(s.overtime_mult || '1.5')}" />
      <div class="hint" style="margin-top:6px">Daily = base ÷ working days · Hourly = daily ÷ (check-out − check-in). Lateness beyond the grace deducts at the hourly rate; overtime pays at the multiplier. Each staff's paid weekly off-days are set on their profile.</div>
      <button class="btn" style="margin-top:12px" onclick="saveCfg(['work_days_per_month','check_in_time','check_out_time','late_grace_min','overtime_mult'])">Save</button></div>`;
  } else {
    inner = `<div class="card"><label>Currency</label><input id="cfg_currency" value="${esc(s.currency || 'EGP')}" />
      <div class="hint" style="margin-top:6px">Shown next to all amounts across the app.</div>
      <button class="btn" style="margin-top:12px" onclick="saveCfg(['currency'])">Save</button></div>`;
  }
  c.innerHTML = title('Configuration', '⚙') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="cfgTab('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.cfgTab = (t) => { window._cfgTab = t; go('config'); };
window.saveCfg = async (keys) => {
  const body = {};
  keys.forEach((k) => { const el = document.getElementById('cfg_' + k); if (el) body[k] = el.value; });
  await PUT('/api/settings', body);
  await loadConfig();
  toast('Saved'); go('config');
};

/* ============ PERMISSIONS (per-role section visibility) ============ */
PAGES.permissions = async (c) => {
  if (state.user.role !== 'admin') { c.innerHTML = empty('Admins only', '🔒'); return; }
  const data = await GET('/api/permissions');
  const hidden = data.hidden || {};
  const roles = [['trainee', 'Students'], ['manager', 'Managers'], ['staff', 'Staff'], ['customer', 'Clients']];
  const role = window._permRole || 'trainee';
  const pages = (NAV[role] || []).slice(1); // skip the landing (home) — always visible
  const hiddenForRole = hidden[role] || [];
  const isHid = (p) => hiddenForRole.includes(p);
  c.innerHTML = title('Permissions', '🔒') +
    `<div class="filters">${roles.map(([k, l]) => `<span class="chip ${role === k ? 'active' : ''}" onclick="permRole('${k}')">${l}</span>`).join('')}</div>
    <div class="hint" style="margin:2px 2px 10px">Choose what <b>${esc(roles.find((r) => r[0] === role)[1])}</b> can see when they log in. Home is always visible.</div>
    <div class="card">${pages.map(([k, l, ic]) => `
      <div class="item">
        <div class="av">${ic}</div>
        <div class="main"><div class="nm">${esc(l)}</div><div class="sub muted">${isHid(k) ? 'Hidden from this role' : 'Visible'}</div></div>
        <button class="btn sm ${isHid(k) ? 'sec' : ''}" onclick="togglePerm('${role}','${k}',${isHid(k) ? 1 : 0})">${isHid(k) ? '🚫 Hidden' : '✓ Visible'}</button>
      </div>`).join('')}</div>`;
};
window.permRole = (r) => { window._permRole = r; go('permissions'); };
window.togglePerm = async (role, page, currentlyHidden) => {
  // if it's currently hidden, clicking makes it visible (and vice-versa)
  await PUT('/api/permissions', { role, page, visible: currentlyHidden ? 1 : 0 });
  toast('Updated'); go('permissions');
};
