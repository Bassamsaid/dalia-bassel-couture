'use strict';
// Daliessa Academy — database layer (libSQL: the same SQLite dialect, hosted).
//
// Serverless hosting gives a function no disk of its own, so the database cannot
// be a file beside the code. libSQL speaks SQLite over HTTP, which means every
// statement in this file and in server.js is the one that was already there —
// only the calls are awaited now. With no TURSO_DATABASE_URL it opens a local
// file instead, so development and the CLI scripts work unchanged.
const { createClient } = require('@libsql/client');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const TURSO = process.env.TURSO_DATABASE_URL;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!TURSO) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'daliessa.db');

const client = createClient(TURSO
  ? { url: TURSO, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: 'file:' + DB_PATH });

// Bound parameters arrive as whatever the handlers happen to hold; libSQL wants
// them flat and JSON-ish, and hands integers back as BigInt.
const arg = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? Number(v) : v);
const args = (a) => (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(arg);
const plain = (row) => {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) out[k] = typeof row[k] === 'bigint' ? Number(row[k]) : row[k];
  return out;
};

// The same shape the rest of the app already calls — db.prepare(sql).get(a, b) —
// so the 340-odd call sites needed an await in front and nothing else.
const db = {
  exec: (sql) => client.executeMultiple(sql),
  prepare: (sql) => ({
    get: async (...a) => plain((await client.execute({ sql, args: args(a) })).rows[0]),
    all: async (...a) => (await client.execute({ sql, args: args(a) })).rows.map(plain),
    run: async (...a) => {
      const r = await client.execute({ sql, args: args(a) });
      return { changes: Number(r.rowsAffected || 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
  }),
};
// Over HTTP each statement is its own round trip, so a bare BEGIN would not hold
// anything: a transaction has to be an explicit object the statements run on.
db.transaction = async (fn) => {
  const tx = await client.transaction('write');
  const scoped = {
    prepare: (sql) => ({
      get: async (...a) => plain((await tx.execute({ sql, args: args(a) })).rows[0]),
      all: async (...a) => (await tx.execute({ sql, args: args(a) })).rows.map(plain),
      run: async (...a) => {
        const r = await tx.execute({ sql, args: args(a) });
        return { changes: Number(r.rowsAffected || 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
      },
    }),
  };
  try { const out = await fn(scoped); await tx.commit(); return out; }
  catch (e) { try { await tx.rollback(); } catch (_) {} throw e; }
};

// A migration that has already been applied throws; that is the signal it is done.
const tryExec = async (sql) => { try { await db.exec(sql); } catch (e) { /* already applied */ } };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Schema, migrations and the first-run seed, in order.
const ready = (async () => {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'trainee',      -- admin | trainee | staff | customer
    round_id INTEGER,
    group_id INTEGER,
    job_title TEXT,                            -- for staff
    base_salary REAL DEFAULT 0,                -- for staff
    hire_date TEXT,                            -- for staff
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    start_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    name TEXT NOT NULL,
    day TEXT,                                  -- friday | saturday
    time_slot TEXT,                            -- '11-3' | '5-9'
    capacity INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Course fee per trainee + payments (deposit / installments) with transfer screenshots
  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    round_id INTEGER,
    total_fee REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    kind TEXT DEFAULT 'installment',           -- deposit | installment
    image TEXT,                                -- transfer screenshot filename
    note TEXT,
    paid_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    amount REAL DEFAULT 0,
    note TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Short videos for the course (visible per round)
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,                          -- null => all rounds
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,                                  -- external link
    file TEXT,                                 -- uploaded file
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Homework: send measurements, trainee draws & uploads a pattern
  CREATE TABLE IF NOT EXISTS homeworks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    title TEXT NOT NULL,
    measurements TEXT,                         -- the measurements sent
    instructions TEXT,
    due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    homework_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    image TEXT,                                -- uploaded pattern drawing
    note TEXT,
    grade TEXT,
    feedback TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Quizzes with reference code, duration, public results
  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    title TEXT NOT NULL,
    ref_code TEXT,
    duration_min INTEGER DEFAULT 15,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    options TEXT NOT NULL,                     -- JSON array of strings
    correct_index INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    answers TEXT,                              -- JSON
    score REAL DEFAULT 0,
    total REAL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at TEXT
  );

  -- Notes / instructions pushed to trainees
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'all',         -- all | round | user
    round_id INTEGER,
    user_id INTEGER,
    title TEXT NOT NULL,
    body TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- About the academy (singleton row id=1)
  CREATE TABLE IF NOT EXISTS about (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT,
    body TEXT,
    image TEXT,
    home_image TEXT
  );

  -- Dalia posts page (photos + text + simple tables)
  CREATE TABLE IF NOT EXISTS dalia_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    body TEXT,
    image TEXT,
    table_data TEXT,                           -- JSON [{cols:[]},{rows:[[]]}]
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Dresses (فساتين): bookings, fittings, delivery, photos, customer access
  CREATE TABLE IF NOT EXISTS dresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_user_id INTEGER,                  -- optional linked customer account
    phone TEXT,
    delivery_date TEXT,
    status TEXT DEFAULT 'open',                -- open | in_progress | delivered
    note TEXT,
    cover_image TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dress_fittings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dress_id INTEGER NOT NULL,
    fitting_date TEXT NOT NULL,
    note TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dress_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dress_id INTEGER NOT NULL,
    image TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Staff HR
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Manual attendance log requests (forgot to check in/out) — admin approves
  CREATE TABLE IF NOT EXISTS attendance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL,                        -- in | out
    time TEXT,                                 -- HH:MM
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );

  CREATE TABLE IF NOT EXISTS salaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    month TEXT NOT NULL,                        -- YYYY-MM
    base REAL DEFAULT 0,
    bonus REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    type TEXT DEFAULT 'annual',                -- annual | sick | unpaid
    reason TEXT,
    status TEXT DEFAULT 'pending',             -- pending | approved | rejected
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Which sections each ROLE can see. A missing (role,page) row means visible (default on).
  CREATE TABLE IF NOT EXISTS role_perms (
    role TEXT NOT NULL,                         -- trainee | staff | customer
    page TEXT NOT NULL,                         -- nav key, e.g. courses | quizzes | mypay ...
    visible INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (role, page)
  );

  -- Admin configuration (simple key/value store)
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Staff absences (each row = one absent day, deducted from salary)
  CREATE TABLE IF NOT EXISTS absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Staff advances (سلف): an amount given to a staff member, deducted from a chosen month's salary
  CREATE TABLE IF NOT EXISTS advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    month TEXT,                                 -- YYYY-MM the deduction applies to
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One-time login codes (passwordless email OTP)
  CREATE TABLE IF NOT EXISTS otps (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- Manual salary adjustments per staff per month: bonus (adds) / deduction (subtracts)
  CREATE TABLE IF NOT EXISTS salary_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    month TEXT,
    amount REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'bonus',          -- bonus | deduction
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Expenses: vendors, expense types, and expense entries (for monthly spend analysis)
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expense_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER,
    type TEXT,
    amount REAL NOT NULL DEFAULT 0,
    date TEXT,
    note TEXT,
    image TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Notifications: one row per recipient. link_page/link_id tell the app where to jump on tap.
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT,
    title TEXT,
    body TEXT,
    link_page TEXT,
    link_id INTEGER,
    image TEXT,
    actor_name TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

  -- Dress update thread: two-way notes/photos between the studio (admin/manager) and the client
  CREATE TABLE IF NOT EXISTS dress_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dress_id INTEGER NOT NULL,
    author_id INTEGER,
    author_name TEXT,
    author_role TEXT,
    body TEXT,
    image TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dressupd ON dress_updates(dress_id);

  -- Dress payments: client deposits / installments against a dress price
  CREATE TABLE IF NOT EXISTS dress_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dress_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    method TEXT DEFAULT 'transfer',
    note TEXT,
    image TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dresspay ON dress_payments(dress_id);

  -- Dress material purchases: a shop invoice (with photo) whose line items are each linked to a dress
  CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop TEXT,
    image TEXT,
    note TEXT,
    invoice_date TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS purchase_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    dress_id INTEGER,
    item TEXT,
    amount REAL NOT NULL DEFAULT 0
  );

  -- Salary disbursements: admin sends salary (with transfer screenshot), staff confirms receipt
  CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    month TEXT,
    amount REAL DEFAULT 0,
    image TEXT,
    note TEXT,
    status TEXT DEFAULT 'sent',                 -- sent | confirmed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
  );
  `);

  // seed default configuration (only fills keys that don't exist yet)
  try {
    const setDefault = await db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
    setDefault.run('academy_name', 'Dalia Bassel Couture');
    setDefault.run('currency', 'EGP');
    setDefault.run('work_days_per_month', '30');
    setDefault.run('check_in_time', '09:00');
    setDefault.run('check_out_time', '17:00');
    setDefault.run('late_grace_min', '15');
    setDefault.run('overtime_mult', '1.5');
    // attendance geofence — default studio location (Dalia Bassel Couture, El Gamaliya, Cairo)
    setDefault.run('geo_enabled', '1');
    setDefault.run('geo_lat', '30.0464497');
    setDefault.run('geo_lng', '31.2673703');
    setDefault.run('geo_radius', '150');
    // default expense types (once, if none)
    if ((await db.prepare('SELECT COUNT(*) c FROM expense_types').get()).c === 0) {
      const et = await db.prepare('INSERT INTO expense_types (name) VALUES (?)');
      ['Fabric & materials', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Supplies', 'Shipping', 'Other'].forEach((n) => et.run(n));
    }
  } catch (e) { /* ignore */ }

  // ---- password helpers (scrypt, no deps) ----

  // Seed a default admin (Dalia) if no users exist
  async function seed() {
    const count = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
    if (count === 0) {
      await db.prepare(
        `INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,'admin')`
      ).run('Dalia Bassel', 'admin@daliessa.com', '', hashPassword('daliessa123'));
      await db.prepare(`INSERT INTO about (id,title,body) VALUES (1,?,?)`).run(
        'Dalia Bassel Couture',
        'A couture academy specialized in teaching pattern-making and tailoring. Est. 2019.'
      );
      console.log('Seeded admin: admin@daliessa.com / daliessa123');
    }
  }
  await seed();

  // lightweight migration for existing DBs
  await tryExec('ALTER TABLE about ADD COLUMN home_image TEXT');
  // How the studio photo sits in its frame: focal point, zoom and the shape of the frame.
  await tryExec("ALTER TABLE about ADD COLUMN img_pos TEXT");
  await tryExec("ALTER TABLE about ADD COLUMN img_zoom TEXT");
  await tryExec("ALTER TABLE about ADD COLUMN img_shape TEXT");
  await tryExec("ALTER TABLE videos ADD COLUMN kind TEXT DEFAULT 'online'"); // online | onsite (in-person)
  await tryExec("ALTER TABLE payments ADD COLUMN method TEXT DEFAULT 'transfer'"); // transfer | cash
  await tryExec("ALTER TABLE rounds ADD COLUMN kind TEXT DEFAULT 'onsite'"); // online | onsite (in-person)
  await tryExec("ALTER TABLE advances ADD COLUMN status TEXT DEFAULT 'approved'"); // pending | approved | rejected
  await tryExec('ALTER TABLE dresses ADD COLUMN assigned_to INTEGER'); // staff responsible for the dress
  await tryExec('ALTER TABLE users ADD COLUMN governorate TEXT'); // student governorate (Egypt)
  await tryExec('ALTER TABLE dress_images ADD COLUMN position INTEGER DEFAULT 0'); // photo order (first = cover)
  await tryExec('ALTER TABLE dresses ADD COLUMN price REAL DEFAULT 0');        // selling price (admin only)
  await tryExec('ALTER TABLE dresses ADD COLUMN measurements TEXT');            // JSON of measurement fields
  await tryExec('ALTER TABLE dresses ADD COLUMN measure_note TEXT');
  await tryExec('ALTER TABLE dresses ADD COLUMN measure_image TEXT');           // reference photo
  await tryExec("ALTER TABLE absences ADD COLUMN status TEXT DEFAULT 'confirmed'"); // pending | confirmed (admin approves)
  await tryExec('ALTER TABLE users ADD COLUMN off_days TEXT'); // paid weekly off-days (comma weekday names)
  await tryExec("ALTER TABLE dalia_posts ADD COLUMN template TEXT DEFAULT 'below'"); // below | side | hero | text
  await tryExec('ALTER TABLE dalia_posts ADD COLUMN subtitle TEXT');
  // which house a post belongs to: studio (general news) | academy | couture
  await tryExec("ALTER TABLE dalia_posts ADD COLUMN section TEXT DEFAULT 'studio'");

  // Customer service: one thread per enquiry, filed under the part of the studio it is about.
  // topic: dress (couture) | course (academy) | general (visitors and everything else)
  await db.exec(`CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    topic TEXT NOT NULL DEFAULT 'general',
    subject TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    from_studio INTEGER NOT NULL DEFAULT 0,
    body TEXT,
    image TEXT,
    seen_by_studio INTEGER NOT NULL DEFAULT 0,
    seen_by_user INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_messages(thread_id, id)')
  await db.exec('CREATE INDEX IF NOT EXISTS idx_chat_topic ON chat_threads(topic, last_at)')

  // A post carries a gallery: several photos and videos you swipe through.
  // dalia_posts.image stays as the cover so older posts keep rendering.
  await db.exec(`CREATE TABLE IF NOT EXISTS dalia_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_dalia_media ON dalia_media(post_id, position)')
  // a still for a video, so it never opens as a black rectangle
  await tryExec('ALTER TABLE dalia_media ADD COLUMN poster TEXT');

  // A task can be aimed at one group inside a round, and says how it is taught.
  await tryExec('ALTER TABLE homeworks ADD COLUMN group_id INTEGER');
  await tryExec("ALTER TABLE homeworks ADD COLUMN mode TEXT DEFAULT 'onsite'"); // online | onsite

  // A dress enquiry carries a consultation brief (JSON) and its first message
  // can bring several inspiration photos.
  await tryExec('ALTER TABLE chat_threads ADD COLUMN brief TEXT');
  await tryExec('ALTER TABLE chat_messages ADD COLUMN media TEXT');

  // An invitation link: one token that lets a client set her own password and get in.
  await tryExec('ALTER TABLE users ADD COLUMN invite_token TEXT');
  await tryExec('ALTER TABLE users ADD COLUMN invite_expires TEXT');

  // The occasion a dress is being made for (JSON), same questions the client answers.
  await tryExec('ALTER TABLE dresses ADD COLUMN brief TEXT');

  // How often a client actually opens the app, and when she was last in.
  await tryExec('ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0');
  await tryExec('ALTER TABLE users ADD COLUMN first_login TEXT');
  await tryExec('ALTER TABLE users ADD COLUMN last_login TEXT');
  await tryExec('ALTER TABLE purchase_invoices ADD COLUMN vendor_id INTEGER'); // link a material invoice to a vendor (unified vendor spend)
  await tryExec('ALTER TABLE users ADD COLUMN avatar TEXT'); // profile photo (uploaded filename)
  // invited = the studio added this email but the person has not set a password yet.
  // Existing rows default to 0, so no live account can be claimed by someone else.
  await tryExec('ALTER TABLE users ADD COLUMN invited INTEGER NOT NULL DEFAULT 0');

  // A pattern is photographed page by page, so a submission holds many images.
  // submissions.image stays as the cover so older rows keep working.
  await db.exec(`CREATE TABLE IF NOT EXISTS submission_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    image TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sub_images ON submission_images(submission_id, position)')
  await tryExec('ALTER TABLE videos ADD COLUMN group_id INTEGER'); // scope a video/photo to one group (null = whole round)
  await tryExec('ALTER TABLE dress_images ADD COLUMN video_url TEXT'); // a dress can carry a video link (Instagram, YouTube…) beside its photos
  // Where the cover sits inside the card's crop ("50% 30%"), so a face is not cut off
  await tryExec('ALTER TABLE dresses ADD COLUMN cover_pos TEXT');
  // What a vendor actually supplies — lace, tulle, beading — and how to reach them
  await tryExec('ALTER TABLE vendors ADD COLUMN specialty TEXT');
  await tryExec('ALTER TABLE vendors ADD COLUMN address TEXT');
  await tryExec('ALTER TABLE vendors ADD COLUMN email TEXT');

})();

module.exports = { db, ready, hashPassword, verifyPassword, DB_PATH };
