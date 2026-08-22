'use strict';
/* Dalia Bassel Couture — STUDENT / STAFF / CLIENT pages + role dispatch */

/* ============ MY PROFILE (all roles) ============ */
PAGES.profile = async (c) => {
  const u = state.user;
  window._pfAvatar = undefined; // undefined = photo unchanged
  c.innerHTML = title('My Profile', '') + `
    <div class="card" style="text-align:center">
      <div id="pfBigAv" style="width:92px;height:92px;border-radius:50%;margin:0 auto 8px;overflow:hidden;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:30px;font-weight:700">${u.avatar ? `<img src="/uploads/${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover" alt=""/>` : esc(initials(u.name))}</div>
      <button class="btn ghost sm" onclick="changeAvatar()">📷 Change photo</button>
      <div class="serif" style="font-size:22px;font-weight:700;margin-top:10px">${esc(u.name)}</div>
      <div class="muted">${roleLabel(u.role)}${u.email ? ' · ' + esc(u.email) : ''}</div>
    </div>
    <div class="card">
      <label>Name</label><input id="pfName" value="${esc(u.name)}" />
      <label>Phone</label><input id="pfPhone" type="tel" inputmode="tel" value="${esc(u.phone || '')}" />
      <label>New password (optional)</label><input id="pfPass" type="password" placeholder="••••••" />
      <button class="btn" style="margin-top:14px" onclick="saveProfile()">Save changes</button>
    </div>`;
};
window.changeAvatar = () => pickImage((b64) => cropImage(b64, 1, (cropped) => {
  window._pfAvatar = cropped;
  const el = document.getElementById('pfBigAv');
  if (el) el.innerHTML = `<img src="${cropped}" style="width:100%;height:100%;object-fit:cover" alt=""/>`;
}));
window.saveProfile = async () => {
  const body = { name: $('#pfName').value, phone: $('#pfPhone').value };
  if ($('#pfPass').value) body.password = $('#pfPass').value;
  if (window._pfAvatar !== undefined) body.avatar = window._pfAvatar;
  await PUT('/api/profile', body);
  state.user = (await GET('/api/me')).user;
  toast('Saved'); renderApp();
};

/* ---- role dispatch for the shared "home" nav key ---- */
PAGES.home = async (c) => {
  const r = state.user.role;
  if (r === 'admin') return PAGES.home_admin(c);
  if (r === 'staff' || r === 'manager') return PAGES.home_staff(c);
  if (r === 'visitor') return PAGES.dalia(c); // visitors only ever see the feed
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
  c.innerHTML = luxBackdrop() + dressWatermark() + '<div class="home-lux">' + title(`Welcome, ${u.name}`, '') + `
    <div class="card">
      <div class="sec-title">Your round</div>
      ${round ? `<div class="nm serif" style="font-size:18px">${esc(round.name)}${round.number ? ' · Round ' + round.number : ''}</div>
        <div class="sub muted">${round.start_date ? 'Starts ' + dt(round.start_date) : ''} ${round.description ? '· ' + esc(round.description) : ''}</div>` : '<div class="muted">Not enrolled in a round yet</div>'}
    </div>
    <div class="sec-title">Your academy</div>
    ${navList([
      ['myattendance', '🕒', 'Attendance', 'Check in & out'],
      ['courses', '🎬', 'Courses', round ? esc(round.name) : 'No round yet'],
      ['homework', '✎', 'Tasks', pendingHw ? `${big(pendingHw)} still to hand in` : 'All handed in'],
      ['quizzes', '📝', 'Quizzes', newQuiz ? `${big(newQuiz)} new` : 'Nothing new'],
      ['notes', '📌', 'Notes', `${big(notes.length)} notes`],
      ['mypay', '💳', 'Account', `${big(money(paid))} paid`],
      ['help', '💬', 'Customer service', 'Ask the studio'],
      ['about', 'ℹ', 'About', 'The academy'],
    ].filter(([p]) => !isHidden(p)))}
    ${notes.length ? `<div class="sec-title">Latest notes</div>${notes.slice(0, 3).map((n) => `<div class="card"><div class="nm" style="font-weight:600">${esc(n.title)}</div>${n.body ? `<div style="font-size:13px">${esc(n.body)}</div>` : ''}</div>`).join('')}` : ''}</div>`;
  runCounters(c);
};

/* ============ STUDENT SELF ATTENDANCE (check in/out) ============ */
PAGES.myattendance = async (c) => {
  const att = await GET('/api/attendance');
  attScreen(c, att, 'My Attendance');
};

/* ============ STUDENT COURSES (videos, read-only) ============ */
PAGES.courses_trainee = async (c) => {
  // server already scopes videos to the student's round (+ global); no type tabs for students
  const videos = await GET('/api/videos');
  c.innerHTML = title('My Course', '') +
    (videos.length ? videos.map((v) => `<div class="card">
      <div class="nm" style="font-weight:600">${esc(v.title)}</div>
      ${v.description ? `<div style="font-size:13px;margin:6px 0">${esc(v.description)}</div>` : ''}
      ${videoEmbed(v)}</div>`).join('') : empty('No videos in your course yet', '🎬'));
};

