'use strict';
/* Dalia Bassel Couture — single-page app (vanilla JS). Website + installable PWA. */

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const root = () => $('#root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* An amount sits next to Arabic names all over this app, and the browser's
   bidirectional algorithm reorders a bare "10,000 EGP" against them — the
   currency ends up across the line from its number. <bdi> isolates the amount so
   it is laid out on its own terms whichever script surrounds it. Every caller
   renders into HTML, never textContent or a toast, so this is safe everywhere. */
/* A stored photo is either a filename from when files lived on this server, or a
   full URL from blob storage. Both appear in the same column, so every place that
   shows one asks here instead of gluing "/uploads/" on the front. */
const mediaUrl = (v) => (/^https?:\/\//i.test(String(v || '')) ? String(v) : '/uploads/' + String(v || ''));
window.mediaUrl = mediaUrl;

// An amount as plain characters, and the same wrapped for dropping into HTML.
// The wrapper keeps "10,000 EGP" together when it sits beside a name in Arabic,
// which otherwise ends up reading "10,000 · المصرى للاقمشه EGP". Anywhere the
// result is set as text or escaped, the tags would be shown rather than obeyed —
// so those places take moneyText.
const moneyText = (n) => `${(Number(n || 0)).toLocaleString('en-US')} ${(window._cfg && window._cfg.currency) || 'EGP'}`;
const money = (n) => `<bdi>${moneyText(n)}</bdi>`;
const dt = (s) => s ? String(s).slice(0, 10) : '—';
const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase();
/* The studio's day, not UTC's. Egypt is three hours ahead, so from nine in the
   evening until midnight UTC is still on yesterday's date — a form filled in at
   one in the morning was dating the cash to the day before. The zone is the
   server's own; Cairo until it says otherwise. */
let STUDIO_TZ = 'Africa/Cairo';
function dayIn(d, tz) {
  // en-CA writes a date as YYYY-MM-DD, which is the form everything here stores
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); }
  catch (e) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
}
const today = () => dayIn(new Date(), STUDIO_TZ);
window.today = today;

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
/* toast(msg) for the ordinary note; toast(msg, 'error') when something was refused —
   big, red, shaking, and it buzzes the phone where the browser allows it. */
function toast(msg, kind) {
  const bad = kind === 'error';
  const t = ensureEl('toast', 'toast');
  t.textContent = msg;
  t.classList.toggle('toast-error', bad);
  t.classList.remove('show'); void t.offsetWidth;      // restart the animation
  t.classList.add('show');
  if (bad) buzz();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), bad ? 4200 : 2400);
}
/* iOS Safari has no Vibration API at all, so the shake carries it there */
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern || [70, 60, 70, 60, 140]); } catch (e) {}
}
window.buzz = buzz;
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

/* pick a file -> base64 data URL. Images are compressed unless raw=true (HD/full quality). */
function pickImage(cb, accept = 'image/*', raw = false) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept;
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    if (accept.startsWith('image') && !raw) compressImage(f, cb);
    else { const fr = new FileReader(); fr.onload = () => cb(fr.result); fr.readAsDataURL(f); }
  };
  inp.click();
}
function compressImage(file, cb, maxSide, quality) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = maxSide || 1500; let { width: w, height: h } = img; // lighter cap for faster loading
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', quality || 0.82));
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

/* Pattern pages: pick or shoot several at once, kept large and never cropped.
   `capture` opens the camera straight away; leaving it off lets iOS offer
   Photo Library / Take Photo / Scan Documents. */
function pickScans(cb, camera) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  if (camera) inp.capture = 'environment';
  inp.onchange = () => { Array.from(inp.files || []).forEach((f) => compressImage(f, cb, 2400, 0.9)); };
  inp.click();
}
window.pickScans = pickScans;

/* Send a file straight to the server as raw bytes — no base64, so an HD video
   keeps its size and we can show real progress. Resolves to the stored name. */
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
      || (file.type.startsWith('video') ? 'mp4' : 'jpg');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?ext=' + encodeURIComponent(ext));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 200 && r.file) resolve({ file: r.file, kind: (file.type || '').startsWith('video') ? 'video' : 'image' });
      else reject(new Error(r.error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    xhr.send(file);
  });
}
/* Pick photos and/or videos. Photos are still compressed; videos go up untouched. */
function pickMedia(cb, onProgress) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,video/*'; inp.multiple = true;
  inp.onchange = async () => {
    for (const f of Array.from(inp.files || [])) {
      try {
        if (f.type.startsWith('video')) {
          const up = await uploadFile(f, onProgress);
          const still = await videoPoster(f);
          if (still) { try { up.poster = (await uploadDataUrl(still, 'still.jpg')).file; } catch (e) {} }
          cb(up);
        }
        else await new Promise((done) => compressImage(f, async (b64) => {
          const blob = await (await fetch(b64)).blob();
          blob.name = 'photo.jpg';
          cb(await uploadFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }), onProgress));
          done();
        }, 2200, 0.88));
      } catch (e) { toast(e.message); }
    }
  };
  inp.click();
}
/* A still from the video itself, so it never shows as a black rectangle */
function videoPoster(file) {
  return new Promise((resolve) => {
    let done = false;
    const url = URL.createObjectURL(file);
    const finish = (v) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(v); };
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
    v.onloadeddata = () => { try { v.currentTime = Math.min(1, (v.duration || 3) / 3); } catch (e) { finish(null); } };
    v.onseeked = () => {
      try {
        let w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return finish(null);
        const max = 1280;
        if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        finish(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { finish(null); }   // a codec the browser cannot decode
    };
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
  });
}
async function uploadDataUrl(dataUrl, name, onProgress) {
  const blob = await (await fetch(dataUrl)).blob();
  return uploadFile(new File([blob], name || 'still.jpg', { type: 'image/jpeg' }), onProgress);
}
window.videoPoster = videoPoster;
window.uploadDataUrl = uploadDataUrl;
window.uploadFile = uploadFile;
window.pickMedia = pickMedia;

/* A swipeable gallery: photos and inline video, snap-scrolled, with dots. */
function gallery(media, opts = {}) {
  const list = (media || []).filter((m) => m && m.file);
  if (!list.length) return '';
  const id = 'g' + Math.round(performance.now() * 1000) + '_' + list.length;
  const slides = list.map((m) => m.kind === 'video'
    ? `<div class="gl-slide"><video class="gl-video" src="${esc(mediaUrl(m.file))}" controls playsinline muted
         preload="metadata" ${m.poster ? `poster="${esc(mediaUrl(m.poster))}"` : ''}></video>
         <button class="gl-sound" onclick="glSound(this)" aria-label="Sound on">🔇</button></div>`
    : `<div class="gl-slide"><img class="gl-img" src="${esc(mediaUrl(m.file))}" alt=""
         onclick="lightbox('${esc(mediaUrl(m.file))}')"/></div>`).join('');
  return `<div class="gl" data-n="${list.length}">
    <div class="gl-track" id="${id}" onscroll="glScroll('${id}')">${slides}</div>
    ${list.length > 1 ? `<div class="gl-dots" id="${id}_d">${list.map((m, i) =>
      `<span class="gl-dot${i === 0 ? ' on' : ''}">${m.kind === 'video' ? '▶' : ''}</span>`).join('')}</div>` : ''}
  </div>`;
}
window.gallery = gallery;
/* Videos start on their own when they are the thing you are looking at,
   muted — which is the only way a browser will allow it — and stop when they leave. */
let _vidWatcher = null;
function watchVideos(root) {
  const vids = (root || document).querySelectorAll('video.gl-video');
  if (!vids.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!_vidWatcher) {
    _vidWatcher = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const v = e.target;
        if (e.isIntersecting && e.intersectionRatio > 0.6) { v.play().catch(() => {}); }
        else if (!v.paused) { v.pause(); }
      });
    }, { threshold: [0, 0.6, 1] });
  }
  vids.forEach((v) => { if (!v.dataset.watched) { v.dataset.watched = '1'; _vidWatcher.observe(v); } });
}
window.watchVideos = watchVideos;
window.glSound = (btn) => {
  const v = btn.parentElement.querySelector('video');
  if (!v) return;
  v.muted = !v.muted;
  btn.textContent = v.muted ? '🔇' : '🔊';
  if (!v.muted) v.play().catch(() => {});
};
window.glScroll = (id) => {
  const t = document.getElementById(id), d = document.getElementById(id + '_d');
  if (!t || !d) return;
  const i = Math.round(t.scrollLeft / t.clientWidth);
  [...d.children].forEach((x, n) => x.classList.toggle('on', n === i));
};

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

