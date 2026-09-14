'use strict';
// Putting a backup back. Used by the Restore button in the app and by
// restore-backup.js on a terminal, so both behave identically.
const { db } = require('./db');

// Not a hash of anything: verifyPassword splits on ":" and compares, so nothing
// a person can type will ever match. The account exists but cannot be signed in
// to until an admin sets a real password.
const NEEDS_RESET = 'restored:needs-a-new-password';

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

// A backup taken through the API carries the app's shape, not the database's: a
// dress arrives with its fittings and photos inside it, an invoice with its
// items, the settings as one object. Pull those apart into the rows they came
// from. A backup taken from Configuration → Backup is already table-shaped and
// passes through untouched.
function tablesFrom(raw) {
  if (raw && raw.tables && typeof raw.tables === 'object') return { ...raw.tables };
  const tables = { ...raw };
  delete tables.exported_at;

  const unnest = (key, childKey, childTable, fk) => {
    if (!Array.isArray(tables[key])) return;
    const kids = [];
    tables[key] = tables[key].map((row) => {
      for (const kid of (row[childKey] || [])) kids.push({ ...kid, [fk]: kid[fk] ?? row.id });
      const { [childKey]: _drop, ...rest } = row;
      return rest;
    });
    if (kids.length) tables[childTable] = (tables[childTable] || []).concat(kids);
  };
  unnest('dresses', 'fittings', 'dress_fittings', 'dress_id');
  unnest('dresses', 'images', 'dress_images', 'dress_id');
  unnest('purchases', 'lines', 'purchase_lines', 'invoice_id');
  if (Array.isArray(tables.purchases)) { tables.purchase_invoices = tables.purchases; delete tables.purchases; }

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
  return tables;
}

async function planFor(tables) {
  // One round trip for the table list, rather than one per table in the file.
  const have = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).map((r) => r.name));
  const present = new Set(Object.keys(tables).filter((t) => Array.isArray(tables[t]) && tables[t].length));
  return [...ORDER.filter((t) => present.has(t)), ...[...present].filter((t) => !ORDER.includes(t))].filter((t) => have.has(t));
}

// Rows whose id is already used are skipped, so restoring twice is safe and
// restoring onto a database that has moved on cannot overwrite newer work.
// replace:true overwrites those rows instead.
async function restore(raw, { replace = false } = {}) {
  const tables = tablesFrom(raw);
  const plan = await planFor(tables);
  if (!plan.length) return { tables: [], written: 0, skipped: 0, needPassword: 0 };

  let written = 0, skipped = 0;
  const perTable = [];
  await db.transaction(async (tx) => {
    for (const t of plan) {
      // Only columns this database actually has — a backup from an older version
      // will not carry the newer ones, and must still restore.
      const cols = (await db.prepare(`PRAGMA table_info(${t})`).all()).map((c) => c.name);
      let w = 0;
      for (const row of tables[t]) {
        // A backup never carries password hashes, and the column cannot be null:
        // without something here every person in the file is dropped on the floor.
        if (t === 'users' && row.password_hash === undefined) row.password_hash = NEEDS_RESET;
        const use = cols.filter((c) => row[c] !== undefined);
        if (!use.length) continue;
        const sql = `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO ${t} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`;
        // Nested objects (a dress's measurements) are stored as their JSON text.
        const vals = use.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
        const r = await tx.prepare(sql).run(...vals);
        if (r.changes) { written++; w++; } else skipped++;
      }
      perTable.push({ table: t, inFile: tables[t].length, written: w });
    }
  });
  const needPassword = (await db.prepare('SELECT COUNT(*) c FROM users WHERE password_hash = ?').get(NEEDS_RESET)).c;
  return { tables: perTable, written, skipped, needPassword };
}

module.exports = { restore, tablesFrom, planFor, NEEDS_RESET };
