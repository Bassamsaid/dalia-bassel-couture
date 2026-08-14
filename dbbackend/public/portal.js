'use strict';
/* Dalia Bassel Couture — STUDENT / STAFF / CLIENT pages + role dispatch */

/* ============ MY PROFILE (all roles) ============ */
PAGES.profile = async (c) => {
  const u = state.user;
  c.innerHTML = title('My Profile', '') + `
    <div class="card" style="text-align:center">
      <div class="av" style="width:76px;height:76px;font-size:26px;margin:0 auto 8px">${esc(initials(u.name))}</div>
      <div class="serif" style="font-size:22px;font-weight:700">${esc(u.name)}</div>
      <div class="muted">${roleLabel(u.role)}${u.email ? ' · ' + esc(u.email) : ''}</div>
    </div>
    <div class="card">
      <label>Name</label><input id="pfName" value="${esc(u.name)}" />
      <label>Phone</label><input id="pfPhone" value="${esc(u.phone || '')}" />
      <label>New password (optional)</label><input id="pfPass" type="password" placeholder="••••••" />
      <button class="btn" style="margin-top:14px" onclick="saveProfile()">Save changes</button>
    </div>`;
};
window.saveProfile = async () => {
  const body = { name: $('#pfName').value, phone: $('#pfPhone').value };
  if ($('#pfPass').value) body.password = $('#pfPass').value;
  await PUT('/api/profile', body);
  state.user = (await GET('/api/me')).user;
  toast('Saved'); renderApp();
};

/* ---- role dispatch for the shared "home" nav key ---- */
PAGES.home = async (c) => {
  const r = state.user.role;
  if (r === 'admin') return PAGES.home_admin(c);
  if (r === 'staff') return PAGES.home_staff(c);
  return PAGES.home_trainee(c);
};

/* ============ STUDENT HOME ============ */
PAGES.home_trainee = async (c) => {
  const u = state.user;
  const [pay, quizzes, hw, notes, rounds] = await Promise.all([
    GET('/api/payments'), GET('/api/quizzes'), GET('/api/homeworks'), GET('/api/notes'), GET('/api/rounds'),
  ]);
  const round = rounds.find((r) => r.id === u.round_id);
  const paid = pay.reduce((a, p) => a + (p.amount || 0), 0);
  const pendingHw = hw.filter((h) => !h.my_submission).length;
  const newQuiz = quizzes.filter((q) => !q.my_attempt).length;
  c.innerHTML = title(`Welcome, ${u.name}`, '') + `
    <div class="card">
      <div class="sec-title">Your round</div>
      ${round ? `<div class="nm serif" style="font-size:18px">${esc(round.name)}${round.number ? ' · Round ' + round.number : ''}</div>
        <div class="sub muted">${round.start_date ? 'Starts ' + dt(round.start_date) : ''} ${round.description ? '· ' + esc(round.description) : ''}</div>` : '<div class="muted">Not enrolled in a round yet</div>'}
    </div>
    <div class="grid g3">
      <div class="stat" onclick="go('mypay')"><div class="n">${money(paid)}</div><div class="l">Paid</div></div>
      <div class="stat" onclick="go('homework')"><div class="n">${pendingHw}</div><div class="l">Tasks due</div></div>
      <div class="stat" onclick="go('quizzes')"><div class="n">${newQuiz}</div><div class="l">New quiz</div></div>
    </div>
    <div class="sec-title">Menu</div>
    <div class="tiles">
      ${[['courses', '🎬', 'Courses'], ['homework', '✎', 'Tasks'], ['quizzes', '📝', 'Quizzes'], ['notes', '📌', 'Notes'], ['mypay', '💳', 'Account'], ['about', 'ℹ', 'About']]
      .map(([p, e, t]) => `<div class="tile" onclick="go('${p}')"><div class="em">${e}</div><div class="t">${t}</div></div>`).join('')}
    </div>
    ${notes.length ? `<div class="sec-title">Latest notes</div>${notes.slice(0, 3).map((n) => `<div class="card"><div class="nm" style="font-weight:600">${esc(n.title)}</div>${n.body ? `<div style="font-size:13px">${esc(n.body)}</div>` : ''}</div>`).join('')}` : ''}`;
};

/* ============ STUDENT COURSES (videos, read-only) ============ */
PAGES.courses_trainee = async (c) => {
  const videos = await GET('/api/videos');
  const tab = window._courseTab === 'onsite' ? 'onsite' : 'online';
  const tabs = [['online', 'Online Course'], ['onsite', 'In‑person']];
  const list = videos.filter((v) => (v.kind || 'online') === tab);
  c.innerHTML = title('Courses', '') +
    `<div class="filters">${tabs.map(([k, l]) => `<span class="chip ${tab === k ? 'active' : ''}" onclick="courseTab('${k}')">${l}</span>`).join('')}</div>` +
    (list.length ? list.map((v) => `<div class="card">
      <div class="nm" style="font-weight:600">${esc(v.title)}</div>
      ${v.description ? `<div style="font-size:13px;margin:6px 0">${esc(v.description)}</div>` : ''}
      ${videoEmbed(v)}</div>`).join('') : empty(tab === 'onsite' ? 'No in‑person videos yet' : 'No online videos yet', '🎬'));
};

