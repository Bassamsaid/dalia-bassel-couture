'use strict';
// Daliessa Academy — HTTP server & API (Node built-in modules only)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { URL } = require('node:url');
const { db, hashPassword, verifyPassword } = require('./db');

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
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  return db.prepare('SELECT id,name,email,phone,role,round_id,group_id,job_title,base_salary,hire_date,active,avatar,off_days FROM users WHERE id=?').get(s.user_id) || null;
}
// Save a base64 data URL (or raw base64) to uploads, return filename
function saveImage(dataUrl, fallbackExt = '.jpg') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  let ext = fallbackExt, b64 = dataUrl;
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) {
    b64 = m[2];
    const map = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
    ext = map[m[1]] || fallbackExt;
  }
  const buf = Buffer.from(b64, 'base64');
  const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}
// If a field looks like a base64 upload, store it and return the filename; otherwise pass through
function maybeImage(val) {
  if (typeof val === 'string' && val.startsWith('data:')) return saveImage(val);
  return val || null;
}

// ---- notifications ----
// Drop a notification for one recipient. o = {type,title,body,link_page,link_id,image,actor_name}
function notify(userId, o = {}) {
  if (!userId) return;
  try {
    db.prepare('INSERT INTO notifications (user_id,type,title,body,link_page,link_id,image,actor_name) VALUES (?,?,?,?,?,?,?,?)')
      .run(Number(userId), o.type || null, o.title || null, o.body || null, o.link_page || null, o.link_id || null, o.image || null, o.actor_name || null);
  } catch (e) { /* never let a notification failure break the main action */ }
}
// Notify every active user in the given role(s), skipping the actor.
function notifyRoles(roles, o = {}, exceptId) {
  const rs = Array.isArray(roles) ? roles : [roles];
  if (!rs.length) return;
  const ph = rs.map(() => '?').join(',');
  try {
    db.prepare(`SELECT id FROM users WHERE active=1 AND role IN (${ph})`).all(...rs)
      .forEach((u) => { if (u.id !== exceptId) notify(u.id, o); });
  } catch (e) {}
}
// Notify every active user (used for new Feed/Highlight drops), skipping the actor.
function notifyAll(o = {}, exceptId) {
  try {
    db.prepare('SELECT id FROM users WHERE active=1').all()
      .forEach((u) => { if (u.id !== exceptId) notify(u.id, o); });
  } catch (e) {}
}
function money0(n) { return (Number(n) || 0).toLocaleString('en-US') + ' EGP'; }
// ---- time / weekday helpers (payroll) ----
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function hm2min(s) { if (!s) return 0; const p = String(s).split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
function weekdayOf(dateStr) { const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z'); return WEEKDAYS[d.getUTCDay()]; }

// ---------- API ----------
const api = {};

// -- auth --
// Count a sign-in, however she got in
function markLogin(userId) {
  try {
    db.prepare(`UPDATE users SET login_count=COALESCE(login_count,0)+1,
      first_login=COALESCE(first_login, datetime('now')), last_login=datetime('now') WHERE id=?`).run(userId);
  } catch (e) { /* never block a sign-in over a counter */ }
}
api['POST /api/login'] = async (req, res) => {
  const b = await readBody(req);
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get((b.email || '').trim());
  // an invited account has no password yet — point them at sign-up instead of a dead end
  if (u && u.active && u.invited) return send(res, 401, { error: 'The studio added you. Tap "Create one" and sign up with this email to set your password.' });
  if (!u || !u.active || !verifyPassword(b.password || '', u.password_hash)) return send(res, 401, { error: 'Invalid email or password' });
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, u.id);
  markLogin(u.id);
  send(res, 200, { ok: true, user: { id: u.id, name: u.name, role: u.role } }, {
    'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
  });
};
api['POST /api/logout'] = async (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
};
api['GET /api/me'] = async (req, res, user) => send(res, 200, { user });

// -- passwordless email OTP login --
api['POST /api/otp/request'] = async (req, res) => {
  const b = await readBody(req);
  const email = (b.email || '').trim();
  if (!email) return send(res, 400, { error: 'Email is required' });
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
  if (!u || !u.active) return send(res, 404, { error: 'No account with this email' });
  const gUser = process.env.GMAIL_USER, gPass = process.env.GMAIL_APP_PASSWORD;
  if (!gUser || !gPass) return send(res, 503, { error: 'Email sign-in is not set up yet' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  db.prepare('INSERT INTO otps (email,code,expires_at) VALUES (lower(?),?,?) ON CONFLICT(email) DO UPDATE SET code=excluded.code,expires_at=excluded.expires_at').run(email, code, expires);
  try {
    await smtpSend({ user: gUser, pass: gPass, to: email, subject: 'Dalia Bassel — your login code', text: `Your Dalia Bassel login code is: ${code}\n\nIt expires in 10 minutes.` });
  } catch (e) { console.error('OTP email failed:', e.message); return send(res, 502, { error: 'Could not send the email — check the mail settings' }); }
  send(res, 200, { ok: true });
};
api['POST /api/otp/verify'] = async (req, res) => {
  const b = await readBody(req);
  const email = (b.email || '').trim().toLowerCase();
  const code = (b.code || '').trim();
  const row = db.prepare('SELECT * FROM otps WHERE email=?').get(email);
  if (!row || row.code !== code) return send(res, 401, { error: 'Invalid code' });
  if (new Date(row.expires_at).getTime() < Date.now()) return send(res, 401, { error: 'The code has expired' });
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
  if (!u || !u.active) return send(res, 401, { error: 'No account' });
  db.prepare('DELETE FROM otps WHERE email=?').run(email);
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, u.id);
  markLogin(u.id);
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
    const invitee = db.prepare('SELECT * FROM users WHERE lower(email)=? AND invited=1').get(email);
    let uid;
    if (invitee) {
      db.prepare('UPDATE users SET password_hash=?,invited=0 WHERE id=?').run(hashPassword(b.password), invitee.id);
      uid = invitee.id;
    } else {
      const taken = db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email);
      if (taken) return send(res, 400, { error: 'Email already in use' });
      // an email the studio does not know yet joins as a visitor
      const r = db.prepare('INSERT INTO users (name,email,password_hash,role,avatar) VALUES (?,?,?,?,?)')
        .run(b.name, email, hashPassword(b.password), 'visitor', maybeImage(b.avatar));
      uid = r.lastInsertRowid;
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, uid);
    send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` });
  } catch (e) { send(res, 400, { error: e.message.includes('UNIQUE') ? 'Email already in use' : e.message }); }
};
api['PUT /api/profile'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const cur = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run(b.name ?? cur.name, b.phone ?? cur.phone, user.id);
  if (b.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(b.password), user.id);
  if (b.avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(maybeImage(b.avatar), user.id);
  send(res, 200, { ok: true });
};

// -- generic guards --
function requireAdmin(user, res) { if (!user || user.role !== 'admin') { send(res, 403, { error: 'forbidden' }); return false; } return true; }
// admin OR manager (academy operations: students, payments, rounds, courses, dresses)
function requireManager(user, res) { if (!user || (user.role !== 'admin' && user.role !== 'manager')) { send(res, 403, { error: 'forbidden' }); return false; } return true; }
// admin, manager, or staff (employees — for self HR: own absences/advances)
function requireStaffish(user, res) { if (!user || !['admin', 'manager', 'staff'].includes(user.role)) { send(res, 403, { error: 'forbidden' }); return false; } return true; }
function requireAuth(user, res) { if (!user) { send(res, 401, { error: 'unauthorized' }); return false; } return true; }

// ================= ADMIN: USERS / STUDENTS =================
api['GET /api/users'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return; // staff may view students (money stripped below)
  const role = url.searchParams.get('role');
  const round = url.searchParams.get('round_id');
  let q = 'SELECT id,name,email,phone,role,round_id,group_id,job_title,base_salary,hire_date,active,governorate,off_days,created_at FROM users WHERE 1=1';
  const args = [];
  if (role) { q += ' AND role=?'; args.push(role); }
  if (round) { q += ' AND round_id=?'; args.push(round); }
  q += ' ORDER BY name';
  const rows = db.prepare(q).all(...args);
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
    const r = db.prepare(`INSERT INTO users (name,email,phone,password_hash,role,round_id,group_id,job_title,base_salary,hire_date,governorate,off_days,invited)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.name, b.email ? String(b.email).trim().toLowerCase() : null, b.phone || null,
      hashPassword(b.password || crypto.randomBytes(9).toString('hex')),
      b.role || 'trainee', b.round_id || null, b.group_id || null,
      b.job_title || null, b.base_salary || 0, b.hire_date || null, b.governorate || null, b.off_days || null, invited);
    const uid = r.lastInsertRowid;
    if (b.role !== 'staff' && (b.total_fee != null || b.round_id)) {
      db.prepare('INSERT INTO enrollments (user_id,round_id,total_fee) VALUES (?,?,?)').run(uid, b.round_id || null, b.total_fee || 0);
    }
    const roleWord = { trainee: 'student', customer: 'client', staff: 'staff member', manager: 'manager' }[b.role || 'trainee'] || 'member';
    notifyRoles('admin', { type: 'user', title: `New ${roleWord}: ${b.name}`, body: `${user.name} added a new ${roleWord}`, link_page: b.role === 'trainee' ? 'students' : 'members', actor_name: user.name }, user.id);
    send(res, 200, { id: uid });
  } catch (e) { send(res, 400, { error: e.message.includes('UNIQUE') ? 'This email is already in use' : e.message }); }
};
api['PUT /api/users/:id'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  const cur = db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
  if (!cur) return send(res, 404, { error: 'not found' });
  if (user.role === 'staff') { // staff may only edit a student/client's contact info — no money, role, round, group
    if (!['trainee', 'customer'].includes(cur.role)) return send(res, 403, { error: 'forbidden' });
    db.prepare('UPDATE users SET name=?,phone=?,governorate=? WHERE id=?').run(b.name ?? cur.name, b.phone ?? cur.phone, b.governorate ?? cur.governorate, params.id);
    return send(res, 200, { ok: true });
  }
  if (user.role === 'manager') { // managers may only touch students/clients and never escalate a role
    if (!['trainee', 'customer'].includes(cur.role)) return send(res, 403, { error: 'forbidden' });
    if (b.role && !['trainee', 'customer'].includes(b.role)) return send(res, 403, { error: 'cannot change role' });
  }
  db.prepare(`UPDATE users SET name=?,email=?,phone=?,role=?,round_id=?,group_id=?,job_title=?,base_salary=?,hire_date=?,active=?,governorate=?,off_days=? WHERE id=?`).run(
    b.name ?? cur.name, b.email ?? cur.email, b.phone ?? cur.phone, b.role ?? cur.role,
    b.round_id ?? cur.round_id, b.group_id ?? cur.group_id, b.job_title ?? cur.job_title,
    b.base_salary ?? cur.base_salary, b.hire_date ?? cur.hire_date, b.active ?? cur.active, b.governorate ?? cur.governorate, b.off_days ?? cur.off_days, params.id);
  if (b.password) db.prepare('UPDATE users SET password_hash=?,invited=0 WHERE id=?').run(hashPassword(b.password), params.id);
  // giving a login email to someone who had none makes the account claimable on sign-up.
  // An account that already had an email keeps its password — editing it must not lock anyone out.
  else if (!cur.email && b.email) db.prepare('UPDATE users SET invited=1 WHERE id=?').run(params.id);
  if (b.total_fee != null) {
    const en = db.prepare('SELECT id FROM enrollments WHERE user_id=?').get(params.id);
    if (en) db.prepare('UPDATE enrollments SET total_fee=?,round_id=? WHERE id=?').run(b.total_fee, b.round_id ?? cur.round_id, en.id);
    else db.prepare('INSERT INTO enrollments (user_id,round_id,total_fee) VALUES (?,?,?)').run(params.id, b.round_id ?? cur.round_id, b.total_fee);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/users/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const id = Number(params.id);
  const target = db.prepare('SELECT id, role FROM users WHERE id=?').get(id);
  if (!target || target.role === 'admin') return send(res, 200, { ok: true }); // never delete the admin
  // clean cascade: remove every record that belongs to this user
  const tables = ['sessions', 'enrollments', 'payments', 'reminders', 'submissions', 'quiz_attempts', 'attendance', 'salaries', 'leaves', 'absences', 'advances', 'salary_adjustments', 'salary_payments', 'notifications'];
  for (const t of tables) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* table/column may not exist */ } }
  db.prepare('DELETE FROM users WHERE id=? AND role!=?').run(id, 'admin');
  send(res, 200, { ok: true });
};

