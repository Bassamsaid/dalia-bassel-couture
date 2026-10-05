'use strict';
// Daliessa Academy — HTTP server & API (Node built-in modules only)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { URL } = require('node:url');
const { db, ready, hashPassword, verifyPassword, DB_PATH, normMonth } = require('./db');
const { restore } = require('./restore');
const { fixAttendanceTz } = require('./fix-attendance-tz');
const store = require('./storage');
const { writeZip } = require('./zip');
const webauthn = require('./webauthn');

// Sending mail. A serverless function usually cannot open a raw socket on port
// 465, so where RESEND_API_KEY is set the mail goes over plain HTTPS instead;
// the SMTP path below still serves a host that allows the connection.
async function sendMail({ user, pass, to, subject, text }) {
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Dalia Bassel Couture <onboarding@resend.dev>', to: [to], subject, text }),
    });
    if (!r.ok) throw new Error('Email failed: ' + (await r.text()).slice(0, 200));
    return;
  }
  if (!user || !pass) throw new Error('Email is not configured');
  return smtpSend({ user, pass, to, subject, text });
}

// Minimal SMTP-over-TLS sender (Gmail: smtp.gmail.com:465), no dependencies.
function smtpSend({ user, pass, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const body = `From: Dalia Bassel Couture <${user}>\r\nTo: <${to}>\r\nSubject: ${subject}\r\n`
      + `MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${String(text).replace(/\r?\n/g, '\r\n')}\r\n.`;
    const seq = [
      { cmd: 'EHLO localhost', expect: 250 },
      { cmd: 'AUTH LOGIN', expect: 334 },
      { cmd: Buffer.from(user).toString('base64'), expect: 334 },
      { cmd: Buffer.from(pass).toString('base64'), expect: 235 },
      { cmd: `MAIL FROM:<${user}>`, expect: 250 },
      { cmd: `RCPT TO:<${to}>`, expect: 250 },
      { cmd: 'DATA', expect: 354 },
      { cmd: body, expect: 250 },
      { cmd: 'QUIT', expect: 221 },
    ];
    const socket = tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
    socket.setEncoding('utf8');
    let i = -1, buf = '', done = false;
    const finish = (err) => { if (done) return; done = true; try { socket.end(); } catch (_) {} err ? reject(err) : resolve(); };
    socket.setTimeout(20000, () => finish(new Error('smtp timeout')));
    socket.on('error', (e) => finish(e));
    socket.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (!/^\d{3} /.test(last || '')) return; // wait for the final (space) reply line
      const code = parseInt(last.slice(0, 3), 10);
      buf = '';
      if (i === -1) { if (code !== 220) return finish(new Error('greeting ' + last)); i = 0; socket.write(seq[0].cmd + '\r\n'); return; }
      if (code !== seq[i].expect) return finish(new Error(`SMTP step ${i}: ${last}`));
      i++;
      if (i < seq.length) socket.write(seq[i].cmd + '\r\n'); else finish();
    });
  });
}

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// UPLOAD_DIR is configurable so a hosting volume (e.g. Railway) can persist images across deploys
const UPLOAD_DIR = store.UPLOAD_DIR;

// Typed back by the admin before anything is wiped wholesale.
const PURGE_PHRASE = 'DELETE ALL DRESSES';

// Resolve a stored image name to a file, confined to UPLOAD_DIR so a stored value
// can never reach outside it. Returns null for anything that would escape.
function uploadPath(stored) {
  const name = path.basename(String(stored || '').replace(/^\/?uploads\//, ''));
  if (!name || name === '.' || name === '..') return null;
  const full = path.resolve(UPLOAD_DIR, name);
  return full.startsWith(path.resolve(UPLOAD_DIR) + path.sep) ? full : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

// ---------- helpers ----------
function send(res, code, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 60 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { const s = Buffer.concat(chunks).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie; if (!h) return out;
  h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
async function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = await db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  return await db.prepare('SELECT id,name,email,phone,role,round_id,group_id,job_title,base_salary,hire_date,active,avatar,off_days FROM users WHERE id=?').get(s.user_id) || null;
}
// Save a base64 data URL (or raw base64) to uploads, return filename
async function saveImage(dataUrl, fallbackExt = '.jpg') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  let ext = fallbackExt, b64 = dataUrl;
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) {
    b64 = m[2];
    const map = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
    ext = map[m[1]] || fallbackExt;
  }
  return store.save(Buffer.from(b64, 'base64'), ext);
}
// If a field looks like a base64 upload, store it and return the filename; otherwise pass through
async function maybeImage(val) {
  if (typeof val === 'string' && val.startsWith('data:')) return await saveImage(val);
  return val || null;
}
// Where the cover photo sits in the card's crop. It is written straight into a
// style attribute, so only a bare "<x>% <y>%" is allowed through.
function coverPos(val) {
  if (val == null) return null;
  const m = String(val).trim().match(/^(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/);
  if (!m) return null;
  const clamp = (n) => Math.min(100, Math.max(0, Number(n)));
  return `${clamp(m[1])}% ${clamp(m[2])}%`;
}
// A pasted video link, kept only if it is a real http(s) address — the page drops
// it into an iframe or an anchor, so javascript: and data: must never get through.
function videoLink(val) {
  const s = String(val || '').trim();
  if (!s) return null;
  let u; try { u = new URL(s); } catch (e) { return null; }
  return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
}

// ---- notifications ----
// Drop a notification for one recipient. o = {type,title,body,link_page,link_id,image,actor_name}
async function notify(userId, o = {}) {
  if (!userId) return;
  try {
    await db.prepare('INSERT INTO notifications (user_id,type,title,body,link_page,link_id,image,actor_name) VALUES (?,?,?,?,?,?,?,?)')
      .run(Number(userId), o.type || null, o.title || null, o.body || null, o.link_page || null, o.link_id || null, o.image || null, o.actor_name || null);
  } catch (e) { /* never let a notification failure break the main action */ }
}
// Notify every active user in the given role(s), skipping the actor.
async function notifyRoles(roles, o = {}, exceptId) {
  const rs = Array.isArray(roles) ? roles : [roles];
  if (!rs.length) return;
  const ph = rs.map(() => '?').join(',');
  try {
    const rows = await db.prepare(`SELECT id FROM users WHERE active=1 AND role IN (${ph})`).all(...rs);
    for (const u of rows) if (u.id !== exceptId) await notify(u.id, o);
  } catch (e) {}
}
// Notify every active user (used for new Feed/Highlight drops), skipping the actor.
async function notifyAll(o = {}, exceptId) {
  try {
    const rows = await db.prepare('SELECT id FROM users WHERE active=1').all();
    for (const u of rows) if (u.id !== exceptId) await notify(u.id, o);
  } catch (e) {}
}
function money0(n) { return (Number(n) || 0).toLocaleString('en-US') + ' EGP'; }
/* "2026-09" as "September 2026" — a month somebody reads rather than decodes. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function monthName(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  return m ? `${MONTH_NAMES[Number(m[2]) - 1] || m[2]} ${m[1]}` : 'this month';
}

// ---- time / weekday helpers (payroll) ----
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function hm2min(s) { if (!s) return 0; const p = String(s).split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
function weekdayOf(dateStr) { const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z'); return WEEKDAYS[d.getUTCDay()]; }

// ---------- API ----------
const api = {};

// -- auth --
// Count a sign-in, however she got in
async function markLogin(userId) {
  try {
    await db.prepare(`UPDATE users SET login_count=COALESCE(login_count,0)+1,
      first_login=COALESCE(first_login, datetime('now')), last_login=datetime('now') WHERE id=?`).run(userId);
  } catch (e) { /* never block a sign-in over a counter */ }
}
api['POST /api/login'] = async (req, res) => {
  const b = await readBody(req);
  const u = await db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get((b.email || '').trim());
  // an invited account has no password yet — point them at sign-up instead of a dead end
  if (u && u.active && u.invited) return send(res, 401, { error: 'The studio added you. Tap "Create one" and sign up with this email to set your password.' });
  if (!u || !u.active || !verifyPassword(b.password || '', u.password_hash)) return send(res, 401, { error: 'Invalid email or password' });
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, u.id);
  await markLogin(u.id);
  send(res, 200, { ok: true, user: { id: u.id, name: u.name, role: u.role } }, {
    'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
  });
};
// ================= FACE ID / FINGERPRINT SIGN-IN =================
// The device checks the face or the finger and signs a challenge with a key it
// keeps in hardware. Nothing about the face reaches this server, and what is
// stored here — a public key — cannot sign anything.
//
// A passkey belongs to one domain, so the name is read off the request rather
// than fixed: a key made on the Railway address will not work on the Vercel one,
// and each has to be set up where it is used.
function rpFor(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0];
  const port = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[1];
  // Only the exact page the browser is on counts as the origin it signed for.
  const origins = [`${proto}://${host}${port ? ':' + port : ''}`];
  return { rpId: host, origins };
}

async function issueChallenge(kind, userId) {
  const challenge = webauthn.newChallenge();
  await db.prepare('INSERT INTO webauthn_challenges (challenge,user_id,kind,expires_at) VALUES (?,?,?,?)')
    .run(challenge, userId || null, kind, new Date(Date.now() + 5 * 60000).toISOString());
  // Opportunistic sweep; there is no scheduler here and these are tiny.
  await db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')").run();
  return challenge;
}

// Take a challenge once. Returning it to the pool is never right: that is what
// would let the same signature be presented twice.
async function spendChallenge(challenge, kind) {
  const row = await db.prepare('SELECT * FROM webauthn_challenges WHERE challenge=? AND kind=?').get(String(challenge || ''), kind);
  if (row) await db.prepare('DELETE FROM webauthn_challenges WHERE challenge=?').run(row.challenge);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

api['POST /api/passkey/register/start'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const { rpId } = rpFor(req);
  const challenge = await issueChallenge('create', user.id);
  const existing = await db.prepare('SELECT cred_id FROM credentials WHERE user_id=?').all(user.id);
  send(res, 200, {
    challenge,
    rp: { id: rpId, name: 'Dalia Bassel Couture' },
    // The handle identifies the account to the device and is shown in its own
    // passkey list; the row id does that without putting an email in there.
    user: { id: Buffer.from(String(user.id)).toString('base64url'), name: user.email || String(user.id), displayName: user.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.cred_id })),
    timeout: 120000,
    attestation: 'none',
  });
};

api['POST /api/passkey/register/finish'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const { rpId, origins } = rpFor(req);
  const row = await spendChallenge(b.challenge, 'create');
  if (!row || row.user_id !== user.id) return send(res, 400, { error: 'That sign-in attempt has expired. Try again.' });
  let reg;
  try { reg = webauthn.verifyRegistration({ response: b.response || {}, challenge: row.challenge, rpId, origins }); }
  catch (e) { return send(res, 400, { error: e.message }); }
  const taken = await db.prepare('SELECT user_id FROM credentials WHERE cred_id=?').get(reg.credentialId);
  if (taken) return send(res, 409, { error: 'This device is already set up.' });
  await db.prepare('INSERT INTO credentials (user_id,cred_id,public_key,sign_count,label,rp_id) VALUES (?,?,?,?,?,?)')
    .run(user.id, reg.credentialId, JSON.stringify(reg.jwk), reg.signCount, deviceLabel(req), rpId);
  send(res, 200, { ok: true });
};

// A name for the row, so "forget that phone" is a thing the owner can actually do.
function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'This device';
}

api['POST /api/passkey/login/start'] = async (req, res) => {
  const { rpId } = rpFor(req);
  const b = await readBody(req);
  // With an email, the device is told which keys fit. Without one it offers
  // whatever it holds for this site, which is the tap-and-go case.
  let allow = [];
  if (b && b.email) {
    const u = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(String(b.email).trim());
    if (u) allow = (await db.prepare('SELECT cred_id FROM credentials WHERE user_id=?').all(u.id)).map((c) => ({ type: 'public-key', id: c.cred_id }));
  }
  const challenge = await issueChallenge('get', null);
  send(res, 200, { challenge, rpId, allowCredentials: allow, userVerification: 'required', timeout: 120000 });
};

api['POST /api/passkey/login/finish'] = async (req, res) => {
  const b = await readBody(req);
  const { rpId, origins } = rpFor(req);
  const row = await spendChallenge(b.challenge, 'get');
  if (!row) return send(res, 401, { error: 'That sign-in attempt has expired. Try again.' });
  const cred = await db.prepare('SELECT * FROM credentials WHERE cred_id=?').get(String((b.response || {}).id || b.id || ''));
  if (!cred) return send(res, 401, { error: 'This device is not set up for sign-in yet.' });
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(cred.user_id);
  if (!u || !u.active) return send(res, 401, { error: 'No account' });
  try {
    const out = webauthn.verifyAssertion({
      response: b.response || {}, challenge: row.challenge, rpId, origins,
      jwk: JSON.parse(cred.public_key), storedCount: cred.sign_count,
    });
    await db.prepare("UPDATE credentials SET sign_count=?, last_used=datetime('now') WHERE id=?").run(out.signCount, cred.id);
  } catch (e) { return send(res, 401, { error: e.message }); }
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, u.id);
  await markLogin(u.id);
  send(res, 200, { ok: true, user: { id: u.id, name: u.name, role: u.role } }, {
    'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
  });
};

// What this account has set up, and taking one away.
api['GET /api/passkeys'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const { rpId } = rpFor(req);
  const rows = await db.prepare('SELECT id,label,rp_id,created_at,last_used FROM credentials WHERE user_id=? ORDER BY id DESC').all(user.id);
  // One made on the old address cannot be used on this one; say so rather than
  // leaving a key that silently never works.
  send(res, 200, rows.map((r) => ({ ...r, usable_here: !r.rp_id || r.rp_id === rpId })));
};

api['DELETE /api/passkeys/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const r = await db.prepare('DELETE FROM credentials WHERE id=? AND user_id=?').run(params.id, user.id);
  send(res, 200, { ok: true, removed: r.changes });
};

api['POST /api/logout'] = async (req, res) => {
  const token = parseCookies(req).sid;
  if (token) await db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
};
api['GET /api/me'] = async (req, res, user) => send(res, 200, { user });

