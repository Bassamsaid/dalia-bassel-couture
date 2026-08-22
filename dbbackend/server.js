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
  return db.prepare('SELECT id,name,email,phone,role,round_id,group_id,job_title,base_salary,hire_date,active,avatar FROM users WHERE id=?').get(s.user_id) || null;
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
api['POST /api/login'] = async (req, res) => {
  const b = await readBody(req);
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get((b.email || '').trim());
  if (!u || !u.active || !verifyPassword(b.password || '', u.password_hash)) return send(res, 401, { error: 'Invalid email or password' });
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, u.id);
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
  send(res, 200, { ok: true, user: { id: u.id, name: u.name, role: u.role } }, {
    'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
  });
};
api['POST /api/register'] = async (req, res) => {
  const b = await readBody(req);
  if (!b.name || !b.email || !b.password) return send(res, 400, { error: 'All fields are required' });
  const role = b.role === 'customer' ? 'customer' : 'trainee';
  try {
    const r = db.prepare(`INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)`).run(b.name, b.email, hashPassword(b.password), role);
    const uid = r.lastInsertRowid;
    if (role === 'trainee') db.prepare('INSERT INTO enrollments (user_id,total_fee) VALUES (?,0)').run(uid);
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
    const r = db.prepare(`INSERT INTO users (name,email,phone,password_hash,role,round_id,group_id,job_title,base_salary,hire_date,governorate,off_days)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.name, b.email || null, b.phone || null, hashPassword(b.password || crypto.randomBytes(9).toString('hex')),
      b.role || 'trainee', b.round_id || null, b.group_id || null,
      b.job_title || null, b.base_salary || 0, b.hire_date || null, b.governorate || null, b.off_days || null);
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
  if (!requireManager(user, res)) return;
  const b = await readBody(req);
  const cur = db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
  if (!cur) return send(res, 404, { error: 'not found' });
  if (user.role === 'manager') { // managers may only touch students/clients and never escalate a role
    if (!['trainee', 'customer'].includes(cur.role)) return send(res, 403, { error: 'forbidden' });
    if (b.role && !['trainee', 'customer'].includes(b.role)) return send(res, 403, { error: 'cannot change role' });
  }
  db.prepare(`UPDATE users SET name=?,email=?,phone=?,role=?,round_id=?,group_id=?,job_title=?,base_salary=?,hire_date=?,active=?,governorate=?,off_days=? WHERE id=?`).run(
    b.name ?? cur.name, b.email ?? cur.email, b.phone ?? cur.phone, b.role ?? cur.role,
    b.round_id ?? cur.round_id, b.group_id ?? cur.group_id, b.job_title ?? cur.job_title,
    b.base_salary ?? cur.base_salary, b.hire_date ?? cur.hire_date, b.active ?? cur.active, b.governorate ?? cur.governorate, b.off_days ?? cur.off_days, params.id);
  if (b.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(b.password), params.id);
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
  rows.forEach((r) => { r.remaining = Math.max(0, (r.total_fee || 0) - (r.paid || 0)); });
  const totals = rows.reduce((a, r) => { a.total_fee += r.total_fee; a.paid += r.paid; a.remaining += r.remaining; return a; },
    { total_fee: 0, paid: 0, remaining: 0, count: rows.length });
  send(res, 200, { rows, totals });
};

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
  const img = maybeImage(b.image);
  const method = b.method === 'cash' ? 'cash' : 'transfer';
  const r = db.prepare('INSERT INTO payments (user_id,amount,kind,method,image,note,paid_at) VALUES (?,?,?,?,?,?,COALESCE(?,datetime(\'now\')))').run(
    b.user_id, b.amount || 0, b.kind || 'installment', method, img, b.note || null, b.paid_at || null);
  const payer = db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id);
  notifyRoles('admin', { type: 'payment', title: `New payment: ${money0(b.amount)}`, body: `${user.name} recorded a payment for ${payer ? payer.name : ''}`, link_page: 'finance', actor_name: user.name }, user.id);
  notify(b.user_id, { type: 'payment', title: `A payment of ${money0(b.amount)} was recorded 💳`, body: 'Thank you! You can view your account', link_page: 'mypay', actor_name: user.name });
  send(res, 200, { id: r.lastInsertRowid });
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
  const list = user.role === 'admin'
    ? db.prepare('SELECT * FROM homeworks ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM homeworks WHERE round_id IS NULL OR round_id=? ORDER BY id DESC').all(user.round_id || -1);
  if (user.role !== 'admin') {
    list.forEach((h) => { h.my_submission = db.prepare('SELECT * FROM submissions WHERE homework_id=? AND user_id=?').get(h.id, user.id) || null; });
  }
  send(res, 200, list);
};
api['POST /api/homeworks'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const r = db.prepare('INSERT INTO homeworks (round_id,title,measurements,instructions,due_date) VALUES (?,?,?,?,?)').run(b.round_id || null, b.title, b.measurements || null, b.instructions || null, b.due_date || null);
  send(res, 200, { id: r.lastInsertRowid });
};
api['DELETE /api/homeworks/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM homeworks WHERE id=?').run(params.id); db.prepare('DELETE FROM submissions WHERE homework_id=?').run(params.id); send(res, 200, { ok: true }); };
api['GET /api/homeworks/:id/submissions'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  send(res, 200, db.prepare('SELECT s.*,u.name user_name FROM submissions s JOIN users u ON u.id=s.user_id WHERE homework_id=? ORDER BY submitted_at DESC').all(params.id));
};
api['POST /api/homeworks/:id/submit'] = async (req, res, user, url, params) => {
  if (!requireAuth(user, res)) return;
  const b = await readBody(req);
  const img = maybeImage(b.image);
  const ex = db.prepare('SELECT id FROM submissions WHERE homework_id=? AND user_id=?').get(params.id, user.id);
  if (ex) db.prepare('UPDATE submissions SET image=?,note=?,submitted_at=datetime(\'now\') WHERE id=?').run(img, b.note || null, ex.id);
  else db.prepare('INSERT INTO submissions (homework_id,user_id,image,note) VALUES (?,?,?,?)').run(params.id, user.id, img, b.note || null);
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
api['GET /api/dalia'] = async (req, res, user) => { if (!requireAuth(user, res)) return; send(res, 200, db.prepare('SELECT * FROM dalia_posts ORDER BY id DESC').all()); };
api['POST /api/dalia'] = async (req, res, user) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req);
  const img = maybeImage(b.image);
  const r = db.prepare('INSERT INTO dalia_posts (title,subtitle,body,image,table_data,template) VALUES (?,?,?,?,?,?)').run(b.title || null, b.subtitle || null, b.body || null, img, b.table_data ? JSON.stringify(b.table_data) : null, b.template || 'below');
  notifyAll({ type: 'feed', title: '✦ New post from Dalia Bassel', body: b.title || b.subtitle || 'See the latest updates', link_page: 'dalia', link_id: r.lastInsertRowid, image: img, actor_name: user.name }, user.id);
  send(res, 200, { id: r.lastInsertRowid });
};
api['PUT /api/dalia/:id'] = async (req, res, user, url, params) => {
  if (!requireAdmin(user, res)) return;
  const b = await readBody(req); const c = db.prepare('SELECT * FROM dalia_posts WHERE id=?').get(params.id);
  if (!c) return send(res, 404, {});
  const img = (b.image && b.image.startsWith('data:')) ? maybeImage(b.image) : (b.image ?? c.image);
  db.prepare('UPDATE dalia_posts SET title=?,subtitle=?,body=?,image=?,template=? WHERE id=?').run(b.title ?? c.title, b.subtitle ?? c.subtitle, b.body ?? c.body, img, b.template ?? c.template, params.id);
  send(res, 200, { ok: true });
};
api['DELETE /api/dalia/:id'] = async (req, res, user, url, params) => { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM dalia_posts WHERE id=?').run(params.id); send(res, 200, { ok: true }); };

// ================= DRESSES =================
api['GET /api/dresses'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
  let list;
  const base = 'SELECT d.*, u.name assignee_name FROM dresses d LEFT JOIN users u ON u.id=d.assigned_to';
  if (['admin', 'manager', 'staff'].includes(user.role)) list = db.prepare(base + ' ORDER BY d.id DESC').all();
  else list = db.prepare(base + ' WHERE d.customer_user_id=? ORDER BY d.id DESC').all(user.id);
  list.forEach((d) => {
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
  const r = db.prepare('INSERT INTO dresses (customer_name,customer_user_id,phone,delivery_date,status,note,cover_image,assigned_to,price) VALUES (?,?,?,?,?,?,?,?,?)').run(
    b.customer_name, b.customer_user_id || null, b.phone || null, b.delivery_date || null, b.status || 'open', b.note || null, cover, b.assigned_to || null, price);
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
  db.prepare('UPDATE dresses SET customer_name=?,customer_user_id=?,phone=?,delivery_date=?,status=?,note=?,assigned_to=?,price=?,measurements=?,measure_note=?,measure_image=? WHERE id=?').run(
    b.customer_name ?? c.customer_name, b.customer_user_id ?? c.customer_user_id, b.phone ?? c.phone, b.delivery_date ?? c.delivery_date, b.status ?? c.status, b.note ?? c.note, b.assigned_to ?? c.assigned_to, price, meas, b.measure_note ?? c.measure_note, measImg, params.id);
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
  if (user.role === 'admin' || user.role === 'manager') {
    const uid = url.searchParams.get('user_id');
    const round = url.searchParams.get('round_id');
    if (round) return send(res, 200, db.prepare('SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE u.round_id=? ORDER BY a.date DESC').all(round));
    const q = uid ? 'SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY date DESC' : 'SELECT a.*,u.name user_name FROM attendance a JOIN users u ON u.id=a.user_id ORDER BY date DESC LIMIT 300';
    return send(res, 200, uid ? db.prepare(q).all(uid) : db.prepare(q).all());
  }
  send(res, 200, db.prepare('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC').all(user.id));
};
api['POST /api/attendance/check'] = async (req, res, user) => {
  if (!requireAuth(user, res)) return;
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      const m = match(req.method, pathname);
      if (!m) return send(res, 404, { error: 'route not found' });
      const user = getUser(req);
      return await m.handler(req, res, user, url, m.params);
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => console.log(`Daliessa Academy running on http://localhost:${PORT}`));