/* ============ STUDENT TASKS ============ */
PAGES.homework_trainee = async (c) => {
  const hw = await GET('/api/homeworks');
  window._hwList = hw;
  const overdue = (h) => h.due_date && !h.my_submission && new Date(h.due_date) < new Date(new Date().toDateString());
  c.innerHTML = title('Tasks', '') +
    (hw.length ? hw.map((h) => {
      const sub = h.my_submission;
      const n = sub && sub.images ? sub.images.length : 0;
      return `<div class="card task-card">
      <div class="task-head">
        <div class="nm serif" style="font-size:17px">${esc(h.title)}</div>
        ${sub ? '<span class="badge ok">Handed in ✓</span>'
              : `<span class="badge ${overdue(h) ? 'bad' : 'warn'}">${overdue(h) ? 'Late' : 'To do'}</span>`}
      </div>
      <div class="sub muted">${h.due_date ? 'Due ' + dt(h.due_date) : 'No due date'}</div>
      ${h.measurements ? `<div class="hint">Measurements: ${esc(h.measurements)}</div>` : ''}
      ${h.instructions ? `<div class="hint">${esc(h.instructions)}</div>` : ''}
      ${sub ? `<div class="scan-strip">${sub.images.map((im) => `
            <img class="scan-thumb" src="/uploads/${esc(im.image)}" onclick="lightbox('/uploads/${esc(im.image)}')" alt=""/>`).join('')}
          </div>
          <div class="hint">${n} photo${n === 1 ? '' : 's'} · sent ${dt(sub.submitted_at)}${sub.grade ? ' · ' + esc(sub.grade) : ''}</div>
          ${sub.feedback ? `<div class="upd upd-studio" style="max-width:100%"><div class="upd-h">Dalia's note</div><div class="upd-b">${esc(sub.feedback)}</div></div>` : ''}
          <button class="btn sec" style="margin-top:10px" onclick="submitHw(${h.id})">Add or remove photos</button>`
        : `<button class="btn" style="margin-top:10px" onclick="submitHw(${h.id})">📷 Upload my pattern</button>`}
    </div>`;
    }).join('') : empty('No tasks yet', '✎'));
};

