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
const { restore, tablesFrom, planFor } = require('./restore');

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

const tables = tablesFrom(raw);
const plan = planFor(tables);

if (!plan.length) { console.log('Nothing in this file matches a table in the database.'); process.exit(0); }

console.log(`Restoring from ${file}${raw.exported_at ? ` (taken ${raw.exported_at})` : ''}:\n`);
for (const t of plan) {
  const have = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  console.log(`  ${t.padEnd(22)} ${String(tables[t].length).padStart(5)} row(s) in the file · ${have} already here`);
}
console.log(`\nRows whose id is already used will be ${replace ? 'OVERWRITTEN (--replace)' : 'skipped'}.`);
if (tables.users) console.log('Note: passwords are not in a backup. Anyone restored this way needs a new one.');

function run() {
  let r;
  try { r = restore(raw, { replace }); }
  catch (e) { console.error('\nFailed — nothing was written:', e.message); process.exit(1); }
  console.log(`\nRestored ${r.written} row(s), skipped ${r.skipped} already there.`);
  if (r.needPassword) console.log(`${r.needPassword} restored account(s) need a password before anyone can sign in:\n  npm run reset-admin-password -- '<new password>' <their email>`);
}

if (yes) { run(); } else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\nType "yes" to restore: ', (a) => {
    rl.close();
    if (a.trim().toLowerCase() !== 'yes') return console.log('Cancelled — nothing written.');
    run();
  });
}
