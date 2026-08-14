'use strict';
/* Dalia Bassel Couture — ADMIN pages */

/* generic form modal. fields: {name,label,type,options,required,value,accept,rows} */
function formModal(heading, fields, onSubmit, opts = {}) {
  const body = fields.map((f) => {
    if (f.type === 'hidden') return '';
    const v = f.value ?? '';
    if (f.type === 'select') {
      return `<label>${f.label}${f.required ? ' *' : ''}</label><select name="${f.name}">${
        (f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    if (f.type === 'textarea') return `<label>${f.label}${f.required ? ' *' : ''}</label><textarea name="${f.name}" ${f.rows ? `style="min-height:${f.rows * 22}px"` : ''}>${esc(v)}</textarea>`;
    if (f.type === 'image' || f.type === 'file') {
      return `<label>${f.label}</label>
        <div class="row"><button type="button" class="btn ghost sm" onclick="pickForField('${f.name}','${f.type}','${f.accept || ''}')">📷 Choose ${f.type === 'file' ? 'file' : 'image'}</button>
        <span class="hint" id="fh_${f.name}" style="flex:2">${v ? 'Selected' : 'None'}</span></div>
        <input type="hidden" name="${f.name}" id="fi_${f.name}" value="${esc(v)}" />`;
    }
    return `<label>${f.label}${f.required ? ' *' : ''}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} />`;
  }).join('');
  modal(`<h3>${esc(heading)}</h3><form id="fm">${body}<div class="err hidden" id="fmErr"></div>
    <button class="btn" type="submit" style="margin-top:16px">${esc(opts.submitLabel || 'Save')}</button></form>`);
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
  const roles = ['all', 'admin', 'trainee', 'customer', 'staff'];
  const lbl = { all: 'All', admin: 'Admins', trainee: 'Students', customer: 'Clients', staff: 'Staff' };
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
        ${['trainee', 'customer', 'staff', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${lbl[r] || r}</option>`).join('')}
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
     <div class="card">${list.length ? list.map((u) => `
       <div class="item" style="cursor:pointer" onclick="viewStudent(${u.id})">
         <div class="av">${esc(initials(u.name))}</div>
         <div class="main"><div class="nm">${esc(u.name)}</div>
           <div class="sub">${u.phone ? esc(u.phone) + ' · ' : ''}${rMap[u.round_id] ? esc(rMap[u.round_id]) : 'No round'}${gMap[u.group_id] ? ' · ' + esc(gMap[u.group_id]) : ''}</div></div>
         <span class="muted" style="font-size:20px">›</span>
       </div>`).join('') : empty('No students yet')}</div>`;
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
    { name: 'email', label: 'Email (login)', type: 'email', value: u.email },
    { name: 'password', label: id ? 'New password (optional)' : 'Password', value: '' },
    { name: 'round_id', label: 'Round', type: 'select', value: u.round_id, options: [{ value: '', label: '—' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'group_id', label: 'Group', type: 'select', value: u.group_id, options: [{ value: '', label: '—' }, ...groups.map((g) => ({ value: g.id, label: g.name + (g.day ? ' · ' + dayEn(g.day) : '') + (g.time_slot ? ' · ' + g.time_slot : '') }))] },
    { name: 'total_fee', label: 'Course fee (EGP)', type: 'number', value: fee },
  ], async (d) => {
    d.role = 'trainee';
    if (id) await PUT('/api/users/' + id, d); else await POST('/api/users', d);
    toast('Saved'); go('students');
  });
  if (id) $('#fm').insertAdjacentHTML('beforeend', `<button type="button" class="btn danger" style="margin-top:8px" onclick="delStudent(${id})">Delete student</button>`);
};
window.delStudent = (id) => confirmDel('Delete this student and all their data?', async () => { await DEL('/api/users/' + id); closeModal(); toast('Deleted'); go('students'); });

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
          <div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
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
  { name: 'paid_at', label: 'Date', type: 'date', value: today() },
  { name: 'note', label: 'Note', value: '' },
  { name: 'image', label: 'Transfer screenshot', type: 'image' },
], async (d) => { await POST('/api/payments', d); toast('Recorded'); go('finance'); });
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
        <div class="main"><div class="nm">${esc(r.name)} <span class="badge">${cnt(r.id)} students</span></div>
          <div class="sub">${r.start_date ? 'Starts ' + dt(r.start_date) : ''} ${r.description ? '· ' + esc(r.description) : ''}</div></div>
        <button class="btn-icon" onclick="delRound(${r.id})">🗑</button></div>
      ${groups.filter((g) => g.round_id === r.id).map((g) => `<div class="item" style="padding-inline-start:14px">
        <div class="av" style="background:#fff">◦</div>
        <div class="main"><div class="nm">${esc(g.name)}</div>
          <div class="sub">${g.day ? dayEn(g.day) : ''} ${g.time_slot ? '· ' + g.time_slot : ''} · ${gcnt(g.id)}/${g.capacity || '∞'}</div></div>
        <button class="btn-icon" onclick="delGroup(${g.id})">🗑</button></div>`).join('')}
    </div>`).join('') : empty('No rounds yet — start by adding a round')}`;
  window._rounds = rounds;
};
window.addRound = () => formModal('New round', [
  { name: 'number', label: 'Round number', type: 'number' },
  { name: 'name', label: 'Name', required: true, placeholder: 'August Round' },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'description', label: 'Description', type: 'textarea' },
], async (d) => { await POST('/api/rounds', d); toast('Added'); go('rounds'); });
window.delRound = (id) => confirmDel('Delete round?', async () => { await DEL('/api/rounds/' + id); go('rounds'); });
window.addGroup = async () => {
  const rounds = window._rounds || await GET('/api/rounds');
  formModal('New group', [
    { name: 'round_id', label: 'Round', type: 'select', options: rounds.map((r) => ({ value: r.id, label: r.name })) },
    { name: 'name', label: 'Group name', required: true, placeholder: 'Group 1' },
    { name: 'day', label: 'Day', type: 'select', options: [{ value: 'friday', label: 'Friday' }, { value: 'saturday', label: 'Saturday' }] },
    { name: 'time_slot', label: 'Time', type: 'select', options: [{ value: '11-3', label: '11 AM – 3 PM' }, { value: '5-9', label: '5 PM – 9 PM' }] },
    { name: 'capacity', label: 'Capacity', type: 'number', value: 6 },
  ], async (d) => { await POST('/api/groups', d); toast('Added'); go('rounds'); });
};
window.delGroup = (id) => confirmDel('Delete group?', async () => { await DEL('/api/groups/' + id); go('rounds'); });

/* ============ COURSES / VIDEOS ============ */
PAGES.courses = async (c) => {
  if (state.user.role !== 'admin') return PAGES.courses_trainee(c);
  const [videos, rounds] = await Promise.all([GET('/api/videos'), GET('/api/rounds')]);
  const rMap = Object.fromEntries(rounds.map((r) => [r.id, r.name]));
  window._rounds = rounds;
  c.innerHTML = title('Courses — Videos', '') +
    `<button class="btn" onclick="addVideo()">＋ Upload / add video</button>
    <div class="grid g2" style="margin-top:12px">${videos.length ? videos.map((v) => `
      <div class="card" style="margin:0">
        <div class="nm" style="font-weight:600">${esc(v.title)}</div>
        <div class="sub muted" style="font-size:12px">${v.round_id ? esc(rMap[v.round_id] || '') : 'All rounds'}</div>
        ${v.description ? `<div style="font-size:13px;margin:6px 0">${esc(v.description)}</div>` : ''}
        ${videoEmbed(v)}
        <button class="btn danger sm" style="margin-top:8px" onclick="delVideo(${v.id})">Delete</button>
      </div>`).join('') : empty('No videos yet', '🎬')}</div>`;
};
function videoEmbed(v) {
  if (v.file) return `<video controls style="width:100%;border-radius:10px;margin-top:6px" src="/uploads/${esc(v.file)}"></video>`;
  if (v.url) {
    const yt = v.url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    if (yt) return `<div style="position:relative;padding-top:56%;margin-top:6px"><iframe style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px" src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
    return `<a class="btn sec sm" style="margin-top:6px" href="${esc(v.url)}" target="_blank">▶ Open video</a>`;
  }
  return '';
}
window.addVideo = async () => {
  const rounds = window._rounds || await GET('/api/rounds');
  formModal('New video', [
    { name: 'title', label: 'Title', required: true },
    { name: 'round_id', label: 'Round', type: 'select', options: [{ value: '', label: 'All rounds' }, ...rounds.map((r) => ({ value: r.id, label: r.name }))] },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'url', label: 'Link (YouTube or any URL)', placeholder: 'https://...' },
    { name: 'file', label: 'Or upload a video from device', type: 'file', accept: 'video/*' },
  ], async (d) => { await POST('/api/videos', d); toast('Uploaded'); go('courses'); });
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
  const admin = state.user.role === 'admin';
  c.innerHTML = title('Dalia Bassel', '') +
    `<div class="feed-hero"><div class="fn">Dalia Bassel</div><div class="fs">Haute Couture · News & Highlights</div></div>` +
    (admin ? `<button class="btn" style="margin-bottom:14px" onclick="addDalia()">＋ New post</button>` : '') +
    (posts.length ? posts.map((p) => {
      let tbl = ''; try { const t = p.table_data && JSON.parse(p.table_data); if (t && t.rows) tbl = renderMiniTable(t); } catch (e) {}
      return `<div class="feed-post">
      ${p.image ? `<img class="ph" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}','${esc(p.title || '')}')"/>` : ''}
      <div class="body">
        <div class="date">${dt(p.created_at)}</div>
        ${p.title ? `<div class="ttl">${esc(p.title)}</div>` : ''}
        ${p.body ? `<div class="txt">${esc(p.body)}</div>` : ''}
        ${tbl}
        ${admin ? `<button class="btn danger sm" style="margin-top:12px" onclick="delDalia(${p.id})">Delete</button>` : ''}
      </div></div>`;
    }).join('') : empty('No posts yet — add photos & news', '✦'));
};
function renderMiniTable(t) {
  return `<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${(t.cols || []).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${(t.rows || []).map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
window.addDalia = () => {
  modal(`<h3>New post</h3>
    <label>Title</label><input id="dT" />
    <label>Text</label><textarea id="dB"></textarea>
    <div class="row"><button class="btn ghost sm" onclick="dPic()">📷 Image</button><span class="hint" id="dH">optional</span></div>
    <div class="divider"></div><div class="sec-title">Table (optional)</div>
    <label>Column headers (comma-separated)</label><input id="dCols" placeholder="Item, Qty, Price" />
    <label>Rows (one per line, values comma-separated)</label><textarea id="dRows" placeholder="Dress, 2, 3000&#10;Embroidery, 1, 500"></textarea>
    <button class="btn" style="margin-top:12px" onclick="saveDalia()">Publish</button>`);
  window._dImg = null;
};
window.dPic = () => pickImage((b) => { window._dImg = b; $('#dH').textContent = 'Selected ✓'; });
window.saveDalia = async () => {
  let td = null;
  const cols = $('#dCols').value.trim(); const rows = $('#dRows').value.trim();
  if (cols || rows) td = { cols: cols.split(',').map((s) => s.trim()), rows: rows.split('\n').filter(Boolean).map((l) => l.split(',').map((s) => s.trim())) };
  await POST('/api/dalia', { title: $('#dT').value, body: $('#dB').value, image: window._dImg, table_data: td });
  closeModal(); toast('Published'); go('dalia');
};
window.delDalia = (id) => confirmDel('Delete post?', async () => { await DEL('/api/dalia/' + id); go('dalia'); });

/* ============ DRESSES ============ */
PAGES.dresses = async (c) => {
  if (state.user.role !== 'admin') return PAGES.mydresses(c);
  const [dresses, customers] = await Promise.all([GET('/api/dresses'), GET('/api/users?role=customer')]);
  window._dressRef = { customers };
  const stEn = { open: 'New', in_progress: 'In progress', delivered: 'Delivered' };
  const stCls = { open: 'warn', in_progress: '', delivered: 'ok' };
  c.innerHTML = title('Dresses', '') +
    `<button class="btn" onclick="addDress()">＋ Book a dress</button>
    <div class="grid g2" style="margin-top:12px">${dresses.length ? dresses.map((d) => `
      <div class="card" style="margin:0">
        ${d.cover_image ? `<img class="thumb" src="/uploads/${esc(d.cover_image)}" onclick="openDress(${d.id})"/>` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:30px" onclick="openDress(${d.id})">👗</div>`}
        <div class="nm" style="font-weight:600;margin-top:8px">${esc(d.customer_name)}</div>
        <div class="sub muted" style="font-size:12px">Delivery ${dt(d.delivery_date)} · <span class="badge ${stCls[d.status] || ''}">${stEn[d.status] || d.status}</span></div>
        <div class="sub muted" style="font-size:12px">${d.fittings.length} fittings · ${d.images.length} photos</div>
        <button class="btn sec sm" style="margin-top:8px" onclick="openDress(${d.id})">Details</button>
      </div>`).join('') : empty('No dresses yet', '👗')}</div>`;
  window._dresses = dresses;
};
window.addDress = () => {
  const { customers } = window._dressRef;
  formModal('Book a dress', [
    { name: 'customer_name', label: 'Client name', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'delivery_date', label: 'Delivery date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'New' }, { value: 'in_progress', label: 'In progress' }, { value: 'delivered', label: 'Delivered' }] },
    { name: 'customer_user_id', label: 'Link to client account (optional)', type: 'select', options: [{ value: '', label: '—' }, ...customers.map((u) => ({ value: u.id, label: u.name + (u.email ? ' · ' + u.email : '') }))] },
    { name: 'note', label: 'Notes', type: 'textarea' },
    { name: 'cover_image', label: 'Dress photo', type: 'image' },
  ], async (d) => { await POST('/api/dresses', d); toast('Booked'); go('dresses'); });
};
window.openDress = (id) => {
  const d = window._dresses.find((x) => x.id === id);
  modal(`<h3>${esc(d.customer_name)}</h3>
    <div class="sub muted">${d.phone ? esc(d.phone) + ' · ' : ''}Delivery ${dt(d.delivery_date)}</div>
    ${d.note ? `<div class="hint">${esc(d.note)}</div>` : ''}
    <div class="sec-title">Fittings</div>
    ${d.fittings.length ? d.fittings.map((f) => `<div class="item"><div class="av">${f.done ? '✓' : '◷'}</div>
      <div class="main"><div class="nm">${dt(f.fitting_date)}</div><div class="sub">${f.note ? esc(f.note) : ''}</div></div>
      <button class="btn-icon" onclick="delFitting(${f.id},${id})">🗑</button></div>`).join('') : '<div class="hint">No fittings scheduled</div>'}
    <button class="btn ghost sm" style="margin-top:8px" onclick="addFitting(${id})">＋ Fitting date</button>
    <div class="sec-title">Dress photos</div>
    <div class="gallery">${d.images.map((im) => `<img class="thumb" style="aspect-ratio:3/4" src="/uploads/${esc(im.image)}" onclick="lightbox('/uploads/${esc(im.image)}','${esc(im.caption || d.customer_name)}')"/>`).join('')}</div>
    <button class="btn ghost sm" style="margin-top:8px" onclick="addDressImg(${id})">＋ Photo</button>
    <div class="divider"></div>
    <button class="btn danger" onclick="delDress(${id})">Delete booking</button>`);
};
window.addFitting = (id) => formModal('Fitting date', [
  { name: 'fitting_date', label: 'Date', type: 'date', required: true, value: today() },
  { name: 'note', label: 'Note' },
], async (d) => { await POST(`/api/dresses/${id}/fittings`, d); toast('Added'); closeModal(); refreshDress(id); });
window.delFitting = async (fid, id) => { await DEL('/api/fittings/' + fid); refreshDress(id); };
window.addDressImg = (id) => pickImages(async (b64) => { await POST(`/api/dresses/${id}/images`, { image: b64 }); toast('Photo added'); refreshDress(id); });
window.delDress = (id) => confirmDel('Delete dress booking?', async () => { await DEL('/api/dresses/' + id); closeModal(); go('dresses'); });
async function refreshDress(id) { window._dresses = await GET('/api/dresses'); openDress(id); }

/* ============ STAFF HR ============ */
PAGES.staff = async (c) => {
  const [staff, att, sal, lv] = await Promise.all([GET('/api/users?role=staff'), GET('/api/attendance'), GET('/api/salaries'), GET('/api/leaves')]);
  window._staff = staff;
  const tab = window._staffTab || 'people';
  const tabs = [['people', 'Staff'], ['att', 'Attendance'], ['sal', 'Salaries'], ['lv', 'Leaves']];
  let inner = '';
  if (tab === 'people') {
    inner = `<button class="btn" onclick="addStaff()">＋ Staff member</button>
      <div class="card" style="margin-top:12px">${staff.length ? staff.map((s) => `<div class="item"><div class="av">${esc(initials(s.name))}</div>
        <div class="main"><div class="nm">${esc(s.name)}</div><div class="sub">${s.job_title ? esc(s.job_title) + ' · ' : ''}${money(s.base_salary)} ${s.hire_date ? '· since ' + dt(s.hire_date) : ''}</div></div>
        <button class="btn sm sec" onclick="editStaff(${s.id})">Edit</button></div>`).join('') : empty('No staff yet', '💼')}</div>`;
  } else if (tab === 'att') {
    inner = `<button class="btn sec" onclick="addAtt()">＋ Manual entry</button>
      <div class="card" style="margin-top:12px"><div class="tbl-wrap"><table><thead><tr><th>Staff</th><th>Day</th><th>In</th><th>Out</th></tr></thead>
      <tbody>${att.length ? att.map((a) => `<tr><td>${esc(a.user_name)}</td><td>${dt(a.date)}</td><td>${a.check_in || '—'}</td><td>${a.check_out || '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No records</td></tr>'}</tbody></table></div></div>`;
  } else if (tab === 'sal') {
    inner = `<button class="btn" onclick="addSalary()">＋ Salary</button>
      <div class="card" style="margin-top:12px"><div class="tbl-wrap"><table><thead><tr><th>Staff</th><th>Month</th><th>Base</th><th>Bonus</th><th>Deduct</th><th>Net</th><th></th></tr></thead>
      <tbody>${sal.length ? sal.map((s) => `<tr><td>${esc(s.user_name)}</td><td>${esc(s.month)}</td><td>${money(s.base)}</td><td>${money(s.bonus)}</td><td>${money(s.deduction)}</td><td>${money(s.net)}</td>
        <td>${s.paid ? '<span class="badge ok">Paid</span>' : `<button class="btn sm ghost" onclick="paySalary(${s.id})">Pay</button>`}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">No records</td></tr>'}</tbody></table></div></div>`;
  } else {
    inner = `<div class="card">${lv.length ? lv.map((l) => `<div class="item"><div class="av">🌴</div>
      <div class="main"><div class="nm">${esc(l.user_name)}</div><div class="sub">${dt(l.from_date)} → ${dt(l.to_date)} · ${leaveEn(l.type)}${l.reason ? ' · ' + esc(l.reason) : ''}</div></div>
      ${l.status === 'pending' ? `<button class="btn sm ghost" onclick="setLeave(${l.id},'approved')">Approve</button><button class="btn sm danger" onclick="setLeave(${l.id},'rejected')">Reject</button>` : `<span class="badge ${l.status === 'approved' ? 'ok' : 'bad'}">${l.status === 'approved' ? 'Approved' : 'Rejected'}</span>`}</div>`).join('') : empty('No leaves', '🌴')}</div>`;
  }
  c.innerHTML = title('Staff', '') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="staffTab('${k}')">${l}</span>`).join('')}</div>` + inner;
};
window.staffTab = (t) => { window._staffTab = t; go('staff'); };
window.addStaff = () => formModal('New staff member', [
  { name: 'name', label: 'Name', required: true },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email (login)', type: 'email' },
  { name: 'password', label: 'Password' },
  { name: 'job_title', label: 'Job title' },
  { name: 'base_salary', label: 'Base salary', type: 'number' },
  { name: 'hire_date', label: 'Hire date', type: 'date' },
], async (d) => { d.role = 'staff'; await POST('/api/users', d); toast('Added'); go('staff'); });
window.editStaff = (id) => {
  const s = window._staff.find((x) => x.id === id);
  formModal('Edit staff', [
    { name: 'name', label: 'Name', required: true, value: s.name },
    { name: 'phone', label: 'Phone', value: s.phone },
    { name: 'email', label: 'Email', type: 'email', value: s.email },
    { name: 'password', label: 'New password (optional)' },
    { name: 'job_title', label: 'Job title', value: s.job_title },
    { name: 'base_salary', label: 'Base salary', type: 'number', value: s.base_salary },
    { name: 'hire_date', label: 'Hire date', type: 'date', value: s.hire_date },
  ], async (d) => { d.role = 'staff'; await PUT('/api/users/' + id, d); toast('Saved'); go('staff'); });
};
window.addAtt = () => formModal('Manual attendance', [
  { name: 'user_id', label: 'Staff', type: 'select', options: window._staff.map((s) => ({ value: s.id, label: s.name })) },
  { name: 'date', label: 'Day', type: 'date', value: today() },
  { name: 'check_in', label: 'In', type: 'time' },
  { name: 'check_out', label: 'Out', type: 'time' },
], async (d) => { await POST('/api/attendance', d); toast('Saved'); go('staff'); });
window.addSalary = () => formModal('Monthly salary', [
  { name: 'user_id', label: 'Staff', type: 'select', options: window._staff.map((s) => ({ value: s.id, label: s.name })) },
  { name: 'month', label: 'Month', type: 'month', value: today().slice(0, 7) },
  { name: 'base', label: 'Base', type: 'number' },
  { name: 'bonus', label: 'Bonus', type: 'number' },
  { name: 'deduction', label: 'Deduction', type: 'number' },
], async (d) => { await POST('/api/salaries', d); toast('Saved'); go('staff'); });
window.paySalary = async (id) => { await PUT('/api/salaries/' + id, { paid: 1 }); toast('Paid'); go('staff'); };
window.setLeave = async (id, st) => { await PUT('/api/leaves/' + id, { status: st }); go('staff'); };