/* ============ STUDENT TASKS ============ */
PAGES.homework_trainee = async (c) => {
  const hw = await GET('/api/homeworks');
  c.innerHTML = title('Tasks', '') +
    (hw.length ? hw.map((h) => `<div class="card">
      <div class="nm" style="font-weight:600">${esc(h.title)}</div>
      <div class="sub muted">${h.due_date ? 'Due ' + dt(h.due_date) : ''}</div>
      ${h.measurements ? `<div class="hint">Measurements: ${esc(h.measurements)}</div>` : ''}
      ${h.instructions ? `<div class="hint">${esc(h.instructions)}</div>` : ''}
      ${h.my_submission ? `<div class="item" style="margin-top:8px">
          ${h.my_submission.image ? `<img class="thumb" style="width:54px;height:54px;aspect-ratio:1" src="/uploads/${esc(h.my_submission.image)}" onclick="lightbox('/uploads/${esc(h.my_submission.image)}')"/>` : '▤'}
          <div class="main"><div class="nm">Submitted ✓</div><div class="sub">${dt(h.my_submission.submitted_at)}${h.my_submission.grade ? ' · ' + esc(h.my_submission.grade) : ''}</div>
          ${h.my_submission.feedback ? `<div class="hint">${esc(h.my_submission.feedback)}</div>` : ''}</div>
          <button class="btn sm sec" onclick="submitHw(${h.id})">Edit</button></div>`
        : `<button class="btn" style="margin-top:8px" onclick="submitHw(${h.id})">Upload pattern</button>`}
    </div>`).join('') : empty('No tasks yet', '✎'));
};
window.submitHw = (id) => {
  modal(`<h3>Upload pattern</h3>
    <div class="row"><button class="btn ghost" onclick="hwPic()">📷 Pattern photo</button></div>
    <img id="hwPrev" class="thumb hidden" style="aspect-ratio:3/4;margin-top:10px"/>
    <label>Note (optional)</label><textarea id="hwNote"></textarea>
    <button class="btn" style="margin-top:12px" onclick="doSubmitHw(${id})">Submit</button>`);
  window._hwImg = null;
};
window.hwPic = () => pickImage((b) => { window._hwImg = b; const p = $('#hwPrev'); p.src = b; p.classList.remove('hidden'); });
window.doSubmitHw = async (id) => {
  if (!window._hwImg) return toast('Choose the pattern photo');
  await POST(`/api/homeworks/${id}/submit`, { image: window._hwImg, note: $('#hwNote').value });
  closeModal(); toast('Submitted ✓'); go('homework');
};

