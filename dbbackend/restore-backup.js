'use strict';
// Put back a backup taken from the running app — either the JSON from
// Configuration → Backup, or the one the browser snippet in README collects.
// Run it where the app runs, so it writes the database the server uses:
//
//   node --experimental-sqlite restore-backup.js daliessa-backup.json
//   node --experimental-sqlite restore-backup.js backup.json --replace
//
// By default nothing already in the database is touched: rows whose id is taken
// are skipped, so restoring twice is safe and restoring onto a live database
// cannot overwrite work done since. --replace overwrites those rows instead.
const fs = require('node:fs');
const readline = require('node:readline');
const { db } = require('./db');

// Not a hash of anything: verifyPassword splits on ":" and compares, so nothing
// a person can type will ever match. The account exists but cannot be signed in
// to until an admin sets a real password.
const NEEDS_RESET = 'restored:needs-a-new-password';

const file = process.argv[2];
const replace = process.argv.includes('--replace');
const yes = process.argv.includes('--yes') || process.argv.includes('-y');

if (!file) {
  console.error('usage: node --experimental-sqlite restore-backup.js <backup.json> [--replace]');
  process.exit(1);
}

let raw;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`Could not read ${file}: ${e.message}`); process.exit(1); }

// Both shapes are accepted: {tables:{name:[rows]}} from the in-app backup, and a
// plain {name:[rows]} from the browser snippet.
const tables = raw.tables && typeof raw.tables === 'object' ? raw.tables : raw;

// A backup taken through the API carries the app's shape, not the database's: a
// dress arrives with its fittings and photos inside it, an invoice with its
// items, the settings as one object. Pull those apart into the rows they came
// from. A backup taken from Configuration → Backup is already table-shaped and
// passes through untouched.
function unnest(key, childKey, childTable, fk) {
  const rows = tables[key];
  if (!Array.isArray(rows)) return;
  const kids = [];
  for (const row of rows) {
    for (const kid of (row[childKey] || [])) kids.push({ ...kid, [fk]: kid[fk] ?? row.id });
    delete row[childKey];
  }
  if (kids.length) tables[childTable] = (tables[childTable] || []).concat(kids);
}
if (!raw.tables) {
  unnest('dresses', 'fittings', 'dress_fittings', 'dress_id');
  unnest('dresses', 'images', 'dress_images', 'dress_id');
  unnest('purchases', 'lines', 'purchase_lines', 'invoice_id');
  if (Array.isArray(tables.purchases)) { tables.purchase_invoices = tables.purchases; delete tables.purchases; }
  // settings comes back as one {key: value} object
  if (tables.settings && !Array.isArray(tables.settings)) {
    tables.settings = Object.entries(tables.settings).map(([key, value]) => ({ key, value: String(value ?? '') }));
  }
  const rename = { 'expense-types': 'expense_types', 'salary-payments': 'salary_payments', dalia: 'dalia_posts' };
  for (const [from, to] of Object.entries(rename)) {
    if (tables[from]) { tables[to] = tables[from]; delete tables[from]; }
  }
  // Figures the server works out on the fly, not columns
  for (const v of (tables.vendors || [])) { delete v.purchases_total; delete v.expenses_total; delete v.total; }
  for (const i of (tables.purchase_invoices || [])) { delete i.total; delete i.vendor_name; }
  delete tables.about; // part of settings, not a table of its own
}

// Parents before children: a fitting cannot be restored before its dress. Any
// table in the file that is not named here is restored afterwards, in file order.
const ORDER = [
  'settings', 'rounds', 'groups', 'users', 'enrollments', 'vendors', 'expense_types',
  'dresses', 'dress_fittings', 'dress_images', 'dress_updates', 'dress_payments',
  'purchase_invoices', 'purchase_lines', 'expenses', 'payments', 'reminders',
  'videos', 'homeworks', 'submissions', 'submission_images', 'quizzes', 'quiz_questions',
  'quiz_attempts', 'notes', 'dalia_posts', 'dalia_media', 'salaries', 'salary_payments',
  'absences', 'advances', 'adjustments', 'attendance', 'attendance_requests', 'leaves',
];

const present = new Set(Object.keys(tables).filter((t) => Array.isArray(tables[t]) && tables[t].length));
const plan = [...ORDER.filter((t) => present.has(t)), ...[...present].filter((t) => !ORDER.includes(t))]
  .filter((t) => db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c);

if (!plan.length) { console.log('Nothing in this file matches a table in the database.'); process.exit(0); }

console.log(`Restoring from ${file}${raw.exported_at ? ` (taken ${raw.exported_at})` : ''}:\n`);
for (const t of plan) {
  const have = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  console.log(`  ${t.padEnd(22)} ${String(tables[t].length).padStart(5)} row(s) in the file · ${have} already here`);
}
console.log(`\nRows whose id is already used will be ${replace ? 'OVERWRITTEN (--replace)' : 'skipped'}.`);
if (tables.users) console.log('Note: passwords are not in a backup. Anyone restored this way needs a new one.');

function run() {
  let written = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const t of plan) {
      // Only columns this database actually has — a backup from an older version
      // will not carry the newer ones, and must still restore.
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      for (const row of tables[t]) {
        // A backup never carries password hashes, and the column cannot be null:
        // without something here every person in the file is dropped on the floor.
        // An unusable placeholder keeps the person — their name, role, salary,
        // what they are owed — and they sign in again once given a new password.
        if (t === 'users' && row.password_hash === undefined) row.password_hash = NEEDS_RESET;
        const use = cols.filter((c) => row[c] !== undefined);
        if (!use.length) continue;
        const sql = `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO ${t} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`;
        const vals = use.map((c) => {
          const v = row[c];
          // Nested objects (a dress's measurements) are stored as their JSON text.
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        });
        const r = db.prepare(sql).run(...vals);
        r.changes ? written++ : skipped++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('\nFailed — nothing was written:', e.message);
    process.exit(1);
  }
  console.log(`\nRestored ${written} row(s), skipped ${skipped} already there.`);
  const stuck = db.prepare('SELECT COUNT(*) c FROM users WHERE password_hash = ?').get(NEEDS_RESET).c;
  if (stuck) console.log(`${stuck} restored account(s) need a password before anyone can sign in:\n  npm run reset-admin-password -- '<new password>' <their email>`);
}

if (yes) { run(); } else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\nType "yes" to restore: ', (a) => {
    rl.close();
    if (a.trim().toLowerCase() !== 'yes') return console.log('Cancelled — nothing written.');
    run();
  });
}