/* --- upload sheet: shoot or pick as many pages as you like, full size, no cropping --- */
window.submitHw = (id) => {
  const h = (window._hwList || []).find((x) => x.id === id) || {};
  window._hwNew = [];                                    // photos added in this sheet
  window._hwOld = (h.my_submission && h.my_submission.images) || []; // already sent
  window._hwId = id;
  modal(`<h3>${esc(h.title || 'Upload pattern')}</h3>
    <p class="hint" style="margin-top:-6px">Photograph every page. Nothing is cropped — the whole sheet is kept.</p>
    <div class="row" style="margin-top:12px">
      <button class="btn ghost" onclick="hwAdd(true)">📷 Camera</button>
      <button class="btn ghost" onclick="hwAdd(false)">🖼 From phone</button>
    </div>
    <div id="hwGrid" class="scan-grid" style="margin-top:14px"></div>
    <label>Note for Dalia (optional)</label><textarea id="hwNote">${esc((h.my_submission && h.my_submission.note) || '')}</textarea>
    <button class="btn" style="margin-top:12px" id="hwSend" onclick="doSubmitHw()">Send</button>`);
  hwPaint();
};
function hwPaint() {
  const g = $('#hwGrid'); if (!g) return;
  const old = window._hwOld.map((im) => `<div class="scan-cell">
      <img src="/uploads/${esc(im.image)}" onclick="lightbox('/uploads/${esc(im.image)}')" alt=""/>
      <button class="scan-del" onclick="hwDelOld(${im.id})" aria-label="Remove photo">✕</button>
      <span class="scan-tag">sent</span></div>`).join('');
  const fresh = window._hwNew.map((b64, i) => `<div class="scan-cell">
      <img src="${b64}" alt=""/>
      <button class="scan-del" onclick="hwDelNew(${i})" aria-label="Remove photo">✕</button>
      <span class="scan-tag new">new</span></div>`).join('');
  const total = window._hwOld.length + window._hwNew.length;
  g.innerHTML = (old + fresh) || '<div class="scan-empty">No photos yet — tap Camera to start</div>';
  const btn = $('#hwSend');
  if (btn) btn.textContent = window._hwNew.length
    ? `Send ${window._hwNew.length} new photo${window._hwNew.length === 1 ? '' : 's'}`
    : (total ? 'Save note' : 'Send');
}
window.hwAdd = (camera) => pickScans((b64) => { window._hwNew.push(b64); hwPaint(); }, camera);
window.hwDelNew = (i) => { window._hwNew.splice(i, 1); hwPaint(); };
window.hwDelOld = (imgId) => confirmDel('Remove this photo?', async () => {
  await DEL('/api/submission-images/' + imgId);
  window._hwOld = window._hwOld.filter((x) => x.id !== imgId);
  hwPaint(); toast('Removed');
});
window.doSubmitHw = async () => {
  const total = window._hwOld.length + window._hwNew.length;
  if (!total) return toast('Add at least one photo');
  const btn = $('#hwSend'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await POST(`/api/homeworks/${window._hwId}/submit`, { images: window._hwNew, note: $('#hwNote').value });
    closeModal(); toast('Sent to Dalia ✓'); go('homework');
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Send'; } toast(e.message); }
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
  window._myPays = pay;
  const paid = pay.reduce((a, p) => a + (p.amount || 0), 0);
  c.innerHTML = title('My Account', '') + `
    <div class="grid g2"><div class="stat"><div class="n">${money(paid)}</div><div class="l">Total paid</div></div>
      <div class="stat"><div class="n">${pay.length}</div><div class="l">Payments</div></div></div>
    <div class="sec-title">My payments</div>
    <div class="card">${pay.length ? pay.map((p, i) => `<div class="item">
      <div class="av">${p.image ? `<img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}')"/>` : '💵'}</div>
      <div class="main"><div class="nm">${money(p.amount)}</div><div class="sub">${p.kind === 'deposit' ? 'Deposit' : 'Installment'} · ${p.method === 'cash' ? '💵 Cash' : '🏦 Transfer'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
      <button class="btn sec sm" onclick="printMyPay(${i})">🖨 Receipt</button></div>`).join('') : empty('No payments yet', '💵')}</div>
    ${rem.filter((r) => !r.done).length ? `<div class="sec-title">Upcoming payments</div><div class="card">${rem.filter((r) => !r.done).map((r) => `<div class="item"><div class="av">◷</div><div class="main"><div class="nm">${dt(r.due_date)}</div><div class="sub">${money(r.amount)}${r.note ? ' · ' + esc(r.note) : ''}</div></div></div>`).join('')}</div>` : ''}`;
};

window.printMyPay = (i) => { const p = (window._myPays || [])[i]; if (!p) return; printReceipt({ name: state.user.name, forWhat: 'Course fees', amount: p.amount, method: p.method, kind: p.kind, date: p.paid_at, note: p.note }); };
window.printDressPay = (did, i) => { const d = (window._custDresses || []).find((x) => x.id === did); if (!d || !d.payments) return; const p = d.payments[i]; if (!p) return; printReceipt({ name: state.user.name, forWhat: 'Dress order', amount: p.amount, method: p.method, date: p.paid_at, note: p.note, remaining: d.remaining }); };

/* ============ ABOUT (view for non-admin) ============ */
PAGES.about_view = async (c, a) => {
  a = a || await GET('/api/about');
  c.innerHTML = title(a.title || 'Dalia Bassel Couture', '') + `<div class="card">
    ${a.image ? `<img class="thumb" style="aspect-ratio:16/9;margin-bottom:10px" src="/uploads/${esc(a.image)}" onclick="lightbox('/uploads/${esc(a.image)}')"/>` : ''}
    <div style="font-size:15px;white-space:pre-wrap">${esc(a.body || 'A couture academy for pattern-making and tailoring.')}</div></div>`;
};

/* ============ CHECK-IN / OUT (shared: staff home + student attendance) ============ */
const _hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
function attMins(ci, co) { // minutes between two "HH:MM" times
  if (!ci || !co) return 0;
  const [ih, im] = ci.split(':').map(Number); const [oh, om] = co.split(':').map(Number);
  let m = (oh * 60 + om) - (ih * 60 + im); if (m < 0) m += 1440; return m;
}
const fmtDur = (m) => Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
function elapsedSince(ci) { const now = new Date(); return fmtDur(attMins(ci, _hhmm(now))); }
function attScreen(c, att, titleTxt) {
  const rec = att.find((a) => a.date === today());
  const st = (!rec || !rec.check_in) ? 'out' : (!rec.check_out ? 'in' : 'done');
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const ring = st === 'out'
    ? `<button class="ck-ring out" onclick="doAttCheck()"><span class="ic">🕒</span><span class="lbl">Check in</span></button>`
    : st === 'in'
      ? `<button class="ck-ring in" onclick="doAttCheck()"><span class="ic">👋</span><span class="lbl">Check out</span></button>`
      : `<div class="ck-ring done"><span class="ic">✓</span><span class="lbl">Done</span></div>`;
  const status = st === 'out'
    ? `<div class="ck-status"><span class="muted">No check-in yet — tap to start your day</span></div>`
    : st === 'in'
      ? `<div class="ck-status">Checked in at <b>${rec.check_in}</b> · <span id="ckElapsed" data-since="${rec.check_in}">${elapsedSince(rec.check_in)}</span></div>`
      : `<div class="ck-pills"><div class="ck-pill"><div class="k">In</div><div class="v">${rec.check_in}</div></div>
         <div class="ck-pill"><div class="k">Out</div><div class="v">${rec.check_out}</div></div>
         <div class="ck-pill"><div class="k">Worked</div><div class="v">${fmtDur(attMins(rec.check_in, rec.check_out))}</div></div></div>`;
  c.innerHTML = title(titleTxt, '') +
    `<div class="card checkin">
       <div class="ck-clock" id="ckClock">${_hhmm(now)}</div><div class="ck-date">${dateStr}</div>
       ${ring}
       ${status}
     </div>
     <div class="sec-title">Recent</div>
     <div class="card">${att.length ? att.slice(0, 30).map((a) => `<div class="item">
       <div class="av">${a.check_out ? '✓' : (a.check_in ? '◐' : '—')}</div>
       <div class="main"><div class="nm">${dt(a.date)}</div><div class="sub">In ${a.check_in || '—'} · Out ${a.check_out || '—'}</div></div>
       ${(a.check_in && a.check_out) ? `<div class="sub" style="font-weight:700;color:var(--ink)">${fmtDur(attMins(a.check_in, a.check_out))}</div>` : ''}</div>`).join('') : empty('No records yet', '🕒')}</div>`;
  clearInterval(window._ckTimer);
  window._ckTimer = setInterval(() => {
    const clk = document.getElementById('ckClock'); if (!clk) { clearInterval(window._ckTimer); return; }
    clk.textContent = _hhmm(new Date());
    const el = document.getElementById('ckElapsed'); if (el && el.dataset.since) el.textContent = elapsedSince(el.dataset.since);
  }, 20000);
}
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location not supported on this device'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
window.doAttCheck = async () => {
  const cfg = window._cfg || {};
  let body = {};
  if (cfg.geo_enabled === '1' && cfg.geo_lat) {
    toast('Getting your location…');
    try { const pos = await getPosition(); body = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }
    catch (e) { toast(e.code === 1 ? 'Please allow location to check in' : 'Could not get your location — try again'); return; }
  }
  try {
    const r = await POST('/api/attendance/check', body);
    toast(r.action === 'in' ? 'Checked in ✓' : r.action === 'out' ? 'Checked out ✓' : 'Done');
    go(state.page);
  } catch (e) { toast(e.message); }
};

/* ============ STAFF HOME (attendance) ============ */
PAGES.home_staff = async (c) => {
  const att = await GET('/api/attendance');
  attScreen(c, att, `Welcome, ${state.user.name}`);
};

/* ============ STAFF SALARY (own, auto-computed) ============ */
PAGES.mysalary = async (c) => {
  const month = window._mySalMonth || today().slice(0, 7);
  let sal = null;
  try { sal = await GET(`/api/staff/${state.user.id}/salary?month=${month}`); } catch (e) {}
  const pays = await GET('/api/salary-payments'); // own
  c.innerHTML = title('My Salary', '') +
    `<div class="filters"><input type="month" value="${month}" onchange="setMySalMonth(this.value)" style="width:auto;padding:8px" /></div>` +
    (sal ? `<div class="card">
      ${kv('Base salary', money(sal.base))}
      ${kv('Working days / month', sal.work_days + '  ·  daily ' + money(sal.daily))}
      ${kv('Absent days', sal.absent_days + ' day(s)')}
      ${kv('− Absence deduction', money(sal.absence_deduction), 'bad')}
      ${kv('− Lateness deduction', money(sal.late_deduction || 0), 'bad')}
      ${kv('+ Overtime pay', money(sal.overtime_pay || 0), 'ok')}
      ${kv('+ Bonus', money(sal.bonus || 0), 'ok')}
      ${kv('− Deductions', money(sal.deductions || 0), 'bad')}
      ${kv('− Advances this month', money(sal.advances), 'bad')}
      <div class="divider"></div>
      <div class="item"><div class="main"><div class="sub">Net salary · ${month}</div><div class="serif" style="font-size:24px;font-weight:700;color:var(--ok)">${money(sal.net)}</div></div></div>
    </div>` : empty('No salary info yet', '💵')) +
    `<div class="sec-title">Salary sent to me</div>
     <div class="card">${pays.length ? pays.map((p) => `<div class="item">
        ${p.image ? `<div class="av"><img class="thumb" style="width:44px;height:44px;aspect-ratio:1" src="/uploads/${esc(p.image)}" onclick="lightbox('/uploads/${esc(p.image)}')"/></div>` : '<div class="av">💵</div>'}
        <div class="main"><div class="nm">${money(p.amount)} · ${esc(p.month || '')}</div><div class="sub">${p.note ? esc(p.note) + ' · ' : ''}${dt(p.created_at)}</div></div>
        ${p.status === 'confirmed' ? '<span class="badge ok">Confirmed ✓</span>' : `<button class="btn sm" onclick="confirmSalary(${p.id})">Confirm received</button>`}</div>`).join('') : empty('No salary sent yet', '💵')}</div>`;
};
window.setMySalMonth = (m) => { window._mySalMonth = m; go('mysalary'); };
window.confirmSalary = async (id) => { await PUT('/api/salary-payments/' + id + '/confirm', {}); toast('Confirmed ✓'); go('mysalary'); };

/* ============ STAFF SELF-SERVICE: report absence / request advance ============ */
PAGES.myrequests = async (c) => {
  const [absences, advances] = await Promise.all([GET('/api/absences'), GET('/api/advances')]);
  const stBadge = (s) => `<span class="badge ${s === 'approved' ? 'ok' : s === 'rejected' ? 'bad' : 'warn'}">${s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'Pending'}</span>`;
  c.innerHTML = title('Absences & Advances', '') + `
    <div class="row"><button class="btn" onclick="reportAbsence()">＋ Report absence</button>
      <button class="btn sec" onclick="requestAdvance()">＋ Request advance</button></div>
    <div class="sec-title">My absences</div>
    <div class="card">${absences.length ? absences.map((a) => { const st = a.status || 'confirmed'; return `<div class="item"><div class="av">✕</div>
      <div class="main"><div class="nm">${dt(a.date)} <span class="badge ${st === 'confirmed' ? 'ok' : 'warn'}">${st === 'confirmed' ? 'Confirmed' : 'Pending'}</span></div><div class="sub">${a.reason ? esc(a.reason) : 'Absent day'}</div></div></div>`; }).join('') : empty('No absences')}</div>
    <div class="sec-title">My advances</div>
    <div class="card">${advances.length ? advances.map((a) => `<div class="item"><div class="av">💵</div>
      <div class="main"><div class="nm">${money(a.amount)}</div><div class="sub">${a.month ? 'Deduct ' + a.month : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
      ${stBadge(a.status || 'approved')}</div>`).join('') : empty('No advances')}</div>`;
};
window.reportAbsence = () => formModal('Report absence', [
  { name: 'date', label: 'Date', type: 'date', required: true, value: today() },
  { name: 'reason', label: 'Reason (optional)' },
], async (d) => { await POST('/api/absences', d); toast('Reported'); go('myrequests'); });
window.requestAdvance = () => formModal('Request advance', [
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'note', label: 'Note (optional)' },
], async (d) => { await POST('/api/advances', d); toast('Request sent'); go('myrequests'); });

/* ============ CLIENT / STAFF DRESSES (read-only) ============ */
PAGES.mydresses = async (c, opts = {}) => {
  const dresses = await GET('/api/dresses');
  window._custDresses = dresses;
  const stEn = { open: 'In preparation', in_progress: 'In progress', delivered: 'Ready' };
  const isStaff = ['staff', 'manager'].includes(state.user.role);
  const mine = isStaff && window._myDressMine;
  const stF = window._myDressStatus || 'all';
  let list = mine ? dresses.filter((d) => d.assigned_to === state.user.id) : dresses;
  if (isStaff && stF !== 'all') list = list.filter((d) => d.status === stF);
  const chips = isStaff ? `<div class="filters">
      <span class="chip ${!mine ? 'active' : ''}" onclick="myDressTab(0)">All</span>
      <span class="chip ${mine ? 'active' : ''}" onclick="myDressTab(1)">👤 Assigned to me</span>
    </div>
    <div class="filters">${[['all', 'All'], ['open', 'New'], ['in_progress', 'In progress'], ['delivered', 'Delivered']].map(([k, l]) => `<span class="chip ${stF === k ? 'active' : ''}" onclick="myDressStatus('${k}')">${l}</span>`).join('')}</div>
    <input placeholder="🔍 Search by client name" value="${esc(window._myDressSearch || '')}" oninput="window._myDressSearch=this.value;liveSearch(this.value,'#myDressList')" style="width:100%;padding:9px 12px;margin:0 0 10px" />
    <div class="hint" style="margin:0 2px 8px">${list.length} dress(es)</div>` : '';
  c.innerHTML = title(opts.title || 'My Dresses', '') + chips + `<div id="myDressList">` +
    (list.length ? list.map((d) => `<div class="card" id="dress_${d.id}" data-name="${esc((d.customer_name || '').toLowerCase())}" style="position:relative">
      ${d.unread ? `<span class="notif-dot">${d.unread}</span>` : ''}
      <div class="nm serif" style="font-size:18px">${esc(d.customer_name)} <span class="badge ${d.status === 'delivered' ? 'ok' : 'warn'}">${stEn[d.status] || d.status}</span></div>
      <div class="sub muted">Delivery: ${dt(d.delivery_date)}${isStaff ? ' · ' + (d.assignee_name ? '👤 ' + esc(d.assignee_name) : 'Unassigned') : ''}</div>
      ${(isStaff && d.note) ? `<div class="sub" style="margin-top:6px">📝 ${esc(d.note)}</div>` : ''}
      ${isStaff ? dressMeasuresHtml(d) : ''}
      ${(!isStaff && d.price != null) ? `<div class="sec-title">Payment 💳</div>
        <div class="grid g3">
          <div class="stat"><div class="n serif">${money(d.price)}</div><div class="l">Total</div></div>
          <div class="stat"><div class="n serif" style="color:var(--ok)">${money(d.paid || 0)}</div><div class="l">Paid</div></div>
          <div class="stat"><div class="n serif" style="color:${d.remaining ? 'var(--bad)' : 'var(--ok)'}">${money(d.remaining || 0)}</div><div class="l">Remaining</div></div>
        </div>
        <div class="card" style="box-shadow:none;margin:8px 0 0">${(d.payments && d.payments.length) ? d.payments.map((p, i) => `<div class="item">
          <div class="av">${p.method === 'cash' ? '💵' : '🏦'}</div>
          <div class="main"><div class="nm">${money(p.amount)}</div><div class="sub">${p.method === 'cash' ? 'Cash' : 'Transfer'} · ${dt(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
          <button class="btn sec sm" onclick="printDressPay(${d.id},${i})">🖨 Receipt</button></div>`).join('') : '<div class="hint">No payments yet</div>'}</div>` : ''}
      ${d.fittings.length ? `<div class="sec-title">Fitting dates</div>${d.fittings.map((f) => `<div class="item"><div class="av">${f.done ? '✓' : '◷'}</div><div class="main"><div class="nm">${dt(f.fitting_date)}</div><div class="sub">${f.note ? esc(f.note) : ''}</div></div></div>`).join('')}` : ''}
      ${d.images.length ? `<div class="sec-title">Dress photos</div><div class="gallery">${d.images.map((im) => `<img class="thumb" style="aspect-ratio:3/4" src="/uploads/${esc(im.image)}" onclick="lightbox('/uploads/${esc(im.image)}','${esc(im.caption || d.customer_name)}')"/>`).join('')}</div>` : ''}
      <div class="sec-title">Updates 💬</div>
      <div id="dupd_${d.id}"><div class="hint">Loading…</div></div>
      <button class="btn sec sm" style="margin-top:8px" onclick="sendDressNote(${d.id})">📝 Send a note about your dress</button>
    </div>`).join('') : empty(mine ? 'No dresses assigned to you' : 'No bookings yet', '👗')) + `</div>`;
  list.forEach((d) => loadDressUpdates(d.id));
  if (isStaff && window._myDressSearch) liveSearch(window._myDressSearch, '#myDressList');
  if (window._openDressAfter) { const oid = window._openDressAfter; window._openDressAfter = null; setTimeout(() => { const el = document.getElementById('dress_' + oid); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80); }
};
window.myDressTab = (v) => { window._myDressMine = v; go(state.page); };
window.myDressStatus = (s) => { window._myDressStatus = s; go(state.page); };
/* read-only measurements table for the staff dress card (no money) */
function dressMeasuresHtml(d) {
  let m = {}; try { m = d.measurements ? JSON.parse(d.measurements) : {}; } catch (e) {}
  const fields = (typeof MEASURE_FIELDS !== 'undefined') ? MEASURE_FIELDS : [];
  const rows = fields.filter(([k]) => m[k] != null && m[k] !== '').map(([k, l]) => `<tr><td style="color:var(--muted)">${esc(l)}</td><td style="text-align:end;font-weight:700">${esc(m[k])}</td></tr>`);
  if (!rows.length && !m.fit && !d.measure_note) return '';
  return `<div class="sec-title">Measurements 📐</div><div class="card" style="box-shadow:none;margin:0">
    ${rows.length ? `<table style="width:100%;border-collapse:collapse">${rows.join('')}</table>` : ''}
    ${m.fit ? `<div class="hint">Fit: ${esc(m.fit)}</div>` : ''}${d.measure_note ? `<div class="hint">${esc(d.measure_note)}</div>` : ''}</div>`;
}
window.sendDressNote = (id) => formModal('Note about the dress', [
  { name: 'body', label: 'Note', type: 'textarea' },
  { name: 'image', label: 'Photo (optional)', type: 'image' },
], async (d) => { await POST('/api/dresses/' + id + '/updates', d); toast('Sent ✅'); closeModal(); go(state.page); });


/* ============ CUSTOMER SERVICE — the customer's side ============ */
const TOPIC_META = {
  dress:   { icon: '👗', label: 'Dresses',  hint: 'Bookings, fittings, your gown', c: 'clients' },
  course:  { icon: '🎓', label: 'Courses',  hint: 'Rounds, fees, joining', c: 'students' },
  general: { icon: '✦', label: 'Anything else', hint: 'Visiting, prices, directions', c: 'about' },
};

window.TOPIC_META = TOPIC_META;
/* the button under the feed: customers start an enquiry, the studio opens its inbox */
window.askStudio = (topic) => {
  if (['admin', 'manager', 'staff'].includes(state.user.role)) return go('chats');
  newChat(topic);
};

PAGES.help = async (c) => {
  const { threads } = await GET('/api/chats');
  window._threads = threads;
  c.innerHTML = luxBackdrop() + '<div class="home-lux">' + title('Customer service', '') +
    `<div class="card"><div class="nm serif" style="font-size:17px">How can we help?</div>
      <div class="sub muted" style="margin-top:4px">Write to us and the studio answers here. Pick what it is about.</div>
      <div class="ask-row">
        ${Object.entries(TOPIC_META).map(([k, m]) => `<button class="ask-btn" style="${tintVars(m.c)}" onclick="newChat('${k}')">
          <span class="ask-ic">${m.icon}</span><span class="ask-t">${m.label}</span><span class="ask-h">${m.hint}</span></button>`).join('')}
      </div>
    </div>
    ${threads.length ? `<div class="sec-title">Your conversations</div>${threads.map(chatRowHtml).join('')}` : ''}
    </div>`;
  if (window._openChatAfter) { const id = window._openChatAfter; window._openChatAfter = null; openChat(id); }
};

function chatRowHtml(t) {
  const m = TOPIC_META[t.topic] || TOPIC_META.general;
  return `<div class="chat-row" style="${tintVars(m.c)}" onclick="openChat(${t.id})">
    <span class="rail"></span>
    <span class="ic">${m.icon}</span>
    <span class="txt"><span class="nm">${esc(t.subject || m.label)}${t.status === 'closed' ? ' <span class="badge">closed</span>' : ''}</span>
      <span class="meta">${esc(t.brief_line || (t.last_body || '').slice(0, 60) || 'No messages yet')}</span>
      <span class="when">${dt(t.last_at)}</span></span>
    ${t.unread ? `<span class="chat-badge">${t.unread}</span>` : '<span class="chev">›</span>'}
  </div>`;
}

/* A dress enquiry is a consultation brief — everything the atelier needs
   before the first fitting. Courses and general questions stay a note. */
const BRIEF = {
  garment: ['What are we making?', [['bridal', '👰 Bridal gown'], ['evening', '✨ Evening gown']]],
  look:    ['Which look?', [['first', 'First look — the ceremony'], ['second', 'Second look — the reception'], ['both', 'Both looks']]],
  venue:   ['Where is it held?', [['openair', '🌤 Open air'], ['indoor', '🏛 Indoor venue']]],
  daytime: ['Time of day', [['day', '☀️ Daytime'], ['night', '🌙 Evening']]],
  role:    ['Your role on the day', [['bride', 'The bride'], ['bride_sister', "Bride's sister"], ['groom_sister', "Groom's sister"],
             ['bride_friend', "Bride's friend"], ['bridesmaid', 'Bridesmaid'], ['other', 'Other']]],
};
window.newChat = (topic) => {
  if (topic === 'dress') return dressBrief();
  const m = TOPIC_META[topic] || TOPIC_META.general;
  modal(`<h3>${m.icon} ${m.label}</h3>
    <p class="hint" style="margin-top:-6px">${esc(m.hint)}</p>
    <label>What do you need?</label>
    <input id="cSub" placeholder="${topic === 'course' ? 'Join the next round' : 'A question'}" />
    <label>Your message</label>
    <textarea id="cBody" style="min-height:110px" placeholder="Write here..."></textarea>
    <button class="btn" style="margin-top:12px" id="cSend" onclick="sendNewChat('${topic}')">Send to the studio</button>`);
};
function briefSelect(key) {
  const [label, opts] = BRIEF[key];
  return `<label>${esc(label)}</label>
    <select id="b_${key}"${key === 'garment' ? ' onchange="briefLookToggle()"' : ''}>
      ${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
    </select>`;
}
window.dressBrief = () => {
  window._briefMedia = [];
  modal(`<h3>👗 Your dress</h3>
    <p class="hint" style="margin-top:-6px">Tell us about the occasion and we will come back with a date for your first consultation.</p>
    <label>When is the occasion?</label>
    <input id="b_event_date" type="date" />
    ${briefSelect('garment')}
    <div id="lookWrap">${briefSelect('look')}</div>
    ${briefSelect('venue')}
    ${briefSelect('daytime')}
    ${briefSelect('role')}
    <label>Where are you based?</label>
    <input id="b_area" placeholder="Area or district — so we can plan the fittings" />
    <label>Inspiration</label>
    <p class="hint" style="margin-top:-2px">Photos of what you have in mind — add as many as you like.</p>
    <button class="btn ghost sm" onclick="briefAdd()">＋ Add photos</button>
    <div class="up-bar hidden" id="bUp"><span id="bUpFill"></span></div>
    <div id="bMedia" class="scan-grid" style="margin-top:12px"></div>
    <label>Or a link</label>
    <input id="b_link" type="url" inputmode="url" placeholder="Pinterest, Instagram, a saved post..." />
    <label>Anything else we should know?</label>
    <textarea id="cBody" style="min-height:90px" placeholder="Fabrics you love, a colour, a deadline..."></textarea>
    <button class="btn" style="margin-top:14px" id="cSend" onclick="sendDressBrief()">Send to the studio</button>`);
  briefLookToggle(); briefPaint();
};
/* the look question only makes sense for a bridal gown */
window.briefLookToggle = () => {
  const w = $('#lookWrap'); if (!w) return;
  w.style.display = $('#b_garment').value === 'bridal' ? '' : 'none';
};
window.briefAdd = () => {
  const bar = $('#bUp'), fill = $('#bUpFill');
  pickMedia((m) => { window._briefMedia.push(m); if (bar) bar.classList.add('hidden'); briefPaint(); },
    (pct) => { if (bar && fill) { bar.classList.remove('hidden'); fill.style.width = Math.round(pct * 100) + '%'; } });
};
window.briefDel = (i) => { window._briefMedia.splice(i, 1); briefPaint(); };
function briefPaint() {
  const g = $('#bMedia'); if (!g) return;
  g.innerHTML = window._briefMedia.map((m, i) => `<div class="scan-cell">
      ${m.kind === 'video' ? `<video src="/uploads/${esc(m.file)}" muted playsinline preload="metadata"></video><span class="scan-play">▶</span>`
        : `<img src="/uploads/${esc(m.file)}" alt=""/>`}
      <button class="scan-del" onclick="briefDel(${i})" aria-label="Remove">✕</button>
    </div>`).join('') || '<div class="scan-empty">No photos yet — optional</div>';
}
window.sendDressBrief = async () => {
  const garment = $('#b_garment').value;
  const brief = {
    event_date: $('#b_event_date').value || null,
    garment,
    look: garment === 'bridal' ? $('#b_look').value : null,
    venue: $('#b_venue').value,
    daytime: $('#b_daytime').value,
    role: $('#b_role').value,
    area: $('#b_area').value.trim() || null,
    link: $('#b_link').value.trim() || null,
  };
  const subject = (garment === 'bridal' ? 'Bridal gown' : 'Evening gown') + (brief.event_date ? ' · ' + brief.event_date : '');
  const btn = $('#cSend'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await POST('/api/chats', { topic: 'dress', subject, brief,
      body: $('#cBody').value.trim(), media: window._briefMedia });
    closeModal(); toast('Sent ✓'); window._openChatAfter = r.id; go('help');
  } catch (e) { btn.disabled = false; btn.textContent = 'Send to the studio'; toast(e.message); }
};
window.sendNewChat = async (topic) => {
  const body = $('#cBody').value.trim();
  if (!body) return toast('Write your message first');
  const btn = $('#cSend'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await POST('/api/chats', { topic, subject: $('#cSub').value.trim(), body });
    closeModal(); toast('Sent ✓'); window._openChatAfter = r.id; go('help');
  } catch (e) { btn.disabled = false; btn.textContent = 'Send to the studio'; toast(e.message); }
};

const BRIEF_WORD = {
  garment: { bridal: 'Bridal gown', evening: 'Evening gown' },
  look: { first: 'First look — ceremony', second: 'Second look — reception', both: 'Both looks' },
  venue: { openair: 'Open air', indoor: 'Indoor venue' },
  daytime: { day: 'Daytime', night: 'Evening' },
  role: { bride: 'The bride', bride_sister: "Bride's sister", groom_sister: "Groom's sister",
    bride_friend: "Bride's friend", bridesmaid: 'Bridesmaid', other: 'Other' },
};
/* the consultation brief, read at a glance */
function briefCard(b) {
  if (!b) return '';
  const row = (k, v) => v ? `<div class="bf-row"><span class="bf-k">${esc(k)}</span><span class="bf-v">${esc(v)}</span></div>` : '';
  return `<div class="brief-card">
    <div class="bf-head">The brief</div>
    ${row('Occasion', b.event_date ? dt(b.event_date) : null)}
    ${row('Garment', BRIEF_WORD.garment[b.garment])}
    ${row('Look', BRIEF_WORD.look[b.look])}
    ${row('Venue', BRIEF_WORD.venue[b.venue])}
    ${row('Time of day', BRIEF_WORD.daytime[b.daytime])}
    ${row('Her role', BRIEF_WORD.role[b.role])}
    ${row('Based in', b.area)}
    ${b.link ? `<div class="bf-row"><span class="bf-k">Inspiration</span>
      <a class="bf-v" href="${esc(b.link)}" target="_blank" rel="noopener">Open the link ↗</a></div>` : ''}
  </div>`;
}
window.openChat = async (id) => {
  const r = await GET('/api/chats/' + id);
  const m = TOPIC_META[r.thread.topic] || TOPIC_META.general;
  modal(`<h3>${m.icon} ${esc(r.thread.subject || m.label)}</h3>
    <div class="sub muted" style="margin-top:-8px">${esc(r.studio ? `${r.thread.user_name} · ${roleLabel(r.thread.user_role)}` : 'Dalia Bassel studio')}</div>
    ${briefCard(r.thread.brief)}
    <div class="chat-log" id="chatLog">${r.messages.map((x) => `
      <div class="upd ${x.from_studio ? 'upd-studio' : 'upd-client'}">
        <div class="upd-h">${esc(x.from_studio ? (r.studio ? x.author_name : 'Dalia Bassel') : (r.studio ? x.author_name : 'You'))} · ${dt(x.created_at)}</div>
        ${(x.media || []).length ? gallery(x.media) : ''}
        ${x.image ? `<img class="thumb" style="aspect-ratio:4/3;margin:4px 0" src="/uploads/${esc(x.image)}" onclick="lightbox('/uploads/${esc(x.image)}')"/>` : ''}
        ${x.body ? `<div class="upd-b">${esc(x.body)}</div>` : ''}
      </div>`).join('')}</div>
    <textarea id="chatMsg" style="min-height:76px" placeholder="Write a reply..."></textarea>
    <div class="row" style="margin-top:8px">
      <button class="btn ghost sm" onclick="chatPic(${id})">📷 Photo</button>
      <button class="btn" id="chatSend" onclick="sendChat(${id})">Send</button>
    </div>
    ${r.studio ? `<button class="btn sec sm" style="margin-top:10px" onclick="closeThread(${id},'${r.thread.status === 'closed' ? 'open' : 'closed'}')">${r.thread.status === 'closed' ? 'Reopen' : 'Mark as handled'}</button>` : ''}`);
  const log = $('#chatLog'); if (log) log.scrollTop = log.scrollHeight;
  refreshNotifBadge();
};
window.chatPic = (id) => pickImage(async (b64) => { await POST(`/api/chats/${id}/messages`, { image: b64 }); openChat(id); });
window.sendChat = async (id) => {
  const box = $('#chatMsg'); const body = box.value.trim();
  if (!body) return toast('Write a message first');
  const btn = $('#chatSend'); btn.disabled = true;
  try { await POST(`/api/chats/${id}/messages`, { body }); await openChat(id); if (window._chatsRefresh) window._chatsRefresh(); }
  catch (e) { btn.disabled = false; toast(e.message); }
};
window.closeThread = async (id, status) => { await PUT('/api/chats/' + id, { status }); closeModal(); toast('Saved'); go(state.page); };
