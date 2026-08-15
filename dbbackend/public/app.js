'use strict';
/* Dalia Bassel Couture — single-page app (vanilla JS). Website + installable PWA. */

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const root = () => $('#root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n || 0)).toLocaleString('en-US') + ' ' + ((window._cfg && window._cfg.currency) || 'EGP');
const dt = (s) => s ? String(s).slice(0, 10) : '—';
const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);

async function api(method, path, body) {
  if (window.__localApi) return window.__localApi(method, path, body); // demo mode (no server)
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  let data = null; try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((data && data.error) || 'Connection error');
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);

/* ensure a container exists even after body is re-rendered */
function ensureEl(id, cls) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; if (cls) el.className = cls; document.body.appendChild(el); }
  return el;
}
function toast(msg) {
  const t = ensureEl('toast', 'toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}
function lazyImgs(sel) {
  document.querySelectorAll(sel + ' img').forEach((im) => { im.loading = 'lazy'; im.decoding = 'async'; });
}
function modal(html) {
  const mr = ensureEl('modal-root');
  mr.innerHTML = `<div class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal">
    <button class="close" onclick="closeModal()">✕</button>${html}</div></div>`;
  lazyImgs('#modal-root');
}
function closeModal() { const m = document.getElementById('modal-root'); if (m) m.innerHTML = ''; }
window.closeModal = closeModal;

function lightbox(src, cap) {
  const mr = ensureEl('modal-root');
  mr.innerHTML = `<div class="lightbox" onclick="if(event.target===this)closeModal()">
    <button class="x" onclick="closeModal()">✕</button>
    <img src="${esc(src)}" alt=""/>${cap ? `<div class="cap">${esc(cap)}</div>` : ''}</div>`;
}
window.lightbox = lightbox;

/* pick an image file -> base64 data URL (compressed) */
function pickImage(cb, accept = 'image/*') {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept;
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    if (accept.startsWith('image')) compressImage(f, cb);
    else { const fr = new FileReader(); fr.onload = () => cb(fr.result); fr.readAsDataURL(f); }
  };
  inp.click();
}
function compressImage(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1500; let { width: w, height: h } = img; // lighter cap for faster loading
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => cb(fr.result);
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
window.pickImage = pickImage;

/* pick MULTIPLE images -> calls cb(dataUrl) for each */
function pickImages(cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => { Array.from(inp.files || []).forEach((f) => compressImage(f, cb)); };
  inp.click();
}
window.pickImages = pickImages;

/* lightweight image cropper (drag to pan + zoom) -> cb(croppedDataUrl) */
function cropImage(dataUrl, aspect, cb) {
  const FW = 300, FH = Math.round(FW / aspect); // frame (preview) size
  modal(`<h3>Adjust photo</h3>
    <div style="text-align:center">
      <div id="cropFrame" style="position:relative;width:${FW}px;height:${FH}px;max-width:100%;margin:0 auto;overflow:hidden;border-radius:12px;background:#eee;touch-action:none;cursor:grab">
        <canvas id="cropCv" width="${FW}" height="${FH}" style="width:100%;height:100%"></canvas>
      </div>
      <label style="text-align:center">Zoom</label>
      <input id="cropZoom" type="range" min="1" max="4" step="0.01" value="1" />
      <button class="btn" style="margin-top:12px" id="cropSave">Save photo</button>
    </div>`);
  const cv = $('#cropCv'), ctx = cv.getContext('2d'), img = new Image();
  const st = { scale: 1, base: 1, x: 0, y: 0, dragging: false, lx: 0, ly: 0 };
  img.onload = () => {
    st.base = Math.max(FW / img.width, FH / img.height);
    st.scale = 1; st.x = (FW - img.width * st.base) / 2; st.y = (FH - img.height * st.base) / 2;
    draw();
  };
  img.src = dataUrl;
  function draw() {
    const s = st.base * st.scale;
    // clamp so image covers frame
    st.x = Math.min(0, Math.max(FW - img.width * s, st.x));
    st.y = Math.min(0, Math.max(FH - img.height * s, st.y));
    ctx.clearRect(0, 0, FW, FH);
    ctx.drawImage(img, st.x, st.y, img.width * s, img.height * s);
  }
  const fr = $('#cropFrame');
  const start = (e) => { st.dragging = true; const p = pt(e); st.lx = p.x; st.ly = p.y; };
  const move = (e) => { if (!st.dragging) return; const p = pt(e); st.x += p.x - st.lx; st.y += p.y - st.ly; st.lx = p.x; st.ly = p.y; draw(); e.preventDefault(); };
  const end = () => { st.dragging = false; };
  const pt = (e) => { const r = fr.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) * (FW / r.width), y: (t.clientY - r.top) * (FH / r.height) }; };
  fr.addEventListener('pointerdown', start); fr.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  $('#cropZoom').oninput = (e) => { const cx = FW / 2, cy = FH / 2; const old = st.base * st.scale; st.scale = Number(e.target.value); const ns = st.base * st.scale; st.x = cx - (cx - st.x) * (ns / old); st.y = cy - (cy - st.y) * (ns / old); draw(); };
  $('#cropSave').onclick = () => {
    const OUT = 1600, out = document.createElement('canvas'); out.width = OUT; out.height = Math.round(OUT / aspect);
    const k = OUT / FW, s = st.base * st.scale;
    out.getContext('2d').drawImage(img, st.x * k, st.y * k, img.width * s * k, img.height * s * k);
    cb(out.toDataURL('image/jpeg', 0.9)); closeModal();
  };
}
window.cropImage = cropImage;