const state = { user: null, page: null, nav: [], stack: [], hidden: new Set(), groupTab: {} };

/* which sections are hidden for the signed-in user's role (admin sees everything) */
async function loadPerms() {
  try { const r = await GET('/api/my-permissions'); state.hidden = new Set(r.hidden || []); }
  catch (e) { state.hidden = new Set(); }
}
async function loadConfig() {
  try { window._cfg = await GET('/api/settings'); } catch (e) { window._cfg = window._cfg || {}; }
  // the clock the server keeps the attendance by, so a date typed here and a
  // date recorded there are the same day
  try { const c = await GET('/api/clock'); if (c && c.zone) STUDIO_TZ = c.zone; } catch (e) {}
}
function isHidden(page) {
  if (!state.user || state.user.role === 'admin') return false;
  const first = (NAV[state.user.role] || [])[0];
  if (page === 'profile' || (first && page === first[0])) return false; // landing + profile always available
  if (state.hidden.has(page)) return true;
  // A merged screen goes away only when everything inside it is hidden; what is
  // still allowed decides which tabs appear.
  if (GROUPS[page]) {
    return !GROUPS[page].tabs.some(([k, l, ic, roles]) => roles.includes(state.user.role) && !state.hidden.has(k));
  }
  return false;
}

/* ---------- boot ---------- */
async function boot() {
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) return renderInvite(invite);   // she arrived on her invitation link
  try {
    const { user } = await GET('/api/me');
    // Somebody already signed in never passes through the sign-in screen again,
    // so without this the offer would never reach the people who have been using
    // the app all along — exactly the ones typing a password least often and
    // noticing it most.
    if (user) { state.user = user; await loadPerms(); await loadConfig(); renderApp(); offerPasskey(); }
    else renderAuth();
  } catch (e) { renderAuth(); }
  if ('serviceWorker' in navigator) {
    // when a new version takes over, reload once so the page runs fresh code (no more "stuck on old version")
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return; reloaded = true; location.reload();
    });
    navigator.serviceWorker.register('/sw.js').then((reg) => { try { reg.update(); } catch (e) {} }).catch(() => {});
  }
}
const APP_VERSION = 'v142';
// manual escape hatch: clear caches + unregister SW + hard reload
window.forceUpdate = async () => {
  try { if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } } catch (e) {}
  try { if ('serviceWorker' in navigator) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map((r) => r.unregister())); } } catch (e) {}
  location.reload(true);
};