// Full financial sheet for all trainees (paid / remaining / totals)
api['GET /api/finance/sheet'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const rows = db.prepare(`
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
function accountOf(userId) {
  const r = db.prepare(`SELECT
    COALESCE((SELECT SUM(total_fee) FROM enrollments WHERE user_id=?),0) AS fee,
    COALESCE((SELECT SUM(amount)    FROM payments    WHERE user_id=?),0) AS paid`).get(userId, userId);
  return { fee: r.fee || 0, paid: r.paid || 0 };
}

// ================= PAYMENTS =================
api['GET /api/payments'] = async (req, res, user, url) => {
  if (!requireAuth(user, res)) return;
  const uid = url.searchParams.get('user_id');
  if (user.role !== 'admin' && user.role !== 'manager') {
    return send(res, 200, db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY paid_at DESC').all(user.id));
  }
  const q = uid ? 'SELECT * FROM payments WHERE user_id=? ORDER BY paid_at DESC' : 'SELECT p.*,u.name user_name FROM payments p JOIN users u ON u.id=p.user_id ORDER BY paid_at DESC';
  send(res, 200, uid ? db.prepare(q).all(uid) : db.prepare(q).all());
};
api['POST /api/payments'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  if (!b.user_id) return send(res, 400, { error: 'Select a student' });
  const amount = Number(b.amount) || 0;
  if (amount <= 0) return send(res, 400, { error: 'Enter an amount above zero' });
  const acc = accountOf(b.user_id);
  if (acc.fee > 0 && acc.paid + amount > acc.fee) {
    const left = acc.fee - acc.paid;
    return send(res, 400, {
      error: left > 0
        ? `That is more than she still owes. Her course is ${money0(acc.fee)}, she has paid ${money0(acc.paid)} — only ${money0(left)} is left.`
        : `Her course fee of ${money0(acc.fee)} is already paid in full.`,
    });
  }
  const img = maybeImage(b.image);
  const method = b.method === 'cash' ? 'cash' : 'transfer';
  const r = db.prepare('INSERT INTO payments (user_id,amount,kind,method,image,note,paid_at) VALUES (?,?,?,?,?,?,COALESCE(?,datetime(\'now\')))').run(
    b.user_id, b.amount || 0, b.kind || 'installment', method, img, b.note || null, b.paid_at || null);
  const payer = db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id);
  notifyRoles('admin', { type: 'payment', title: `New payment: ${money0(b.amount)}`, body: `${user.name} recorded a payment for ${payer ? payer.name : ''}`, link_page: 'finance', actor_name: user.name }, user.id);
  notify(b.user_id, { type: 'payment', title: `A payment of ${money0(b.amount)} was recorded 💳`, body: 'Thank you! You can view your account', link_page: 'mypay', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/payments/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const cur = db.prepare('SELECT * FROM payments WHERE id=?').get(params.id);
  if (!cur) return send(res, 404, { error: 'That payment no longer exists' });
  const b = await readBody(req);
  const amount = Number(b.amount ?? cur.amount) || 0;
  if (amount <= 0) return send(res, 400, { error: 'Enter an amount above zero' });
  const uid = b.user_id ? Number(b.user_id) : cur.user_id;
  const acc = accountOf(uid);
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
  const img = b.image === undefined ? cur.image : maybeImage(b.image);
  db.prepare('UPDATE payments SET user_id=?,amount=?,kind=?,method=?,image=?,note=?,paid_at=COALESCE(?,paid_at) WHERE id=?').run(
    uid, amount, b.kind || cur.kind, (b.method === 'cash' ? 'cash' : (b.method ? 'transfer' : cur.method)),
    img, b.note === undefined ? cur.note : (b.note || null), b.paid_at || null, params.id);
  if (amount !== cur.amount || uid !== cur.user_id) {
    const payer = db.prepare('SELECT name FROM users WHERE id=?').get(uid);
    notifyRoles('admin', { type: 'payment', title: `Payment corrected: ${money0(cur.amount)} → ${money0(amount)}`,
      body: `${user.name} corrected a payment for ${payer ? payer.name : ''}`, link_page: 'finance', actor_name: user.name }, user.id);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/payments/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  db.prepare('DELETE FROM payments WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= REMINDERS (payment due dates) =================
api['GET /api/reminders'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') {
    return send(res, 200, db.prepare('SELECT r.*,u.name user_name FROM reminders r JOIN users u ON u.id=r.user_id ORDER BY done, due_date').all());
  }
  send(res, 200, db.prepare('SELECT * FROM reminders WHERE user_id=? ORDER BY done,due_date').all(user.id));
};
api['POST /api/reminders'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO reminders (user_id,due_date,amount,note) VALUES (?,?,?,?)').run(b.user_id, b.due_date, b.amount || 0, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/reminders/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  db.prepare('UPDATE reminders SET done=? WHERE id=?').run(b.done ? 1 : 0, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/reminders/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  db.prepare('DELETE FROM reminders WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= ROUNDS & GROUPS =================
for (const [name, table] of [['rounds', 'rounds'], ['groups', 'groups']]) {
  api[`GET /api/${name}`] = async (req, res, user) => {
    if (!requireAuth(user, res)) return;
    send(res, 200, db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
  };
}
api['POST /api/rounds'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const kind = b.kind === 'online' ? 'online' : 'onsite';
  const r = db.prepare('INSERT INTO rounds (number,name,description,start_date,active,kind) VALUES (?,?,?,?,?,?)').run(b.number || null, b.name, b.description || null, b.start_date || null, b.active ?? 1, kind);
  notifyRoles('admin', { type: 'course', title: `New round: ${b.name || ''}`, body: `${user.name} added a new round`, link_page: 'rounds', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/rounds/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req); const c = db.prepare('SELECT * FROM rounds WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  db.prepare('UPDATE rounds SET number=?,name=?,description=?,start_date=?,active=?,kind=? WHERE id=?').run(b.number ?? c.number, b.name ?? c.name, b.description ?? c.description, b.start_date ?? c.start_date, b.active ?? c.active, b.kind ?? c.kind, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/rounds/:id'] = async (req, res, user, url, params) => { if (!requireManager(user, res)) return; db.prepare('DELETE FROM rounds WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/groups'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO groups (round_id,name,day,time_slot,capacity) VALUES (?,?,?,?,?)').run(b.round_id || null, b.name, b.day || null, b.time_slot || null, b.capacity || 0);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/groups/:id'] = async (req, res, user, url, params) => { if (!requireManager(user, res)) return; db.prepare('DELETE FROM groups WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= VIDEOS =================
api['GET /api/videos'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const withNames = 'SELECT v.*, (SELECT name FROM rounds WHERE id=v.round_id) round_name, (SELECT name FROM groups WHERE id=v.group_id) group_name FROM videos v';
  if (['admin', 'manager', 'staff'].includes(user.role)) return send(res, 200, db.prepare(withNames + ' ORDER BY v.id DESC').all());
  // students: their round's content, and only their group (or round-wide items with no group)
  send(res, 200, db.prepare(withNames + ' WHERE (v.round_id IS NULL OR v.round_id=?) AND (v.group_id IS NULL OR v.group_id=?) ORDER BY v.id DESC').all(user.round_id || -1, user.group_id || -1));
};
api['POST /api/videos'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return; // staff can upload course videos/photos too
  const b = await readBody(req);
  const file = b.file && b.file.startsWith('data:') ? saveImage(b.file, '.mp4') : null;
  const kind = b.kind === 'onsite' ? 'onsite' : 'online';
  const r = db.prepare('INSERT INTO videos (round_id,group_id,title,description,url,file,kind) VALUES (?,?,?,?,?,?,?)').run(b.round_id || null, b.group_id || null, b.title, b.description || null, b.url || null, file, kind);
  notifyRoles('admin', { type: 'course', title: `New lesson / video: ${b.title || ''}`, body: `${user.name} added new course content`, link_page: 'courses', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/videos/:id'] = async (req, res, user, url, params) => { if (!requireStaffish(user, res)) return; db.prepare('DELETE FROM videos WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= HOMEWORK + SUBMISSIONS =================
api['GET /api/homeworks'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const studio = ['admin', 'manager', 'staff'].includes(user.role);
  const list = studio
    ? db.prepare('SELECT * FROM homeworks ORDER BY id DESC').all()
    // mirrors taskAudience: a task aimed at a group reaches that group, whatever
    // round the student is filed under; only a task without a group follows rounds
    : db.prepare(`SELECT * FROM homeworks WHERE
        (group_id IS NOT NULL AND group_id=?)
        OR (group_id IS NULL AND (round_id IS NULL OR round_id=?))
        ORDER BY id DESC`).all(user.group_id || -1, user.round_id || -1);
  if (studio) {
    // how many of the students it was sent to have handed it in
    list.forEach((h) => {
      h.expected_count = taskAudience(h).length;
      h.submitted_count = db.prepare('SELECT COUNT(*) c FROM submissions WHERE homework_id=?').get(h.id).c;
    });
  }
  if (user.role !== 'admin') {
    list.forEach((h) => {
      h.my_submission = db.prepare('SELECT * FROM submissions WHERE homework_id=? AND user_id=?').get(h.id, user.id) || null;
      if (h.my_submission) h.my_submission.images = subImages(h.my_submission.id);
    });
  }
  send(res, 200, list);
};
// Students a task was sent to: its round, or every student when it is for all rounds.
function taskAudience(hw) {
  const cols = `SELECT u.id, u.name, u.group_id, (SELECT name FROM groups WHERE id=u.group_id) group_name
    FROM users u WHERE u.role='trainee' AND u.active=1`;
  if (hw.group_id) return db.prepare(`${cols} AND u.group_id=? ORDER BY u.name`).all(hw.group_id);
  if (hw.round_id) return db.prepare(`${cols} AND u.round_id=? ORDER BY u.name`).all(hw.round_id);
  return db.prepare(`${cols} ORDER BY u.name`).all();
}
function subImages(submissionId) {
  return db.prepare('SELECT id,image FROM submission_images WHERE submission_id=? ORDER BY position,id').all(submissionId);
}
api['POST /api/homeworks'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const mode = b.mode === 'online' ? 'online' : 'onsite';
  const r = db.prepare('INSERT INTO homeworks (round_id,group_id,mode,title,measurements,instructions,due_date) VALUES (?,?,?,?,?,?,?)')
    .run(b.round_id || null, b.group_id || null, mode, b.title, b.measurements || null, b.instructions || null, b.due_date || null);
  const hid = r.lastInsertRowid;
  const due = b.due_date ? ` · due ${b.due_date}` : '';
  taskAudience({ round_id: b.round_id || null, group_id: b.group_id || null }).forEach((st) => notify(st.id, {
    type: 'task', title: `New task: ${b.title}`, body: `Upload your pattern photos${due}`,
    link_page: 'homework', link_id: hid, actor_name: user.name,
  }));
  send(res, 200, { id: hid });
};
api['DELETE /api/homeworks/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM homeworks WHERE id=?').run(params.id); db.prepare('DELETE FROM submissions WHERE homework_id=?').run(params.id); send(res, 200, { ok: true }); };
api['GET /api/homeworks/:id/submissions'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return; // managers and staff follow the class too
  const hw = db.prepare('SELECT * FROM homeworks WHERE id=?').get(params.id);
  if (!hw) return send(res, 404, { error: 'Task not found' });
  const submitted = db.prepare(`SELECT s.*, u.name user_name, u.group_id,
      (SELECT name FROM groups WHERE id=u.group_id) group_name
    FROM submissions s JOIN users u ON u.id=s.user_id WHERE homework_id=? ORDER BY s.submitted_at DESC`).all(params.id);
  submitted.forEach((s) => { s.images = subImages(s.id); });
  const done = new Set(submitted.map((s) => s.user_id));
  const pending = taskAudience(hw).filter((st) => !done.has(st.id));
  send(res, 200, { homework: hw, submitted, pending, expected: submitted.length + pending.length });
};
api['POST /api/homeworks/:id/submit'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const hw = db.prepare('SELECT * FROM homeworks WHERE id=?').get(params.id);
  if (!hw) return send(res, 404, { error: 'Task not found' });
  const ex = db.prepare('SELECT id FROM submissions WHERE homework_id=? AND user_id=?').get(params.id, user.id);
  const first = ex ? false : true;
  let sid;
  if (ex) { db.prepare("UPDATE submissions SET note=?,submitted_at=datetime('now') WHERE id=?").run(b.note ?? null, ex.id); sid = ex.id; }
  else { sid = db.prepare('INSERT INTO submissions (homework_id,user_id,note) VALUES (?,?,?)').run(params.id, user.id, b.note || null).lastInsertRowid; }

  // new photos are appended — nothing already uploaded is replaced
  const incoming = [].concat(b.images || [], b.image ? [b.image] : []).filter(Boolean);
  let pos = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM submission_images WHERE submission_id=?').get(sid).p;
  incoming.forEach((raw) => {
    const saved = maybeImage(raw);
    if (saved) db.prepare('INSERT INTO submission_images (submission_id,image,position) VALUES (?,?,?)').run(sid, saved, ++pos);
  });
  // keep the cover in sync so old screens and thumbnails still work
  const cover = db.prepare('SELECT image FROM submission_images WHERE submission_id=? ORDER BY position,id LIMIT 1').get(sid);
  db.prepare('UPDATE submissions SET image=? WHERE id=?').run(cover ? cover.image : null, sid);

  const count = db.prepare('SELECT COUNT(*) c FROM submission_images WHERE submission_id=?').get(sid).c;
  notifyRoles(['admin', 'manager', 'staff'], {
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
  const row = db.prepare('SELECT si.*, s.user_id FROM submission_images si JOIN submissions s ON s.id=si.submission_id WHERE si.id=?').get(params.id);
  if (!row) return send(res, 404, { error: 'not found' });
  if (row.user_id !== user.id && !['admin', 'manager'].includes(user.role)) return send(res, 403, { error: 'forbidden' });
  db.prepare('DELETE FROM submission_images WHERE id=?').run(params.id);
  const cover = db.prepare('SELECT image FROM submission_images WHERE submission_id=? ORDER BY position,id LIMIT 1').get(row.submission_id);
  db.prepare('UPDATE submissions SET image=? WHERE id=?').run(cover ? cover.image : null, row.submission_id);
  send(res, 200, { ok: true });
};
api['PUT /api/submissions/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  db.prepare('UPDATE submissions SET grade=?,feedback=? WHERE id=?').run(b.grade || null, b.feedback || null, params.id);
  send(res, 200, { ok: true });
};

// ================= QUIZZES =================
api['GET /api/quizzes'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const list = user.role === 'admin'
    ? db.prepare('SELECT * FROM quizzes ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM quizzes WHERE active=1 AND (round_id IS NULL OR round_id=?) ORDER BY id DESC').all(user.round_id || -1);
  list.forEach((q) => {
    q.questions_count = db.prepare('SELECT COUNT(*) c FROM quiz_questions WHERE quiz_id=?').get(q.id).c;
    if (user.role !== 'admin') q.my_attempt = db.prepare('SELECT id,score,total,submitted_at FROM quiz_attempts WHERE quiz_id=? AND user_id=? AND submitted_at IS NOT NULL').get(q.id, user.id) || null;
  });
  send(res, 200, list);
};
api['POST /api/quizzes'] = async (req, res, user) => {
  if (!requireManager(user, res)) return; // admin + manager can create quizzes
  const b = await readBody(req);
  const ref = b.ref_code || 'Q-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const r = db.prepare('INSERT INTO quizzes (round_id,title,ref_code,duration_min,active) VALUES (?,?,?,?,?)').run(b.round_id || null, b.title, ref, b.duration_min || 15, b.active ?? 1);
  const qid = r.lastInsertRowid;
  (b.questions || []).forEach((q) => {
    db.prepare('INSERT INTO quiz_questions (quiz_id,text,options,correct_index,points) VALUES (?,?,?,?,?)').run(qid, q.text, JSON.stringify(q.options || []), q.correct_index || 0, q.points || 1);
  });
  send(res, 200, { id: qid, ref_code: ref });
};
api['DELETE /api/quizzes/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  db.prepare('DELETE FROM quizzes WHERE id=?').run(params.id);
  db.prepare('DELETE FROM quiz_questions WHERE quiz_id=?').run(params.id);
  db.prepare('DELETE FROM quiz_attempts WHERE quiz_id=?').run(params.id);
  send(res, 200, { ok: true });
};
// Get quiz with questions. For trainees, correct answers are hidden.
api['GET /api/quizzes/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id=?').get(params.id);
  if (!quiz) return send(res, 404, {});
  const qs = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id=?').all(params.id).map((q) => ({
    id: q.id, text: q.text, options: JSON.parse(q.options), points: q.points,
    ...(user.role === 'admin' ? { correct_index: q.correct_index } : {}),
  }));
  send(res, 200, { ...quiz, questions: qs });
};
api['POST /api/quizzes/:id/attempt'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const qs = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id=?').all(params.id);
  let score = 0, total = 0;
  qs.forEach((q) => { total += q.points; if (Number(b.answers?.[q.id]) === q.correct_index) score += q.points; });
  const r = db.prepare('INSERT INTO quiz_attempts (quiz_id,user_id,answers,score,total,submitted_at) VALUES (?,?,?,?,?,datetime(\'now\'))').run(params.id, user.id, JSON.stringify(b.answers || {}), score, total);
  send(res, 200, { id: r.lastInsertRowid, score, total });
};
// Public results of a quiz (everyone can see, per requirement)
api['GET /api/quizzes/:id/results'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  send(res, 200, db.prepare('SELECT a.score,a.total,a.submitted_at,u.name user_name FROM quiz_attempts a JOIN users u ON u.id=a.user_id WHERE a.quiz_id=? AND a.submitted_at IS NOT NULL ORDER BY a.score DESC,a.submitted_at').all(params.id));
};

// ================= NOTES =================
api['GET /api/notes'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, db.prepare('SELECT * FROM notes ORDER BY id DESC').all());
  send(res, 200, db.prepare(`SELECT * FROM notes WHERE scope='all' OR (scope='round' AND round_id=?) OR (scope='user' AND user_id=?) ORDER BY id DESC`).all(user.round_id || -1, user.id));
};
api['POST /api/notes'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO notes (scope,round_id,user_id,title,body) VALUES (?,?,?,?,?)').run(b.scope || 'all', b.round_id || null, b.user_id || null, b.title, b.body || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/notes/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM notes WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= ABOUT =================
api['GET /api/about'] = async (req, res) => send(res, 200, db.prepare('SELECT * FROM about WHERE id=1').get() || {});
api['PUT /api/about'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = b.image && b.image.startsWith('data:') ? saveImage(b.image) : b.image;
  const ex = db.prepare('SELECT id FROM about WHERE id=1').get();
  if (ex) db.prepare('UPDATE about SET title=?,body=?,image=COALESCE(?,image) WHERE id=1').run(b.title, b.body, img || null);
  else db.prepare('INSERT INTO about (id,title,body,image) VALUES (1,?,?,?)').run(b.title, b.body, img || null);
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
  const ex = db.prepare('SELECT id FROM about WHERE id=1').get();
  if (ex) db.prepare('UPDATE about SET img_pos=?,img_zoom=?,img_shape=? WHERE id=1').run(pos, zoom, shape);
  else db.prepare('INSERT INTO about (id,img_pos,img_zoom,img_shape) VALUES (1,?,?,?)').run(pos, zoom, shape);
  send(res, 200, { ok: true });
};

api['PUT /api/home-cover'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = b.image && b.image.startsWith('data:') ? saveImage(b.image) : b.image;
  const ex = db.prepare('SELECT id FROM about WHERE id=1').get();
  if (ex) db.prepare('UPDATE about SET home_image=? WHERE id=1').run(img || null);
  else db.prepare('INSERT INTO about (id,home_image) VALUES (1,?)').run(img || null);
  send(res, 200, { ok: true });
};

// ================= DALIA POSTS =================
api['GET /api/dalia'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const rows = db.prepare('SELECT * FROM dalia_posts ORDER BY id DESC').all();
  rows.forEach((r) => {
    r.media = postMedia(r.id);
    // a post made before galleries existed still has its single cover photo
    if (!r.media.length && r.image) r.media = [{ id: null, file: r.image, kind: 'image' }];
  });
  send(res, 200, rows);
};
function postMedia(postId) {
  return db.prepare('SELECT id,file,kind,poster FROM dalia_media WHERE post_id=? ORDER BY position,id').all(postId);
}
// Store the gallery for a post and keep dalia_posts.image pointing at the first photo.
function setPostMedia(postId, media) {
  let pos = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM dalia_media WHERE post_id=?').get(postId).p;
  (media || []).forEach((m) => {
    const file = typeof m === 'string' ? m : m.file;
    if (!file) return;
    const saved = String(file).startsWith('data:') ? saveImage(file) : file;
    const kind = (typeof m === 'object' && m.kind === 'video') || /\.(mp4|mov|webm)$/i.test(saved) ? 'video' : 'image';
    const poster = (typeof m === 'object' && m.poster)
      ? (String(m.poster).startsWith('data:') ? saveImage(m.poster) : m.poster) : null;
    db.prepare('INSERT INTO dalia_media (post_id,file,kind,position,poster) VALUES (?,?,?,?,?)').run(postId, saved, kind, ++pos, poster);
  });
  const cover = db.prepare("SELECT file FROM dalia_media WHERE post_id=? AND kind='image' ORDER BY position,id LIMIT 1").get(postId);
  if (cover) db.prepare('UPDATE dalia_posts SET image=? WHERE id=?').run(cover.file, postId);
}
api['POST /api/dalia'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = maybeImage(b.image);
  const r = db.prepare('INSERT INTO dalia_posts (title,subtitle,body,image,table_data,template,section) VALUES (?,?,?,?,?,?,?)').run(b.title || null, b.subtitle || null, b.body || null, img, b.table_data ? JSON.stringify(b.table_data) : null, b.template || 'below', b.section || 'studio');
  setPostMedia(r.lastInsertRowid, b.media);
  notifyAll({ type: 'feed', title: '✦ New post from Dalia Bassel', body: b.title || b.subtitle || 'See the latest updates', link_page: 'dalia', link_id: r.lastInsertRowid, image: img, actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/dalia/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req); const c = db.prepare('SELECT * FROM dalia_posts WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const img = (b.image && b.image.startsWith('data:')) ? maybeImage(b.image) : (b.image ?? c.image);
  db.prepare('UPDATE dalia_posts SET title=?,subtitle=?,body=?,image=?,template=?,section=? WHERE id=?').run(b.title ?? c.title, b.subtitle ?? c.subtitle, b.body ?? c.body, img, b.template ?? c.template, b.section ?? c.section, params.id);
  setPostMedia(params.id, b.media);
  send(res, 200, { ok: true });
};
api['DELETE /api/dalia/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM dalia_posts WHERE id=?').run(params.id); db.prepare('DELETE FROM dalia_media WHERE post_id=?').run(params.id); send(res, 200, { ok: true }); };
// choose the still shown before a video plays
api['PUT /api/dalia-media/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const row = db.prepare('SELECT * FROM dalia_media WHERE id=?').get(params.id);
  if (!row) return send(res, 404, { error: 'not found' });
  const poster = b.poster ? (String(b.poster).startsWith('data:') ? saveImage(b.poster) : b.poster) : null;
  db.prepare('UPDATE dalia_media SET poster=? WHERE id=?').run(poster, params.id);
  send(res, 200, { ok: true, poster });
};
api['DELETE /api/dalia-media/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const row = db.prepare('SELECT * FROM dalia_media WHERE id=?').get(params.id);
  if (!row) return send(res, 404, { error: 'not found' });
  db.prepare('DELETE FROM dalia_media WHERE id=?').run(params.id);
  const cover = db.prepare("SELECT file FROM dalia_media WHERE post_id=? AND kind='image' ORDER BY position,id LIMIT 1").get(row.post_id);
  db.prepare('UPDATE dalia_posts SET image=? WHERE id=?').run(cover ? cover.file : null, row.post_id);
  send(res, 200, { ok: true });
};

// ================= DRESSES =================
api['GET /api/dresses'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  let list;
  const base = 'SELECT d.*, u.name assignee_name FROM dresses d LEFT JOIN users u ON u.id=d.assigned_to';
  if (['admin', 'manager', 'staff'].includes(user.role)) list = db.prepare(base + ' ORDER BY d.id DESC').all();
  else list = db.prepare(base + ' WHERE d.customer_user_id=? ORDER BY d.id DESC').all(user.id);
  const studioSide = ['admin', 'manager', 'staff'].includes(user.role);
  list.forEach((d) => {
    try { d.brief = d.brief ? JSON.parse(d.brief) : null; } catch (e) { d.brief = null; }
    // does her own account exist, and has she used it?
    if (studioSide && d.customer_user_id) {
      const cu = db.prepare('SELECT email,invited,invite_expires,login_count,first_login,last_login FROM users WHERE id=?').get(d.customer_user_id);
      if (cu) d.client_access = {
        email: cu.email, invited: !!cu.invited,
        invite_expires: cu.invite_expires,
        logins: cu.login_count || 0, first_login: cu.first_login, last_login: cu.last_login,
      };
    }
    d.fittings = db.prepare('SELECT * FROM dress_fittings WHERE dress_id=? ORDER BY fitting_date').all(d.id);
    d.images = db.prepare('SELECT * FROM dress_images WHERE dress_id=? ORDER BY position, id').all(d.id);
    d.unread = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0 AND link_page='dress' AND link_id=?").get(user.id, d.id).c;
    if (user.role === 'admin') {
      d.material_cost = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM purchase_lines WHERE dress_id=?').get(d.id).s;
      d.profit = (d.price || 0) - d.material_cost;
      d.paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM dress_payments WHERE dress_id=?').get(d.id).s;
      d.remaining = Math.max(0, (d.price || 0) - d.paid);
    } else if (user.role === 'customer') {
      // clients see THEIR OWN order's price, deposits and balance (+ receipts)
      d.paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM dress_payments WHERE dress_id=?').get(d.id).s;
      d.remaining = Math.max(0, (d.price || 0) - d.paid);
      d.payments = db.prepare('SELECT amount,method,note,paid_at FROM dress_payments WHERE dress_id=? ORDER BY COALESCE(paid_at,created_at) DESC, id DESC').all(d.id);
    } else { delete d.price; } // staff / manager: no dress money
  });
  send(res, 200, list);
};
api['POST /api/dresses'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const cover = maybeImage(b.cover_image);
  const price = user.role === 'admin' ? (b.price || 0) : 0; // only admin sets price
  const r = db.prepare('INSERT INTO dresses (customer_name,customer_user_id,phone,delivery_date,status,note,cover_image,assigned_to,price,brief) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    b.customer_name, b.customer_user_id || null, b.phone || null, b.delivery_date || null, b.status || 'open', b.note || null, cover, b.assigned_to || null, price,
    b.brief && typeof b.brief === 'object' ? JSON.stringify(b.brief) : null);
  const did = r.lastInsertRowid;
  notifyRoles('admin', { type: 'dress', title: `New dress: ${b.customer_name}`, body: `${user.name} added a new dress booking`, link_page: 'dress', link_id: did, actor_name: user.name }, user.id);
  if (b.assigned_to) notify(b.assigned_to, { type: 'assign', title: `You were assigned a dress: ${b.customer_name}`, body: `${user.name} assigned you a new dress`, link_page: 'dress', link_id: did, actor_name: user.name });
  if (b.customer_user_id) notify(b.customer_user_id, { type: 'dress', title: 'A new dress was registered for you 👗', body: 'You can follow the updates here', link_page: 'dress', link_id: did, actor_name: user.name });
  send(res, 200, { id: did });
};
api['PUT /api/dresses/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req); const c = db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const price = (user.role === 'admin' && b.price != null) ? b.price : c.price; // only admin edits price
  const measImg = (b.measure_image && b.measure_image.startsWith('data:')) ? maybeImage(b.measure_image) : (b.measure_image ?? c.measure_image);
  const meas = b.measurements != null ? (typeof b.measurements === 'string' ? b.measurements : JSON.stringify(b.measurements)) : c.measurements;
  const brief = b.brief && typeof b.brief === 'object' ? JSON.stringify(b.brief) : c.brief;
  db.prepare('UPDATE dresses SET customer_name=?,customer_user_id=?,phone=?,delivery_date=?,status=?,note=?,assigned_to=?,price=?,measurements=?,measure_note=?,measure_image=?,brief=? WHERE id=?').run(
    b.customer_name ?? c.customer_name, b.customer_user_id ?? c.customer_user_id, b.phone ?? c.phone, b.delivery_date ?? c.delivery_date, b.status ?? c.status, b.note ?? c.note, b.assigned_to ?? c.assigned_to, price, meas, b.measure_note ?? c.measure_note, measImg, brief, params.id);
  // --- notifications on status / assignment changes ---
  const did = Number(params.id);
  const stLabel = { open: 'New', in_progress: 'In progress', delivered: 'Delivered' };
  const statusChanged = b.status != null && b.status !== c.status;
  const assignChanged = b.assigned_to != null && String(b.assigned_to || '') !== String(c.assigned_to || '');
  if (statusChanged) {
    const st = stLabel[b.status] || b.status;
    if (c.assigned_to) notify(c.assigned_to, { type: 'dress', title: `${c.customer_name}'s dress: ${st}`, body: `${user.name} changed the dress status`, link_page: 'dress', link_id: did, actor_name: user.name });
    if (c.customer_user_id) notify(c.customer_user_id, { type: 'dress', title: `Your dress is now: ${st}`, body: 'Your dress status changed', link_page: 'dress', link_id: did, actor_name: user.name });
    if (user.role === 'manager') notifyRoles('admin', { type: 'dress', title: `${user.name} changed ${c.customer_name}'s dress to ${st}`, link_page: 'dress', link_id: did, actor_name: user.name }, user.id);
  }
  if (assignChanged && b.assigned_to) {
    notify(b.assigned_to, { type: 'assign', title: `You were assigned a dress: ${c.customer_name}`, body: `${user.name} assigned you this dress`, link_page: 'dress', link_id: did, actor_name: user.name });
    if (user.role === 'manager') notifyRoles('admin', { type: 'assign', title: `${user.name} assigned ${c.customer_name}'s dress to a staff member`, link_page: 'dress', link_id: did, actor_name: user.name }, user.id);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/dresses/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  db.prepare('DELETE FROM dresses WHERE id=?').run(params.id);
  db.prepare('DELETE FROM dress_fittings WHERE dress_id=?').run(params.id);
  db.prepare('DELETE FROM dress_images WHERE dress_id=?').run(params.id);
  db.prepare('DELETE FROM dress_payments WHERE dress_id=?').run(params.id);
  db.prepare('DELETE FROM dress_updates WHERE dress_id=?').run(params.id);
  send(res, 200, { ok: true });
};
// materials bought for a dress — admin + manager (operational; NOT price/deposit)
api['GET /api/dresses/:id/purchases'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  send(res, 200, db.prepare(`SELECT l.item, l.amount, pi.shop, pi.invoice_date, pi.created_at,
      (SELECT name FROM vendors WHERE id=pi.vendor_id) vendor_name
    FROM purchase_lines l JOIN purchase_invoices pi ON pi.id=l.invoice_id
    WHERE l.dress_id=? ORDER BY pi.id DESC, l.id`).all(params.id));
};
// ---- dress payments (client deposits/installments) — admin only (price is admin-only) ----
api['GET /api/dresses/:id/payments'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  send(res, 200, db.prepare('SELECT * FROM dress_payments WHERE dress_id=? ORDER BY COALESCE(paid_at,created_at) DESC, id DESC').all(params.id));
};
api['POST /api/dresses/:id/payments'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.amount) return send(res, 400, { error: 'Amount is required' });
  const img = maybeImage(b.image);
  const method = b.method === 'cash' ? 'cash' : 'transfer';
  const r = db.prepare("INSERT INTO dress_payments (dress_id,amount,method,note,image,paid_at) VALUES (?,?,?,?,?,COALESCE(?,datetime('now')))")
    .run(params.id, b.amount, method, b.note || null, img, b.paid_at || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/dress-payments/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM dress_payments WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/dresses/:id/fittings'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO dress_fittings (dress_id,fitting_date,note,done) VALUES (?,?,?,?)').run(params.id, b.fitting_date, b.note || null, b.done ? 1 : 0);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/fittings/:id'] = async (req, res, user, url, params) => { if (!requireManager(user, res)) return; db.prepare('DELETE FROM dress_fittings WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['POST /api/dresses/:id/images'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const img = maybeImage(b.image);
  if (!img) return send(res, 400, { error: 'no image' });
  const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM dress_images WHERE dress_id=?').get(params.id).p;
  const r = db.prepare('INSERT INTO dress_images (dress_id,image,caption,position) VALUES (?,?,?,?)').run(params.id, img, b.caption || null, pos);
  if (!db.prepare('SELECT cover_image FROM dresses WHERE id=?').get(params.id).cover_image) db.prepare('UPDATE dresses SET cover_image=? WHERE id=?').run(img, params.id);
  send(res, 200, { id: r.lastInsertRowid });
};
// reorder photos; first in the order becomes the cover shown outside
api['PUT /api/dresses/:id/image-order'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const order = Array.isArray(b.order) ? b.order : [];
  order.forEach((imgId, i) => db.prepare('UPDATE dress_images SET position=? WHERE id=? AND dress_id=?').run(i, imgId, params.id));
  if (order.length) {
    const first = db.prepare('SELECT image FROM dress_images WHERE id=? AND dress_id=?').get(order[0], params.id);
    if (first) db.prepare('UPDATE dresses SET cover_image=? WHERE id=?').run(first.image, params.id);
  }
  send(res, 200, { ok: true });
};
api['DELETE /api/dress-images/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const img = db.prepare('SELECT * FROM dress_images WHERE id=?').get(params.id);
  db.prepare('DELETE FROM dress_images WHERE id=?').run(params.id);
  if (img) { // if the deleted photo was the cover, promote the next one (or clear)
    const dr = db.prepare('SELECT cover_image FROM dresses WHERE id=?').get(img.dress_id);
    if (dr && dr.cover_image === img.image) {
      const next = db.prepare('SELECT image FROM dress_images WHERE dress_id=? ORDER BY position,id LIMIT 1').get(img.dress_id);
      db.prepare('UPDATE dresses SET cover_image=? WHERE id=?').run(next ? next.image : null, img.dress_id);
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
    if (round) return send(res, 200, db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE u.round_id=? ORDER BY a.date DESC').all(round));
    if (uid) return send(res, 200, db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY date DESC').all(uid));
    if (user.role === 'staff') return send(res, 200, db.prepare('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC').all(user.id)); // staff no-param: own timeline (check-in screen)
    return send(res, 200, db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id ORDER BY date DESC LIMIT 300').all());
  }
  send(res, 200, db.prepare('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC').all(user.id));
};
function haversine(lat1, lon1, lat2, lon2) { // metres between two lat/lng points
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
api['POST /api/attendance/check'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  // geofence: if enabled, the check must happen within the studio radius
  const cfg = {}; db.prepare('SELECT key,value FROM settings').all().forEach((r) => { cfg[r.key] = r.value; });
  if (cfg.geo_enabled === '1' && cfg.geo_lat && cfg.geo_lng) {
    if (b.lat == null || b.lng == null) return send(res, 400, { error: 'Location needed — turn on location and try again' });
    const dist = haversine(Number(cfg.geo_lat), Number(cfg.geo_lng), Number(b.lat), Number(b.lng));
    const radius = Number(cfg.geo_radius) || 150;
    if (dist > radius) return send(res, 403, { error: `You are ${Math.round(dist)}m from the studio — you must be within ${radius}m to check in/out` });
  }
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toTimeString().slice(0, 5);
  let rec = db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(user.id, today);
  if (!rec) { db.prepare('INSERT INTO attendance (user_id,date,check_in) VALUES (?,?,?)').run(user.id, today, now); return send(res, 200, { action: 'in', time: now }); }
  if (!rec.check_out) { db.prepare('UPDATE attendance SET check_out=? WHERE id=?').run(now, rec.id); return send(res, 200, { action: 'out', time: now }); }
  send(res, 200, { action: 'done' });
};
api['POST /api/attendance'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO attendance (user_id,date,check_in,check_out,note) VALUES (?,?,?,?,?)').run(b.user_id, b.date, b.check_in || null, b.check_out || null, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['GET /api/salaries'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, db.prepare('SELECT s.*,u.name user_name,(s.base+s.bonus-s.deduction) net FROM salaries s JOIN users u ON u.id=s.user_id ORDER BY month DESC,u.name').all());
  send(res, 200, db.prepare('SELECT *,(base+bonus-deduction) net FROM salaries WHERE user_id=? ORDER BY month DESC').all(user.id));
};
api['POST /api/salaries'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO salaries (user_id,month,base,bonus,deduction,paid,note) VALUES (?,?,?,?,?,?,?)').run(b.user_id, b.month, b.base || 0, b.bonus || 0, b.deduction || 0, b.paid ? 1 : 0, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/salaries/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  db.prepare('UPDATE salaries SET paid=? WHERE id=?').run(b.paid ? 1 : 0, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/salaries/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM salaries WHERE id=?').run(params.id); send(res, 200, { ok: true }); };
api['GET /api/leaves'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, db.prepare('SELECT l.*,u.name user_name FROM leaves l JOIN users u ON u.id=l.user_id ORDER BY status,from_date DESC').all());
  send(res, 200, db.prepare('SELECT * FROM leaves WHERE user_id=? ORDER BY from_date DESC').all(user.id));
};
api['POST /api/leaves'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const uid = user.role === 'admin' ? b.user_id : user.id;
  const r = db.prepare('INSERT INTO leaves (user_id,from_date,to_date,type,reason,status) VALUES (?,?,?,?,?,?)').run(uid, b.from_date, b.to_date, b.type || 'annual', b.reason || null, user.role === 'admin' ? (b.status || 'approved') : 'pending');
  if (user.role !== 'admin') notifyRoles('admin', { type: 'leave', title: `Leave request from ${user.name}`, body: `${b.from_date} → ${b.to_date}`, link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/leaves/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const lv = db.prepare('SELECT * FROM leaves WHERE id=?').get(params.id);
  db.prepare('UPDATE leaves SET status=? WHERE id=?').run(b.status, params.id);
  if (lv) notify(lv.user_id, { type: 'leave', title: `Leave request ${b.status === 'approved' ? 'approved ✅' : 'rejected ❌'}`, body: `${lv.from_date} → ${lv.to_date}`, link_page: 'myrequests', actor_name: user.name });
  send(res, 200, { ok: true });
};

// ================= ROLE PERMISSIONS (admin-managed section visibility) =================
// Admin reads the full matrix of hidden sections per role
api['GET /api/permissions'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = db.prepare('SELECT role,page,visible FROM role_perms').all();
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
  db.prepare(`INSERT INTO role_perms (role,page,visible) VALUES (?,?,?)
    ON CONFLICT(role,page) DO UPDATE SET visible=excluded.visible`).run(b.role, b.page, vis);
  send(res, 200, { ok: true });
};
// Any signed-in user gets the list of sections hidden for THEIR role (admin: none)
api['GET /api/my-permissions'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (user.role === 'admin') return send(res, 200, { hidden: [] });
  const rows = db.prepare('SELECT page FROM role_perms WHERE role=? AND visible=0').all(user.role);
  send(res, 200, { hidden: rows.map((r) => r.page) });
};

// ================= CONFIGURATION (settings) =================
api['GET /api/settings'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {}; rows.forEach((r) => { out[r.key] = r.value; });
  send(res, 200, out);
};
api['PUT /api/settings'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  Object.entries(b || {}).forEach(([k, v]) => up.run(k, v == null ? '' : String(v)));
  send(res, 200, { ok: true });
};

// ================= STAFF HR: ABSENCES / ADVANCES / SALARY =================
api['GET /api/absences'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return;
  const uid = user.role === 'admin' ? url.searchParams.get('user_id') : user.id; // non-admin: own only
  const q = uid ? 'SELECT a.*,u.name user_name FROM absences a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY date DESC'
    : 'SELECT a.*,u.name user_name FROM absences a JOIN users u ON u.id=a.user_id ORDER BY date DESC';
  send(res, 200, uid ? db.prepare(q).all(uid) : db.prepare(q).all());
};
api['POST /api/absences'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  const uid = user.role === 'admin' ? b.user_id : user.id; // staff report their own absence (pending until admin confirms)
  if (!uid || !b.date) return send(res, 400, { error: 'date required' });
  const status = user.role === 'admin' ? 'confirmed' : 'pending';
  const r = db.prepare('INSERT INTO absences (user_id,date,reason,status) VALUES (?,?,?,?)').run(uid, b.date, b.reason || null, status);
  if (user.role !== 'admin') notifyRoles('admin', { type: 'absence', title: `${user.name} reported an absence`, body: `${b.date}${b.reason ? ' · ' + b.reason : ''}`, link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/absences/:id/confirm'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const ab = db.prepare('SELECT * FROM absences WHERE id=?').get(params.id);
  db.prepare("UPDATE absences SET status='confirmed' WHERE id=?").run(params.id);
  if (ab) notify(ab.user_id, { type: 'absence', title: 'Absence confirmed', body: `${ab.date}`, link_page: 'myrequests', actor_name: user.name });
  send(res, 200, { ok: true });
};
api['DELETE /api/absences/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM absences WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// manual salary adjustments (bonus / deduction) per month
api['GET /api/adjustments'] = async (req, res, user, url) => {
  if (!requireAdmin(user, res)) return;
  const uid = url.searchParams.get('user_id');
  const q = uid ? 'SELECT * FROM salary_adjustments WHERE user_id=? ORDER BY created_at DESC'
    : 'SELECT a.*,u.name user_name FROM salary_adjustments a JOIN users u ON u.id=a.user_id ORDER BY created_at DESC';
  send(res, 200, uid ? db.prepare(q).all(uid) : db.prepare(q).all());
};
api['POST /api/adjustments'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.user_id || !b.amount) return send(res, 400, { error: 'staff and amount required' });
  const type = b.type === 'deduction' ? 'deduction' : 'bonus';
  const r = db.prepare('INSERT INTO salary_adjustments (user_id,month,amount,type,note) VALUES (?,?,?,?,?)').run(b.user_id, b.month || null, b.amount, type, b.note || null);
  notify(b.user_id, { type: 'salary', title: type === 'bonus' ? `Bonus ${money0(b.amount)} 🎉` : `Deduction ${money0(b.amount)}`, body: b.note || '', link_page: 'mysalary', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/adjustments/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM salary_adjustments WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

api['GET /api/advances'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return;
  const uid = user.role === 'admin' ? url.searchParams.get('user_id') : user.id; // non-admin: own only
  const q = uid ? 'SELECT a.*,u.name user_name FROM advances a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY created_at DESC'
    : 'SELECT a.*,u.name user_name FROM advances a JOIN users u ON u.id=a.user_id ORDER BY created_at DESC';
  send(res, 200, uid ? db.prepare(q).all(uid) : db.prepare(q).all());
};
api['POST /api/advances'] = async (req, res, user) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  const uid = user.role === 'admin' ? b.user_id : user.id;
  if (!uid || !b.amount) return send(res, 400, { error: 'amount required' });
  // admin creates approved advances; staff request pending ones (deduct from current month once approved)
  const status = user.role === 'admin' ? (b.status || 'approved') : 'pending';
  const month = user.role === 'admin' ? (b.month || null) : new Date().toISOString().slice(0, 7);
  const r = db.prepare('INSERT INTO advances (user_id,amount,month,note,status) VALUES (?,?,?,?,?)').run(uid, b.amount, month, b.note || null, status);
  if (user.role !== 'admin') notifyRoles('admin', { type: 'advance', title: `Advance request from ${user.name}`, body: money0(b.amount), link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/advances/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const adv = db.prepare('SELECT * FROM advances WHERE id=?').get(params.id);
  const st = b.status === 'approved' ? 'approved' : 'rejected';
  db.prepare('UPDATE advances SET status=? WHERE id=?').run(st, params.id);
  if (adv) notify(adv.user_id, { type: 'advance', title: `Advance request ${st === 'approved' ? 'approved ✅' : 'rejected ❌'}`, body: money0(adv.amount), link_page: 'myrequests', actor_name: user.name });
  send(res, 200, { ok: true });
};
api['DELETE /api/advances/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM advances WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// Auto salary breakdown for a staff member in a given month (YYYY-MM). Admin, or the staff themselves.
api['GET /api/staff/:id/salary'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  if (user.role !== 'admin' && user.id !== Number(params.id)) return send(res, 403, { error: 'forbidden' });
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const u = db.prepare('SELECT id,name,base_salary,off_days FROM users WHERE id=?').get(params.id);
  if (!u) return send(res, 404, { error: 'not found' });
  const cfg = {}; db.prepare('SELECT key,value FROM settings').all().forEach((r) => { cfg[r.key] = r.value; });
  const wd = Number(cfg.work_days_per_month) || 30;
  const base = Number(u.base_salary) || 0;
  const daily = wd ? base / wd : 0;
  const inMin = hm2min(cfg.check_in_time || '09:00');
  const outMin = hm2min(cfg.check_out_time || '17:00');
  const grace = Number(cfg.late_grace_min) || 0;
  const otMult = Number(cfg.overtime_mult) || 1.5;
  const workHours = Math.max(1, (outMin - inMin) / 60);
  const hourly = daily / workHours;
  const off = new Set((u.off_days || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  // confirmed absences (skip the staff's paid weekly off-days)
  const absRows = db.prepare("SELECT date FROM absences WHERE user_id=? AND substr(date,1,7)=? AND (status IS NULL OR status='confirmed')").all(params.id, month);
  const absDays = absRows.filter((a) => !off.has(weekdayOf(a.date))).length;

  // lateness + overtime from attendance (skip off-days; grace period on lateness)
  let lateMin = 0, otMin = 0;
  db.prepare('SELECT date,check_in,check_out FROM attendance WHERE user_id=? AND substr(date,1,7)=?').all(params.id, month).forEach((a) => {
    if (off.has(weekdayOf(a.date))) return;
    if (a.check_in) { const late = hm2min(a.check_in) - inMin; if (late > grace) lateMin += (late - grace); }
    if (a.check_out) { const ot = hm2min(a.check_out) - outMin; if (ot > 0) otMin += ot; }
  });

  const advTotal = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM advances WHERE user_id=? AND month=? AND (status IS NULL OR status='approved')").get(params.id, month).s;
  const bonus = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM salary_adjustments WHERE user_id=? AND month=? AND type='bonus'").get(params.id, month).s;
  const deductions = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM salary_adjustments WHERE user_id=? AND month=? AND type='deduction'").get(params.id, month).s;
  const r2 = (x) => Math.round(x * 100) / 100;
  const absenceDeduction = r2(daily * absDays);
  const lateDeduction = r2((lateMin / 60) * hourly);
  const overtimePay = r2((otMin / 60) * otMult * hourly);
  const net = r2(base + bonus + overtimePay - absenceDeduction - lateDeduction - advTotal - deductions);
  send(res, 200, {
    user: u.name, month, base, work_days: wd, daily: r2(daily), hourly: r2(hourly), work_hours: workHours,
    absent_days: absDays, absence_deduction: absenceDeduction,
    late_minutes: lateMin, late_deduction: lateDeduction, overtime_minutes: otMin, overtime_pay: overtimePay, overtime_mult: otMult,
    bonus, deductions, advances: advTotal, net,
  });
};

// ================= DRESS MATERIAL PURCHASES (invoices + dress-linked lines) =================
api['GET /api/purchases'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const invs = db.prepare('SELECT pi.*, (SELECT name FROM vendors WHERE id=pi.vendor_id) vendor_name FROM purchase_invoices pi ORDER BY pi.id DESC').all();
  invs.forEach((inv) => {
    inv.lines = db.prepare('SELECT l.*, (SELECT customer_name FROM dresses WHERE id=l.dress_id) dress_name FROM purchase_lines l WHERE l.invoice_id=?').all(inv.id);
    inv.total = inv.lines.reduce((a, x) => a + (x.amount || 0), 0);
  });
  send(res, 200, invs);
};
api['POST /api/purchases'] = async (req, res, user) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const img = maybeImage(b.image);
  const r = db.prepare('INSERT INTO purchase_invoices (shop,vendor_id,image,note,invoice_date,created_by) VALUES (?,?,?,?,?,?)').run(b.shop || null, b.vendor_id || null, img, b.note || null, b.invoice_date || null, user.id);
  const invId = r.lastInsertRowid;
  (Array.isArray(b.lines) ? b.lines : []).forEach((li) => {
    if (li && (li.dress_id || li.amount)) db.prepare('INSERT INTO purchase_lines (invoice_id,dress_id,item,amount) VALUES (?,?,?,?)').run(invId, li.dress_id || null, li.item || null, li.amount || 0);
  });
  send(res, 200, { id: invId });
};
api['PUT /api/purchases/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req); const c = db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const img = (b.image && b.image.startsWith('data:')) ? maybeImage(b.image) : (b.image ?? c.image);
  db.prepare('UPDATE purchase_invoices SET shop=?,vendor_id=?,note=?,invoice_date=?,image=? WHERE id=?').run(b.shop ?? c.shop, b.vendor_id ?? c.vendor_id, b.note ?? c.note, b.invoice_date ?? c.invoice_date, img, params.id);
  send(res, 200, { ok: true });
};
// Move a mis-filed item to the dress it really belongs to (or off a dress entirely)
api['PUT /api/purchase-lines/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const line = db.prepare('SELECT * FROM purchase_lines WHERE id=?').get(params.id);
  if (!line) return send(res, 404, { error: 'not found' });
  db.prepare('UPDATE purchase_lines SET dress_id=?,item=?,amount=? WHERE id=?')
    .run(b.dress_id === null ? null : (b.dress_id ?? line.dress_id), b.item ?? line.item, b.amount ?? line.amount, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/purchases/:id'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  db.prepare('DELETE FROM purchase_lines WHERE invoice_id=?').run(params.id);
  db.prepare('DELETE FROM purchase_invoices WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
};

// ================= SALARY DISBURSEMENTS (admin sends, staff confirms) =================
api['GET /api/salary-payments'] = async (req, res, user, url) => {
  if (!requireStaffish(user, res)) return;
  const uid = user.role === 'admin' ? url.searchParams.get('user_id') : user.id; // non-admin: own only
  const q = uid ? 'SELECT s.*,u.name user_name FROM salary_payments s JOIN users u ON u.id=s.user_id WHERE s.user_id=? ORDER BY s.created_at DESC'
    : 'SELECT s.*,u.name user_name FROM salary_payments s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC';
  send(res, 200, uid ? db.prepare(q).all(uid) : db.prepare(q).all());
};
api['POST /api/salary-payments'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.user_id) return send(res, 400, { error: 'staff required' });
  const img = maybeImage(b.image);
  const r = db.prepare('INSERT INTO salary_payments (user_id,month,amount,image,note) VALUES (?,?,?,?,?)').run(b.user_id, b.month || null, b.amount || 0, img, b.note || null);
  notify(b.user_id, { type: 'salary', title: `You received a salary of ${money0(b.amount)} 💵`, body: 'Open the Salary screen and confirm receipt', link_page: 'mysalary', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
};
// staff (owner) confirms receipt; admin may also confirm
api['PUT /api/salary-payments/:id/confirm'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return;
  const p = db.prepare('SELECT * FROM salary_payments WHERE id=?').get(params.id);
  if (!p) return send(res, 404, { error: 'not found' });
  if (user.role !== 'admin' && p.user_id !== user.id) return send(res, 403, { error: 'forbidden' });
  db.prepare("UPDATE salary_payments SET status='confirmed', confirmed_at=datetime('now') WHERE id=?").run(params.id);
  if (user.role !== 'admin') notifyRoles('admin', { type: 'salary', title: `${user.name} confirmed salary receipt ✅`, body: money0(p.amount), link_page: 'staff', actor_name: user.name }, user.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/salary-payments/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM salary_payments WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= EXPENSES (vendors, types, entries) =================
// Each vendor carries its unified spend = material purchases + general expenses.
api['GET /api/vendors'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = db.prepare('SELECT * FROM vendors ORDER BY name').all();
  rows.forEach((v) => {
    v.purchases_total = db.prepare('SELECT COALESCE(SUM(l.amount),0) s FROM purchase_lines l JOIN purchase_invoices pi ON pi.id=l.invoice_id WHERE pi.vendor_id=?').get(v.id).s;
    v.expenses_total = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE vendor_id=?').get(v.id).s;
    v.total = v.purchases_total + v.expenses_total;
  });
  send(res, 200, rows);
};
// Full per-vendor report: every material invoice + every expense from that vendor, with totals.
api['GET /api/vendors/:id/report'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const vendor = db.prepare('SELECT * FROM vendors WHERE id=?').get(params.id);
  if (!vendor) return send(res, 404, { error: 'not found' });
  const purchases = db.prepare('SELECT * FROM purchase_invoices WHERE vendor_id=? ORDER BY COALESCE(invoice_date,created_at) DESC, id DESC').all(params.id);
  purchases.forEach((inv) => {
    inv.lines = db.prepare('SELECT l.*, (SELECT customer_name FROM dresses WHERE id=l.dress_id) dress_name FROM purchase_lines l WHERE l.invoice_id=?').all(inv.id);
    inv.total = inv.lines.reduce((a, x) => a + (x.amount || 0), 0);
  });
  const expenses = db.prepare('SELECT * FROM expenses WHERE vendor_id=? ORDER BY COALESCE(date,created_at) DESC, id DESC').all(params.id);
  const pTotal = purchases.reduce((a, p) => a + p.total, 0);
  const eTotal = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  send(res, 200, { vendor, purchases, expenses, totals: { purchases: pTotal, expenses: eTotal, grand: pTotal + eTotal } });
};
api['POST /api/vendors'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.name) return send(res, 400, { error: 'name required' });
  const r = db.prepare('INSERT INTO vendors (name,phone,note) VALUES (?,?,?)').run(b.name, b.phone || null, b.note || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/vendors/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM vendors WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

api['GET /api/expense-types'] = async (req, res, user) => { if (!requireAdmin(user, res)) return; send(res, 200, db.prepare('SELECT * FROM expense_types ORDER BY name').all()); };
api['POST /api/expense-types'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.name) return send(res, 400, { error: 'name required' });
  const r = db.prepare('INSERT INTO expense_types (name) VALUES (?)').run(b.name);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/expense-types/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM expense_types WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

api['GET /api/expenses'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  send(res, 200, db.prepare('SELECT e.*, (SELECT name FROM vendors WHERE id=e.vendor_id) vendor_name FROM expenses e ORDER BY date DESC, e.id DESC').all());
};
api['POST /api/expenses'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  if (!b.amount) return send(res, 400, { error: 'amount required' });
  const img = maybeImage(b.image);
  const r = db.prepare('INSERT INTO expenses (vendor_id,type,amount,date,note,image) VALUES (?,?,?,?,?,?)').run(b.vendor_id || null, b.type || null, b.amount, b.date || null, b.note || null, img);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/expenses/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM expenses WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= NOTIFICATIONS =================
// Raw file upload — the body IS the file, so an HD video does not have to be
// base64'd into JSON (which adds a third to its size) before it can be sent.
const UPLOAD_MAX = 400 * 1024 * 1024;
const EXT_OK = { mp4: '.mp4', mov: '.mov', webm: '.webm', jpg: '.jpg', jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif' };
function receiveUpload(req, res, user) {
  if (!requireAuth(user, res)) return;
  const url = new URL(req.url, 'http://x');
  const ext = EXT_OK[String(url.searchParams.get('ext') || '').toLowerCase().replace('.', '')];
  if (!ext) return send(res, 400, { error: 'Unsupported file type' });
  const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const dest = path.join(UPLOAD_DIR, name);
  const out = fs.createWriteStream(dest);
  let size = 0, failed = false;
  const fail = (code, msg) => {
    if (failed) return; failed = true;
    out.destroy(); fs.unlink(dest, () => {});
    req.destroy(); send(res, code, { error: msg });
  };
  req.on('data', (c) => { size += c.length; if (size > UPLOAD_MAX) fail(413, 'File is too large (400 MB max)'); });
  req.on('error', () => fail(400, 'Upload failed'));
  out.on('error', () => fail(500, 'Could not save the file'));
  req.pipe(out);
  out.on('close', () => { if (!failed) send(res, 200, { file: name, size }); });
}
// ---- Client invitations ----
function appOrigin(req) {
  const host = req.headers.host || '';
  // behind Railway the proxy tells us; locally there is no header and no TLS
  const fwd = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = fwd || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
function makeInvite(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET invite_token=?,invite_expires=? WHERE id=?').run(token, expires, userId);
  return token;
}

// Give the client of a dress her own way in: link (or create) her account and mint a link.
api['POST /api/dresses/:id/invite-client'] = async (req, res, user, url, params) => {
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return send(res, 400, { error: 'Enter a valid email' });
  const dress = db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!dress) return send(res, 404, { error: 'Dress not found' });

  let client = db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);
  if (!client) {
    const id = db.prepare('INSERT INTO users (name,email,password_hash,role,invited) VALUES (?,?,?,?,1)')
      .run(b.name || dress.customer_name, email, hashPassword(crypto.randomBytes(9).toString('hex')), 'customer').lastInsertRowid;
    client = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  } else if (client.role === 'visitor') {
    db.prepare("UPDATE users SET role='customer' WHERE id=?").run(client.id); // she is a client now
  }
  db.prepare('UPDATE dresses SET customer_user_id=? WHERE id=?').run(client.id, dress.id);

  const token = makeInvite(client.id);
  const link = `${appOrigin(req)}/?invite=${token}`;
  let emailed = false, mailError = null;
  const gUser = process.env.GMAIL_USER, gPass = process.env.GMAIL_APP_PASSWORD;
  if (gUser && gPass) {
    try {
      await smtpSend({ user: gUser, pass: gPass, to: email, subject: 'Dalia Bassel — your dress',
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
  const u = db.prepare('SELECT * FROM users WHERE invite_token=?').get(token);
  if (!u || !u.active) return send(res, 400, { error: 'This link is not valid any more' });
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) return send(res, 400, { error: 'This link has expired — ask the studio for a new one' });
  db.prepare('UPDATE users SET password_hash=?,invited=0,invite_token=NULL,invite_expires=NULL WHERE id=?').run(hashPassword(password), u.id);
  const sid = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(sid, u.id);
  markLogin(u.id);
  send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` });
};
// Who is this link for? Shown on the set-a-password screen.
api['GET /api/invite/:token'] = async (req, res, user, url, params) => {
  const u = db.prepare('SELECT name,email,invite_expires,active FROM users WHERE invite_token=?').get(params.token);
  if (!u || !u.active) return send(res, 404, { error: 'This link is not valid any more' });
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) return send(res, 410, { error: 'This link has expired' });
  send(res, 200, { name: u.name, email: u.email });
};

// What is on offer — the only thing a visitor may read about the academy
api['GET /api/public/rounds'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  send(res, 200, db.prepare("SELECT id,name,start_date,kind FROM rounds WHERE active=1 ORDER BY id DESC").all());
};

// ================= CUSTOMER SERVICE CHAT =================
const CHAT_TOPICS = ['dress', 'course', 'general'];
const topicWord = { dress: 'a dress', course: 'the courses', general: 'the studio' };
const isStudio = (u) => ['admin', 'manager', 'staff'].includes(u.role);

function threadRow(t) {
  const last = db.prepare('SELECT body,from_studio,created_at FROM chat_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1').get(t.id);
  let brief = null; try { brief = t.brief ? JSON.parse(t.brief) : null; } catch (e) {}
  return { ...t, brief, brief_line: briefLine(brief),
    last_body: last ? last.body : null, last_from_studio: last ? last.from_studio : 0 };
}

// Studio sees every thread; anyone else sees only their own.
api['GET /api/chats'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  if (isStudio(user)) {
    const rows = db.prepare(`SELECT t.*, u.name user_name, u.role user_role,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id AND m.from_studio=0 AND m.seen_by_studio=0) unread
      FROM chat_threads t JOIN users u ON u.id=t.user_id ORDER BY t.last_at DESC`).all();
    return send(res, 200, { threads: rows.map(threadRow), studio: true });
  }
  const rows = db.prepare(`SELECT t.*,
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
  const tid = db.prepare('INSERT INTO chat_threads (user_id,topic,subject,brief) VALUES (?,?,?,?)')
    .run(user.id, topic, b.subject || null, brief ? JSON.stringify(brief) : null).lastInsertRowid;
  db.prepare('INSERT INTO chat_messages (thread_id,user_id,from_studio,body,image,media,seen_by_user) VALUES (?,?,0,?,?,?,1)')
    .run(tid, user.id, body || null, maybeImage(b.image), media.length ? JSON.stringify(media) : null);
  const line = briefLine(brief);
  notifyRoles(['admin', 'manager', 'staff'], {
    type: 'chat', title: `${user.name} asks about ${topicWord[topic]}`,
    body: (line || body).slice(0, 90), link_page: 'chats', link_id: tid, actor_name: user.name,
  }, user.id);
  send(res, 200, { id: tid });
};

// The conversation. Opening it marks the other side's messages as seen.
api['GET /api/chats/:id'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const t = db.prepare('SELECT t.*,u.name user_name,u.role user_role FROM chat_threads t JOIN users u ON u.id=t.user_id WHERE t.id=?').get(params.id);
  if (!t) return send(res, 404, { error: 'not found' });
  if (!isStudio(user) && t.user_id !== user.id) return send(res, 403, { error: 'forbidden' });
  if (isStudio(user)) db.prepare('UPDATE chat_messages SET seen_by_studio=1 WHERE thread_id=? AND from_studio=0').run(t.id);
  else db.prepare('UPDATE chat_messages SET seen_by_user=1 WHERE thread_id=? AND from_studio=1').run(t.id);
  const messages = db.prepare(`SELECT m.*, u.name author_name FROM chat_messages m JOIN users u ON u.id=m.user_id
    WHERE m.thread_id=? ORDER BY m.id`).all(t.id);
  messages.forEach((m) => { try { m.media = m.media ? JSON.parse(m.media) : []; } catch (e) { m.media = []; } });
  try { t.brief = t.brief ? JSON.parse(t.brief) : null; } catch (e) { t.brief = null; }
  send(res, 200, { thread: t, messages, studio: isStudio(user) });
};

api['POST /api/chats/:id/messages'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const t = db.prepare('SELECT * FROM chat_threads WHERE id=?').get(params.id);
  if (!t) return send(res, 404, { error: 'not found' });
  const studio = isStudio(user);
  if (!studio && t.user_id !== user.id) return send(res, 403, { error: 'forbidden' });
  const b = await readBody(req);
  const body = (b.body || '').trim();
  const img = maybeImage(b.image);
  if (!body && !img && !(b.media || []).length) return send(res, 400, { error: 'Write a message first' });
  const media = (b.media || []).filter((m) => m && m.file).slice(0, 12);
  db.prepare('INSERT INTO chat_messages (thread_id,user_id,from_studio,body,image,media,seen_by_studio,seen_by_user) VALUES (?,?,?,?,?,?,?,?)')
    .run(t.id, user.id, studio ? 1 : 0, body || null, img, media.length ? JSON.stringify(media) : null, studio ? 1 : 0, studio ? 0 : 1);
  db.prepare("UPDATE chat_threads SET last_at=datetime('now'), status='open' WHERE id=?").run(t.id);
  if (studio) {
    notify(t.user_id, { type: 'chat', title: `Dalia Bassel replied`, body: (body || 'Sent a photo').slice(0, 90), link_page: 'help', link_id: t.id, actor_name: user.name });
  } else {
    notifyRoles(['admin', 'manager', 'staff'], {
      type: 'chat', title: `${user.name} · ${topicWord[t.topic]}`, body: (body || 'Sent a photo').slice(0, 90),
      link_page: 'chats', link_id: t.id, actor_name: user.name,
    }, user.id);
  }
  send(res, 200, { ok: true });
};

api['PUT /api/chats/:id'] = async (req, res, user, url, params) => {
  if (!requireStaffish(user, res)) return;
  const b = await readBody(req);
  db.prepare('UPDATE chat_threads SET status=? WHERE id=?').run(b.status === 'closed' ? 'closed' : 'open', params.id);
  send(res, 200, { ok: true });
};

api['GET /api/notifications'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 80').all(user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(user.id).c;
  send(res, 200, { items, unread });
};
// lightweight badge poll
api['GET /api/notifications/count'] = async (req, res, user) => {
  if (!user) return send(res, 200, { unread: 0 });
  send(res, 200, { unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(user.id).c });
};
api['POST /api/notifications/read-all'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(user.id);
  send(res, 200, { ok: true });
};
api['POST /api/notifications/:id/read'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(params.id, user.id);
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
  const d = db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!dressAccessible(user, d)) return send(res, 403, { error: 'forbidden' });
  // opening the thread clears the red dot for this viewer
  db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0 AND link_page='dress' AND link_id=?").run(user.id, Number(params.id));
  send(res, 200, db.prepare('SELECT * FROM dress_updates WHERE dress_id=? ORDER BY id').all(params.id));
};
api['POST /api/dresses/:id/updates'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const d = db.prepare('SELECT * FROM dresses WHERE id=?').get(params.id);
  if (!dressAccessible(user, d)) return send(res, 403, { error: 'forbidden' });
  const b = await readBody(req);
  const img = maybeImage(b.image);
  if (!b.body && !img) return send(res, 400, { error: 'Write a note or add a photo' });
  const r = db.prepare('INSERT INTO dress_updates (dress_id,author_id,author_name,author_role,body,image) VALUES (?,?,?,?,?,?)')
    .run(params.id, user.id, user.name, user.role, b.body || null, img);
  const preview = (b.body || '📷 New photo').slice(0, 90);
  if (user.role === 'customer') {
    // client -> studio: red dot on the dress for every admin/manager
    notifyRoles(['admin', 'manager'], { type: 'dress', title: `Client ${d.customer_name} sent a note`, body: preview, link_page: 'dress', link_id: Number(params.id), actor_name: user.name }, user.id);
  } else {
    // studio (admin/manager/staff) -> client, and keep admins in the loop for manager/staff posts
    notify(d.customer_user_id, { type: 'dress', title: `Update on ${d.customer_name}'s dress`, body: preview, link_page: 'dress', link_id: Number(params.id), image: img, actor_name: user.name });
    if (user.role !== 'admin') notifyRoles('admin', { type: 'dress', title: `${user.name} updated ${d.customer_name}'s dress`, body: preview, link_page: 'dress', link_id: Number(params.id), actor_name: user.name }, user.id);
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (pathname === '/api/upload' && req.method === 'POST') {
      return receiveUpload(req, res, getUser(req)); // streamed to disk, never buffered
    }
    if (pathname.startsWith('/api/')) {
      const m = match(req.method, pathname);
      if (!m) return send(res, 404, { error: 'route not found' });
      const user = getUser(req);
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
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => console.log(`Daliessa Academy running on http://localhost:${PORT}`));