/* ripple effect on buttons (attached to document so it survives re-renders) */
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest && e.target.closest('.btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const rip = document.createElement('span');
  rip.className = 'ripple';
  rip.style.width = rip.style.height = size + 'px';
  rip.style.left = (e.clientX - rect.left - size / 2) + 'px';
  rip.style.top = (e.clientY - rect.top - size / 2) + 'px';
  if (/\b(sec|ghost|danger)\b/.test(btn.className)) rip.style.background = 'rgba(227,74,134,.20)';
  btn.appendChild(rip);
  setTimeout(() => rip.remove(), 600);
});

const state = { user: null, page: null, nav: [], stack: [], hidden: new Set() };

/* which sections are hidden for the signed-in user's role (admin sees everything) */
async function loadPerms() {
  try { const r = await GET('/api/my-permissions'); state.hidden = new Set(r.hidden || []); }
  catch (e) { state.hidden = new Set(); }
}
async function loadConfig() {
  try { window._cfg = await GET('/api/settings'); } catch (e) { window._cfg = window._cfg || {}; }
}
function isHidden(page) {
  if (!state.user || state.user.role === 'admin') return false;
  const first = (NAV[state.user.role] || [])[0];
  if (page === 'profile' || (first && page === first[0])) return false; // landing + profile always available
  return state.hidden.has(page);
}

