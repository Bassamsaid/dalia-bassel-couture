'use strict';
// Daliessa Academy — database layer (Node built-in SQLite, zero dependencies)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

// DATA_DIR is configurable so a hosting volume (e.g. Railway) can persist the DB across deploys
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'daliessa.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
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
`);

// seed default configuration once
try {
  const has = db.prepare('SELECT COUNT(*) c FROM settings').get().c;
  if (!has) {
    const s = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    s.run('academy_name', 'Dalia Bassel Couture');
    s.run('currency', 'EGP');
    s.run('work_days_per_month', '30');
  }
} catch (e) { /* ignore */ }

// ---- password helpers (scrypt, no deps) ----
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

// Seed a default admin (Dalia) if no users exist
function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count === 0) {
    db.prepare(
      `INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,'admin')`
    ).run('Dalia Bassel', 'admin@daliessa.com', '', hashPassword('daliessa123'));
    db.prepare(`INSERT INTO about (id,title,body) VALUES (1,?,?)`).run(
      'Dalia Bassel Couture',
      'A couture academy specialized in teaching pattern-making and tailoring. Est. 2019.'
    );
    console.log('Seeded admin: admin@daliessa.com / daliessa123');
  }
}
seed();

// lightweight migration for existing DBs
try { db.exec('ALTER TABLE about ADD COLUMN home_image TEXT'); } catch (e) { /* column exists */ }
try { db.exec("ALTER TABLE videos ADD COLUMN kind TEXT DEFAULT 'online'"); } catch (e) { /* column exists */ } // online | onsite (in-person)
try { db.exec("ALTER TABLE payments ADD COLUMN method TEXT DEFAULT 'transfer'"); } catch (e) { /* column exists */ } // transfer | cash
try { db.exec("ALTER TABLE rounds ADD COLUMN kind TEXT DEFAULT 'onsite'"); } catch (e) { /* column exists */ } // online | onsite (in-person)
try { db.exec("ALTER TABLE advances ADD COLUMN status TEXT DEFAULT 'approved'"); } catch (e) { /* column exists */ } // pending | approved | rejected
try { db.exec('ALTER TABLE dresses ADD COLUMN assigned_to INTEGER'); } catch (e) { /* column exists */ } // staff responsible for the dress
try { db.exec('ALTER TABLE users ADD COLUMN governorate TEXT'); } catch (e) { /* column exists */ } // student governorate (Egypt)
try { db.exec('ALTER TABLE dress_images ADD COLUMN position INTEGER DEFAULT 0'); } catch (e) { /* column exists */ } // photo order (first = cover)

module.exports = { db, hashPassword, verifyPassword };