/* The invitation screen: she chooses a password, and nothing else. */
async function renderInvite(token) {
  const brand = `<div class="brand-mark">DB</div>
    <h1 class="brand-title">Dalia Bassel</h1>
    <p class="brand-sub">Haute Couture · Est 2019</p>`;
  const shell = (inner) => { document.body.innerHTML = `<div class="auth-wrap"><div class="auth-card">${brand}${inner}</div></div>`; };
  shell('<div class="spinner"></div>');
  let who;
  try { who = await GET('/api/invite/' + encodeURIComponent(token)); }
  catch (e) {
    return shell(`<p class="err">${esc(e.message)}</p>
      <button class="btn" style="margin-top:14px" onclick="location.href='/'">Go to sign in</button>`);
  }
  shell(`<div style="text-align:start">
      <p class="hint" style="text-align:center;margin:0 0 18px">Welcome, <b>${esc(who.name)}</b> — choose a password and your dress is waiting for you.</p>
      <label>Your email</label>
      <input value="${esc(who.email || '')}" readonly />
      <label>Choose a password</label>
      <input id="ivPass" type="password" placeholder="at least 6 characters" autocomplete="new-password" />
      <label>Type it again</label>
      <input id="ivPass2" type="password" autocomplete="new-password" />
      <div class="err hidden" id="ivErr"></div>
      <button class="btn" style="margin-top:18px" id="ivBtn">Set my password</button>
    </div>`);
  $('#ivBtn').onclick = async () => {
    const a = $('#ivPass').value, b = $('#ivPass2').value, err = $('#ivErr');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (a.length < 6) return fail('Choose a password of at least 6 characters');
    if (a !== b) return fail('The two passwords are not the same');
    const btn = $('#ivBtn'); btn.disabled = true; btn.textContent = 'Just a moment…';
    try {
      await POST('/api/invite/accept', { token, password: a });
      history.replaceState({}, '', '/');            // drop the token from the address bar
      state.user = (await GET('/api/me')).user;
      window._forceStart = state.user.role === 'customer' ? 'mydresses' : null; // she came for her dress
      await loadPerms(); await loadConfig();
      renderApp();
    } catch (e) { btn.disabled = false; btn.textContent = 'Set my password'; fail(e.message); }
  };
}
window.renderInvite = renderInvite;

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
    inner = `${isReg ? '' : `<div id="pkTop" class="hidden">
      <button class="btn" onclick="passkeyLogin()">${faceLabel()}</button>
      <div class="pk-or" style="margin-top:16px"><span>or use your password</span></div>
    </div>`}
    <form id="authForm" style="text-align:start">
      ${isReg ? `<div class="sign-photo">
        <div class="sp-ring" id="spRing" onclick="pickSignupPhoto()">
          <span class="sp-plus">＋</span><span class="sp-hint">Your photo</span>
        </div>
        <div class="hint" style="text-align:center;margin-top:6px">A photo helps the studio know you</div>
      </div>` : ''}
      ${isReg ? '<label>Full name</label><input name="name" placeholder="Your name" required />' : ''}
      <label>Email</label>
      <input name="email" type="email" placeholder="you@email.com" required />
      <label>Password</label>
      <input name="password" type="password" placeholder="••••••" required />
      ${isReg ? '<p class="hint" style="margin-top:12px">Use the email the studio has for you and you go straight to your own pages. Any other email joins as a visitor.</p>' : ''}
      <div class="err hidden" id="authErr"></div>
      <button class="btn" style="margin-top:18px" type="submit">${isReg ? 'Create account' : 'Sign in'}</button>
    </form>
    ${isReg ? '' : `<div id="pkWrap" class="hidden" style="margin-top:14px">
      <div class="pk-or"><span>or</span></div>
      <button class="btn sec" style="margin-top:12px" onclick="passkeyLogin()">${faceLabel()}</button>
    </div>`}
    <p class="hint" style="margin-top:16px">${isReg ? 'Already have an account? ' : "Don't have an account? "}
      <a href="#" onclick="renderAuth('${isReg ? '' : 'register'}');return false" style="font-weight:700">${isReg ? 'Sign in' : 'Create one'}</a></p>`;
  }
  document.body.innerHTML = `<div class="auth-wrap"><div class="auth-card">${brand}${inner}</div></div>`;
  const form = $('#authForm');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      if (isReg) {
        if (!window._signupPhoto) { const el = $('#authErr'); el.textContent = 'Add a photo of yourself first'; el.classList.remove('hidden'); document.getElementById('spRing').classList.add('sp-shake'); setTimeout(() => document.getElementById('spRing') && document.getElementById('spRing').classList.remove('sp-shake'), 600); return; }
        await POST('/api/register', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), avatar: window._signupPhoto });
      }
      else await POST('/api/login', { email: fd.get('email'), password: fd.get('password') });
      state.user = (await GET('/api/me')).user;
      await loadPerms(); await loadConfig();
      renderApp();
      offerPasskey();
    } catch (err) { const el = $('#authErr'); el.textContent = err.message; el.classList.remove('hidden'); }
  };
  // Shown only where the device can actually do it, so the button is never a
  // promise the phone cannot keep.
  // A phone that has been set up leads with the button; one that has not still
  // shows it, below the password, because a sign-in screen with no sign of the
  // thing somebody was told to look for is its own kind of broken. Tapping it
  // there does not reach the operating system — passkeyLogin says in words that
  // this phone is not set up yet, instead of letting iOS answer an empty list
  // with a QR code for some other device.
  if (!isReg) hasPlatformAuthenticator().then((yes) => {
    if (!yes) return;
    const el = document.getElementById(pkSetUpHere() ? 'pkTop' : 'pkWrap');
    if (el) el.classList.remove('hidden');
    autoPasskey();
  });
}
window.renderAuth = renderAuth;
window.pickSignupPhoto = () => pickImage((b64) => {
  window._signupPhoto = b64;
  const r = document.getElementById('spRing');
  if (r) { r.style.backgroundImage = `url('${b64}')`; r.classList.add('has'); }
  const err = document.getElementById('authErr'); if (err) err.classList.add('hidden');
});
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
    offerPasskey();
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
};

/* ---------- app shell ---------- */

/* Screens that belong together share one line in the menu and sit side by side
   as tabs. The pages themselves are untouched — they are simply drawn inside
   the screen named here, which carries the heading for them.
   Each tab says which roles it is for; a role sees only its own. */
const GROUPS = {
  academy: {
    title: 'Academy', icon: '🎓',
    tabs: [
      ['students', 'Students', '👩‍🎓', ['admin', 'manager', 'staff']],
      ['finance', 'Payments', '💳', ['admin', 'manager']],
      ['rounds', 'Rounds', '🗓', ['admin', 'manager']],
      ['courses', 'Courses', '🎬', ['admin', 'manager', 'staff']],
    ],
  },
  spending: {
    title: 'Spending', icon: '💸',
    tabs: [
      ['purchases', 'Purchases', '🧾', ['admin', 'manager']],
      ['expenses', 'Studio costs', '🏠', ['admin']],
      ['floats', 'Floats', '🧰', ['admin']],
      ['vendors', 'Vendors', '🏬', ['admin']],
    ],
  },
  me: {
    title: 'My record', icon: '🧾',
    tabs: [
      ['myoverview', 'Overview', '👤', ['staff', 'manager']],
      ['mysalary', 'Salary', '💵', ['staff', 'manager']],
      ['myrequests', 'Absences', '🗂', ['staff', 'manager']],
      ['myattendance', 'Attendance', '🕒', ['staff', 'manager']],
    ],
  },
  classroom: {
    title: 'Classroom', icon: '📚',
    tabs: [
      ['homework', 'Tasks', '✎', ['admin', 'trainee']],
      ['quizzes', 'Quizzes', '📝', ['admin', 'trainee']],
      ['notes', 'Notes', '📌', ['admin', 'trainee']],
    ],
  },
};

/* the tabs of one merged screen that this user may actually open */
function groupTabs(key) {
  const g = GROUPS[key];
  if (!g || !state.user) return [];
  return g.tabs.filter(([k, l, ic, roles]) => roles.includes(state.user.role) && !isHidden(k));
}

/* the merged screen a page lives in, for this user — or nothing, if it stands alone */
function groupOf(page) {
  if (!state.user || GROUPS[page]) return null;
  const mine = NAV[state.user.role] || [];
  for (const key of Object.keys(GROUPS)) {
    if (!mine.some(([k]) => k === key)) continue;
    if (GROUPS[key].tabs.some(([k, l, ic, roles]) => k === page && roles.includes(state.user.role))) return key;
  }
  return null;
}