/* ---------- boot ---------- */
async function boot() {
  try {
    const { user } = await GET('/api/me');
    if (user) { state.user = user; await loadPerms(); await loadConfig(); renderApp(); }
    else renderAuth();
  } catch (e) { renderAuth(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ---------- auth ---------- */
function renderAuth(mode) {
  const isReg = mode === 'register';
  const isOtp = mode === 'otp';
  const brand = `<div class="brand-mark">DB</div>
    <h1 class="brand-title">Dalia Bassel</h1>
    <p class="brand-sub">Haute Couture · Est 2019</p>`;
  let inner;
  if (isOtp) {
    inner = `<div style="text-align:start">
      <label>Email</label>
      <input id="otpEmail" type="email" placeholder="you@email.com" />
      <div id="otpStep2" class="hidden"><label>6-digit code (check your email)</label>
        <input id="otpCode" inputmode="numeric" maxlength="6" placeholder="– – – – – –" style="letter-spacing:4px;text-align:center" /></div>
      <div class="err hidden" id="authErr"></div>
      <button class="btn" style="margin-top:18px" id="otpBtn" onclick="otpSend()">Email me a code</button>
    </div>
    <p class="hint" style="margin-top:16px"><a href="#" onclick="renderAuth('');return false" style="font-weight:700">← Sign in with password</a></p>`;
  } else {
    inner = `<form id="authForm" style="text-align:start">
      ${isReg ? '<label>Full name</label><input name="name" placeholder="Your name" required />' : ''}
      <label>Email</label>
      <input name="email" type="email" placeholder="you@email.com" required />
      <label>Password</label>
      <input name="password" type="password" placeholder="••••••" required />
      ${isReg ? `<label>I'm here to</label><select name="role">
        <option value="trainee">Join a course (student)</option>
        <option value="customer">Order a dress (client)</option></select>` : ''}
      <div class="err hidden" id="authErr"></div>
      <button class="btn" style="margin-top:18px" type="submit">${isReg ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="hint" style="margin-top:16px">${isReg ? 'Already have an account? ' : "Don't have an account? "}
      <a href="#" onclick="renderAuth('${isReg ? '' : 'register'}');return false" style="font-weight:700">${isReg ? 'Sign in' : 'Create one'}</a></p>
    ${isReg ? '' : '<p class="hint"><a href="#" onclick="renderAuth(\'otp\');return false" style="font-weight:700">Student? Sign in with an email code →</a></p>'}`;
  }
  document.body.innerHTML = `<div class="auth-wrap"><div class="auth-card">${brand}${inner}</div></div>`;
  const form = $('#authForm');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      if (isReg) await POST('/api/register', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), role: fd.get('role') });
      else await POST('/api/login', { email: fd.get('email'), password: fd.get('password') });
      state.user = (await GET('/api/me')).user;
      await loadPerms(); await loadConfig();
      renderApp();
    } catch (err) { const el = $('#authErr'); el.textContent = err.message; el.classList.remove('hidden'); }
  };
}
window.renderAuth = renderAuth;
window.otpSend = async () => {
  const email = ($('#otpEmail').value || '').trim();
  const err = $('#authErr'); err.classList.add('hidden');
  if (!email) { err.textContent = 'Enter your email'; err.classList.remove('hidden'); return; }
  try {
    await POST('/api/otp/request', { email });
    $('#otpStep2').classList.remove('hidden');
    $('#otpEmail').setAttribute('readonly', 'true');
    const b = $('#otpBtn'); b.textContent = 'Sign in'; b.setAttribute('onclick', 'otpVerify()');
    toast('Code sent to your email');
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
};
window.otpVerify = async () => {
  const email = ($('#otpEmail').value || '').trim();
  const code = ($('#otpCode').value || '').trim();
  const err = $('#authErr'); err.classList.add('hidden');
  try {
    await POST('/api/otp/verify', { email, code });
    state.user = (await GET('/api/me')).user;
    await loadPerms(); await loadConfig();
    renderApp();
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
};

/* ---------- app shell ---------- */
const NAV = {
  admin: [
    ['home', 'Home', '⌂'],
    ['members', 'Members', '👥'],
    ['students', 'Students', '👩‍🎓'],
    ['finance', 'Payments', '💳'],
    ['rounds', 'Rounds', '🗓'],
    ['courses', 'Courses', '🎬'],
    ['homework', 'Tasks', '✎'],
    ['quizzes', 'Quizzes', '📝'],
    ['notes', 'Notes', '📌'],
    ['dalia', 'Dalia', '✦'],
    ['dresses', 'Dresses', '👗'],
    ['purchases', 'Purchases', '🧾'],
    ['staff', 'Staff', '💼'],
    ['expenses', 'Expenses', '💸'],
    ['permissions', 'Permissions', '🔒'],
    ['config', 'Configuration', '⚙'],
    ['about', 'About', 'ℹ'],
  ],
  trainee: [
    ['home', 'Home', '⌂'],
    ['myattendance', 'Attendance', '🕒'],
    ['courses', 'Courses', '🎬'],
    ['homework', 'Tasks', '✎'],
    ['quizzes', 'Quizzes', '📝'],
    ['notes', 'Notes', '📌'],
    ['mypay', 'Account', '💳'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  manager: [
    ['home', 'Attendance', '🕒'],
    ['dresses', 'Dresses', '👗'],
    ['purchases', 'Purchases', '🧾'],
    ['students', 'Students', '👩‍🎓'],
    ['finance', 'Payments', '💳'],
    ['rounds', 'Rounds', '🗓'],
    ['courses', 'Courses', '🎬'],
    ['mysalary', 'Salary', '💵'],
    ['myrequests', 'Absences & Advances', '🗂'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  staff: [
    ['home', 'Attendance', '🕒'],
    ['dresses', 'Dresses', '👗'],
    ['purchases', 'Purchases', '🧾'],
    ['mysalary', 'Salary', '💵'],
    ['myrequests', 'Absences & Advances', '🗂'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  customer: [
    ['mydresses', 'My Dresses', '👗'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
};

/* bottom bar shows only 2 tabs; the rest live in the side drawer */
const BOTTOM = {
  admin: [['home', 'Home', '⌂'], ['courses', 'Courses', '🎬'], ['dresses', 'Dresses', '👗'], ['dalia', 'Dalia', '✦']],
  manager: [['home', 'Attendance', '🕒'], ['dresses', 'Dresses', '👗'], ['students', 'Students', '👩‍🎓'], ['dalia', 'Dalia', '✦']],
  trainee: [['home', 'Home', '⌂'], ['dalia', 'Dalia Bassel', '✦']],
  staff: [['home', 'Attendance', '🕒'], ['dresses', 'Dresses', '👗'], ['dalia', 'Dalia', '✦']],
  customer: [['mydresses', 'My Dresses', '👗'], ['dalia', 'Dalia Bassel', '✦']],
};

function renderApp() {
  const u = state.user;
  state.nav = (NAV[u.role] || NAV.trainee).filter(([k]) => !isHidden(k));
  state.stack = []; state.page = null;
  try { history.replaceState({ root: true }, ''); } catch (e) {}
  document.body.innerHTML = `
    <div class="app">
      <div class="topbar">
        <button class="back-btn" id="backBtn" onclick="goBack()" aria-label="Back" style="display:none">‹</button>
        <div class="logo" onclick="openDrawer()" style="cursor:pointer">DB</div>
        <h1>Dalia Bassel</h1>
        <button class="profile-btn" onclick="openDrawer()">
          <span class="who">${esc(u.name)}<br><span class="muted">${roleLabel(u.role)}</span></span>
          <span class="pav">${esc(initials(u.name))}</span>
        </button>
      </div>
      <div class="content" id="content"><div class="spinner"></div></div>
    </div>
    <div class="bottomnav bn${((BOTTOM[u.role] || state.nav).filter(([k]) => !isHidden(k))).length}" id="nav">
      ${(BOTTOM[u.role] || state.nav).filter(([k]) => !isHidden(k)).map(([k, l, ic]) => `<button data-p="${k}"><span class="ic">${ic}</span>${l}</button>`).join('')}
    </div>`;
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.p); });
  // restore the last screen after a refresh (so reload keeps you where you were)
  let start = state.nav[0][0];
  try {
    const route = JSON.parse(localStorage.getItem('dalia_route') || 'null');
    if (route && route.page && PAGES[route.page]) {
      const inNav = state.nav.some(([k]) => k === route.page);
      const detailOK = ((route.page === 'round' && route.roundId) || (route.page === 'staffmember' && route.staffId)) && ['admin', 'manager'].includes(u.role);
      if (inNav || detailOK || route.page === 'profile') {
        window._roundId = route.roundId; window._roundTab = route.roundTab;
        window._staffId = route.staffId; window._staffTab2 = route.staffTab2;
        start = route.page;
      }
    }
  } catch (e) {}
  go(start);
}
function roleLabel(r) { return { admin: 'Admin', manager: 'Manager', trainee: 'Student', staff: 'Staff', customer: 'Client' }[r] || r; }
function openDrawer() {
  const profileItem = `<button class="draw-item ${state.page === 'profile' ? 'active' : ''}" onclick="closeDrawer();go('profile')"><span class="ic">👤</span>My Profile</button>`;
  const items = profileItem + state.nav.map(([k, l, ic]) =>
    `<button class="draw-item ${state.page === k ? 'active' : ''}" onclick="closeDrawer();go('${k}')"><span class="ic">${ic}</span>${l}</button>`).join('');
  const d = ensureEl('drawer-root');
  d.innerHTML = `<div class="drawer-back" onclick="if(event.target===this)closeDrawer()"><div class="drawer">
    <div class="drawer-head" style="cursor:pointer" onclick="closeDrawer();go('profile')"><div class="logo">DB</div>
      <div><div class="dn">${esc(state.user.name)}</div><div class="dr">${roleLabel(state.user.role)}</div></div></div>
    <div class="drawer-nav">${items}</div>
    <button class="btn sec" style="margin-top:14px" onclick="logout()">Sign out</button></div></div>`;
}
function closeDrawer() { const d = document.getElementById('drawer-root'); if (d) d.innerHTML = ''; }
window.openDrawer = openDrawer; window.closeDrawer = closeDrawer;
async function logout() { try { await POST('/api/logout'); } catch (e) {} try { localStorage.removeItem('dalia_route'); } catch (e) {} state.user = null; renderAuth(); }
window.logout = logout;

function persistRoute() {
  try { localStorage.setItem('dalia_route', JSON.stringify({ page: state.page, roundId: window._roundId, roundTab: window._roundTab, staffId: window._staffId, staffTab2: window._staffTab2 })); } catch (e) {}
}
function go(page, opts = {}) {
  if (isHidden(page)) page = (NAV[state.user.role] || [])[0][0]; // blocked section -> landing
  // push the current screen onto the back-stack (skip refreshes of the same page and back navigations)
  if (!opts._back && state.page && state.page !== page) {
    state.stack.push(state.page);
    try { history.pushState({ page }, ''); } catch (e) {}
  }
  state.page = page;
  persistRoute();
  updateBackBtn();
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.p === page));
  const c = $('#content'); if (!c) return; c.innerHTML = '<div class="spinner"></div>'; window.scrollTo(0, 0);
  const fn = PAGES[page];
  if (fn) fn(c).then(() => lazyImgs('#content')).catch((e) => { c.innerHTML = `<div class="empty"><div class="em">⚠</div>${esc(e.message)}</div>`; });
  else c.innerHTML = '<div class="empty">Coming soon</div>';
}
window.go = go;

function updateBackBtn() {
  // always visible on every screen; on the first screen it simply returns Home
  const b = document.getElementById('backBtn');
  if (b) b.style.display = 'flex';
}
function goBack() {
  if (state.stack.length) history.back();
  else if (state.page !== state.nav[0][0]) go(state.nav[0][0]); // no history: go Home
}
window.goBack = goBack;

/* hardware / gesture back (Android back, swipe): close an open overlay first,
   otherwise step back to the previous screen instead of leaving the app */
window.addEventListener('popstate', () => {
  const mr = document.getElementById('modal-root');
  if (mr && mr.innerHTML.trim()) { mr.innerHTML = ''; try { history.pushState({}, ''); } catch (e) {} return; }
  const dr = document.getElementById('drawer-root');
  if (dr && dr.innerHTML.trim()) { dr.innerHTML = ''; try { history.pushState({}, ''); } catch (e) {} return; }
  if (state.stack.length) { const prev = state.stack.pop(); go(prev, { _back: true }); }
});

/* live name search: hides rows whose [data-name] doesn't contain the query (no re-render, keeps focus) */
window.liveSearch = (q, sel) => {
  const box = document.querySelector(sel); if (!box) return;
  const t = (q || '').trim().toLowerCase();
  box.querySelectorAll('[data-name]').forEach((el) => { el.style.display = el.dataset.name.includes(t) ? '' : 'none'; });
};

function title(t, icon) { return `<div class="page-title">${icon || ''} ${esc(t)}</div>`; }
function empty(msg, em = '—') { return `<div class="empty"><div class="em">${em}</div>${esc(msg)}</div>`; }

const PAGES = {};
boot();