// -- passwordless email OTP login --
api['POST /api/otp/request'] = async (req, res) => {
  const b = await readBody(req);
  const email = (b.email || '').trim();
  if (!email) return send(res, 400, { error: 'Email is required' });
  const u = await db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
  if (!u || !u.active) return send(res, 404, { error: 'No account with this email' });
  const gUser = process.env.GMAIL_USER, gPass = process.env.GMAIL_APP_PASSWORD;
  if (!gUser || !gPass) return send(res, 503, { error: 'Email sign-in is not set up yet' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  await db.prepare('INSERT INTO otps (email,code,expires_at) VALUES (lower(?),?,?) ON CONFLICT(email) DO UPDATE SET code=excluded.code,expires_at=excluded.expires_at').run(email, code, expires);
  try {
    await sendMail({ user: gUser, pass: gPass, to: email, subject: 'Dalia Bassel — your login code', text: `Your Dalia Bassel login code is: ${code}\n\nIt expires in 10 minutes.` });
  } catch (e) { console.error('OTP email failed:', e.message); return send(res, 502, { error: 'Could not send the email — check the mail settings' }); }
  send(res, 200, { ok: true });
};
api['POST /api/otp/verify'] = async (req, res) => {
  const b = await readBody(req);
  const email = (b.email || '').trim().toLowerCase();
  const code = (b.code || '').trim();
  const row = await db.prepare('SELECT * FROM otps WHERE email=?').get(email);
  if (!row || row.code !== code) return send(res, 401, { error: 'Invalid code' });
  if (new Date(row.expires_at).getTime() < Date.now()) return send(res, 401, { error: 'The code has expired' });
  const u = await db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
  if (!u || !u.active) return send(res, 401, { error: 'No account' });
  await db.prepare('DELETE FROM otps WHERE email=?').run(email);
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, u.id);
  await markLogin(u.id);
  send(res, 200, { ok: true, user: { id: u.id, name: u.name, role: u.role } }, {
    'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
  });
};
api['POST /api/register'] = async (req, res) => {
  const b = await readBody(req);
  if (!b.name || !b.email || !b.password) return send(res, 400, { error: 'All fields are required' });
  const email = String(b.email).trim().toLowerCase();
  try {
    // The studio adds a student's or client's email in advance. Signing up with that
    // same email claims the account, keeping the role and round already set for them.
    const invitee = await db.prepare('SELECT * FROM users WHERE lower(email)=? AND invited=1').get(email);
    let uid;
    if (invitee) {
      await db.prepare('UPDATE users SET password_hash=?,invited=0 WHERE id=?').run(hashPassword(b.password), invitee.id);
      uid = invitee.id;
    } else {
      const taken = await db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email);
      if (taken) return send(res, 400, { error: 'Email already in use' });
      // an email the studio does not know yet joins as a visitor
      const r = await db.prepare('INSERT INTO users (name,email,password_hash,role,avatar) VALUES (?,?,?,?,?)')
        .run(b.name, email, hashPassword(b.password), 'visitor', await maybeImage(b.avatar));
      uid = r.lastInsertRowid;
    }
    const token = crypto.randomBytes(24).toString('hex');
    await db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, uid);
    send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` });
  } catch (e) { send(res, 400, { error: e.message.includes('UNIQUE') ? 'Email already in use' : e.message }); }
};
api['PUT /api/profile'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const cur = await db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  await db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run(b.name ?? cur.name, b.phone ?? cur.phone, user.id);
  if (b.password) await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(b.password), user.id);
  if (b.avatar !== undefined) await db.prepare('UPDATE users SET avatar=? WHERE id=?').run(await maybeImage(b.avatar), user.id);
  send(res, 200, { ok: true });
};

// -- generic guards --
function requireAdmin(user, res) { if (!user || user.role !== 'admin') { send(res, 403, { error: 'forbidden' }); return false; } return true; }
// admin OR manager (academy operations: students, payments, rounds, courses, dresses)
function requireManager(user, res) { if (!user || (user.role !== 'admin' && user.role !== 'manager')) { send(res, 403, { error: 'forbidden' }); return false; } return true; }
// admin, manager, or staff (employees — for self HR: own absences/advances)
function requireStaffish(user, res) { if (!user || !['admin', 'manager', 'staff'].includes(user.role)) { send(res, 403, { error: 'forbidden' }); return false; } return true; }
function requireAuth(user, res) { if (!user) { send(res, 401, { error: 'unauthorized' }); return false; } return true; }

// A seamstress needs the garment — its photos, its measurements, when it is due.
// She has no reason to know whose it is, so who the client is never leaves the
// server for a staff account: not the name, the phone, the notes, her account,
// nor when she is coming in for a fitting. Stripped here rather than hidden in
// the page, so it is gone from the response too.
function stripClient(d) {
  delete d.customer_name; delete d.phone; delete d.note;
  delete d.customer_user_id; delete d.client_access; delete d.brief;
  d.fittings = [];
  return d;
}

// ================= ADMIN: USERS / STUDENTS =================
api['GET /api/users'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return; // staff may view students (money stripped below)
  const role = url.searchParams.get('role');
  const round = url.searchParams.get('round_id');
  let q = 'SELECT id,name,email,phone,role,round_id,group_id,job_title,base_salary,hire_date,active,governorate,off_days,created_at FROM users WHERE 1=1';
  const args = [];
  if (role) { q += ' AND role=?'; args.push(role); }
  if (round) { q += ' AND round_id=?'; args.push(round); }
  // Clients are off the list for staff — otherwise the names and phone numbers
  // kept out of the dress would simply be read here instead.
  if (user.role === 'staff') q += " AND role<>'customer'";
  q += ' ORDER BY name';
  const rows = await db.prepare(q).all(...args);
  if (user.role === 'staff') rows.forEach((r) => { delete r.base_salary; }); // no money for staff
  send(res, 200, rows);
};
api['POST /api/users'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  if (!b.name) return send(res, 400, { error: 'Name is required' });
  if (user.role === 'manager' && !['trainee', 'customer'].includes(b.role || 'trainee')) return send(res, 403, { error: 'managers can only add students or clients' });
  try {
    const invited = b.password ? 0 : 1; // no password -> they set one themselves by signing up with this email
    const r = await db.prepare(`INSERT INTO users (name,email,phone,password_hash,role,round_id,group_id,job_title,base_salary,hire_date,governorate,off_days,invited)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.name, b.email ? String(b.email).trim().toLowerCase() : null, b.phone || null,
      hashPassword(b.password || crypto.randomBytes(9).toString('hex')),
      b.role || 'trainee', b.round_id || null, b.group_id || null,
      b.job_title || null, b.base_salary || 0, b.hire_date || null, b.governorate || null, b.off_days || null, invited);
    const uid = r.lastInsertRowid;
    if (b.role !== 'staff' && (b.total_fee != null || b.round_id)) {
      await db.prepare('INSERT INTO enrollments (user_id,round_id,total_fee) VALUES (?,?,?)').run(uid, b.round_id || null, b.total_fee || 0);
    }
    const roleWord = { trainee: 'student', customer: 'client', staff: 'staff member', manager: 'manager' }[b.role || 'trainee'] || 'member';
    await notifyRoles('admin', { type: 'user', title: `New ${roleWord}: ${b.name}`, body: `${user.name} added a new ${roleWord}`, link_page: b.role === 'trainee' ? 'students' : 'members', actor_name: user.name }, user.id);
    send(res, 200, { id: uid });
  } catch (e) { send(res, 400, { error: e.message.includes('UNIQUE') ? 'This email is already in use' : e.message }); }
};
api['PUT /api/users/:id'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  const cur = await db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
  if (!cur) return send(res, 404, { error: 'not found' });
  if (user.role === 'staff') { // staff may only edit a student/client's contact info — no money, role, round, group
    if (!['trainee', 'customer'].includes(cur.role)) return send(res, 403, { error: 'forbidden' });
    await db.prepare('UPDATE users SET name=?,phone=?,governorate=? WHERE id=?').run(b.name ?? cur.name, b.phone ?? cur.phone, b.governorate ?? cur.governorate, params.id);
    return send(res, 200, { ok: true });
  }
  if (user.role === 'manager') { // managers may only touch students/clients and never escalate a role
    if (!['trainee', 'customer'].includes(cur.role)) return send(res, 403, { error: 'forbidden' });
    if (b.role && !['trainee', 'customer'].includes(b.role)) return send(res, 403, { error: 'cannot change role' });
  }
  // An empty shift box means "use the studio's hours", so '' is stored as null
  // rather than as a time of midnight.
  const shift = (v, fallback) => (v === undefined ? fallback : (String(v).trim() || null));
  await db.prepare(`UPDATE users SET name=?,email=?,phone=?,role=?,round_id=?,group_id=?,job_title=?,base_salary=?,hire_date=?,active=?,governorate=?,off_days=?,shift_start=?,shift_end=? WHERE id=?`).run(
    b.name ?? cur.name, b.email ?? cur.email, b.phone ?? cur.phone, b.role ?? cur.role,
    b.round_id ?? cur.round_id, b.group_id ?? cur.group_id, b.job_title ?? cur.job_title,
    b.base_salary ?? cur.base_salary, b.hire_date ?? cur.hire_date, b.active ?? cur.active, b.governorate ?? cur.governorate, b.off_days ?? cur.off_days,
    shift(b.shift_start, cur.shift_start), shift(b.shift_end, cur.shift_end), params.id);
  if (b.password) await db.prepare('UPDATE users SET password_hash=?,invited=0 WHERE id=?').run(hashPassword(b.password), params.id);
  // giving a login email to someone who had none makes the account claimable on sign-up.
  // An account that already had an email keeps its password — editing it must not lock anyone out.
  else if (!cur.email && b.email) await db.prepare('UPDATE users SET invited=1 WHERE id=?').run(params.id);
  if (b.total_fee != null) {
    const en = await db.prepare('SELECT id FROM enrollments WHERE user_id=?').get(params.id);
    if (en) await db.prepare('UPDATE enrollments SET total_fee=?,round_id=? WHERE id=?').run(b.total_fee, b.round_id ?? cur.round_id, en.id);
    else await db.prepare('INSERT INTO enrollments (user_id,round_id,total_fee) VALUES (?,?,?)').run(params.id, b.round_id ?? cur.round_id, b.total_fee);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/users/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const id = Number(params.id);
  const target = await db.prepare('SELECT id, role FROM users WHERE id=?').get(id);
  if (!target || target.role === 'admin') return send(res, 200, { ok: true }); // never delete the admin
  // clean cascade: remove every record that belongs to this user
  const tables = ['sessions', 'enrollments', 'payments', 'reminders', 'submissions', 'quiz_attempts', 'attendance', 'attendance_requests', 'salaries', 'leaves', 'absences', 'advances', 'salary_adjustments', 'salary_payments', 'notifications'];
  for (const t of tables) { try { await db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* table/column may not exist */ } }
  await db.prepare('DELETE FROM users WHERE id=? AND role!=?').run(id, 'admin');
  send(res, 200, { ok: true });
};

// Full financial sheet for all trainees (paid / remaining / totals)
api['GET /api/finance/sheet'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const rows = await db.prepare(`
    SELECT u.id,u.name,u.phone,u.round_id,u.group_id,
      COALESCE(e.total_fee,0) AS total_fee,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.user_id=u.id),0) AS paid
    FROM users u
    LEFT JOIN enrollments e ON e.user_id=u.id
    WHERE u.role='trainee'
    ORDER BY u.name`).all();
  rows.forEach((r) => {
    r.remaining = Math.max(0, (r.total_fee || 0) - (r.paid || 0));
    // paid beyond the fee: a figure entered wrong, worth showing rather than hiding
    r.over = r.total_fee > 0 ? Math.max(0, (r.paid || 0) - r.total_fee) : 0;
  });
  const totals = rows.reduce((a, r) => { a.total_fee += r.total_fee; a.paid += r.paid; a.remaining += r.remaining; return a; },
    { total_fee: 0, paid: 0, remaining: 0, count: rows.length });
  send(res, 200, { rows, totals });
};

// What a student owes the academy and what she has paid so far.
async function accountOf(userId) {
  const r = await db.prepare(`SELECT
    COALESCE((SELECT SUM(total_fee) FROM enrollments WHERE user_id=?),0) AS fee,
    COALESCE((SELECT SUM(amount)    FROM payments    WHERE user_id=?),0) AS paid`).get(userId, userId);
  return { fee: r.fee || 0, paid: r.paid || 0 };
}

// ================= PAYMENTS =================
api['GET /api/payments'] = async (req, res, user, url) => {
  if (!requireAuth(user, res)) return;
  const uid = url.searchParams.get('user_id');
  if (user.role !== 'admin' && user.role !== 'manager') {
    return send(res, 200, await db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY paid_at DESC').all(user.id));
  }
  const q = uid ? 'SELECT * FROM payments WHERE user_id=? ORDER BY paid_at DESC' : 'SELECT p.*,u.name user_name FROM payments p JOIN users u ON u.id=p.user_id ORDER BY paid_at DESC';
  send(res, 200, uid ? await db.prepare(q).all(uid) : await db.prepare(q).all());
};
api['POST /api/payments'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  if (!b.user_id) return send(res, 400, { error: 'Select a student' });
  const amount = Number(b.amount) || 0;
  if (amount <= 0) return send(res, 400, { error: 'Enter an amount above zero' });
  const acc = await accountOf(b.user_id);
  if (acc.fee > 0 && acc.paid + amount > acc.fee) {
    const left = acc.fee - acc.paid;
    return send(res, 400, {
      error: left > 0
        ? `That is more than she still owes. Her course is ${money0(acc.fee)}, she has paid ${money0(acc.paid)} — only ${money0(left)} is left.`
        : `Her course fee of ${money0(acc.fee)} is already paid in full.`,
    });
  }
  const img = await maybeImage(b.image);
  const method = b.method === 'cash' ? 'cash' : 'transfer';
  const r = await db.prepare('INSERT INTO payments (user_id,amount,kind,method,image,note,paid_at) VALUES (?,?,?,?,?,?,COALESCE(?,datetime(\'now\')))').run(
    b.user_id, b.amount || 0, b.kind || 'installment', method, img, b.note || null, b.paid_at || null);
  const payer = await db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id);
  await notifyRoles('admin', { type: 'payment', title: `New payment: ${money0(b.amount)}`, body: `${user.name} recorded a payment for ${payer ? payer.name : ''}`, link_page: 'finance', actor_name: user.name }, user.id);
  await notify(b.user_id, { type: 'payment', title: `A payment of ${money0(b.amount)} was recorded 💳`, body: 'Thank you! You can view your account', link_page: 'mypay', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/payments/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const cur = await db.prepare('SELECT * FROM payments WHERE id=?').get(params.id);
  if (!cur) return send(res, 404, { error: 'That payment no longer exists' });
  const b = await readBody(req);
  const amount = Number(b.amount ?? cur.amount) || 0;
  if (amount <= 0) return send(res, 400, { error: 'Enter an amount above zero' });
  const uid = b.user_id ? Number(b.user_id) : cur.user_id;
  const acc = await accountOf(uid);
  // this payment's own amount is being replaced, so it must not count against her ceiling
  const others = acc.paid - (uid === cur.user_id ? cur.amount : 0);
  if (acc.fee > 0 && others + amount > acc.fee) {
    const left = acc.fee - others;
    return send(res, 400, {
      error: left > 0
        ? `That is more than she still owes. Her course is ${money0(acc.fee)}, her other payments come to ${money0(others)} — only ${money0(left)} is left.`
        : `Her course fee of ${money0(acc.fee)} is already covered by her other payments.`,
    });
  }
  const img = b.image === undefined ? cur.image : await maybeImage(b.image);
  await db.prepare('UPDATE payments SET user_id=?,amount=?,kind=?,method=?,image=?,note=?,paid_at=COALESCE(?,paid_at) WHERE id=?').run(
    uid, amount, b.kind || cur.kind, (b.method === 'cash' ? 'cash' : (b.method ? 'transfer' : cur.method)),
    img, b.note === undefined ? cur.note : (b.note || null), b.paid_at || null, params.id);
  if (amount !== cur.amount || uid !== cur.user_id) {
    const payer = await db.prepare('SELECT name FROM users WHERE id=?').get(uid);
    await notifyRoles('admin', { type: 'payment', title: `Payment corrected: ${money0(cur.amount)} → ${money0(amount)}`,
      body: `${user.name} corrected a payment for ${payer ? payer.name : ''}`, link_page: 'finance', actor_name: user.name }, user.id);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/payments/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  await db.prepare('DELETE FROM payments WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= REMINDERS (payment due dates) =================
api['GET /api/reminders'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') {
    return send(res, 200, await db.prepare('SELECT r.*,u.name user_name FROM reminders r JOIN users u ON u.id=r.user_id ORDER BY done, due_date').all());
  }
  send(res, 200, await db.prepare('SELECT * FROM reminders WHERE user_id=? ORDER BY done,due_date').all(user.id));
};
api['POST /api/reminders'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const r = await db.prepare('INSERT INTO reminders (user_id,due_date,amount,note) VALUES (?,?,?,?)').run(b.user_id, b.due_date, b.amount || 0, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/reminders/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  await db.prepare('UPDATE reminders SET done=? WHERE id=?').run(b.done ? 1 : 0, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/reminders/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  await db.prepare('DELETE FROM reminders WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= ROUNDS & GROUPS =================
for (const [name, table] of [['rounds', 'rounds'], ['groups', 'groups']]) {
  api[`GET /api/${name}`] = async (req, res, user) => {
    if (!requireAuth(user, res)) return;
    send(res, 200, await db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
  };
}
api['POST /api/rounds'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const kind = b.kind === 'online' ? 'online' : 'onsite';
  const r = await db.prepare('INSERT INTO rounds (number,name,description,start_date,active,kind) VALUES (?,?,?,?,?,?)').run(b.number || null, b.name, b.description || null, b.start_date || null, b.active ?? 1, kind);
  await notifyRoles('admin', { type: 'course', title: `New round: ${b.name || ''}`, body: `${user.name} added a new round`, link_page: 'rounds', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/rounds/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req); const c = await db.prepare('SELECT * FROM rounds WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  await db.prepare('UPDATE rounds SET number=?,name=?,description=?,start_date=?,active=?,kind=? WHERE id=?').run(b.number ?? c.number, b.name ?? c.name, b.description ?? c.description, b.start_date ?? c.start_date, b.active ?? c.active, b.kind ?? c.kind, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/rounds/:id'] = async (req, res, user, url, params) => { if (!requireManager(user, res)) return; await db.prepare('DELETE FROM rounds WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/groups'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const r = await db.prepare('INSERT INTO groups (round_id,name,day,time_slot,capacity) VALUES (?,?,?,?,?)').run(b.round_id || null, b.name, b.day || null, b.time_slot || null, b.capacity || 0);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/groups/:id'] = async (req, res, user, url, params) => { if (!requireManager(user, res)) return; await db.prepare('DELETE FROM groups WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= VIDEOS =================
api['GET /api/videos'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const withNames = 'SELECT v.*, (SELECT name FROM rounds WHERE id=v.round_id) round_name, (SELECT name FROM groups WHERE id=v.group_id) group_name FROM videos v';
  if (['admin', 'manager', 'staff'].includes(user.role)) return send(res, 200, await db.prepare(withNames + ' ORDER BY v.id DESC').all());
  // students: their round's content, and only their group (or round-wide items with no group)
  send(res, 200, await db.prepare(withNames + ' WHERE (v.round_id IS NULL OR v.round_id=?) AND (v.group_id IS NULL OR v.group_id=?) ORDER BY v.id DESC').all(user.round_id || -1, user.group_id || -1));
};
api['POST /api/videos'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return; // staff can upload course videos/photos too
  const b = await readBody(req);
  const file = b.file && b.file.startsWith('data:') ? await saveImage(b.file, '.mp4') : null;
  const kind = b.kind === 'onsite' ? 'onsite' : 'online';
  const r = await db.prepare('INSERT INTO videos (round_id,group_id,title,description,url,file,kind) VALUES (?,?,?,?,?,?,?)').run(b.round_id || null, b.group_id || null, b.title, b.description || null, b.url || null, file, kind);
  await notifyRoles('admin', { type: 'course', title: `New lesson / video: ${b.title || ''}`, body: `${user.name} added new course content`, link_page: 'courses', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/videos/:id'] = async (req, res, user, url, params) => { if (!requireStaffish(user, res)) return; await db.prepare('DELETE FROM videos WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= HOMEWORK + SUBMISSIONS =================
api['GET /api/homeworks'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const studio = ['admin', 'manager', 'staff'].includes(user.role);
  const list = studio
    ? await db.prepare('SELECT * FROM homeworks ORDER BY id DESC').all()
    // mirrors taskAudience: a task aimed at a group reaches that group, whatever
    // round the student is filed under; only a task without a group follows rounds
    : await db.prepare(`SELECT * FROM homeworks WHERE
        (group_id IS NOT NULL AND group_id=?)
        OR (group_id IS NULL AND (round_id IS NULL OR round_id=?))
        ORDER BY id DESC`).all(user.group_id || -1, user.round_id || -1);
  if (studio) {
    // how many of the students it was sent to have handed it in
    for (const h of list) {
      h.expected_count = (await taskAudience(h)).length;
      h.submitted_count = (await db.prepare('SELECT COUNT(*) c FROM submissions WHERE homework_id=?').get(h.id)).c;
    }
  }
  if (user.role !== 'admin') {
    for (const h of list) {
      h.my_submission = await db.prepare('SELECT * FROM submissions WHERE homework_id=? AND user_id=?').get(h.id, user.id) || null;
      if (h.my_submission) h.my_submission.images = await subImages(h.my_submission.id);
    }
  }
  send(res, 200, list);
};
// Students a task was sent to: its round, or every student when it is for all rounds.
async function taskAudience(hw) {
  const cols = `SELECT u.id, u.name, u.group_id, (SELECT name FROM groups WHERE id=u.group_id) group_name
    FROM users u WHERE u.role='trainee' AND u.active=1`;
  if (hw.group_id) return await db.prepare(`${cols} AND u.group_id=? ORDER BY u.name`).all(hw.group_id);
  if (hw.round_id) return await db.prepare(`${cols} AND u.round_id=? ORDER BY u.name`).all(hw.round_id);
  return await db.prepare(`${cols} ORDER BY u.name`).all();
}
async function subImages(submissionId) {
  return await db.prepare('SELECT id,image FROM submission_images WHERE submission_id=? ORDER BY position,id').all(submissionId);
}
api['POST /api/homeworks'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const mode = b.mode === 'online' ? 'online' : 'onsite';
  const r = await db.prepare('INSERT INTO homeworks (round_id,group_id,mode,title,measurements,instructions,due_date) VALUES (?,?,?,?,?,?,?)')
    .run(b.round_id || null, b.group_id || null, mode, b.title, b.measurements || null, b.instructions || null, b.due_date || null);
  const hid = r.lastInsertRowid;
  const due = b.due_date ? ` · due ${b.due_date}` : '';
  for (const st of (await taskAudience({ round_id: b.round_id || null, group_id: b.group_id || null }))) {await notify(st.id, {
    type: 'task', title: `New task: ${b.title}`, body: `Upload your pattern photos${due}`,
    link_page: 'homework', link_id: hid, actor_name: user.name,
  });}
  send(res, 200, { id: hid });
};
api['DELETE /api/homeworks/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM homeworks WHERE id=?').run(params.id); await db.prepare('DELETE FROM submissions WHERE homework_id=?').run(params.id); send(res, 200, { ok: true }); };
api['GET /api/homeworks/:id/submissions'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return; // managers and staff follow the class too
  const hw = await db.prepare('SELECT * FROM homeworks WHERE id=?').get(params.id);
  if (!hw) return send(res, 404, { error: 'Task not found' });
  const submitted = await db.prepare(`SELECT s.*, u.name user_name, u.group_id,
      (SELECT name FROM groups WHERE id=u.group_id) group_name
    FROM submissions s JOIN users u ON u.id=s.user_id WHERE homework_id=? ORDER BY s.submitted_at DESC`).all(params.id);
  for (const s of submitted) s.images = await subImages(s.id);
  const done = new Set(submitted.map((s) => s.user_id));
  const pending = (await taskAudience(hw)).filter((st) => !done.has(st.id));
  send(res, 200, { homework: hw, submitted, pending, expected: submitted.length + pending.length });
};
api['POST /api/homeworks/:id/submit'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const hw = await db.prepare('SELECT * FROM homeworks WHERE id=?').get(params.id);
  if (!hw) return send(res, 404, { error: 'Task not found' });
  const ex = await db.prepare('SELECT id FROM submissions WHERE homework_id=? AND user_id=?').get(params.id, user.id);
  const first = ex ? false : true;
  let sid;
  if (ex) { await db.prepare("UPDATE submissions SET note=?,submitted_at=datetime('now') WHERE id=?").run(b.note ?? null, ex.id); sid = ex.id; }
  else { sid = (await db.prepare('INSERT INTO submissions (homework_id,user_id,note) VALUES (?,?,?)').run(params.id, user.id, b.note || null)).lastInsertRowid; }

  // new photos are appended — nothing already uploaded is replaced
  const incoming = [].concat(b.images || [], b.image ? [b.image] : []).filter(Boolean);
  let pos = (await db.prepare('SELECT COALESCE(MAX(position),-1) p FROM submission_images WHERE submission_id=?').get(sid)).p;
  for (const raw of incoming) {
    const saved = await maybeImage(raw);
    if (saved) await db.prepare('INSERT INTO submission_images (submission_id,image,position) VALUES (?,?,?)').run(sid, saved, ++pos);
  }
  // keep the cover in sync so old screens and thumbnails still work
  const cover = await db.prepare('SELECT image FROM submission_images WHERE submission_id=? ORDER BY position,id LIMIT 1').get(sid);
  await db.prepare('UPDATE submissions SET image=? WHERE id=?').run(cover ? cover.image : null, sid);

  const count = (await db.prepare('SELECT COUNT(*) c FROM submission_images WHERE submission_id=?').get(sid)).c;
  await notifyRoles(['admin', 'manager', 'staff'], {
    type: 'submission',
    title: `${user.name} ${first ? 'handed in' : 'updated'}: ${hw.title}`,
    body: `${count} photo${count === 1 ? '' : 's'}`,
    link_page: 'homework', link_id: hw.id, image: cover ? cover.image : null, actor_name: user.name,
  }, user.id);
  send(res, 200, { ok: true, submission_id: sid, count });
};
// a student removes one of her own photos; the studio may remove any
api['DELETE /api/submission-images/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const row = await db.prepare('SELECT si.*, s.user_id FROM submission_images si JOIN submissions s ON s.id=si.submission_id WHERE si.id=?').get(params.id);
  if (!row) return send(res, 404, { error: 'not found' });
  if (row.user_id !== user.id && !['admin', 'manager'].includes(user.role)) return send(res, 403, { error: 'forbidden' });
  await db.prepare('DELETE FROM submission_images WHERE id=?').run(params.id);
  const cover = await db.prepare('SELECT image FROM submission_images WHERE submission_id=? ORDER BY position,id LIMIT 1').get(row.submission_id);
  await db.prepare('UPDATE submissions SET image=? WHERE id=?').run(cover ? cover.image : null, row.submission_id);
  send(res, 200, { ok: true });
};
api['PUT /api/submissions/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  await db.prepare('UPDATE submissions SET grade=?,feedback=? WHERE id=?').run(b.grade || null, b.feedback || null, params.id);
  send(res, 200, { ok: true });
};

// ================= QUIZZES =================
api['GET /api/quizzes'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const list = user.role === 'admin'
    ? await db.prepare('SELECT * FROM quizzes ORDER BY id DESC').all()
    : await db.prepare('SELECT * FROM quizzes WHERE active=1 AND (round_id IS NULL OR round_id=?) ORDER BY id DESC').all(user.round_id || -1);
  for (const q of list) {
    q.questions_count = (await db.prepare('SELECT COUNT(*) c FROM quiz_questions WHERE quiz_id=?').get(q.id)).c;
    if (user.role !== 'admin') q.my_attempt = await db.prepare('SELECT id,score,total,submitted_at FROM quiz_attempts WHERE quiz_id=? AND user_id=? AND submitted_at IS NOT NULL').get(q.id, user.id) || null;
  }
  send(res, 200, list);
};
api['POST /api/quizzes'] = async (req, res, user) => {
  if (!requireManager(user, res)) return; // admin + manager can create quizzes
  const b = await readBody(req);
  const ref = b.ref_code || 'Q-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const r = await db.prepare('INSERT INTO quizzes (round_id,title,ref_code,duration_min,active) VALUES (?,?,?,?,?)').run(b.round_id || null, b.title, ref, b.duration_min || 15, b.active ?? 1);
  const qid = r.lastInsertRowid;
  for (const q of (b.questions || [])) {
    await db.prepare('INSERT INTO quiz_questions (quiz_id,text,options,correct_index,points) VALUES (?,?,?,?,?)').run(qid, q.text, JSON.stringify(q.options || []), q.correct_index || 0, q.points || 1);
  }
  send(res, 200, { id: qid, ref_code: ref });
};
api['DELETE /api/quizzes/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  await db.prepare('DELETE FROM quizzes WHERE id=?').run(params.id);
  await db.prepare('DELETE FROM quiz_questions WHERE quiz_id=?').run(params.id);
  await db.prepare('DELETE FROM quiz_attempts WHERE quiz_id=?').run(params.id);
  send(res, 200, { ok: true });
};
// Get quiz with questions. For trainees, correct answers are hidden.
api['GET /api/quizzes/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const quiz = await db.prepare('SELECT * FROM quizzes WHERE id=?').get(params.id);
  if (!quiz) return send(res, 404, {});
  const qs = (await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id=?').all(params.id)).map((q) => ({
    id: q.id, text: q.text, options: JSON.parse(q.options), points: q.points,
    ...(user.role === 'admin' ? { correct_index: q.correct_index } : {}),
  }));
  send(res, 200, { ...quiz, questions: qs });
};
api['POST /api/quizzes/:id/attempt'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const qs = await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id=?').all(params.id);
  let score = 0, total = 0;
  qs.forEach((q) => { total += q.points; if (Number(b.answers?.[q.id]) === q.correct_index) score += q.points; });
  const r = await db.prepare('INSERT INTO quiz_attempts (quiz_id,user_id,answers,score,total,submitted_at) VALUES (?,?,?,?,?,datetime(\'now\'))').run(params.id, user.id, JSON.stringify(b.answers || {}), score, total);
  send(res, 200, { id: r.lastInsertRowid, score, total });
};
// Public results of a quiz (everyone can see, per requirement)
api['GET /api/quizzes/:id/results'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  send(res, 200, await db.prepare('SELECT a.score,a.total,a.submitted_at,u.name user_name FROM quiz_attempts a JOIN users u ON u.id=a.user_id WHERE a.quiz_id=? AND a.submitted_at IS NOT NULL ORDER BY a.score DESC,a.submitted_at').all(params.id));
};

// ================= NOTES =================
api['GET /api/notes'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, await db.prepare('SELECT * FROM notes ORDER BY id DESC').all());
  send(res, 200, await db.prepare(`SELECT * FROM notes WHERE scope='all' OR (scope='round' AND round_id=?) OR (scope='user' AND user_id=?) ORDER BY id DESC`).all(user.round_id || -1, user.id));
};
api['POST /api/notes'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = await db.prepare('INSERT INTO notes (scope,round_id,user_id,title,body) VALUES (?,?,?,?,?)').run(b.scope || 'all', b.round_id || null, b.user_id || null, b.title, b.body || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/notes/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM notes WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= ABOUT =================
api['GET /api/about'] = async (req, res) => send(res, 200, await db.prepare('SELECT * FROM about WHERE id=1').get() || {});
api['PUT /api/about'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = b.image && b.image.startsWith('data:') ? await saveImage(b.image) : b.image;
  const ex = await db.prepare('SELECT id FROM about WHERE id=1').get();
  if (ex) await db.prepare('UPDATE about SET title=?,body=?,image=COALESCE(?,image) WHERE id=1').run(b.title, b.body, img || null);
  else await db.prepare('INSERT INTO about (id,title,body,image) VALUES (1,?,?,?)').run(b.title, b.body, img || null);
  send(res, 200, { ok: true });
};

/* Where the studio photo sits in its frame. Nothing is cut from the file itself,
   so the framing can be redone as often as she likes. */
api['PUT /api/about/frame'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const num = (v, lo, hi, d) => { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const shapes = ['16/10', '3/2', '1/1', '4/5'];
  const pos = `${num(b.x, 0, 100, 50)} ${num(b.y, 0, 100, 50)}`;
  const zoom = String(num(b.zoom, 1, 3, 1));
  const shape = shapes.includes(b.shape) ? b.shape : '16/10';
  const ex = await db.prepare('SELECT id FROM about WHERE id=1').get();
  if (ex) await db.prepare('UPDATE about SET img_pos=?,img_zoom=?,img_shape=? WHERE id=1').run(pos, zoom, shape);
  else await db.prepare('INSERT INTO about (id,img_pos,img_zoom,img_shape) VALUES (1,?,?,?)').run(pos, zoom, shape);
  send(res, 200, { ok: true });
};

api['PUT /api/home-cover'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = b.image && b.image.startsWith('data:') ? await saveImage(b.image) : b.image;
  const ex = await db.prepare('SELECT id, home_image FROM about WHERE id=1').get();
  if (ex) await db.prepare('UPDATE about SET home_image=? WHERE id=1').run(img || null);
  else await db.prepare('INSERT INTO about (id,home_image) VALUES (1,?)').run(img || null);
  // Forgetting the name is not the same as the photo being gone: the file would
  // still answer to anyone holding its address. Taking a photo down means
  // taking it down, and a replaced one has nothing left pointing at it either.
  const old = ex && ex.home_image;
  if (old && old !== img) await store.remove(old);
  send(res, 200, { ok: true });
};

// ================= DALIA POSTS =================
api['GET /api/dalia'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const rows = await db.prepare('SELECT * FROM dalia_posts ORDER BY id DESC').all();
  for (const r of rows) {
    r.media = await postMedia(r.id);
    // a post made before galleries existed still has its single cover photo
    if (!r.media.length && r.image) r.media = [{ id: null, file: r.image, kind: 'image' }];
  }
  send(res, 200, rows);
};
async function postMedia(postId) {
  return await db.prepare('SELECT id,file,kind,poster FROM dalia_media WHERE post_id=? ORDER BY position,id').all(postId);
}
// Store the gallery for a post and keep dalia_posts.image pointing at the first photo.
async function setPostMedia(postId, media) {
  let pos = (await db.prepare('SELECT COALESCE(MAX(position),-1) p FROM dalia_media WHERE post_id=?').get(postId)).p;
  for (const m of (media || [])) {
    const file = typeof m === 'string' ? m : m.file;
    if (!file) return;
    const saved = String(file).startsWith('data:') ? await saveImage(file) : file;
    const kind = (typeof m === 'object' && m.kind === 'video') || /\.(mp4|mov|webm)$/i.test(saved) ? 'video' : 'image';
    const poster = (typeof m === 'object' && m.poster)
      ? (String(m.poster).startsWith('data:') ? await saveImage(m.poster) : m.poster) : null;
    await db.prepare('INSERT INTO dalia_media (post_id,file,kind,position,poster) VALUES (?,?,?,?,?)').run(postId, saved, kind, ++pos, poster);
  }
  const cover = await db.prepare("SELECT file FROM dalia_media WHERE post_id=? AND kind='image' ORDER BY position,id LIMIT 1").get(postId);
  if (cover) await db.prepare('UPDATE dalia_posts SET image=? WHERE id=?').run(cover.file, postId);
}
api['POST /api/dalia'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = await maybeImage(b.image);
  const r = await db.prepare('INSERT INTO dalia_posts (title,subtitle,body,image,table_data,template,section) VALUES (?,?,?,?,?,?,?)').run(b.title || null, b.subtitle || null, b.body || null, img, b.table_data ? JSON.stringify(b.table_data) : null, b.template || 'below', b.section || 'studio');
  await setPostMedia(r.lastInsertRowid, b.media);
  await notifyAll({ type: 'feed', title: '✦ New post from Dalia Bassel', body: b.title || b.subtitle || 'See the latest updates', link_page: 'dalia', link_id: r.lastInsertRowid, image: img, actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/dalia/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req); const c = await db.prepare('SELECT * FROM dalia_posts WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const img = (b.image && b.image.startsWith('data:')) ? await maybeImage(b.image) : (b.image ?? c.image);
  await db.prepare('UPDATE dalia_posts SET title=?,subtitle=?,body=?,image=?,template=?,section=? WHERE id=?').run(b.title ?? c.title, b.subtitle ?? c.subtitle, b.body ?? c.body, img, b.template ?? c.template, b.section ?? c.section, params.id);
  await setPostMedia(params.id, b.media);
  send(res, 200, { ok: true });
};
api['DELETE /api/dalia/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM dalia_posts WHERE id=?').run(params.id); await db.prepare('DELETE FROM dalia_media WHERE post_id=?').run(params.id); send(res, 200, { ok: true }); };
// choose the still shown before a video plays
api['PUT /api/dalia-media/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const row = await db.prepare('SELECT * FROM dalia_media WHERE id=?').get(params.id);
  if (!row) return send(res, 404, { error: 'not found' });
  const poster = b.poster ? (String(b.poster).startsWith('data:') ? await saveImage(b.poster) : b.poster) : null;
  await db.prepare('UPDATE dalia_media SET poster=? WHERE id=?').run(poster, params.id);
  send(res, 200, { ok: true, poster });
};
api['DELETE /api/dalia-media/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const row = await db.prepare('SELECT * FROM dalia_media WHERE id=?').get(params.id);
  if (!row) return send(res, 404, { error: 'not found' });
  await db.prepare('DELETE FROM dalia_media WHERE id=?').run(params.id);
  const cover = await db.prepare("SELECT file FROM dalia_media WHERE post_id=? AND kind='image' ORDER BY position,id LIMIT 1").get(row.post_id);
  await db.prepare('UPDATE dalia_posts SET image=? WHERE id=?').run(cover ? cover.file : null, row.post_id);
  send(res, 200, { ok: true });
};

// ================= DRESSES =================
api['GET /api/dresses'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  let list;
  const base = 'SELECT d.*, u.name assignee_name FROM dresses d LEFT JOIN users u ON u.id=d.assigned_to';
  if (['admin', 'manager', 'staff'].includes(user.role)) list = await db.prepare(base + ' ORDER BY d.id DESC').all();
  else list = await db.prepare(base + ' WHERE d.customer_user_id=? ORDER BY d.id DESC').all(user.id);
  const studioSide = ['admin', 'manager', 'staff'].includes(user.role);
  for (const d of list) {
    // A client's phone number is the studio's to hold, not the workroom's. Taking
    // the field off the screen is not enough on its own — it has to stop being
    // sent, or it is simply read somewhere else instead.
    if (user.role !== 'admin' && user.role !== 'customer') delete d.phone;
    try { d.brief = d.brief ? JSON.parse(d.brief) : null; } catch (e) { d.brief = null; }
    // does her own account exist, and has she used it?
    if (studioSide && d.customer_user_id) {
      const cu = await db.prepare('SELECT email,invited,invite_expires,login_count,first_login,last_login FROM users WHERE id=?').get(d.customer_user_id);
      if (cu) d.client_access = {
        email: cu.email, invited: !!cu.invited,
        invite_expires: cu.invite_expires,
        logins: cu.login_count || 0, first_login: cu.first_login, last_login: cu.last_login,
      };
    }
    d.fittings = await db.prepare('SELECT * FROM dress_fittings WHERE dress_id=? ORDER BY fitting_date').all(d.id);
    d.images = await db.prepare('SELECT * FROM dress_images WHERE dress_id=? ORDER BY position, id').all(d.id);
    d.unread = (await db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0 AND link_page='dress' AND link_id=?").get(user.id, d.id)).c;
    if (user.role === 'admin') {
      d.material_cost = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM purchase_lines WHERE dress_id=?').get(d.id)).s;
      d.paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM dress_payments WHERE dress_id=?').get(d.id)).s;
      // Written off: the balance is never coming, so what the dress really sold
      // for is what came in. The price she agreed stays on the record, and what
      // was given up is carried beside it rather than quietly disappearing.
      d.forgiven = d.written_off ? Math.max(0, (d.price || 0) - d.paid) : 0;
      d.sold_for = d.written_off ? d.paid : (d.price || 0);
      d.profit = d.sold_for - d.material_cost;
      d.remaining = d.written_off ? 0 : Math.max(0, (d.price || 0) - d.paid);
    } else if (user.role === 'customer') {
      // clients see THEIR OWN order's price, deposits and balance (+ receipts)
      d.paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM dress_payments WHERE dress_id=?').get(d.id)).s;
      d.remaining = Math.max(0, (d.price || 0) - d.paid);
      d.payments = await db.prepare('SELECT amount,method,note,paid_at,kind FROM dress_payments WHERE dress_id=? ORDER BY COALESCE(paid_at,created_at) DESC, id DESC').all(d.id);
    } else { delete d.price; } // staff / manager: no dress money
    if (user.role === 'staff') stripClient(d);
  }
  send(res, 200, list);
};
api['POST /api/dresses'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const cover = await maybeImage(b.cover_image);
  const price = user.role === 'admin' ? (b.price || 0) : 0; // only admin sets price
  const r = await db.prepare('INSERT INTO dresses (customer_name,customer_user_id,phone,delivery_date,status,note,cover_image,assigned_to,price,brief) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    b.customer_name, b.customer_user_id || null, b.phone || null, b.delivery_date || null, b.status || 'open', b.note || null, cover, b.assigned_to || null, price,
    b.brief && typeof b.brief === 'object' ? JSON.stringify(b.brief) : null);
  const did = r.lastInsertRowid;
  await notifyRoles('admin', { type: 'dress', title: `New dress: ${b.customer_name}`, body: `${user.name} added a new dress booking`, link_page: 'dress', link_id: did, actor_name: user.name }, user.id);
  if (b.assigned_to) await notify(b.assigned_to, { type: 'assign', title: `You were assigned a dress: ${b.customer_name}`, body: `${user.name} assigned you a new dress`, link_page: 'dress', link_id: did, actor_name: user.name });
  if (b.customer_user_id) await notify(b.customer_user_id, { type: 'dress', title: 'A new dress was registered for you 👗', body: 'You can follow the updates here', link_page: 'dress', link_id: did, actor_name: user.name });
  send(res, 200, { id: did });
};
api['PUT /api/dresses/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req); const c = await db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const price = (user.role === 'admin' && b.price != null) ? b.price : c.price; // only admin edits price
  const measImg = (b.measure_image && b.measure_image.startsWith('data:')) ? await maybeImage(b.measure_image) : (b.measure_image ?? c.measure_image);
  const meas = b.measurements != null ? (typeof b.measurements === 'string' ? b.measurements : JSON.stringify(b.measurements)) : c.measurements;
  const brief = b.brief && typeof b.brief === 'object' ? JSON.stringify(b.brief) : c.brief;
  await db.prepare('UPDATE dresses SET customer_name=?,customer_user_id=?,phone=?,delivery_date=?,status=?,note=?,assigned_to=?,price=?,measurements=?,measure_note=?,measure_image=?,brief=?,cover_pos=? WHERE id=?').run(
    b.customer_name ?? c.customer_name, b.customer_user_id ?? c.customer_user_id, b.phone ?? c.phone, b.delivery_date ?? c.delivery_date, b.status ?? c.status, b.note ?? c.note, b.assigned_to ?? c.assigned_to, price, meas, b.measure_note ?? c.measure_note, measImg, brief, coverPos(b.cover_pos) ?? c.cover_pos, params.id);
  // --- notifications on status / assignment changes ---
  const did = Number(params.id);
  const stLabel = { open: 'New', in_progress: 'In progress', delivered: 'Delivered' };
  const statusChanged = b.status != null && b.status !== c.status;
  const assignChanged = b.assigned_to != null && String(b.assigned_to || '') !== String(c.assigned_to || '');
  if (statusChanged) {
    const st = stLabel[b.status] || b.status;
    if (c.assigned_to) await notify(c.assigned_to, { type: 'dress', title: `${c.customer_name}'s dress: ${st}`, body: `${user.name} changed the dress status`, link_page: 'dress', link_id: did, actor_name: user.name });
    if (c.customer_user_id) await notify(c.customer_user_id, { type: 'dress', title: `Your dress is now: ${st}`, body: 'Your dress status changed', link_page: 'dress', link_id: did, actor_name: user.name });
    if (user.role === 'manager') await notifyRoles('admin', { type: 'dress', title: `${user.name} changed ${c.customer_name}'s dress to ${st}`, link_page: 'dress', link_id: did, actor_name: user.name }, user.id);
  }
  if (assignChanged && b.assigned_to) {
    await notify(b.assigned_to, { type: 'assign', title: `You were assigned a dress: ${c.customer_name}`, body: `${user.name} assigned you this dress`, link_page: 'dress', link_id: did, actor_name: user.name });
    if (user.role === 'manager') await notifyRoles('admin', { type: 'assign', title: `${user.name} assigned ${c.customer_name}'s dress to a staff member`, link_page: 'dress', link_id: did, actor_name: user.name }, user.id);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/dresses/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  await db.prepare('DELETE FROM dresses WHERE id=?').run(params.id);
  await db.prepare('DELETE FROM dress_fittings WHERE dress_id=?').run(params.id);
  await db.prepare('DELETE FROM dress_images WHERE dress_id=?').run(params.id);
  await db.prepare('DELETE FROM dress_payments WHERE dress_id=?').run(params.id);
  await db.prepare('DELETE FROM dress_updates WHERE dress_id=?').run(params.id);
  // Material bought for the dress was still bought: keep the line on its invoice
  // (whose total is the sum of its lines) and just drop the dress it pointed at.
  await db.prepare('UPDATE purchase_lines SET dress_id=NULL WHERE dress_id=?').run(params.id);
  send(res, 200, { ok: true });
};
// Wipe every dress at once — for clearing demo data off a fresh install. Admin
// only (a manager may delete dresses one by one, not empty the book), and the
// exact phrase has to come back in the body so a stray request cannot trigger it.
api['DELETE /api/dresses'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (b.confirm !== PURGE_PHRASE) return send(res, 400, { error: `Send confirm: "${PURGE_PHRASE}" to do this.` });
  const dresses = await db.prepare('SELECT id FROM dresses').all();
  if (!dresses.length) return send(res, 200, { ok: true, dresses: 0, files: 0 });

  // Collect the files first: once the rows are gone their names are unrecoverable.
  const files = (await db.prepare('SELECT image FROM dress_images').all()).map((r) => r.image);
  let invoices = 0;
  if (b.with_purchases) {
    // Invoices holding nothing but dress lines go too; one with general spending
    // on it keeps that spending and survives.
    const empties = await db.prepare(`SELECT id, image FROM purchase_invoices WHERE id IN (
                                  SELECT DISTINCT invoice_id FROM purchase_lines WHERE dress_id IS NOT NULL
                                ) AND id NOT IN (
                                  SELECT invoice_id FROM purchase_lines WHERE dress_id IS NULL
                                )`).all();
    empties.forEach((inv) => files.push(inv.image));
    invoices = empties.length;
    await db.exec('DELETE FROM purchase_lines WHERE dress_id IS NOT NULL');
    for (const inv of empties) await db.prepare('DELETE FROM purchase_invoices WHERE id=?').run(inv.id);
  } else {
    await db.exec('UPDATE purchase_lines SET dress_id=NULL'); // spending stays on its invoice
  }
  for (const t of ['dress_fittings', 'dress_images', 'dress_updates', 'dress_payments', 'dresses']) await db.exec(`DELETE FROM ${t}`);

  let removed = 0;
  for (const f of files) { if (await store.remove(f)) removed++; }
  send(res, 200, { ok: true, dresses: dresses.length, invoices, files: removed });
};
// materials bought for a dress — admin + manager (operational; NOT price/deposit)
api['GET /api/dresses/:id/purchases'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  send(res, 200, await db.prepare(`SELECT l.id, l.invoice_id, l.item, l.amount, pi.shop, pi.invoice_date, pi.created_at,
      (SELECT name FROM vendors WHERE id=pi.vendor_id) vendor_name
    FROM purchase_lines l JOIN purchase_invoices pi ON pi.id=l.invoice_id
    WHERE l.dress_id=? ORDER BY pi.id DESC, l.id`).all(params.id));
};
// ---- dress payments (client deposits/installments) — admin only (price is admin-only) ----
api['GET /api/dresses/:id/payments'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  send(res, 200, await db.prepare('SELECT * FROM dress_payments WHERE dress_id=? ORDER BY COALESCE(paid_at,created_at) DESC, id DESC').all(params.id));
};
/* The balance on a dress that is never coming. Not a deletion: the dress keeps
   the price she agreed and gains the date it was given up on, so it can be put
   back if the money does arrive after all. */
api['PUT /api/dresses/:id/write-off'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const d = await db.prepare('SELECT id FROM dresses WHERE id=?').get(params.id);
  if (!d) return send(res, 404, { error: 'not found' });
  if (b.off) {
    await db.prepare("UPDATE dresses SET written_off=1, written_off_at=COALESCE(written_off_at, date('now')), written_off_note=? WHERE id=?")
      .run(b.note || null, params.id);
  } else {
    await db.prepare('UPDATE dresses SET written_off=0, written_off_at=NULL, written_off_note=NULL WHERE id=?').run(params.id);
  }
  send(res, 200, { ok: true });
};
api['POST /api/dresses/:id/payments'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.amount) return send(res, 400, { error: 'Amount is required' });
  const img = await maybeImage(b.image);
  const method = b.method === 'cash' ? 'cash' : 'transfer';
  // Deposit or instalment. Not asked twice: with nothing said, the first money
  // on a dress is its deposit and everything after it an instalment.
  let kind = b.kind === 'deposit' || b.kind === 'payment' ? b.kind : null;
  if (!kind) {
    const n = (await db.prepare('SELECT COUNT(*) c FROM dress_payments WHERE dress_id=?').get(params.id)).c;
    kind = n ? 'payment' : 'deposit';
  }
  const r = await db.prepare("INSERT INTO dress_payments (dress_id,amount,method,note,image,paid_at,kind) VALUES (?,?,?,?,?,COALESCE(?,datetime('now')),?)")
    .run(params.id, b.amount, method, b.note || null, img, b.paid_at || null, kind);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/dress-payments/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM dress_payments WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/dresses/:id/fittings'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const r = await db.prepare('INSERT INTO dress_fittings (dress_id,fitting_date,note,done) VALUES (?,?,?,?)').run(params.id, b.fitting_date, b.note || null, b.done ? 1 : 0);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/fittings/:id'] = async (req, res, user, url, params) => { if (!requireManager(user, res)) return; await db.prepare('DELETE FROM dress_fittings WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/dresses/:id/images'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const img = await maybeImage(b.image);
  // A row is either an uploaded file or a link to a video somewhere else.
  const link = img ? null : videoLink(b.video_url);
  if (!img && !link) return send(res, 400, { error: 'Add a photo, a video, or a video link' });
  const pos = (await db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM dress_images WHERE dress_id=?').get(params.id)).p;
  const r = await db.prepare('INSERT INTO dress_images (dress_id,image,video_url,caption,position) VALUES (?,?,?,?,?)')
    .run(params.id, img || '', link, b.caption || null, pos);
  // The cover is the card's photo, so a video — uploaded or linked — is never it.
  const isPhoto = img && !/\.(mp4|mov|webm)$/i.test(img);
  if (isPhoto && !(await db.prepare('SELECT cover_image FROM dresses WHERE id=?').get(params.id)).cover_image) {
    await db.prepare('UPDATE dresses SET cover_image=? WHERE id=?').run(img, params.id);
  }
  send(res, 200, { id: r.lastInsertRowid });
};
// reorder photos; first in the order becomes the cover shown outside
api['PUT /api/dresses/:id/image-order'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const order = Array.isArray(b.order) ? b.order : [];
  for (const [i, imgId] of order.entries()) await db.prepare('UPDATE dress_images SET position=? WHERE id=? AND dress_id=?').run(i, imgId, params.id);
  if (order.length) {
    const first = await db.prepare('SELECT image FROM dress_images WHERE id=? AND dress_id=?').get(order[0], params.id);
    if (first) await db.prepare('UPDATE dresses SET cover_image=? WHERE id=?').run(first.image, params.id);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/dress-images/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const img = await db.prepare('SELECT * FROM dress_images WHERE id=?').get(params.id);
  await db.prepare('DELETE FROM dress_images WHERE id=?').run(params.id);
  if (img) { // if the deleted photo was the cover, promote the next one (or clear)
    const dr = await db.prepare('SELECT cover_image FROM dresses WHERE id=?').get(img.dress_id);
    if (dr && dr.cover_image === img.image) {
      const next = await db.prepare("SELECT image FROM dress_images WHERE dress_id=? AND image<>'' AND image NOT LIKE '%.mp4' AND image NOT LIKE '%.mov' AND image NOT LIKE '%.webm' ORDER BY position,id LIMIT 1").get(img.dress_id);
      await db.prepare('UPDATE dresses SET cover_image=? WHERE id=?').run(next ? next.image : null, img.dress_id);
    }
  }
  send(res, 200, { ok: true });
};

// ================= STAFF HR =================
api['GET /api/attendance'] = async (req, res, user, url) => {
  if (!requireAuth(user, res)) return;
  const uid = url.searchParams.get('user_id');
  const round = url.searchParams.get('round_id');
  if (['admin', 'manager', 'staff'].includes(user.role)) {
    if (round) return send(res, 200, await db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE u.round_id=? ORDER BY a.date DESC').all(round));
    if (uid) return send(res, 200, await db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY date DESC').all(uid));
    if (user.role === 'staff') return send(res, 200, await db.prepare('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC').all(user.id)); // staff no-param: own timeline (check-in screen)
    return send(res, 200, await db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id ORDER BY date DESC LIMIT 300').all());
  }
  send(res, 200, await db.prepare('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC').all(user.id));
};
/* The attendance book: who came in and who went home, day by day, for the whole
   studio. The owner's alone — a manager can see her own hours and a staff
   member hers, but the comings and goings of everybody is not theirs to read. */
api['GET /api/attendance/log'] = async (req, res, user, url) => {
  if (!requireAdmin(user, res)) return;
  const from = String(url.searchParams.get('from') || '').slice(0, 10);
  const to = String(url.searchParams.get('to') || '').slice(0, 10);
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(from) || !ymd.test(to)) return send(res, 400, { error: 'from and to are needed, as YYYY-MM-DD' });
  const rows = await db.prepare(`SELECT a.id,a.user_id,a.date,a.check_in,a.check_out,a.note,
      u.name user_name, u.job_title, u.role
    FROM attendance a JOIN users u ON u.id=a.user_id
    WHERE u.role IN ('staff','manager') AND a.date >= ? AND a.date <= ?
    ORDER BY a.date DESC, u.name`).all(from, to);
  send(res, 200, rows);
};
function haversine(lat1, lon1, lat2, lon2) { // metres between two lat/lng points
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// The studio's clock, which is the only one that means anything on a timesheet.
//
// A container's own clock is UTC unless somebody says otherwise, so reading the
// date and the time off it recorded a seven in the evening in Cairo as four —
// three hours short on every shift, and the staff watching a clock on their own
// phone showing the right time while the row said something else. Worse, a time
// typed into a manual log is whatever the person in Cairo meant by it, so the
// two sources disagreed and a day could end before it began.
//
// Named zone rather than a fixed offset, so the hour Egypt moves its clocks is
// not an hour this gets wrong.
const STUDIO_TZ = process.env.STUDIO_TZ || 'Africa/Cairo';
let studioClock;
try {
  studioClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: STUDIO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
} catch (e) {
  console.warn(`STUDIO_TZ "${STUDIO_TZ}" is not a timezone this system knows; falling back to UTC.`);
  studioClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
}
function studioNow(at = new Date()) {
  const p = {};
  for (const part of studioClock.formatToParts(at)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

api['GET /api/clock'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  send(res, 200, { ...studioNow(), zone: STUDIO_TZ });
};

api['POST /api/attendance/check'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  // geofence: if enabled, the check must happen within the studio radius
  const cfg = {}; (await db.prepare('SELECT key,value FROM settings').all()).forEach((r) => { cfg[r.key] = r.value; });
  if (cfg.geo_enabled === '1' && cfg.geo_lat && cfg.geo_lng) {
    if (b.lat == null || b.lng == null) return send(res, 400, { error: 'Location needed — turn on location and try again' });
    const dist = haversine(Number(cfg.geo_lat), Number(cfg.geo_lng), Number(b.lat), Number(b.lng));
    const radius = Number(cfg.geo_radius) || 150;
    if (dist > radius) return send(res, 403, { error: `You are ${Math.round(dist)}m from the studio — you must be within ${radius}m to check in/out` });
  }
  const { date: today, time: now } = studioNow();
  let rec = await db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(user.id, today);
  // tz_ok says these times are already the studio's, so the correction that
  // puts old rows right leaves them alone.
  if (!rec) { await db.prepare('INSERT INTO attendance (user_id,date,check_in,tz_ok) VALUES (?,?,?,1)').run(user.id, today, now); return send(res, 200, { action: 'in', time: now }); }
  if (!rec.check_out) { await db.prepare('UPDATE attendance SET check_out=?, tz_ok=1 WHERE id=?').run(now, rec.id); return send(res, 200, { action: 'out', time: now }); }
  send(res, 200, { action: 'done' });
};
// ---- manual attendance log requests (forgot to check in/out) ----
api['GET /api/attendance-requests'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return;
  if (user.role === 'admin') return send(res, 200, await db.prepare('SELECT r.*,u.name user_name FROM attendance_requests r JOIN users u ON u.id=r.user_id ORDER BY (r.status=\'pending\') DESC, r.created_at DESC').all());
  send(res, 200, await db.prepare('SELECT * FROM attendance_requests WHERE user_id=? ORDER BY created_at DESC').all(user.id));
};
api['POST /api/attendance-requests'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  if (!b.date || !['in', 'out'].includes(b.kind)) return send(res, 400, { error: 'date and type (in/out) are required' });
  const r = await db.prepare('INSERT INTO attendance_requests (user_id,date,kind,time,reason) VALUES (?,?,?,?,?)').run(user.id, b.date, b.kind, b.time || null, b.reason || null);
  const label = b.kind === 'in' ? 'Check-in' : 'Check-out';
  await notifyRoles('admin', { type: 'attendance', title: `${user.name} — manual log request`, body: `${b.date} · ${label}${b.time ? ' ' + b.time : ''}${b.reason ? ' · ' + b.reason : ''}`, link_page: 'attreqs', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/attendance-requests/:id/decide'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const rq = await db.prepare('SELECT * FROM attendance_requests WHERE id=?').get(params.id);
  if (!rq) return send(res, 404, { error: 'not found' });
  const st = b.status === 'approved' ? 'approved' : 'rejected';
  await db.prepare("UPDATE attendance_requests SET status=?, decided_at=datetime('now') WHERE id=?").run(st, params.id);
  if (st === 'approved') {
    const time = rq.time || studioNow().time;
    const rec = await db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(rq.user_id, rq.date);
    if (rq.kind === 'in') {
      if (rec) await db.prepare('UPDATE attendance SET check_in=?, tz_ok=1 WHERE id=?').run(time, rec.id);
      else await db.prepare('INSERT INTO attendance (user_id,date,check_in,note,tz_ok) VALUES (?,?,?,?,1)').run(rq.user_id, rq.date, time, 'manual (admin approved)');
    } else {
      if (rec) await db.prepare('UPDATE attendance SET check_out=?, tz_ok=1 WHERE id=?').run(time, rec.id);
      else await db.prepare('INSERT INTO attendance (user_id,date,check_out,note,tz_ok) VALUES (?,?,?,?,1)').run(rq.user_id, rq.date, time, 'manual (admin approved)');
    }
  }
  const label = rq.kind === 'in' ? 'Check-in' : 'Check-out';
  await notify(rq.user_id, { type: 'attendance', title: `Manual log ${st === 'approved' ? 'approved ✅' : 'rejected ❌'}`, body: `${rq.date} · ${label}${rq.time ? ' ' + rq.time : ''}`, link_page: 'home', actor_name: user.name });
  send(res, 200, { ok: true });
};
api['DELETE /api/attendance-requests/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM attendance_requests WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/attendance'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = await db.prepare('INSERT INTO attendance (user_id,date,check_in,check_out,note,tz_ok) VALUES (?,?,?,?,?,1)').run(b.user_id, b.date, b.check_in || null, b.check_out || null, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['GET /api/salaries'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, await db.prepare('SELECT s.*,u.name user_name,(s.base+s.bonus-s.deduction) net FROM salaries s JOIN users u ON u.id=s.user_id ORDER BY month DESC,u.name').all());
  send(res, 200, await db.prepare('SELECT *,(base+bonus-deduction) net FROM salaries WHERE user_id=? ORDER BY month DESC').all(user.id));
};
api['POST /api/salaries'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = await db.prepare('INSERT INTO salaries (user_id,month,base,bonus,deduction,paid,note) VALUES (?,?,?,?,?,?,?)').run(b.user_id, b.month, b.base || 0, b.bonus || 0, b.deduction || 0, b.paid ? 1 : 0, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/salaries/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  await db.prepare('UPDATE salaries SET paid=? WHERE id=?').run(b.paid ? 1 : 0, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/salaries/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM salaries WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['GET /api/leaves'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, await db.prepare('SELECT l.*,u.name user_name FROM leaves l JOIN users u ON u.id=l.user_id ORDER BY status,from_date DESC').all());
  send(res, 200, await db.prepare('SELECT * FROM leaves WHERE user_id=? ORDER BY from_date DESC').all(user.id));
};
api['POST /api/leaves'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const uid = user.role === 'admin' ? b.user_id : user.id;
  const r = await db.prepare('INSERT INTO leaves (user_id,from_date,to_date,type,reason,status) VALUES (?,?,?,?,?,?)').run(uid, b.from_date, b.to_date, b.type || 'annual', b.reason || null, user.role === 'admin' ? (b.status || 'approved') : 'pending');
  if (user.role !== 'admin') await notifyRoles('admin', { type: 'leave', title: `Leave request from ${user.name}`, body: `${b.from_date} → ${b.to_date}`, link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/leaves/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const lv = await db.prepare('SELECT * FROM leaves WHERE id=?').get(params.id);
  await db.prepare('UPDATE leaves SET status=? WHERE id=?').run(b.status, params.id);
  if (lv) await notify(lv.user_id, { type: 'leave', title: `Leave request ${b.status === 'approved' ? 'approved ✅' : 'rejected ❌'}`, body: `${lv.from_date} → ${lv.to_date}`, link_page: 'myrequests', actor_name: user.name });
  send(res, 200, { ok: true });
};

// ================= ROLE PERMISSIONS (admin-managed section visibility) =================
// Admin reads the full matrix of hidden sections per role
api['GET /api/permissions'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = await db.prepare('SELECT role,page,visible FROM role_perms').all();
  const hidden = {}; // { role: [pages hidden] }
  rows.forEach((r) => { if (!r.visible) { (hidden[r.role] = hidden[r.role] || []).push(r.page); } });
  send(res, 200, { hidden });
};
// Admin flips a single (role,page) toggle
api['PUT /api/permissions'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.role || !b.page) return send(res, 400, { error: 'role and page required' });
  if (b.role === 'admin') return send(res, 400, { error: 'admin always has full access' });
  const vis = b.visible ? 1 : 0;
  await db.prepare(`INSERT INTO role_perms (role,page,visible) VALUES (?,?,?)
    ON CONFLICT(role,page) DO UPDATE SET visible=excluded.visible`).run(b.role, b.page, vis);
  send(res, 200, { ok: true });
};
// Any signed-in user gets the list of sections hidden for THEIR role (admin: none)
api['GET /api/my-permissions'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, { hidden: [] });
  const rows = await db.prepare('SELECT page FROM role_perms WHERE role=? AND visible=0').all(user.role);
  send(res, 200, { hidden: rows.map((r) => r.page) });
};

// ================= CONFIGURATION (settings) =================
api['GET /api/settings'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const rows = await db.prepare('SELECT key,value FROM settings').all();
  const out = {}; rows.forEach((r) => { out[r.key] = r.value; });
  // The zone the timesheet is kept in, so the clock on the screen and the row it
  // writes cannot disagree — even on a phone set to somewhere else.
  out.studio_tz = STUDIO_TZ;
  send(res, 200, out);
};
api['PUT /api/settings'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  // one prepared statement, run per setting
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(b || {})) await up.run(k, v == null ? '' : String(v));
  send(res, 200, { ok: true });
};

// ================= WHERE THE DATA LIVES =================
// A volume that is mounted but not pointed at is the same as no volume at all,
// and the difference is invisible until a redeploy has already taken the data.
// The app says which of the two it is, rather than the studio having to read it
// off a hosting dashboard.
// ================= THE STUDIO PIN FROM A SHORT LINK =================
// Sharing a place from the Google Maps app gives a maps.app.goo.gl link, which
// carries an identifier and no coordinates — those only appear in the address it
// redirects to. The browser cannot look: Google answers it without the header
// that would let another site read the reply. The server has no such limit, so
// the expanding happens here.
//
// Only Google's own shorteners are followed, and only to Google, so this cannot
// be pointed at anything else.
const SHORTENERS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.google.com']);
const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|(^|\.)g\.co$/i;

// Follow redirects and hand back the address they end at, plus the first slice
// of the page — a place link sometimes carries its coordinates only in the body.
function followLink(start, hops = 6) {
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(start); } catch (e) { return reject(new Error('That is not a link.')); }
    if (url.protocol !== 'https:' || !GOOGLE_HOST.test(url.hostname)) {
      return reject(new Error('Only Google Maps links can be opened here.'));
    }
    const req2 = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } }, (r) => {
      const next = r.headers.location;
      if (next && r.statusCode >= 300 && r.statusCode < 400) {
        r.resume(); // drop the body, we only wanted the header
        if (!hops) return reject(new Error('This link redirects too many times.'));
        return resolve(followLink(new URL(next, url).toString(), hops - 1));
      }
      // Enough of the page to find a coordinate, and not a byte more. A place
      // page runs to several hundred kilobytes and states its position well in,
      // so the ceiling has to clear that while still being a ceiling.
      const CAP = 1024 * 1024;
      let body = '';
      r.on('data', (c) => { body += c; if (body.length > CAP) { body = body.slice(0, CAP); r.destroy(); } });
      r.on('close', () => resolve({ url: url.toString(), body }));
      r.on('error', () => resolve({ url: url.toString(), body }));
    });
    req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('Google did not answer in time.')); });
    req2.on('error', () => reject(new Error('Could not reach Google Maps.')));
  });
}

// The same patterns the Configuration screen reads a long link with.
function latLngIn(text) {
  const N = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const pats = [
    new RegExp('!3d' + N + '.*?!4d' + N),
    new RegExp('@' + N + ',' + N),
    new RegExp('[?&](?:q|ll|sll|daddr|center|destination)=' + N + '(?:,|%2C)\\s*' + N, 'i'),
    new RegExp('\\[null,null,' + N + ',' + N + '\\]'), // how a place page states it in its own data
  ];
  for (const p of pats) {
    const m = String(text || '').match(p);
    if (!m) continue;
    const la = parseFloat(m[1]), ln = parseFloat(m[2]);
    if (isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
      return { lat: la.toFixed(6), lng: ln.toFixed(6) };
    }
  }
  return null;
}

api['POST /api/geo/resolve'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const link = String((b && b.link) || '').trim();
  let host = '';
  try { host = new URL(link).hostname; } catch (e) { return send(res, 400, { error: 'That is not a link.' }); }
  if (!SHORTENERS.has(host) && !GOOGLE_HOST.test(host)) {
    return send(res, 400, { error: 'That is not a Google Maps link.' });
  }
  let page;
  try { page = await followLink(link); }
  catch (e) { return send(res, 502, { error: e.message }); }
  const hit = latLngIn(page.url) || latLngIn(page.body);
  if (!hit) {
    return send(res, 404, { error: 'That link opened, but it carries no pin. Long-press the exact spot on the map, then Share → Copy link.' });
  }
  send(res, 200, hit);
};

api['GET /api/storage'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const appDir = path.resolve(__dirname);
  const dataDir = path.resolve(path.dirname(DB_PATH));
  // Inside the app's own folder means it ships with the code and is replaced
  // along with it on every deploy.
  const inApp = dataDir === path.join(appDir, 'data') || dataDir.startsWith(appDir + path.sep);
  const uploadsInApp = path.resolve(UPLOAD_DIR).startsWith(appDir + path.sep);
  const photos = listUploads();
  send(res, 200, {
    data_dir: dataDir,
    upload_dir: path.resolve(UPLOAD_DIR),
    data_dir_set: !!process.env.DATA_DIR,
    upload_dir_set: !!process.env.UPLOAD_DIR,
    persistent: !inApp,
    uploads_persistent: !uploadsInApp,
    // What a photo download would contain. On blob storage the photos are
    // already at addresses of their own and there is nothing here to pack.
    photos: store.BLOB ? null : photos.length,
    photos_bytes: store.BLOB ? null : photos.reduce((n, f) => n + f.size, 0),
  });
};

// Every file sitting in UPLOAD_DIR, newest last. Not the database's idea of
// which photos exist — the disk's, so nothing is left behind.
function listUploads() {
  try {
    return fs.readdirSync(UPLOAD_DIR)
      .map((name) => {
        const full = path.join(UPLOAD_DIR, name);
        try { const s = fs.statSync(full); return s.isFile() ? { full, size: s.size } : null; }
        catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (e) { return []; }
}

// ================= BACKUP =================
// Hosting without a persistent volume keeps the database inside the container,
// where a redeploy resets it. Until there is a volume, the studio's copy of its
// own data is whatever it has downloaded, so both formats are one tap away.
function backupName(ext) {
  const d = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  return `daliessa-backup-${d}.${ext}`;
}
// The real thing: the SQLite file, restored by putting it back in DATA_DIR.
api['GET /api/backup'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  // WAL mode keeps recent writes beside the database; fold them in so the copy
  // is not missing today's work.
  try { await db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* nothing to fold */ }
  // A hosted database is not a file on this machine, so there is nothing to copy:
  // the JSON backup is the one that works everywhere, and restores the same way.
  if (process.env.TURSO_DATABASE_URL) {
    return send(res, 400, { error: 'This copy keeps its data in a hosted database. Use "Readable copy (JSON)" — Restore takes it back.' });
  }
  let data; try { data = fs.readFileSync(DB_PATH); } catch (e) { return send(res, 500, { error: 'Could not read the database' }); }
  send(res, 200, data, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${backupName('db')}"`,
    'Content-Length': data.length,
  });
};
// The readable one: every table as JSON, so the data can still be read by a
// person (or another program) with no SQLite tooling at hand.
api['GET /api/backup.json'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = { exported_at: new Date().toISOString(), tables: {} };
  for (const { name } of tables) {
    const rows = await db.prepare(`SELECT * FROM ${name}`).all();
    // Password hashes are not the studio's data to carry around in a plain file.
    if (name === 'users') rows.forEach((r) => { delete r.password_hash; delete r.invite_token; });
    out.tables[name] = rows;
  }
  send(res, 200, JSON.stringify(out, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${backupName('json')}"`,
  });
};

// The photos. A backup holds the studio's records; these are the fabric shots,
// the fittings and the receipts, and they live as files rather than rows — so
// leaving a host without them means losing them. One archive, one download.
api['GET /api/uploads.zip'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  if (store.BLOB) {
    return send(res, 400, { error: 'The photos are on blob storage, each at an address of its own, so there is nothing here to pack.' });
  }
  const files = listUploads();
  if (!files.length) return send(res, 404, { error: 'There are no photos on this copy yet.' });
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${backupName('zip').replace('backup', 'photos')}"`,
  });
  try { await writeZip(res, files.map((f) => f.full)); }
  catch (e) { res.destroy(); } // headers are already out; the truncated file is the error
};

// Putting a backup back from the phone. Hosting without a volume means a
// redeploy starts the app on an empty database, and the studio has no terminal
// to run the restore script on — so the file goes back in the same way it came
// out. Rows whose id is taken are skipped, so this cannot overwrite work done
// since the backup, and running it twice changes nothing the second time.
api['POST /api/restore'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const payload = b && b.backup ? b.backup : b;
  if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) {
    return send(res, 400, { error: 'That file does not look like a backup.' });
  }
  try {
    const r = await restore(payload, { replace: !!b.replace });
    if (!r.written && !r.skipped) return send(res, 400, { error: 'Nothing in that file matches this app.' });
    // A backup taken before the clock was put right carries shifts recorded in
    // UTC. They come back unmarked, so correct them now rather than at the next
    // restart — the person is standing here looking at the result.
    let tz = null;
    try { tz = await fixAttendanceTz(db, STUDIO_TZ); } catch (e) { /* the timesheet is still there */ }
    send(res, 200, { ...r, attendanceCorrected: tz ? tz.corrected : 0 });
  } catch (e) {
    send(res, 500, { error: 'Restore failed, nothing was written: ' + e.message });
  }
};

// ================= STAFF HR: ABSENCES / ADVANCES / SALARY =================
api['GET /api/absences'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return;
  const uid = user.role === 'admin' ? url.searchParams.get('user_id') : user.id; // non-admin: own only
  const q = uid ? 'SELECT a.*,u.name user_name FROM absences a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY date DESC'
    : 'SELECT a.*,u.name user_name FROM absences a JOIN users u ON u.id=a.user_id ORDER BY date DESC';
  send(res, 200, uid ? await db.prepare(q).all(uid) : await db.prepare(q).all());
};
api['POST /api/absences'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  const uid = user.role === 'admin' ? b.user_id : user.id; // staff report their own absence (pending until admin confirms)
  if (!uid || !b.date) return send(res, 400, { error: 'date required' });
  const status = user.role === 'admin' ? 'confirmed' : 'pending';
  const r = await db.prepare('INSERT INTO absences (user_id,date,reason,status) VALUES (?,?,?,?)').run(uid, b.date, b.reason || null, status);
  if (user.role !== 'admin') await notifyRoles('admin', { type: 'absence', title: `${user.name} reported an absence`, body: `${b.date}${b.reason ? ' · ' + b.reason : ''}`, link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/absences/:id/confirm'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const ab = await db.prepare('SELECT * FROM absences WHERE id=?').get(params.id);
  await db.prepare("UPDATE absences SET status='confirmed' WHERE id=?").run(params.id);
  if (ab) await notify(ab.user_id, { type: 'absence', title: 'Absence confirmed', body: `${ab.date}`, link_page: 'myrequests', actor_name: user.name });
  send(res, 200, { ok: true });
};
api['DELETE /api/absences/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM absences WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// manual salary adjustments (bonus / deduction) per month
api['GET /api/adjustments'] = async (req, res, user, url) => {
  if (!requireAdmin(user, res)) return;
  const uid = url.searchParams.get('user_id');
  const q = uid ? 'SELECT * FROM salary_adjustments WHERE user_id=? ORDER BY created_at DESC'
    : 'SELECT a.*,u.name user_name FROM salary_adjustments a JOIN users u ON u.id=a.user_id ORDER BY created_at DESC';
  send(res, 200, uid ? await db.prepare(q).all(uid) : await db.prepare(q).all());
};
api['POST /api/adjustments'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.user_id || !b.amount) return send(res, 400, { error: 'staff and amount required' });
  const type = b.type === 'deduction' ? 'deduction' : 'bonus';
  const r = await db.prepare('INSERT INTO salary_adjustments (user_id,month,amount,type,note) VALUES (?,?,?,?,?)').run(b.user_id, b.month || null, b.amount, type, b.note || null);
  await notify(b.user_id, { type: 'salary', title: type === 'bonus' ? `Bonus ${money0(b.amount)} 🎉` : `Deduction ${money0(b.amount)}`, body: b.note || '', link_page: 'mysalary', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/adjustments/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM salary_adjustments WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

/* YYYY-MM plus n months. Done on the numbers, because a Date would drag a
   timezone into something that is only ever a year and a month. */
function addMonths(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  const t = (y * 12) + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/* An advance and its instalments come back as one thing: the plan, with the
   months under it, how many have come off a salary, and whether that is all of
   them. A plain one-off advance has no instalments and is its own plan. */
function advanceShape(parent, kids) {
  const parts = kids.slice().sort((a, b) => String(a.month || '').localeCompare(String(b.month || '')));
  const paid = parts.filter((p) => p.paid).length;
  const total = parts.length ? parts.reduce((a, p) => a + (p.amount || 0), 0) : (parent.amount || 0);
  return {
    ...parent,
    total,
    instalments: parts.length || 1,
    paid_count: parts.length ? paid : (parent.paid ? 1 : 0),
    paid_amount: parts.length ? parts.filter((p) => p.paid).reduce((a, p) => a + (p.amount || 0), 0) : (parent.paid ? parent.amount : 0),
    complete: parts.length ? (paid === parts.length) : !!parent.paid,
    parts,
  };
}
api['GET /api/advances'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return;
  const uid = user.role === 'admin' ? url.searchParams.get('user_id') : user.id; // non-admin: own only
  const q = uid ? 'SELECT a.*,u.name user_name FROM advances a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY a.created_at DESC, a.id DESC'
    : 'SELECT a.*,u.name user_name FROM advances a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC, a.id DESC';
  const rows = uid ? await db.prepare(q).all(uid) : await db.prepare(q).all();
  const kids = {};
  rows.forEach((r) => { if (r.parent_id) (kids[r.parent_id] = kids[r.parent_id] || []).push(r); });
  send(res, 200, rows.filter((r) => !r.parent_id).map((r) => advanceShape(r, kids[r.id] || [])));
};
api['POST /api/advances'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  const uid = user.role === 'admin' ? b.user_id : user.id;
  if (!uid || !b.amount) return send(res, 400, { error: 'amount required' });
  // admin creates approved advances; staff request pending ones (deduct from current month once approved)
  const status = user.role === 'admin' ? (b.status || 'approved') : 'pending';
  const month = user.role === 'admin' ? (b.month || null) : new Date().toISOString().slice(0, 7);
  // Split over several months: one plan, and a row per month for the salary to
  // find. The division is to the piastre and whatever is left over rides on the
  // last instalment, so the parts always add back up to what was handed over.
  const n = Math.max(1, Math.min(36, Number(b.instalments) || 1));
  if (n > 1 && user.role === 'admin') {
    const total = Number(b.amount) || 0;
    const each = Math.round((total / n) * 100) / 100;
    const start = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? String(b.month) : studioNow().date.slice(0, 7);
    const p = await db.prepare('INSERT INTO advances (user_id,amount,month,note,status,instalments) VALUES (?,?,NULL,?,?,?)')
      .run(uid, total, b.note || null, status, n);
    const pid = p.lastInsertRowid;
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const amt = i === n - 1 ? Math.round((total - placed) * 100) / 100 : each;
      placed = Math.round((placed + amt) * 100) / 100;
      await db.prepare('INSERT INTO advances (user_id,amount,month,note,status,parent_id) VALUES (?,?,?,?,?,?)')
        .run(uid, amt, addMonths(start, i), b.note || null, status, pid);
    }
    await notify(uid, { type: 'advance', title: `An advance of ${money0(total)} over ${n} month(s)`, body: `${money0(each)} a month from ${addMonths(start, 0)}`, link_page: 'me', actor_name: user.name });
    return send(res, 200, { id: pid, instalments: n });
  }
  const r = await db.prepare('INSERT INTO advances (user_id,amount,month,note,status) VALUES (?,?,?,?,?)').run(uid, b.amount, month, b.note || null, status);
  if (user.role !== 'admin') await notifyRoles('admin', { type: 'advance', title: `Advance request from ${user.name}`, body: money0(b.amount), link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/advances/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const adv = await db.prepare('SELECT * FROM advances WHERE id=?').get(params.id);
  const st = b.status === 'approved' ? 'approved' : 'rejected';
  await db.prepare('UPDATE advances SET status=? WHERE id=?').run(st, params.id);
  if (adv) await notify(adv.user_id, { type: 'advance', title: `Advance request ${st === 'approved' ? 'approved ✅' : 'rejected ❌'}`, body: money0(adv.amount), link_page: 'myrequests', actor_name: user.name });
  send(res, 200, { ok: true });
};
/* Ticking an instalment off by hand, for a month whose salary was handed over
   without being recorded here. */
api['PUT /api/advances/:id/paid'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  await db.prepare('UPDATE advances SET paid=? WHERE id=?').run(b.paid ? 1 : 0, params.id);
  send(res, 200, { ok: true });
};
/* Deleting a plan takes its instalments with it — they are not advances of their
   own and leaving them behind would keep deducting for something that is gone. */
api['DELETE /api/advances/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  await db.prepare('DELETE FROM advances WHERE parent_id=?').run(params.id);
  await db.prepare('DELETE FROM advances WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// Auto salary breakdown for a staff member in a given month (YYYY-MM). Admin, or the staff themselves.
api['GET /api/staff/:id/salary'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  if (user.role !== 'admin' && user.id !== Number(params.id)) return send(res, 403, { error: 'forbidden' });
  const month = url.searchParams.get('month') || studioNow().date.slice(0, 7);
  const u = await db.prepare('SELECT id,name,base_salary,off_days,shift_start,shift_end FROM users WHERE id=?').get(params.id);
  if (!u) return send(res, 404, { error: 'not found' });
  const cfg = {}; (await db.prepare('SELECT key,value FROM settings').all()).forEach((r) => { cfg[r.key] = r.value; });
  const base = Number(u.base_salary) || 0;
  // This person's hours if they have their own, the studio's otherwise. Both
  // lateness and overtime are measured from these, so somebody whose day starts
  // at eleven is neither late every morning nor paid overtime from eight.
  const shiftIn = u.shift_start || cfg.check_in_time || '09:00';
  const shiftOut = u.shift_end || cfg.check_out_time || '17:00';
  const inMin = hm2min(shiftIn);
  const outMin = hm2min(shiftOut);
  const grace = Number(cfg.late_grace_min) || 0;
  const otMult = Number(cfg.overtime_mult) || 1.5;
  const workHours = Math.max(1, (outMin - inMin) / 60);
  const off = new Set((u.off_days || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  // A month is read day by day rather than counted from the rows that happen to
  // exist. A day nobody recorded anything for is an absence — that is what the
  // studio means by one — and nothing has to be entered for it to count.
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  // Two divisors, because two different questions are being asked.
  //
  // What a day is worth, for an absence: the salary spread over the whole month.
  // Sundays are paid and so is approved leave, so a month that pays for all
  // thirty of its days is valued over thirty, and a day missed costs a thirtieth.
  const wd = Number(cfg.work_days_per_month) || lastDay;
  const daily = wd ? base / wd : 0;
  //
  // What an hour is worth, for overtime: the salary over the hours actually owed
  // — the days somebody is expected in, times the length of their day. September
  // asks for twenty-six days of nine hours, so an hour is a two-hundred-and-
  // thirty-fourth of the month, which is what the studio's own timesheet pays.
  let owedDays = 0;
  for (let d = 1; d <= lastDay; d++) {
    if (!off.has(weekdayOf(`${month}-${String(d).padStart(2, '0')}`))) owedDays++;
  }
  if (!owedDays) owedDays = wd;
  const hourly = base / (owedDays * workHours);
  // Nobody is absent on a day that has not happened. This is what makes the
  // figure move with each check-in rather than only at the end of the month.
  const today = studioNow().date;
  const stop = `${month}-${String(lastDay).padStart(2, '0')}` <= today
    ? `${month}-${String(lastDay).padStart(2, '0')}` : today;

  const att = {};
  for (const a of await db.prepare('SELECT date,check_in,check_out,extra_hours,extra_note FROM attendance WHERE user_id=? AND substr(date,1,7)=?').all(params.id, month)) att[a.date] = a;
  const marked = new Set((await db.prepare("SELECT date FROM absences WHERE user_id=? AND substr(date,1,7)=? AND (status IS NULL OR status='confirmed')").all(params.id, month)).map((a) => a.date));
  // Approved leave. Annual and sick are paid and cost nothing; unpaid is a day
  // off that is still a day unpaid, so it is deducted like an absence.
  const leave = {};
  for (const l of await db.prepare("SELECT from_date,to_date,type FROM leaves WHERE user_id=? AND (status IS NULL OR status='approved')").all(params.id)) {
    for (let d = 1; d <= lastDay; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      if (iso >= String(l.from_date).slice(0, 10) && iso <= String(l.to_date).slice(0, 10)) leave[iso] = l.type || 'annual';
    }
  }

  const days = [];
  let absDays = 0, presentDays = 0, offDays = 0, paidLeaveDays = 0, lateMin = 0, otMin = 0, extraHours = 0;
  for (let d = 1; d <= lastDay; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const a = att[date];
    const row = { date, weekday: weekdayOf(date), check_in: (a && a.check_in) || null, check_out: (a && a.check_out) || null, late_min: 0, ot_min: 0 };
    if (date > stop) { row.status = 'future'; days.push(row); continue; }
    // Work done away from the studio counts whatever the day itself turned out
    // to be — it is paid for the hours, not for being here.
    if (a && Number(a.extra_hours) > 0) {
      row.extra_hours = Number(a.extra_hours);
      row.extra_note = a.extra_note || null;
      extraHours += row.extra_hours;
    }

    if (a && a.check_in) {
      row.status = 'present'; presentDays++;
      const late = hm2min(a.check_in) - inMin;
      if (!off.has(row.weekday) && late > grace) { row.late_min = late - grace; lateMin += row.late_min; }
      if (a.check_out) { const ot = hm2min(a.check_out) - outMin; if (!off.has(row.weekday) && ot > 0) { row.ot_min = ot; otMin += ot; } }
    } else if (off.has(row.weekday)) {
      row.status = 'off'; offDays++;
    } else if (leave[date] && leave[date] !== 'unpaid') {
      row.status = 'paid_leave'; row.leave_type = leave[date]; paidLeaveDays++;
    } else if (leave[date] === 'unpaid') {
      row.status = 'unpaid_leave'; absDays++;
    } else if (date === today) {
      // Today is not over. Somebody who has not checked in yet has not missed
      // anything — the day decides itself this evening, and until then it is
      // neither absent nor paid. A day off or a day of leave is known whatever
      // the hour, so those are settled above and this only catches a working day
      // still in progress.
      row.status = 'today';
    } else {
      // Marked by hand or simply never turned up — the same thing on the sheet.
      row.status = 'absent'; row.recorded = marked.has(date); absDays++;
    }
    days.push(row);
  }

  const advTotal = (await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM advances WHERE user_id=? AND month=? AND (status IS NULL OR status='approved')").get(params.id, month)).s;
  const bonus = (await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM salary_adjustments WHERE user_id=? AND month=? AND type='bonus'").get(params.id, month)).s;
  const deductions = (await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM salary_adjustments WHERE user_id=? AND month=? AND type='deduction'").get(params.id, month)).s;
  const r2 = (x) => Math.round(x * 100) / 100;
  const absenceDeduction = r2(daily * absDays);
  const lateDeduction = r2((lateMin / 60) * hourly);
  const overtimePay = r2((otMin / 60) * otMult * hourly);
  // At the plain rate: the studio's sheet keeps this on a line of its own, apart
  // from the overtime it pays at one and a half.
  const extraTaskPay = r2(extraHours * hourly);
  const net = r2(base + bonus + overtimePay + extraTaskPay - absenceDeduction - lateDeduction - advTotal - deductions);
  // What the month is worth so far: the days already paid for, rather than the
  // whole salary with the missing days taken back off it. Same arithmetic at the
  // end of the month, but it reads correctly in the middle of one.
  const paidDays = presentDays + offDays + paidLeaveDays;
  const earnedToDate = r2(daily * paidDays + bonus + overtimePay + extraTaskPay - lateDeduction - advTotal - deductions);

  send(res, 200, {
    user: u.name, month, base, work_days: wd, days_in_month: lastDay, owed_days: owedDays,
    daily: r2(daily), hourly: r2(hourly), work_hours: workHours,
    shift_start: shiftIn, shift_end: shiftOut, shift_is_own: !!(u.shift_start || u.shift_end),
    absent_days: absDays, absence_deduction: absenceDeduction,
    present_days: presentDays, off_days: offDays, paid_leave_days: paidLeaveDays,
    late_minutes: lateMin, late_deduction: lateDeduction, overtime_minutes: otMin, overtime_pay: overtimePay, overtime_mult: otMult,
    extra_hours: r2(extraHours), extra_task_pay: extraTaskPay,
    bonus, deductions, advances: advTotal, net,
    as_of: stop, earned_to_date: earnedToDate, paid_days: paidDays, days,
  });
};

// ================= DRESS MATERIAL PURCHASES (invoices + dress-linked lines) =================
api['GET /api/purchases'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const invs = await db.prepare(`SELECT pi.*, (SELECT name FROM vendors WHERE id=pi.vendor_id) vendor_name,
    (SELECT name FROM users WHERE id=pi.paid_by) paid_by_name FROM purchase_invoices pi ORDER BY pi.id DESC`).all();
  for (const inv of invs) {
    inv.lines = await db.prepare('SELECT l.*, (SELECT customer_name FROM dresses WHERE id=l.dress_id) dress_name FROM purchase_lines l WHERE l.invoice_id=?').all(inv.id);
    inv.total = inv.lines.reduce((a, x) => a + (x.amount || 0), 0);
  }
  send(res, 200, invs);
};
api['POST /api/purchases'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  // every invoice carries who it is from; without it the spending belongs to
  // nobody and never reaches a vendor's report
  const shopName = String(b.shop || '').trim();
  if (!b.vendor_id && !shopName) return send(res, 400, { error: 'a vendor or a shop name is required' });
  const img = await maybeImage(b.image);
  const vid = b.vendor_id || await vendorIdForShop(b.shop); // a typed shop that is already a supplier
  const r = await db.prepare('INSERT INTO purchase_invoices (shop,vendor_id,image,note,invoice_date,created_by,paid_by) VALUES (?,?,?,?,?,?,?)').run(b.shop || null, vid, img, b.note || null, b.invoice_date || null, user.id, b.paid_by || null);
  const invId = r.lastInsertRowid;
  for (const li of (Array.isArray(b.lines) ? b.lines : [])) {
    if (li && (li.dress_id || li.amount)) await db.prepare('INSERT INTO purchase_lines (invoice_id,dress_id,item,amount) VALUES (?,?,?,?)').run(invId, li.dress_id || null, li.item || null, li.amount || 0);
  }
  send(res, 200, { id: invId });
};
api['PUT /api/purchases/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req); const c = await db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const img = (b.image && b.image.startsWith('data:')) ? await maybeImage(b.image) : (b.image ?? c.image);
  const shop = b.shop ?? c.shop;
  const vendorId = b.vendor_id !== undefined ? b.vendor_id : (c.vendor_id || await vendorIdForShop(shop));
  await db.prepare('UPDATE purchase_invoices SET shop=?,vendor_id=?,note=?,invoice_date=?,image=?,paid_by=? WHERE id=?').run(shop, vendorId, b.note ?? c.note, b.invoice_date ?? c.invoice_date, img, b.paid_by !== undefined ? b.paid_by : c.paid_by, params.id);
  send(res, 200, { ok: true });
};
// Move a mis-filed item to the dress it really belongs to (or off a dress entirely)
api['PUT /api/purchase-lines/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const line = await db.prepare('SELECT * FROM purchase_lines WHERE id=?').get(params.id);
  if (!line) return send(res, 404, { error: 'not found' });
  await db.prepare('UPDATE purchase_lines SET dress_id=?,item=?,amount=? WHERE id=?')
    .run(b.dress_id === null ? null : (b.dress_id ?? line.dress_id), b.item ?? line.item, b.amount ?? line.amount, params.id);
  send(res, 200, { ok: true });
};
// Items are added to and taken off an invoice after the fact — a forgotten roll
// of tulle, a line entered twice. The invoice total is the sum of its lines, so
// both keep it honest without the total being stored anywhere.
api['POST /api/purchases/:id/lines'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  if (!await db.prepare('SELECT id FROM purchase_invoices WHERE id=?').get(params.id)) return send(res, 404, { error: 'not found' });
  const r = await db.prepare('INSERT INTO purchase_lines (invoice_id,dress_id,item,amount) VALUES (?,?,?,?)')
    .run(params.id, b.dress_id || null, b.item || null, Number(b.amount) || 0);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/purchase-lines/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  await db.prepare('DELETE FROM purchase_lines WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/purchases/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  await db.prepare('DELETE FROM purchase_lines WHERE invoice_id=?').run(params.id);
  await db.prepare('DELETE FROM purchase_invoices WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= SALARY DISBURSEMENTS (admin sends, staff confirms) =================
api['GET /api/salary-payments'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return;
  const uid = user.role === 'admin' ? url.searchParams.get('user_id') : user.id; // non-admin: own only
  const q = uid ? 'SELECT s.*,u.name user_name FROM salary_payments s JOIN users u ON u.id=s.user_id WHERE s.user_id=? ORDER BY s.created_at DESC'
    : 'SELECT s.*,u.name user_name FROM salary_payments s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC';
  send(res, 200, uid ? await db.prepare(q).all(uid) : await db.prepare(q).all());
};
/* A salary that has gone out, written into the studio costs where it belongs.
   It is dated to the month it is FOR, not the day it was sent: a September wage
   paid in October is September's cost, or every month's figure reads wrong.
   paid_by is left empty — wages go from the bank, never from somebody's float. */
async function addSalaryCost(payId, userId, month, amount) {
  const who = await db.prepare('SELECT name FROM users WHERE id=?').get(userId);
  const m = String(month || '').slice(0, 7);
  const date = /^\d{4}-\d{2}$/.test(m)
    ? new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10)
    : studioNow().date;
  await db.prepare('INSERT INTO expenses (type,amount,date,note,salary_payment_id) VALUES (?,?,?,?,?)')
    .run('Salaries', amount || 0, date, `${(who && who.name) || 'Staff'}${m ? ' · ' + m : ''} salary`, payId);
}
api['POST /api/salary-payments'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.user_id) return send(res, 400, { error: 'staff required' });
  // one shape for a month, always — a month written the other way round is
  // recognised by nothing afterwards
  const month = normMonth(b.month);
  // The same salary sent twice is the same money counted twice, in her record
  // and in the studio costs both. It is refused until the first one is dealt
  // with, or until somebody says plainly that a second payment is meant.
  if (month && !b.force) {
    const dup = await db.prepare('SELECT id,amount FROM salary_payments WHERE user_id=? AND month=?').get(b.user_id, month);
    if (dup) {
      const who = await db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id);
      return send(res, 409, {
        error: `${(who && who.name) || 'She'} was already sent ${money0(dup.amount)} for ${monthName(month)}. Delete that one first, or send this as a second payment for the same month.`,
        duplicate: { id: dup.id, amount: dup.amount, month },
      });
    }
  }
  const img = await maybeImage(b.image);
  const r = await db.prepare('INSERT INTO salary_payments (user_id,month,amount,image,note) VALUES (?,?,?,?,?)').run(b.user_id, month, b.amount || 0, img, b.note || null);
  // That month's salary has gone out, and this month's instalment came off it —
  // so it is paid, without anybody having to remember to say so.
  if (month) await db.prepare('UPDATE advances SET paid=1 WHERE user_id=? AND month=? AND paid=0').run(b.user_id, month);
  // Wages are a studio cost like any other, and always go from the bank — so the
  // payment writes its own cost rather than waiting to be typed in twice.
  await addSalaryCost(r.lastInsertRowid, b.user_id, month, b.amount || 0);
  // The month it is for, and the payment itself, so tapping the notification
  // opens her salary on that month rather than on whichever one it happens to be
  // today — a salary for September read in October shows an empty screen.
  await notify(b.user_id, {
    type: 'salary',
    title: `Your ${monthName(month)} salary · ${money0(b.amount)} 💵`,
    body: 'Tap to open it and confirm you received it',
    link_page: 'mysalary', link_id: r.lastInsertRowid, actor_name: user.name,
  });
  send(res, 200, { id: r.lastInsertRowid });
};
// staff (owner) confirms receipt; admin may also confirm
api['PUT /api/salary-payments/:id/confirm'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return;
  const p = await db.prepare('SELECT * FROM salary_payments WHERE id=?').get(params.id);
  if (!p) return send(res, 404, { error: 'not found' });
  if (user.role !== 'admin' && p.user_id !== user.id) return send(res, 403, { error: 'forbidden' });
  await db.prepare("UPDATE salary_payments SET status='confirmed', confirmed_at=datetime('now') WHERE id=?").run(params.id);
  if (user.role !== 'admin') await notifyRoles('admin', { type: 'salary', title: `${user.name} confirmed salary receipt ✅`, body: money0(p.amount), link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/salary-payments/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  await db.prepare('DELETE FROM salary_payments WHERE id=?').run(params.id);
  // the cost it wrote goes with it — a wage that was never paid is not a cost
  await db.prepare('DELETE FROM expenses WHERE salary_payment_id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= THE BOOKS (money in against money out) =================
// One statement for the whole place: the two houses on the income side, the
// materials and the studio's own costs on the other, and what is left.
//
// Month by month it is counted the way a studio counts — on the money that
// moved: a payment belongs to the month it came in, an invoice and a cost to
// the month they are dated. That is the only basis the records can carry
// honestly, because a dress is not earned on any one day.
//
// Beside it, what everything is WORTH: the full price of every dress and every
// course fee, whether or not it has been paid for yet, less the same costs. The
// two answer different questions and are never mixed into one number.
api['GET /api/books'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const m = (d) => String(d || '').slice(0, 7);
  const bucket = {};
  const at = (k) => (bucket[k] = bucket[k] || { dresses: 0, courses: 0, materials: 0, studio: 0 });
  const add = (rows, field) => rows.forEach((r) => { const k = m(r.d); if (/^\d{4}-\d{2}$/.test(k)) at(k)[field] += Number(r.v) || 0; });

  add(await db.prepare('SELECT amount v, COALESCE(paid_at,created_at) d FROM dress_payments').all(), 'dresses');
  add(await db.prepare('SELECT amount v, COALESCE(paid_at,created_at) d FROM payments').all(), 'courses');
  add(await db.prepare(`SELECT COALESCE(i.invoice_date,i.created_at) d,
    (SELECT COALESCE(SUM(amount),0) FROM purchase_lines WHERE invoice_id=i.id) v FROM purchase_invoices i`).all(), 'materials');
  add(await db.prepare('SELECT amount v, COALESCE(date,created_at) d FROM expenses').all(), 'studio');

  const shape = (b) => {
    const income = b.dresses + b.courses;
    const cost = b.materials + b.studio;
    return { ...b, income, cost, net: income - cost, margin: income ? (income - cost) / income : 0 };
  };
  const months = Object.keys(bucket).sort().reverse();
  const by = {};
  for (const k of months) by[k] = shape(bucket[k]);
  const sum = months.reduce((a, k) => {
    for (const f of ['dresses', 'courses', 'materials', 'studio']) a[f] += bucket[k][f];
    return a;
  }, { dresses: 0, courses: 0, materials: 0, studio: 0 });

  // What is still owed is worked out per dress and per student: somebody who
  // overpaid must not cancel out somebody who has not paid at all.
  const dressRows = await db.prepare(`SELECT COALESCE(d.price,0) price, COALESCE(d.written_off,0) written_off,
    COALESCE((SELECT SUM(amount) FROM dress_payments WHERE dress_id=d.id),0) paid FROM dresses d`).all();
  const courseRows = await db.prepare(`SELECT COALESCE(e.total_fee,0) fee,
    COALESCE((SELECT SUM(amount) FROM payments p WHERE p.user_id=u.id),0) paid
    FROM users u LEFT JOIN enrollments e ON e.user_id=u.id WHERE u.role='trainee'`).all();
  // a dress written off really sold for what came in, and owes nothing more
  const dressValue = dressRows.reduce((a, r) => a + (r.written_off ? r.paid : r.price), 0);
  const dueDresses = dressRows.reduce((a, r) => a + (r.written_off ? 0 : Math.max(0, r.price - r.paid)), 0);
  const courseFees = courseRows.reduce((a, r) => a + r.fee, 0);
  const dueCourses = courseRows.reduce((a, r) => a + Math.max(0, r.fee - r.paid), 0);
  const worthIncome = dressValue + courseFees;
  const worthCost = sum.materials + sum.studio;

  send(res, 200, {
    months, by, all: shape(sum),
    worth: {
      dresses: dressValue, courses: courseFees, dueDresses, dueCourses,
      income: worthIncome, materials: sum.materials, studio: sum.studio, cost: worthCost,
      net: worthIncome - worthCost, margin: worthIncome ? (worthIncome - worthCost) / worthIncome : 0,
    },
  });
};

// ================= EXPENSES (vendors, types, entries) =================
// Each vendor carries its unified spend = material purchases + general expenses.
// An invoice belongs to a vendor either because it was picked from the list, or
// because the shop was typed by hand and the name is that vendor's. Only counting
// the first left real spending sitting at zero on the vendor it belonged to.
const VENDOR_MATCH = "(pi.vendor_id = ? OR (pi.vendor_id IS NULL AND TRIM(pi.shop) = TRIM(?)))";
async function vendorPurchases(vendorId, name) {
  return (await db.prepare(`SELECT COALESCE(SUM(l.amount),0) s FROM purchase_lines l
    JOIN purchase_invoices pi ON pi.id = l.invoice_id WHERE ${VENDOR_MATCH}`).get(vendorId, name || '\u0000')).s;
}
// Typing a shop that is already a supplier links the invoice to it, so the books
// tidy themselves instead of drifting further apart with every invoice.
async function vendorIdForShop(shop) {
  const s = String(shop || '').trim();
  if (!s) return null;
  const v = await db.prepare('SELECT id FROM vendors WHERE TRIM(name) = ?').get(s);
  return v ? v.id : null;
}

api['GET /api/vendors'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = await db.prepare('SELECT * FROM vendors ORDER BY name').all();
  for (const v of rows) {
    v.purchases_total = await vendorPurchases(v.id, v.name);
    v.expenses_total = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE vendor_id=?').get(v.id)).s;
    v.total = v.purchases_total + v.expenses_total;
  }
  send(res, 200, rows);
};
// Full per-vendor report: every material invoice + every expense from that vendor, with totals.
api['GET /api/vendors/:id/report'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const vendor = await db.prepare('SELECT * FROM vendors WHERE id=?').get(params.id);
  if (!vendor) return send(res, 404, { error: 'not found' });
  const purchases = await db.prepare(`SELECT pi.* FROM purchase_invoices pi WHERE ${VENDOR_MATCH}
    ORDER BY COALESCE(pi.invoice_date,pi.created_at) DESC, pi.id DESC`).all(vendor.id, vendor.name || '\u0000');
  for (const inv of purchases) {
    inv.lines = await db.prepare('SELECT l.*, (SELECT customer_name FROM dresses WHERE id=l.dress_id) dress_name FROM purchase_lines l WHERE l.invoice_id=?').all(inv.id);
    inv.total = inv.lines.reduce((a, x) => a + (x.amount || 0), 0);
  }
  const expenses = await db.prepare('SELECT * FROM expenses WHERE vendor_id=? ORDER BY COALESCE(date,created_at) DESC, id DESC').all(params.id);
  const pTotal = purchases.reduce((a, p) => a + p.total, 0);
  const eTotal = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  send(res, 200, { vendor, purchases, expenses, totals: { purchases: pTotal, expenses: eTotal, grand: pTotal + eTotal } });
};
// Shops typed onto invoices that are not suppliers yet. They hold real spending
// that shows on no vendor, so the Suppliers screen offers them for adding.
api['GET /api/vendors/unlinked-shops'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  send(res, 200, await db.prepare(`SELECT TRIM(pi.shop) shop, COALESCE(SUM(l.amount),0) total, COUNT(DISTINCT pi.id) invoices
    FROM purchase_invoices pi LEFT JOIN purchase_lines l ON l.invoice_id = pi.id
    WHERE pi.vendor_id IS NULL AND TRIM(COALESCE(pi.shop,'')) <> ''
      AND TRIM(pi.shop) NOT IN (SELECT TRIM(name) FROM vendors)
    GROUP BY TRIM(pi.shop) ORDER BY total DESC`).all());
};
/* The same shop typed two ways is two shops as far as the invoices know. This
   says they are one: every invoice still carrying the loose name joins the
   vendor, and its spending is on that vendor's report from then on. The typed
   name on the invoice is left as it was written — it is what the paper says. */
api['POST /api/vendors/link-shop'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const shop = String(b.shop || '').trim();
  const vendorId = Number(b.vendor_id);
  if (!shop || !vendorId) return send(res, 400, { error: 'which shop, and which vendor?' });
  const v = await db.prepare('SELECT id,name FROM vendors WHERE id=?').get(vendorId);
  if (!v) return send(res, 404, { error: 'no such vendor' });
  const r = await db.prepare('UPDATE purchase_invoices SET vendor_id=? WHERE vendor_id IS NULL AND TRIM(shop)=?').run(vendorId, shop);
  send(res, 200, { ok: true, moved: Number(r.changes || 0), vendor: v.name });
};

api['POST /api/vendors'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.name) return send(res, 400, { error: 'name required' });
  const r = await db.prepare('INSERT INTO vendors (name,phone,email,address,specialty,note) VALUES (?,?,?,?,?,?)')
    .run(b.name, b.phone || null, b.email || null, b.address || null, b.specialty || null, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/vendors/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const c = await db.prepare('SELECT * FROM vendors WHERE id=?').get(params.id);
  if (!c) return send(res, 404, { error: 'not found' });
  await db.prepare('UPDATE vendors SET name=?,phone=?,email=?,address=?,specialty=?,note=? WHERE id=?').run(
    b.name || c.name, b.phone ?? c.phone, b.email ?? c.email, b.address ?? c.address,
    b.specialty ?? c.specialty, b.note ?? c.note, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/vendors/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM vendors WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

api['GET /api/expense-types'] = async (req, res, user) => { if (!requireAdmin(user, res)) return; send(res, 200, await db.prepare('SELECT * FROM expense_types ORDER BY name').all()); };
api['POST /api/expense-types'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.name) return send(res, 400, { error: 'name required' });
  const r = await db.prepare('INSERT INTO expense_types (name) VALUES (?)').run(b.name);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/expense-types/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; await db.prepare('DELETE FROM expense_types WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= FLOATS (عهدة) =================
// Cash handed to somebody to keep at the studio and spend from. What she still
// holds is what was handed to her, less what she has given back, less what she
// has spent — so the figure is worked out from the movements and the spending
// marked against her, never stored and kept in step by hand.
async function floatFor(userId) {
  const row = async (sql, ...a) => Number(((await db.prepare(sql).get(...a)) || {}).t || 0);
  const handed = await row("SELECT SUM(amount) t FROM float_moves WHERE user_id=? AND kind='in'", userId);
  const back = await row("SELECT SUM(amount) t FROM float_moves WHERE user_id=? AND kind='out'", userId);
  const costs = await row('SELECT SUM(amount) t FROM expenses WHERE paid_by=?', userId);
  const invoices = await row(`SELECT SUM(l.amount) t FROM purchase_lines l
    JOIN purchase_invoices i ON i.id = l.invoice_id WHERE i.paid_by=?`, userId);
  const spent = costs + invoices;
  return { handed, back, costs, invoices, spent, balance: handed - back - spent };
}

/* Everyone currently holding a float, and everyone who could be given one */
api['GET /api/floats'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const staff = await db.prepare("SELECT id,name,role,job_title FROM users WHERE role IN ('staff','manager','admin') ORDER BY name").all();
  const held = await db.prepare('SELECT DISTINCT user_id FROM float_moves').all();
  const ids = new Set(held.map((r) => r.user_id));
  const rows = [];
  for (const s of staff) {
    if (!ids.has(s.id)) continue;
    rows.push({ ...s, ...(await floatFor(s.id)) });
  }
  rows.sort((a, b) => b.balance - a.balance);
  send(res, 200, { rows, staff });
};

/* One person's float: the cash movements and everything spent out of it, as one
   list in date order — which is how somebody checks a float against the money
   actually in the drawer. */
/* The admin, or the person holding it. Somebody carrying the studio's cash
   should be able to see what she is carrying without having to ask. */
api['GET /api/floats/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  if (user.role !== 'admin' && user.id !== Number(params.id)) return send(res, 403, { error: 'forbidden' });
  const id = Number(params.id);
  const who = await db.prepare('SELECT id,name,role,job_title FROM users WHERE id=?').get(id);
  if (!who) return send(res, 404, {});
  const moves = await db.prepare('SELECT * FROM float_moves WHERE user_id=? ORDER BY date DESC, id DESC').all(id);
  const costs = await db.prepare(`SELECT e.*, (SELECT name FROM vendors WHERE id=e.vendor_id) vendor_name
    FROM expenses e WHERE e.paid_by=? ORDER BY e.date DESC, e.id DESC`).all(id);
  const invoices = await db.prepare(`SELECT i.*, (SELECT SUM(amount) FROM purchase_lines WHERE invoice_id=i.id) total,
    (SELECT name FROM vendors WHERE id=i.vendor_id) vendor_name,
    (SELECT GROUP_CONCAT(DISTINCT d.customer_name) FROM purchase_lines l
       JOIN dresses d ON d.id = l.dress_id WHERE l.invoice_id = i.id) dress_names
    FROM purchase_invoices i WHERE i.paid_by=? ORDER BY i.invoice_date DESC, i.id DESC`).all(id);
  const when = (d) => String(d || '').slice(0, 10);
  const entries = [
    ...moves.map((m) => ({ kind: m.kind === 'out' ? 'back' : 'handed', id: m.id, amount: m.amount, date: when(m.date || m.created_at), note: m.note })),
    ...costs.map((e) => ({ kind: 'cost', id: e.id, amount: e.amount, date: when(e.date || e.created_at), note: [e.type, e.vendor_name, e.note].filter(Boolean).join(' · ') })),
    // which dress the materials went on is the thing somebody checking a float
    // actually wants to read, so it leads the line
    ...invoices.map((i) => ({ kind: 'invoice', id: i.id, amount: i.total || 0, date: when(i.invoice_date || i.created_at), note: [i.dress_names ? '👗 ' + i.dress_names : null, i.vendor_name || i.shop, i.note].filter(Boolean).join(' · ') })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  send(res, 200, { user: who, ...(await floatFor(id)), entries });
};

api['POST /api/floats'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const uid = Number(b.user_id);
  const amount = Number(b.amount);
  if (!uid || !(amount > 0)) return send(res, 400, { error: 'who and how much are both needed' });
  const kind = b.kind === 'out' ? 'out' : 'in';
  const who = await db.prepare("SELECT id,name,role FROM users WHERE id=?").get(uid);
  if (!who || !['staff', 'manager', 'admin'].includes(who.role)) return send(res, 400, { error: 'a float is held by somebody who works here' });
  const r = await db.prepare('INSERT INTO float_moves (user_id,kind,amount,date,note,created_by) VALUES (?,?,?,?,?,?)')
    .run(uid, kind, amount, b.date || null, b.note || null, user.id);
  // She should know what she is holding without having to be told
  await notify(uid, kind === 'in'
    ? { type: 'float', title: `You were given ${money0(amount)} to hold`, body: b.note || 'Cash float for studio spending', actor_name: user.name }
    : { type: 'float', title: `${money0(amount)} of your float was taken back`, body: b.note || '', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
};

api['PUT /api/floats/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const c = await db.prepare('SELECT * FROM float_moves WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const amount = b.amount != null ? Number(b.amount) : c.amount;
  if (!(amount > 0)) return send(res, 400, { error: 'how much?' });
  await db.prepare('UPDATE float_moves SET amount=?, date=?, note=?, kind=? WHERE id=?')
    .run(amount, b.date ?? c.date, b.note ?? c.note, b.kind === 'out' ? 'out' : (b.kind === 'in' ? 'in' : c.kind), params.id);
  send(res, 200, { ok: true });
};

api['DELETE /api/floats/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  await db.prepare('DELETE FROM float_moves WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

api['GET /api/expenses'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  send(res, 200, await db.prepare(`SELECT e.*, (SELECT name FROM vendors WHERE id=e.vendor_id) vendor_name,
    (SELECT name FROM users WHERE id=e.paid_by) paid_by_name FROM expenses e ORDER BY date DESC, e.id DESC`).all());
};
api['POST /api/expenses'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.amount) return send(res, 400, { error: 'amount required' });
  const img = await maybeImage(b.image);
  const r = await db.prepare('INSERT INTO expenses (vendor_id,type,amount,date,note,image,paid_by) VALUES (?,?,?,?,?,?,?)').run(b.vendor_id || null, b.type || null, b.amount, b.date || null, b.note || null, img, b.paid_by || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/expenses/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  // a wage's cost is the wage: taking it off here alone would leave the salary
  // record saying it was paid and the books saying it never cost anything
  const e = await db.prepare('SELECT salary_payment_id FROM expenses WHERE id=?').get(params.id);
  if (e && e.salary_payment_id) return send(res, 400, { error: 'This is a salary that was sent. Remove it from the staff member\'s salary record and it comes off here too.' });
  await db.prepare('DELETE FROM expenses WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= NOTIFICATIONS =================
// Raw file upload — the body IS the file, so an HD video does not have to be
// base64'd into JSON (which adds a third to its size) before it can be sent.
const UPLOAD_MAX = 400 * 1024 * 1024;
const { EXT_OK } = store;
async function receiveUpload(req, res, user) {
  if (!requireAuth(user, res)) return;
  const url = new URL(req.url, 'http://x');
  const ext = EXT_OK[String(url.searchParams.get('ext') || '').toLowerCase().replace('.', '')];
  if (!ext) return send(res, 400, { error: 'Unsupported file type' });
  // Watch the size as it arrives rather than after: a 400 MB body should be cut
  // off, not stored and then rejected.
  let size = 0, tooBig = false;
  req.on('data', (c) => { size += c.length; if (size > UPLOAD_MAX && !tooBig) { tooBig = true; req.destroy(); } });
  try {
    const ref = await store.saveStream(req, ext);
    if (tooBig) { await store.remove(ref); return send(res, 413, { error: 'File is too large (400 MB max)' }); }
    send(res, 200, { file: ref, size });
  } catch (e) {
    if (tooBig) return send(res, 413, { error: 'File is too large (400 MB max)' });
    send(res, 500, { error: 'Could not save the file' });
  }
}
// ---- Client invitations ----
function appOrigin(req) {
  const host = req.headers.host || '';
  // behind Railway the proxy tells us; locally there is no header and no TLS
  const fwd = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = fwd || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
async function makeInvite(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('UPDATE users SET invite_token=?,invite_expires=? WHERE id=?').run(token, expires, userId);
  return token;
}

// Give the client of a dress her own way in: link (or create) her account and mint a link.
api['POST /api/dresses/:id/invite-client'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return send(res, 400, { error: 'Enter a valid email' });
  const dress = await db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!dress) return send(res, 404, { error: 'Dress not found' });

  let client = await db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);
  if (!client) {
    const id = (await db.prepare('INSERT INTO users (name,email,password_hash,role,invited) VALUES (?,?,?,?,1)')
      .run(b.name || dress.customer_name, email, hashPassword(crypto.randomBytes(9).toString('hex')), 'customer')).lastInsertRowid;
    client = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
  } else if (client.role === 'visitor') {
    await db.prepare("UPDATE users SET role='customer' WHERE id=?").run(client.id); // she is a client now
  }
  await db.prepare('UPDATE dresses SET customer_user_id=? WHERE id=?').run(client.id, dress.id);

  const token = await makeInvite(client.id);
  const link = `${appOrigin(req)}/?invite=${token}`;
  let emailed = false, mailError = null;
  const gUser = process.env.GMAIL_USER, gPass = process.env.GMAIL_APP_PASSWORD;
  if (gUser && gPass) {
    try {
      await sendMail({ user: gUser, pass: gPass, to: email, subject: 'Dalia Bassel — your dress',
        text: `Dear ${client.name},\n\nYou can now follow your dress with us — the fittings, the photos and every update.\n\nOpen this link and choose a password:\n${link}\n\nThe link works for 14 days.\n\nDalia Bassel Couture` });
      emailed = true;
    } catch (e) { mailError = e.message; }
  }
  send(res, 200, { link, emailed, mail_error: mailError, client: { id: client.id, name: client.name, email } });
};

// She opens the link, picks a password, and is in. No auth needed — the token is the proof.
api['POST /api/invite/accept'] = async (req, res) => {
  const b = await readBody(req);
  const token = String(b.token || '').trim();
  const password = String(b.password || '');
  if (!token) return send(res, 400, { error: 'This link is not valid' });
  if (password.length < 6) return send(res, 400, { error: 'Choose a password of at least 6 characters' });
  const u = await db.prepare('SELECT * FROM users WHERE invite_token=?').get(token);
  if (!u || !u.active) return send(res, 400, { error: 'This link is not valid any more' });
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) return send(res, 400, { error: 'This link has expired — ask the studio for a new one' });
  await db.prepare('UPDATE users SET password_hash=?,invited=0,invite_token=NULL,invite_expires=NULL WHERE id=?').run(hashPassword(password), u.id);
  const sid = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(sid, u.id);
  await markLogin(u.id);
  send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` });
};
// Who is this link for? Shown on the set-a-password screen.
api['GET /api/invite/:token'] = async (req, res, user, url, params) => {
  const u = await db.prepare('SELECT name,email,invite_expires,active FROM users WHERE invite_token=?').get(params.token);
  if (!u || !u.active) return send(res, 404, { error: 'This link is not valid any more' });
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) return send(res, 410, { error: 'This link has expired' });
  send(res, 200, { name: u.name, email: u.email });
};

// What is on offer — the only thing a visitor may read about the academy
api['GET /api/public/rounds'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  send(res, 200, await db.prepare("SELECT id,name,start_date,kind FROM rounds WHERE active=1 ORDER BY id DESC").all());
};

// ================= CUSTOMER SERVICE CHAT =================
const CHAT_TOPICS = ['dress', 'course', 'general'];
const topicWord = { dress: 'a dress', course: 'the courses', general: 'the studio' };
const isStudio = (u) => ['admin', 'manager', 'staff'].includes(u.role);

async function threadRow(t) {
  const last = await db.prepare('SELECT body,from_studio,created_at FROM chat_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1').get(t.id);
  let brief = null; try { brief = t.brief ? JSON.parse(t.brief) : null; } catch (e) {}
  return { ...t, brief, brief_line: briefLine(brief),
    last_body: last ? last.body : null, last_from_studio: last ? last.from_studio : 0 };
}

// Studio sees every thread; anyone else sees only their own.
api['GET /api/chats'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (isStudio(user)) {
    const rows = await db.prepare(`SELECT t.*, u.name user_name, u.role user_role,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id AND m.from_studio=0 AND m.seen_by_studio=0) unread
      FROM chat_threads t JOIN users u ON u.id=t.user_id ORDER BY t.last_at DESC`).all();
    return send(res, 200, { threads: rows.map(threadRow), studio: true });
  }
  const rows = await db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id AND m.from_studio=1 AND m.seen_by_user=0) unread
    FROM chat_threads t WHERE t.user_id=? ORDER BY t.last_at DESC`).all(user.id);
  send(res, 200, { threads: rows.map(threadRow), studio: false });
};

// Start an enquiry. The first message goes with it.
// A one-line read of a dress brief, for the inbox and the notification
function briefLine(brief) {
  if (!brief) return '';
  if (brief.kind === 'course') {
    return [
      brief.round_name || 'Round not decided',
      { onsite: 'in the studio', online: 'online', either: 'either way' }[brief.mode],
      brief.start_from ? `from ${brief.start_from}` : null,
    ].filter(Boolean).join(' · ');
  }
  const bits = [
    { bridal: 'Bridal gown', evening: 'Evening gown' }[brief.garment],
    { first: 'first look', second: 'second look', both: 'both looks' }[brief.look],
    brief.event_date,
    { openair: 'open air', indoor: 'indoor venue' }[brief.venue],
    { day: 'daytime', night: 'evening' }[brief.daytime],
    brief.visit_date ? `wants ${brief.visit_date}${brief.visit_time ? ' ' + brief.visit_time : ''}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}
api['POST /api/chats'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const topic = CHAT_TOPICS.includes(b.topic) ? b.topic : 'general';
  const body = (b.body || '').trim();
  const brief = b.brief && typeof b.brief === 'object' ? b.brief : null;
  if (!body && !brief) return send(res, 400, { error: 'Write your message first' });
  const media = (b.media || []).filter((m) => m && m.file).slice(0, 12);
  const tid = (await db.prepare('INSERT INTO chat_threads (user_id,topic,subject,brief) VALUES (?,?,?,?)')
    .run(user.id, topic, b.subject || null, brief ? JSON.stringify(brief) : null)).lastInsertRowid;
  await db.prepare('INSERT INTO chat_messages (thread_id,user_id,from_studio,body,image,media,seen_by_user) VALUES (?,?,0,?,?,?,1)')
    .run(tid, user.id, body || null, await maybeImage(b.image), media.length ? JSON.stringify(media) : null);
  const line = briefLine(brief);
  await notifyRoles(['admin', 'manager', 'staff'], {
    type: 'chat', title: `${user.name} asks about ${topicWord[topic]}`,
    body: (line || body).slice(0, 90), link_page: 'chats', link_id: tid, actor_name: user.name,
  }, user.id);
  send(res, 200, { id: tid });
};

// The conversation. Opening it marks the other side's messages as seen.
api['GET /api/chats/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const t = await db.prepare('SELECT t.*,u.name user_name,u.role user_role FROM chat_threads t JOIN users u ON u.id=t.user_id WHERE t.id=?').get(params.id);
  if (!t) return send(res, 404, { error: 'not found' });
  if (!isStudio(user) && t.user_id !== user.id) return send(res, 403, { error: 'forbidden' });
  if (isStudio(user)) await db.prepare('UPDATE chat_messages SET seen_by_studio=1 WHERE thread_id=? AND from_studio=0').run(t.id);
  else await db.prepare('UPDATE chat_messages SET seen_by_user=1 WHERE thread_id=? AND from_studio=1').run(t.id);
  const messages = await db.prepare(`SELECT m.*, u.name author_name FROM chat_messages m JOIN users u ON u.id=m.user_id
    WHERE m.thread_id=? ORDER BY m.id`).all(t.id);
  messages.forEach((m) => { try { m.media = m.media ? JSON.parse(m.media) : []; } catch (e) { m.media = []; } });
  try { t.brief = t.brief ? JSON.parse(t.brief) : null; } catch (e) { t.brief = null; }
  send(res, 200, { thread: t, messages, studio: isStudio(user) });
};

api['POST /api/chats/:id/messages'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const t = await db.prepare('SELECT * FROM chat_threads WHERE id=?').get(params.id);
  if (!t) return send(res, 404, { error: 'not found' });
  const studio = isStudio(user);
  if (!studio && t.user_id !== user.id) return send(res, 403, { error: 'forbidden' });
  const b = await readBody(req);
  const body = (b.body || '').trim();
  const img = await maybeImage(b.image);
  if (!body && !img && !(b.media || []).length) return send(res, 400, { error: 'Write a message first' });
  const media = (b.media || []).filter((m) => m && m.file).slice(0, 12);
  await db.prepare('INSERT INTO chat_messages (thread_id,user_id,from_studio,body,image,media,seen_by_studio,seen_by_user) VALUES (?,?,?,?,?,?,?,?)')
    .run(t.id, user.id, studio ? 1 : 0, body || null, img, media.length ? JSON.stringify(media) : null, studio ? 1 : 0, studio ? 0 : 1);
  await db.prepare("UPDATE chat_threads SET last_at=datetime('now'), status='open' WHERE id=?").run(t.id);
  if (studio) {
    await notify(t.user_id, { type: 'chat', title: `Dalia Bassel replied`, body: (body || 'Sent a photo').slice(0, 90), link_page: 'help', link_id: t.id, actor_name: user.name });
  } else {
    await notifyRoles(['admin', 'manager', 'staff'], {
      type: 'chat', title: `${user.name} · ${topicWord[t.topic]}`, body: (body || 'Sent a photo').slice(0, 90),
      link_page: 'chats', link_id: t.id, actor_name: user.name,
    }, user.id);
  }
  send(res, 200, { ok: true });
};

api['PUT /api/chats/:id'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  await db.prepare('UPDATE chat_threads SET status=? WHERE id=?').run(b.status === 'closed' ? 'closed' : 'open', params.id);
  send(res, 200, { ok: true });
};

api['GET /api/notifications'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const items = await db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 80').all(user.id);
  const unread = (await db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(user.id)).c;
  send(res, 200, { items, unread });
};
// lightweight badge poll
api['GET /api/notifications/count'] = async (req, res, user) => {
  if (!user) return send(res, 200, { unread: 0 });
  send(res, 200, { unread: (await db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(user.id)).c });
};
api['POST /api/notifications/read-all'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  await db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(user.id);
  send(res, 200, { ok: true });
};
api['POST /api/notifications/:id/read'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  await db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(params.id, user.id);
  send(res, 200, { ok: true });
};

// ================= DRESS UPDATE THREAD (two-way notes/photos) =================
function dressAccessible(user, d) {
  if (!d) return false;
  if (['admin', 'manager', 'staff'].includes(user.role)) return true;
  return d.customer_user_id === user.id; // clients: only their own dress
}
api['GET /api/dresses/:id/updates'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const d = await db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!dressAccessible(user, d)) return send(res, 403, { error: 'forbidden' });
  // opening the thread clears the red dot for this viewer
  await db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0 AND link_page='dress' AND link_id=?").run(user.id, Number(params.id));
  send(res, 200, await db.prepare('SELECT * FROM dress_updates WHERE dress_id=? ORDER BY id').all(params.id));
};
api['POST /api/dresses/:id/updates'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const d = await db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!dressAccessible(user, d)) return send(res, 403, { error: 'forbidden' });
  const b = await readBody(req);
  const img = await maybeImage(b.image);
  if (!b.body && !img) return send(res, 400, { error: 'Write a note or add a photo' });
  const r = await db.prepare('INSERT INTO dress_updates (dress_id,author_id,author_name,author_role,body,image) VALUES (?,?,?,?,?,?)')
    .run(params.id, user.id, user.name, user.role, b.body || null, img);
  const preview = (b.body || '📷 New photo').slice(0, 90);
  if (user.role === 'customer') {
    // client -> studio: red dot on the dress for every admin/manager
    await notifyRoles(['admin', 'manager'], { type: 'dress', title: `Client ${d.customer_name} sent a note`, body: preview, link_page: 'dress', link_id: Number(params.id), actor_name: user.name }, user.id);
  } else {
    // studio (admin/manager/staff) -> client, and keep admins in the loop for manager/staff posts
    await notify(d.customer_user_id, { type: 'dress', title: `Update on ${d.customer_name}'s dress`, body: preview, link_page: 'dress', link_id: Number(params.id), image: img, actor_name: user.name });
    if (user.role !== 'admin') await notifyRoles('admin', { type: 'dress', title: `${user.name} updated ${d.customer_name}'s dress`, body: preview, link_page: 'dress', link_id: Number(params.id), actor_name: user.name }, user.id);
  }
  send(res, 200, { id: r.lastInsertRowid });
};

// ---------- router ----------
const routes = Object.keys(api).map((key) => {
  const [method, pat] = key.split(' ');
  const parts = pat.split('/').filter(Boolean);
  return { method, parts, handler: api[key], key };
});
function match(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (r.parts[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

function serveStatic(req, res, pathname) {
  let filePath, root;
  if (pathname.startsWith('/uploads/')) {
    root = UPLOAD_DIR;
    filePath = path.join(UPLOAD_DIR, pathname.slice('/uploads/'.length));
  } else {
    root = PUBLIC_DIR;
    filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  }
  if (!path.resolve(filePath).startsWith(path.resolve(root))) return send(res, 403, { error: 'forbidden' });

  // Uploaded media is streamed, and honours Range — without this iOS will not
  // play a video inline, and a large file would be read wholly into memory.
  if (pathname.startsWith('/uploads/')) {
    return fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' };
      const range = req.headers.range;
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : null;
        let end = m[2] ? parseInt(m[2], 10) : null;
        if (start === null) { start = Math.max(0, st.size - (end || 0)); end = st.size - 1; }   // suffix range
        if (end === null || end >= st.size) end = st.size - 1;
        if (Number.isNaN(start) || start > end || start >= st.size) {
          return res.writeHead(416, { ...base, 'Content-Range': `bytes */${st.size}` }).end();
        }
        res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(filePath, { start, end }).on('error', () => res.end()).pipe(res);
      }
      res.writeHead(200, { ...base, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).on('error', () => res.end()).pipe(res);
    });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      if (!pathname.startsWith('/api') && !pathname.startsWith('/uploads')) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => e2 ? send(res, 404, { error: 'not found' }) : res.writeHead(200, { 'Content-Type': MIME['.html'] }) & res.end(d2));
      }
      return send(res, 404, { error: 'not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // uploaded files have unique immutable names -> let the browser cache them forever
    if (pathname.startsWith('/uploads/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
    res.end(data);
  });
}

// What a visitor may touch. Everything else answers 403.
const VISITOR_OK = [
  '/api/me', '/api/login', '/api/logout', '/api/register', '/api/profile',
  '/api/settings', '/api/my-permissions',
  '/api/dalia', '/api/about', '/api/public',
  '/api/chats', '/api/notifications', '/api/upload',
];

// One request. Vercel hands a function the same (req, res) Node gives a server,
// so this is the handler for both — exported for serverless, and wrapped in an
// http server below when the file is run directly.
async function handle(req, res) {
  try {
    // The schema is built once per cold start, before anything reads. A failure
    // here is configuration, not a bad request, and saying so beats the browser's
    // generic connection error.
    try { await ready; }
    catch (e) { return send(res, 503, { error: 'The app is not connected to its database. ' + e.message }); }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (pathname === '/api/upload' && req.method === 'POST') {
      return await receiveUpload(req, res, await getUser(req));
    }
    if (pathname.startsWith('/api/')) {
      const m = match(req.method, pathname);
      if (!m) return send(res, 404, { error: 'route not found' });
      const user = await getUser(req);
      // A visitor is not a member of the academy yet: the feed, who we are, and
      // talking to us. Everything else is refused here rather than relying on each
      // endpoint to scope itself — new endpoints are then closed by default.
      if (user && user.role === 'visitor' && !VISITOR_OK.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
        return send(res, 403, { error: 'Ask the studio to give you access to this part of the app.' });
      }
      return await m.handler(req, res, user, url, m.params);
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
}

module.exports = handle;

// Run directly (npm start, and the maintenance scripts' sibling) — serve locally.
if (require.main === module) {
  http.createServer(handle).listen(PORT, () => console.log(`Daliessa Academy running on http://localhost:${PORT}`));
}