/* ============ STUDENT QUIZZES ============ */
PAGES.quizzes_trainee = async (c) => {
  const quizzes = await GET('/api/quizzes');
  c.innerHTML = title('Quizzes', '') +
    (quizzes.length ? quizzes.map((q) => `<div class="card">
      <div class="item"><div class="av">📝</div>
        <div class="main"><div class="nm">${esc(q.title)} <span class="badge">${q.ref_code}</span></div>
          <div class="sub">${q.questions_count} questions · ${q.duration_min} min</div></div>
        ${q.my_attempt ? `<span class="badge ok">${q.my_attempt.score}/${q.my_attempt.total}</span>` : `<button class="btn sm" onclick="startQuiz(${q.id})">Start</button>`}</div>
      <button class="btn sec sm" style="margin-top:6px" onclick="quizResults(${q.id},'${esc(q.title)}')">All results</button>
    </div>`).join('') : empty('No quizzes available', '📝'));
};
let _quizState = null;
window.startQuiz = async (id) => {
  const quiz = await GET('/api/quizzes/' + id);
  if (!quiz.questions.length) return toast('This quiz has no questions yet');
  _quizState = { quiz, answers: {}, endsAt: Date.now() + quiz.duration_min * 60000 };
  renderQuizRunner();
};
function renderQuizRunner() {
  const { quiz } = _quizState;
  modal(`<h3>${esc(quiz.title)}</h3>
    <div class="right"><span class="q-timer" id="qTimer"></span></div>
    <div id="qBody">${quiz.questions.map((q, i) => `<div class="card" style="padding:12px">
      <div class="nm" style="font-weight:600">${i + 1}. ${esc(q.text)}</div>
      ${q.options.map((o, oi) => `<label class="opt" id="opt_${q.id}_${oi}" onclick="pickAns(${q.id},${oi})">${esc(o)}</label>`).join('')}
    </div>`).join('')}</div>
    <button class="btn" onclick="finishQuiz()">Submit quiz</button>`);
  tickTimer();
}
window.pickAns = (qid, oi) => {
  _quizState.answers[qid] = oi;
  _quizState.quiz.questions.find((q) => q.id === qid).options.forEach((_, i) => $(`#opt_${qid}_${i}`).classList.toggle('sel', i === oi));
};
function tickTimer() {
  const el = $('#qTimer'); if (!el || !_quizState) return;
  const left = Math.max(0, _quizState.endsAt - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  if (left <= 0) { finishQuiz(); return; }
  _quizState.timer = setTimeout(tickTimer, 1000);
}
window.finishQuiz = async () => {
  if (!_quizState) return;
  clearTimeout(_quizState.timer);
  const { quiz, answers } = _quizState; _quizState = null;
  const r = await POST(`/api/quizzes/${quiz.id}/attempt`, { answers });
  modal(`<h3>Your score</h3><div class="stat" style="margin:10px 0"><div class="n">${r.score} / ${r.total}</div><div class="l">${esc(quiz.title)}</div></div>
    <button class="btn sec" onclick="quizResults(${quiz.id},'${esc(quiz.title)}')">See all results</button>
    <button class="btn" style="margin-top:8px" onclick="closeModal();go('quizzes')">Done</button>`);
};

/* ============ STUDENT NOTES ============ */
PAGES.notes_trainee = async (c) => {
  const notes = await GET('/api/notes');
  c.innerHTML = title('Notes & Instructions', '') +
    (notes.length ? notes.map((n) => `<div class="card"><div class="nm" style="font-weight:600">${esc(n.title)}</div>
      <div class="sub muted">${dt(n.created_at)}</div>
      ${n.body ? `<div style="font-size:14px;margin-top:6px">${esc(n.body)}</div>` : ''}</div>`).join('') : empty('No notes yet', '📌'));
};

/* ============ STUDENT ACCOUNT (payments) ============ */
PAGES.mypay = async (c) => {
  const pay = await GET('/api/payments');
  const rem = await GET('/api/reminders');
  const paid = pay.reduce((a, p) => a + (p.amount || 0), 0);
  c.innerHTML = title('My Account', '') + `
    <div class="grid g2"><div class="stat"><div class="n">${money(paid)}</div><div class="l">Total paid</div></div>
      <div class="stat"><div class="n">${pay.length}</div><div class="l">Payments</div></div></div>
    <div class="sec-title">My payments</div>
    <div class="card">${pay.length ? pay.map((p) => `<div class="item">
      <div class="av">${p.image ? `<img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}')"/>` : '💵'}</div>
      <div class="main"><div class="nm">${money(p.amount)}</div><div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div></div>`).join('') : empty('No payments yet', '💵')}</div>
    ${rem.filter((r) => !r.done).length ? `<div class="sec-title">Upcoming payments</div><div class="card">${rem.filter((r) => !r.done).map((r) => `<div class="item"><div class="av">◷</div><div class="main"><div class="nm">${dt(r.due_date)}</div><div class="sub">${money(r.amount)}${r.note ? ' · ' + esc(r.note) : ''}</div></div></div>`).join('')}</div>` : ''}`;
};

/* ============ ABOUT (view for non-admin) ============ */
PAGES.about_view = async (c, a) => {
  a = a || await GET('/api/about');
  c.innerHTML = title(a.title || 'Dalia Bassel Couture', '') + `<div class="card">
    ${a.image ? `<img class="thumb" style="aspect-ratio:16/9;margin-bottom:10px" src="/uploads/${esc(a.image)}" onclick="lightbox('/uploads/${esc(a.image)}')"/>` : ''}
    <div style="font-size:15px;white-space:pre-wrap">${esc(a.body || 'A couture academy for pattern-making and tailoring.')}</div></div>`;
};

/* ============ STAFF HOME (attendance) ============ */
PAGES.home_staff = async (c) => {
  const att = await GET('/api/attendance');
  const todayRec = att.find((a) => a.date === today());
  let label = 'Check in', ic = '●';
  if (todayRec && todayRec.check_in && !todayRec.check_out) { label = 'Check out'; ic = '◐'; }
  else if (todayRec && todayRec.check_out) { label = 'Done for today ✓'; ic = '✓'; }
  c.innerHTML = title(`Welcome, ${state.user.name}`, '') + `
    <div class="card" style="text-align:center">
      <div style="font-size:40px">${ic}</div>
      <div class="nm" style="font-weight:600;font-size:16px;margin:8px 0">${todayRec ? `In: ${todayRec.check_in || '—'} · Out: ${todayRec.check_out || '—'}` : 'No attendance today yet'}</div>
      ${todayRec && todayRec.check_out ? '' : `<button class="btn" onclick="doCheck()">${label}</button>`}
    </div>
    <div class="sec-title">Recent attendance</div>
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Day</th><th>In</th><th>Out</th></tr></thead>
      <tbody>${att.length ? att.slice(0, 30).map((a) => `<tr><td>${dt(a.date)}</td><td>${a.check_in || '—'}</td><td>${a.check_out || '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No records</td></tr>'}</tbody></table></div></div>`;
};
window.doCheck = async () => { const r = await POST('/api/attendance/check'); toast(r.action === 'in' ? 'Checked in' : r.action === 'out' ? 'Checked out' : 'Done'); go('home'); };

/* ============ STAFF SALARY ============ */
PAGES.mysalary = async (c) => {
  const sal = await GET('/api/salaries');
  const total = sal.filter((s) => s.paid).reduce((a, s) => a + s.net, 0);
  c.innerHTML = title('My Salary', '') + `
    <div class="grid g2"><div class="stat"><div class="n">${money(state.user.base_salary)}</div><div class="l">Base</div></div>
      <div class="stat"><div class="n">${money(total)}</div><div class="l">Received</div></div></div>
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Month</th><th>Base</th><th>Bonus</th><th>Deduct</th><th>Net</th><th></th></tr></thead>
      <tbody>${sal.length ? sal.map((s) => `<tr><td>${esc(s.month)}</td><td>${money(s.base)}</td><td>${money(s.bonus)}</td><td>${money(s.deduction)}</td><td>${money(s.net)}</td><td>${s.paid ? '<span class="badge ok">Paid</span>' : '<span class="badge warn">Pending</span>'}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">No records</td></tr>'}</tbody></table></div></div>`;
};

/* ============ STAFF LEAVES ============ */
PAGES.myleaves = async (c) => {
  const lv = await GET('/api/leaves');
  c.innerHTML = title('My Leaves', '') +
    `<button class="btn" onclick="requestLeave()">＋ Request leave</button>
    <div class="card" style="margin-top:12px">${lv.length ? lv.map((l) => `<div class="item"><div class="av">🌴</div>
      <div class="main"><div class="nm">${dt(l.from_date)} → ${dt(l.to_date)}</div><div class="sub">${leaveEn(l.type)}${l.reason ? ' · ' + esc(l.reason) : ''}</div></div>
      <span class="badge ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'bad' : 'warn'}">${l.status === 'approved' ? 'Approved' : l.status === 'rejected' ? 'Rejected' : 'Pending'}</span></div>`).join('') : empty('No leaves yet', '🌴')}</div>`;
};
window.requestLeave = () => formModal('Request leave', [
  { name: 'from_date', label: 'From', type: 'date', required: true, value: today() },
  { name: 'to_date', label: 'To', type: 'date', required: true, value: today() },
  { name: 'type', label: 'Type', type: 'select', options: [{ value: 'annual', label: 'Annual' }, { value: 'sick', label: 'Sick' }, { value: 'unpaid', label: 'Unpaid' }] },
  { name: 'reason', label: 'Reason', type: 'textarea' },
], async (d) => { await POST('/api/leaves', d); toast('Sent for approval'); go('myleaves'); });

/* ============ CLIENT DRESSES ============ */
PAGES.mydresses = async (c) => {
  const dresses = await GET('/api/dresses');
  const stEn = { open: 'In preparation', in_progress: 'In progress', delivered: 'Ready' };
  c.innerHTML = title('My Dresses', '') +
    (dresses.length ? dresses.map((d) => `<div class="card">
      <div class="nm serif" style="font-size:18px">${esc(d.customer_name)} <span class="badge ${d.status === 'delivered' ? 'ok' : 'warn'}">${stEn[d.status] || d.status}</span></div>
      <div class="sub muted">Delivery: ${dt(d.delivery_date)}</div>
      ${d.fittings.length ? `<div class="sec-title">Fitting dates</div>${d.fittings.map((f) => `<div class="item"><div class="av">${f.done ? '✓' : '◷'}</div><div class="main"><div class="nm">${dt(f.fitting_date)}</div><div class="sub">${f.note ? esc(f.note) : ''}</div></div></div>`).join('')}` : ''}
      ${d.images.length ? `<div class="sec-title">Dress photos</div><div class="gallery">${d.images.map((im) => `<img class="thumb" style="aspect-ratio:3/4" src="/uploads/${esc(im.image)}" onclick="lightbox('/uploads/${esc(im.image)}','${esc(im.caption || d.customer_name)}')"/>`).join('')}</div>` : ''}
    </div>`).join('') : empty('No bookings yet', '👗'));
};