const NAV = {
  admin: [
    ['home', 'Home', '⌂'],
    ['members', 'Members', '👥'],
    ['academy', 'Academy', '🎓'],
    ['classroom', 'Classroom', '📚'],
    ['dalia', 'Dalia', '✦'],
    ['dresses', 'Dresses', '👗'],
    ['spending', 'Spending', '💸'],
    ['staff', 'Staff', '💼'],
    ['attreqs', 'Attendance requests', '🕒'],
    ['config', 'Configuration', '⚙'],
    ['about', 'About', 'ℹ'],
  ],
  trainee: [
    ['home', 'Home', '⌂'],
    ['myattendance', 'Attendance', '🕒'],
    ['courses', 'Courses', '🎬'],
    ['classroom', 'Classroom', '📚'],
    ['mypay', 'Account', '💳'],
    ['help', 'Customer service', '💬'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  manager: [
    ['home', 'Attendance', '🕒'],
    ['dresses', 'Dresses', '👗'],
    ['academy', 'Academy', '🎓'],
    ['spending', 'Spending', '💸'],
    ['me', 'My record', '🧾'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  staff: [
    ['home', 'Attendance', '🕒'],
    ['dresses', 'Dresses', '👗'],
    ['academy', 'Academy', '🎓'],
    ['me', 'My record', '🧾'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  customer: [
    ['mydresses', 'My Dresses', '👗'],
    ['help', 'Customer service', '💬'],
    ['dalia', 'Dalia Bassel', '✦'],
    ['about', 'About', 'ℹ'],
  ],
  // a visitor has no place in the academy yet — the feed, a way to reach us, and who we are
  visitor: [
    ['dalia', 'Dalia Bassel', '✦'],
    ['help', 'Customer service', '💬'],
    ['about', 'About', 'ℹ'],
  ],
};

/* bottom bar shows only 2 tabs; the rest live in the side drawer */
const BOTTOM = {
  admin: [['home', 'Home', '⌂'], ['academy', 'Academy', '🎓'], ['dresses', 'Dresses', '👗'], ['dalia', 'Dalia', '✦']],
  manager: [['home', 'Attendance', '🕒'], ['dresses', 'Dresses', '👗'], ['academy', 'Academy', '🎓'], ['dalia', 'Dalia', '✦']],
  trainee: [['home', 'Home', '⌂'], ['dalia', 'Dalia Bassel', '✦']],
  staff: [['home', 'Attendance', '🕒'], ['dresses', 'Dresses', '👗'], ['academy', 'Academy', '🎓'], ['dalia', 'Dalia', '✦']],
  customer: [['mydresses', 'My Dresses', '👗'], ['help', 'Customer service', '💬'], ['dalia', 'Dalia Bassel', '✦']],
  visitor: [['dalia', 'Dalia Bassel', '✦'], ['help', 'Customer service', '💬'], ['about', 'About', 'ℹ']],
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
        <button class="bell-btn" onclick="go('notifications')" aria-label="Notifications">${bellIcon()}<span class="bell-badge" id="bellBadge" style="display:none">0</span></button>
        <button class="profile-btn" onclick="openDrawer()" aria-label="${esc(u.name)}">
          <span class="who">${esc(u.name)}<br><span class="muted">${roleLabel(u.role)}</span></span>
          ${avatarHtml(u, 'pav')}
        </button>
      </div>
      <div class="content" id="content"><div class="spinner"></div></div>
    </div>
    <div class="bottomnav bn${((BOTTOM[u.role] || state.nav).filter(([k]) => !isHidden(k))).length}" id="nav">
      ${(BOTTOM[u.role] || state.nav).filter(([k]) => !isHidden(k)).map(([k, l, ic]) => `<button data-p="${k}"><span class="ic">${ic}</span>${l}</button>`).join('')}
    </div>`;
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.p); });
  // restore the last screen after a refresh (so reload keeps you where you were)
  // default landing = the Dalia feed (falls back to the first nav item)
  let start = state.nav.some(([k]) => k === 'dalia') && !isHidden('dalia') ? 'dalia' : state.nav[0][0];
  if (window._forceStart && state.nav.some(([k]) => k === window._forceStart)) { start = window._forceStart; window._forceStart = null; }
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
  startNotifPoll();
}
/* a drawn bell rather than an emoji — it sits properly and follows the type colour */
function bellIcon() {
  return `<svg class="bell-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3a5.6 5.6 0 0 0-5.6 5.6v3.03c0 .5-.18.98-.5 1.36l-.94 1.1A1.2 1.2 0 0 0 5.88 16h12.24a1.2 1.2 0 0 0 .92-1.97l-.94-1.1a2.1 2.1 0 0 1-.5-1.36V8.6A5.6 5.6 0 0 0 12 3Z"
      stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M9.9 19a2.2 2.2 0 0 0 4.2 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`;
}
window.bellIcon = bellIcon;
function roleLabel(r) { return { admin: 'Admin', manager: 'Manager', trainee: 'Student', staff: 'Staff', customer: 'Client', visitor: 'Visitor' }[r] || r; }
/* avatar: uploaded photo if present, else initials — same shape (pav / av) */
function avatarHtml(u, cls) {
  const c = cls || 'pav';
  return (u && u.avatar)
    ? `<span class="${c}" style="padding:0;overflow:hidden"><img src="${esc(mediaUrl(u.avatar))}" style="width:100%;height:100%;object-fit:cover" alt=""/></span>`
    : `<span class="${c}">${esc(initials(u && u.name))}</span>`;
}
window.avatarHtml = avatarHtml;
function openDrawer() {
  const profileItem = `<button class="draw-item ${state.page === 'profile' ? 'active' : ''}" onclick="closeDrawer();go('profile')"><span class="ic">👤</span>My Profile</button>`;
  const items = profileItem + state.nav.map(([k, l, ic]) =>
    `<button class="draw-item ${state.page === k ? 'active' : ''}" onclick="closeDrawer();go('${k}')"><span class="ic">${ic}</span>${l}</button>`).join('');
  const d = ensureEl('drawer-root');
  d.innerHTML = `<div class="drawer-back" onclick="if(event.target===this)closeDrawer()"><div class="drawer">
    <div class="drawer-head" style="cursor:pointer" onclick="closeDrawer();go('profile')"><div class="logo">DB</div>
      <div><div class="dn">${esc(state.user.name)}</div><div class="dr">${roleLabel(state.user.role)}</div></div></div>
    <div class="drawer-nav">${items}</div>
    ${appInstalled() ? '' : '<button class="btn sec" style="margin-top:14px" onclick="closeDrawer();installApp()">📲 Install app</button>'}
    <button class="btn sec" style="margin-top:8px" onclick="logout()">Sign out</button>
    <div style="margin-top:14px;text-align:center;font-size:12px;color:var(--muted)">Version ${APP_VERSION} · <a href="#" onclick="forceUpdate();return false" style="font-weight:700">Update now</a></div></div></div>`;
}
/* ---- PWA install ---- */
let _deferredPrompt = null;
function appInstalled() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _deferredPrompt = e; });
window.installApp = async () => {
  if (appInstalled()) { toast('App already installed ✓'); return; }
  if (_deferredPrompt) {
    _deferredPrompt.prompt();
    try { await _deferredPrompt.userChoice; } catch (e) {}
    _deferredPrompt = null;
    return;
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  modal(isIOS
    ? `<h3>Install on iPhone 🍎</h3>
       <ol style="line-height:2;padding-inline-start:20px;font-size:14px">
         <li>Open this page in <b>Safari</b>.</li>
         <li>Tap the <b>Share</b> button ⬆️ (bottom bar).</li>
         <li>Scroll down and tap <b>“Add to Home Screen”</b>.</li>
         <li>Tap <b>Add</b> — the icon appears on your home screen.</li>
       </ol>`
    : `<h3>Install app 📲</h3>
       <ol style="line-height:2;padding-inline-start:20px;font-size:14px">
         <li>Open the browser menu <b>⋮</b> (top-right).</li>
         <li>Tap <b>“Add to Home screen”</b> / <b>“Install app”</b>.</li>
         <li>Confirm — the icon appears on your home screen.</li>
       </ol>`);
};
function closeDrawer() { const d = document.getElementById('drawer-root'); if (d) d.innerHTML = ''; }
window.openDrawer = openDrawer; window.closeDrawer = closeDrawer;
async function logout() { try { await POST('/api/logout'); } catch (e) {} try { localStorage.removeItem('dalia_route'); } catch (e) {} state.user = null; renderAuth(); }
window.logout = logout;

/* A row of tabs or chips wider than the phone should never open with the one you
   are on hidden off the edge. Only the row is moved, never the page under it. */
function showActiveChip(root) {
  (root || document).querySelectorAll('.filters, .dtabs').forEach((row) => {
    const on = row.querySelector('.chip.active, .dtab.on');
    if (!on || row.scrollWidth <= row.clientWidth + 4) return;
    row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
  });
}
window.showActiveChip = showActiveChip;

function persistRoute() {
  try { localStorage.setItem('dalia_route', JSON.stringify({ page: state.page, roundId: window._roundId, roundTab: window._roundTab, staffId: window._staffId, staffTab2: window._staffTab2 })); } catch (e) {}
}
function go(page, opts = {}) {
  // a page that now lives inside a merged screen opens that screen on its tab,
  // so every link and every "back to the list" still lands where it meant to
  const grp = groupOf(page);
  if (grp) { state.groupTab[grp] = page; page = grp; }
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
  if (fn) fn(c).then(() => { lazyImgs('#content'); watchVideos(c); showActiveChip(c); }).catch((e) => { c.innerHTML = `<div class="empty"><div class="em">⚠</div>${esc(e.message)}</div>`; });
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

/* ---------- animated dress watermark (sits behind a screen's content) ---------- */
const DRESS_PATH = 'M68 34 L100 60 L132 34 C140 62 124 100 118 130 C152 172 180 240 184 286 '
  + 'C150 300 50 300 16 286 C20 240 48 172 82 130 C76 100 60 62 68 34 Z';
function dressWatermark() {
  return `<div class="dress-wm" aria-hidden="true">
    <svg viewBox="0 0 200 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="dwmG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7c3aed"/><stop offset=".5" stop-color="#a24fd6"/><stop offset="1" stop-color="#e24a8b"/>
      </linearGradient></defs>
      <path class="dwm-fill" d="${DRESS_PATH}" fill="url(#dwmG)"/>
      <path class="dwm-stroke" d="${DRESS_PATH}" stroke="url(#dwmG)" stroke-width="1.5" stroke-linejoin="round" stroke-opacity=".5"/>
      <g class="dwm-detail" stroke="url(#dwmG)" stroke-width="1.1" stroke-linecap="round" stroke-opacity=".34">
        <path d="M70 37 Q100 45 130 37"/>
        <path d="M82 130 Q100 137 118 130"/>
        <path d="M100 137 L100 290"/>
        <path d="M92 141 Q76 212 56 288"/>
        <path d="M108 141 Q124 212 144 288"/>
      </g>
    </svg>
  </div>`;
}

/* ---------- Face ID / fingerprint sign-in ----------
   The browser speaks ArrayBuffers and the server speaks base64url, so the two
   helpers below are most of the work. Everything secret stays on the device:
   what crosses the wire is a signature over a challenge the server just made. */
const pkToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkFromB64 = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
// Apple calls it Face ID, everyone else calls it something else; say what the
// person in front of the screen will recognise.
function faceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad/i.test(ua)) return '🙂 Face ID /&nbsp;Touch ID';
  if (/Macintosh/i.test(ua)) return '🙂 Touch ID';
  if (/Android/i.test(ua)) return '🙂 Fingerprint /&nbsp;Face';
  return '🙂 Device unlock';
}
async function hasPlatformAuthenticator() {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) { return false; }
}
// A cancelled prompt is the person changing their mind, not a fault to shout at.
const pkCancelled = (e) => e && (e.name === 'NotAllowedError' || e.name === 'AbortError');

window.passkeyRegister = async () => {
  if (!(await hasPlatformAuthenticator())) return toast('This device cannot do that', 'error');
  try {
    const o = await POST('/api/passkey/register/start', {});
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: pkFromB64(o.challenge),
        rp: o.rp,
        user: { id: pkFromB64(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: o.pubKeyCredParams,
        authenticatorSelection: o.authenticatorSelection,
        excludeCredentials: (o.excludeCredentials || []).map((c) => ({ type: c.type, id: pkFromB64(c.id) })),
        timeout: o.timeout,
        attestation: o.attestation,
      },
    });
    if (!cred) throw new Error('Nothing came back from the device');
    await POST('/api/passkey/register/finish', {
      challenge: o.challenge,
      response: {
        id: cred.id,
        clientDataJSON: pkToB64(cred.response.clientDataJSON),
        attestationObject: pkToB64(cred.response.attestationObject),
      },
    });
    pkRemember(true);
    toast('Done — just look at your phone next time ✓');
    // Refresh the list if the profile screen happens to be open; never navigate,
    // since this is usually answered from a prompt somewhere else entirely.
    if (typeof renderPasskeys === 'function') renderPasskeys();
  } catch (e) {
    if (pkCancelled(e)) return;
    toast(e.message || 'Could not set this up', 'error');
  }
};

window.passkeyLogin = async (opts) => {
  const o_ = opts || {};
  try {
    const typed = document.querySelector('#authForm input[name=email]');
    const email = typed ? (typed.value || '').trim() : '';
    const o = await POST('/api/passkey/login/start', email ? { email } : {});
    // Nothing to offer and no note saying this phone was set up: say so rather
    // than handing the request to the operating system, which answers an empty
    // list by asking to scan a QR code with another device.
    if (!(o.allowCredentials || []).length && !pkSetUpHere()) {
      throw new Error('This phone is not set up yet. Sign in with your password once and it will offer to set it up.');
    }
    const req = {
      publicKey: {
        challenge: pkFromB64(o.challenge),
        rpId: o.rpId,
        allowCredentials: (o.allowCredentials || []).map((c) => ({ type: c.type, id: pkFromB64(c.id) })),
        userVerification: o.userVerification,
        timeout: o.timeout,
      },
    };
    // Conditional means: do not open anything, just wait, and offer the key if
    // the person taps the email box. Safari allows that without a gesture where
    // it refuses to open a prompt on its own.
    if (o_.conditional) req.mediation = 'conditional';
    const cred = await navigator.credentials.get(req);
    if (!cred) throw new Error('Nothing came back from the device');
    await POST('/api/passkey/login/finish', {
      challenge: o.challenge,
      response: {
        id: cred.id,
        clientDataJSON: pkToB64(cred.response.clientDataJSON),
        authenticatorData: pkToB64(cred.response.authenticatorData),
        signature: pkToB64(cred.response.signature),
      },
    });
    state.user = (await GET('/api/me')).user;
    await loadPerms(); await loadConfig();
    renderApp();
    return true;
  } catch (e) {
    if (pkCancelled(e)) return false;
    // Only "this device is not known here" means the note is stale. An expired
    // challenge or a dropped connection is a retry, not a reason to forget.
    if (/not set up/i.test(e.message || '')) pkRemember(false);
    // An attempt nobody asked for stays silent: it was a convenience, and the
    // button is still sitting there to be pressed.
    if (o_.quiet) return false;
    const el = document.getElementById('authErr');
    if (el) { el.textContent = e.message || 'Could not sign in with this device'; el.classList.remove('hidden'); }
    else toast(e.message || 'Could not sign in', 'error');
    return false;
  }
};
/* Opening Face ID without being asked to.

   Browsers disagree about this on purpose. Chrome on Android will open the
   prompt as the page loads; Safari will not, because a page that can raise
   Face ID unprompted can raise it over and over until somebody glances at the
   screen. So: ask straight away, and where that is refused, fall back to the
   conditional request, which opens nothing but offers the key the moment the
   email box is tapped. Either way the button is still there. */
window.autoPasskey = async () => {
  if (window.__pkAutoTried) return;
  window.__pkAutoTried = true;
  if (!pkSetUpHere()) return;
  if (!(await hasPlatformAuthenticator())) return;
  if (await passkeyLogin({ quiet: true })) return;   // signed in, nothing more to do
  try {
    if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return;
    const inp = document.querySelector('#authForm input[name=email]');
    if (inp) inp.setAttribute('autocomplete', 'username webauthn');
    passkeyLogin({ quiet: true, conditional: true });  // left pending on purpose
  } catch (e) { /* the button remains */ }
};
window.faceLabel = faceLabel;
window.hasPlatformAuthenticator = hasPlatformAuthenticator;

/* Offering it at the one moment it makes sense: just after someone has typed
   the password they would rather not type again. Buried three taps deep in a
   settings screen, nobody ever finds it. */
// Whether this phone has been set up. Nobody is signed in on the sign-in
// screen, so the server cannot be asked — a note left on the device is the only
// way to know which button to lead with. It decides layout and nothing else, so
// a wrong answer costs a tap, never access.
const PK_HERE = 'pk-here';
const pkSetUpHere = () => { try { return localStorage.getItem(PK_HERE) === '1'; } catch (e) { return false; } };
const pkRemember = (on) => { try { on ? localStorage.setItem(PK_HERE, '1') : localStorage.removeItem(PK_HERE); } catch (e) {} };

const PK_ASKED = 'pk-asked';
const PK_ASKED_AT = 'pk-asked-at';
window.offerPasskey = async () => {
  try {
    if (!(await hasPlatformAuthenticator())) return;
    // Waved away twice, it goes quiet — but for a fortnight, not forever. A
    // "not now" on a busy morning should not be the last the studio ever hears
    // of it. My Profile has it permanently for anyone who wants it sooner.
    let asked = 0, when = 0;
    try {
      asked = Number(localStorage.getItem(PK_ASKED) || 0);
      when = Number(localStorage.getItem(PK_ASKED_AT) || 0);
    } catch (e) { asked = 0; }
    if (asked >= 2 && Date.now() - when < 14 * 24 * 3600 * 1000) return;
    if (asked >= 2) { try { localStorage.setItem(PK_ASKED, '0'); } catch (e) {} }
    // Only once per visit, however many times the app is re-rendered.
    if (window.__pkOffered) return;
    window.__pkOffered = true;
    const keys = await GET('/api/passkeys').catch(() => []);
    if (keys.some((k) => k.usable_here)) return; // already set up on this phone
    modal(`<h3 style="margin:0 0 6px">Skip the password next time?</h3>
      <p class="hint" style="margin:0 0 4px">Unlock with ${faceLabel().replace(/^🙂 /, '')} instead. Your face stays on this phone — the studio never sees it.</p>
      <button class="btn" style="margin-top:16px" onclick="closeModal();passkeyRegister()">${faceLabel()}</button>
      <button class="btn ghost" style="margin-top:8px" onclick="dismissPasskeyOffer()">Not now</button>`);
  } catch (e) { /* never let this get in the way of signing in */ }
};
window.dismissPasskeyOffer = () => {
  try {
    localStorage.setItem(PK_ASKED, String(Number(localStorage.getItem(PK_ASKED) || 0) + 1));
    localStorage.setItem(PK_ASKED_AT, String(Date.now()));
  } catch (e) {}
  closeModal();
};

/* ---------- count-up for stat numbers: <div class="n" data-count="70000" data-fmt="money"> ---------- */
function runCounters(root) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  (root || document).querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count || 0);
    // Written with textContent, so the plain form: markup here would be read out
    // character by character instead of rendered.
    const fmt = el.dataset.fmt === 'money' ? moneyText : (v) => Number(v).toLocaleString('en-US');
    if (reduce || !to) { el.textContent = fmt(to); return; }
    const dur = 900; let t0 = null;
    const step = (t) => {
      if (t0 === null) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
window.dressWatermark = dressWatermark;
window.runCounters = runCounters;

/* ---------- animated colour bands behind a screen (couture backdrop) ---------- */
function luxBackdrop() {
  return `<div class="lux-bg" aria-hidden="true">
    <span class="band b1"></span><span class="band b2"></span>
    <span class="band b3"></span><span class="band b4"></span>
  </div>`;
}

/* ---------- per-tile colour slice: [start, end, glow] ---------- */
const TILE_TINT = {
  students: ['#7c3aed', '#a78bfa', '124,58,237'],
  members:  ['#6b4a7a', '#b596c4', '107,74,122'],
  finance:  ['#b3873a', '#e8c477', '179,135,58'],
  courses:  ['#2563eb', '#7ea8ff', '37,99,235'],
  homework: ['#e24a8b', '#f7a3c6', '226,74,139'],
  quizzes:  ['#0f8f80', '#5ed4c6', '15,143,128'],
  dresses:  ['#d63384', '#f39ac0', '214,51,132'],
  dalia:    ['#a24fd6', '#d9a6f2', '162,79,214'],
  myattendance: ['#4f46e5', '#9aa5ff', '79,70,229'],
  notes:    ['#c2622a', '#f3a97a', '194,98,42'],
  mypay:    ['#b3873a', '#e8c477', '179,135,58'],
  about:    ['#6b6478', '#b6aec6', '107,100,120'],
  rounds:   ['#5b21b6', '#a78bfa', '91,33,182'],
  clients:  ['#c2185b', '#f0a3c6', '194,24,91'],
  help:     ['#0f766e', '#5eead4', '15,118,110'],
  chats:    ['#0f766e', '#5eead4', '15,118,110'],
  dressmoney: ['#b3873a', '#e8c477', '179,135,58'],
  staff:    ['#0f766e', '#5eead4', '15,118,110'],
};
function tintVars(key) {
  const [c1, c2, glow] = TILE_TINT[key] || TILE_TINT.students;
  return `--c1:${c1};--c2:${c2};--glow:${glow}`;
}

/* menu tiles: [page, emoji, label] -> coloured, animated tiles */
function tilesHtml(items) {
  return `<div class="tiles">${items.map(([p, e, t]) => `<div class="tile" style="${tintVars(p)}" onclick="go('${p}')">
    <div class="em"><span>${e}</span></div><div class="t">${esc(t)}</div></div>`).join('')}</div>`;
}
/* elegant nav list: rows of [page, icon, label, meta-html] — replaces the tile grid */
function navList(rows, flush) {
  return `<div class="nav-list${flush ? ' flush' : ''}">${rows.map(([p, e, label, meta, act], i) => `
    <div class="nav-row" style="${tintVars(p)};--d:${(0.05 + i * 0.055).toFixed(3)}s" onclick="${act || `go('${p}')`}">
      <span class="rail"></span>
      <span class="ic">${e}</span>
      <span class="txt"><span class="nm">${esc(label)}</span><span class="meta">${meta || ''}</span></span>
      <span class="chev">›</span>
    </div>`).join('')}</div>`;
}

/* One of the two houses: a branded block that holds its own sections and figures.
   o = { name, kind, summary, c1, c2, glow, rows, figures } */
function brandGroup(o) {
  const figs = (o.figures || []).map((f) => `<div class="fig">
      <div class="v"${f.color ? ` style="color:${f.color}"` : ''} data-count="${f.value}"${f.money ? ' data-fmt="money"' : ''}>${f.money ? money(0) : 0}</div>
      <div class="k">${esc(f.label)}</div></div>`).join('');
  return `<div class="brand-group" style="--c1:${o.c1};--c2:${o.c2};--glow:${o.glow}">
    <div class="bg-head">
      <div class="bg-name">${esc(o.name)}</div>
      <div class="bg-kind">${esc(o.kind)}</div>
      ${o.summary ? `<div class="bg-sum">${o.summary}</div>` : ''}
    </div>
    ${o.content !== undefined ? `<div class="bg-body">${o.content}</div>` : navList(o.rows, true)}
    ${figs ? `<div class="bg-figs"><div class="fig-row"${o.figuresGo ? ` onclick="${o.figuresGo}"` : ''}>${figs}</div></div>` : ''}
  </div>`;
}
const big = (v) => `<b>${typeof v === 'number' ? v.toLocaleString('en-US') : esc(String(v))}</b>`;
window.luxBackdrop = luxBackdrop;
window.tilesHtml = tilesHtml;
window.tintVars = tintVars;
window.navList = navList;
window.brandGroup = brandGroup;
window.big = big;
window.moneyText = moneyText;

const PAGES = {};

/* ---------- payment receipt: a screen you can leave, and print ---------- */
function printReceipt(o) { window._receipt = o; go('receipt'); }
window.printReceipt = printReceipt;

PAGES.receipt = async (c) => {
  const o = window._receipt;
  if (!o) return go(state.user.role === 'customer' ? 'mydresses' : 'home');
  const rows = [
    ['Name', o.name || '—'],
    ['For', o.forWhat || '—'],
    ['Method', o.method === 'cash' ? 'Cash' : 'Bank transfer / Instapay'],
    ['Type', o.kind === 'deposit' ? 'Deposit' : 'Installment'],
    ['Date', o.date ? dt(o.date) : dt(today())],
  ];
  if (o.note) rows.push(['Note', o.note]);
  if (o.remaining != null) rows.push(['Remaining balance', money(o.remaining)]);
  c.innerHTML = `<div class="rc-actions no-print">
      <button class="btn sec" onclick="goBack()">‹ Back</button>
      <button class="btn" onclick="window.print()">🖨 Print / Save as PDF</button>
    </div>
    <div class="receipt-sheet" id="receiptSheet">
      <div class="rc-head">
        <div class="rc-brand">DALIA BASSEL</div>
        <div class="rc-sub">Haute Couture · Payment Receipt</div>
      </div>
      <div class="rc-amt">${money(o.amount)}</div>
      <table class="rc-table"><tbody>${rows.map(([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}</tbody></table>
      <div class="rc-foot">Thank you 💜 · Dalia Bassel Couture</div>
    </div>`;
};

/* ---------- the payslip ----------
   The salary screen is a working view, full of buttons. This is the piece of
   paper that comes out of it: what the month was, what was added and taken off
   and why, and a line for each of them to sign. */
PAGES.payslip = async (c) => {
  const o = window._payslip;
  if (!o) return goBack();
  const s = o.sheet;
  const line = (label, detail, amount, kind) => `<tr class="${kind || ''}">
    <td>${esc(label)}${detail ? `<span class="ps-detail">${esc(detail)}</span>` : ''}</td>
    <td class="ps-amt">${amount}</td></tr>`;
  const plus = [];
  const minus = [];
  if (s.overtime_minutes) plus.push(line('Overtime', `${s.overtime_minutes} min × ${s.overtime_mult} at ${moneyText(s.hourly)}/h`, money(s.overtime_pay), 'ps-plus'));
  if (s.extra_hours) plus.push(line('Work from home', `${s.extra_hours} h at ${moneyText(s.hourly)}/h`, money(s.extra_task_pay), 'ps-plus'));
  if (s.bonus) plus.push(line('Bonus', '', money(s.bonus), 'ps-plus'));
  if (s.absent_days) minus.push(line('Absence', `${s.absent_days} day(s) × ${moneyText(s.daily)}`, '− ' + money(s.absence_deduction), 'ps-minus'));
  if (s.late_minutes) minus.push(line('Lateness', `${s.late_minutes} min beyond the grace period`, '− ' + money(s.late_deduction), 'ps-minus'));
  if (s.deductions) minus.push(line('Deductions', '', '− ' + money(s.deductions), 'ps-minus'));
  if (s.advances) minus.push(line('Advances taken this month', '', '− ' + money(s.advances), 'ps-minus'));

  const monthName = new Date(s.month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  c.innerHTML = `<div class="rc-actions no-print">
      <button class="btn sec" onclick="goBack()">‹ Back</button>
      <button class="btn" onclick="window.print()">🖨 Print / Save as PDF</button>
    </div>
    <div class="receipt-sheet ps-sheet">
      <div class="rc-head">
        <div class="rc-brand">DALIA BASSEL</div>
        <div class="rc-sub">Haute Couture · Payslip</div>
      </div>

      <div class="ps-who">
        <div><div class="ps-k">Employee</div><div class="ps-v">${esc(s.user)}</div></div>
        <div><div class="ps-k">Month</div><div class="ps-v">${esc(monthName)}</div></div>
      </div>

      <div class="ps-days">
        <span><b>${s.present_days}</b> present</span>
        ${s.paid_leave_days ? `<span><b>${s.paid_leave_days}</b> paid leave</span>` : ''}
        <span><b>${s.off_days}</b> day(s) off</span>
        ${s.absent_days ? `<span class="ps-bad"><b>${s.absent_days}</b> absent</span>` : ''}
      </div>

      <table class="rc-table ps-table"><tbody>
        ${line('Basic salary', `${s.work_days} day(s) at ${moneyText(s.daily)}`, money(s.base))}
        ${plus.join('')}
        ${minus.join('')}
      </tbody></table>

      <div class="ps-net">
        <div class="ps-net-k">Net salary</div>
        <div class="ps-net-v">${money(s.net)}</div>
      </div>

      <div class="ps-sign">
        <div><div class="ps-line"></div>Received by</div>
        <div><div class="ps-line"></div>Dalia Bassel Couture</div>
      </div>
      <div class="rc-foot">${esc(monthName)} · issued ${esc(dt(today()))}</div>
    </div>`;
};
window.openPayslip = (sheet) => { window._payslip = { sheet }; go('payslip'); };

/* ---------- notifications ---------- */
function timeago(s) {
  if (!s) return '';
  const t = new Date(String(s).replace(' ', 'T') + 'Z').getTime();
  if (isNaN(t)) return String(s).slice(0, 10);
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return String(s).slice(0, 10);
}
const NOTIF_ICON = { dress: '👗', assign: '🧵', feed: '✦', payment: '💳', salary: '💵', leave: '🌴', advance: '💰', absence: '🚫', user: '👤', course: '🎬', chat: '💬', task: '✎', submission: '📥', attendance: '🕒', float: '🧰' };
async function refreshNotifBadge() {
  try {
    const { unread } = await GET('/api/notifications/count');
    const b = document.getElementById('bellBadge');
    if (b) { if (unread > 0) { b.textContent = unread > 99 ? '99+' : unread; b.style.display = ''; } else { b.style.display = 'none'; } }
  } catch (e) {}
}
window.refreshNotifBadge = refreshNotifBadge;
let _notifTimer = null;
function startNotifPoll() {
  refreshNotifBadge();
  clearInterval(_notifTimer);
  _notifTimer = setInterval(() => { if (document.visibilityState !== 'hidden') refreshNotifBadge(); }, 30000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshNotifBadge(); });

PAGES.notifications = async (c) => {
  const { items, unread } = await GET('/api/notifications');
  if (unread > 0) { try { await POST('/api/notifications/read-all'); } catch (e) {} refreshNotifBadge(); }
  c.innerHTML = title('Notifications', '🔔') +
    (items.length
      ? `<div class="card" style="margin-top:6px;padding:4px 0">${items.map((n) => `
        <div class="item notif ${n.is_read ? '' : 'notif-unread'}" onclick="openNotif('${n.link_page || ''}',${n.link_id || 'null'})">
          <div class="av">${NOTIF_ICON[n.type] || '🔔'}</div>
          <div class="main"><div class="nm">${esc(n.title || '')}</div>
            <div class="sub">${n.body ? esc(n.body) + ' · ' : ''}${timeago(n.created_at)}</div></div>
          ${n.image ? `<img class="thumb" style="width:44px;height:44px;aspect-ratio:1;border-radius:8px" src="${esc(mediaUrl(n.image))}"/>` : ''}
        </div>`).join('')}</div>`
      : empty('No notifications yet', '🔔'));
};
window.openNotif = (page, id) => {
  if (!page) return;
  if (page === 'dress') {
    if (['admin', 'manager', 'staff'].includes(state.user.role)) { window._dressId = id; return go('dress'); }
    window._openDressAfter = id;
    go('mydresses');
    return;
  }
  if (page === 'homework' && id) window._openTaskAfter = id; // land on that task's hand-in list
  if ((page === 'chats' || page === 'help') && id) window._openChatAfter = id; // open that conversation
  const target = PAGES[page] ? page : 'notifications';
  go(target);
};

boot();
