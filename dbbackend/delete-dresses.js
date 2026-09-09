'use strict';
// Delete dresses and everything hanging off them. Run it where the app runs, so
// it hits the same database the server does (DATA_DIR, hosting volume included):
//
//   node --experimental-sqlite delete-dresses.js               # list only, deletes nothing
//   node --experimental-sqlite delete-dresses.js --demo        # the seeded demo dress
//   node --experimental-sqlite delete-dresses.js --ids 3,7     # specific dresses
//   node --experimental-sqlite delete-dresses.js --all         # every dress
//
// Nothing is deleted without one of those flags, and each one prints what it is
// about to remove and then asks for confirmation — this cannot be undone.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { db } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
// The seed's demo customer (seed.js) — the one dress a fresh install ships with.
const DEMO_CUSTOMER_EMAIL = 'laila@d.com';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const yes = has('--yes') || has('-y');

function pickDresses() {
  if (has('--all')) return db.prepare('SELECT * FROM dresses ORDER BY id').all();
  if (has('--demo')) {
    return db.prepare(`SELECT d.* FROM dresses d LEFT JOIN users u ON u.id = d.customer_user_id
                       WHERE u.email = ? ORDER BY d.id`).all(DEMO_CUSTOMER_EMAIL);
  }
  const i = argv.indexOf('--ids');
  if (i !== -1) {
    const ids = String(argv[i + 1] || '').split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
    if (!ids.length) { console.error('--ids needs a list, e.g. --ids 3,7'); process.exit(1); }
    return ids.map((id) => db.prepare('SELECT * FROM dresses WHERE id = ?').get(id)).filter(Boolean);
  }
  return null; // no flag -> listing mode
}

// Tables that point back at a dress. The app's own delete endpoint misses
// purchase_lines, which is how orphaned material lines end up in the books.
const CHILD_TABLES = ['dress_fittings', 'dress_images', 'dress_updates', 'dress_payments', 'purchase_lines'];

function countChildren(ids) {
  const marks = ids.map(() => '?').join(',');
  const out = {};
  for (const t of CHILD_TABLES) {
    out[t] = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE dress_id IN (${marks})`).get(...ids).c;
  }
  return out;
}

// Uploaded files are content under UPLOAD_DIR; resolve and confine before unlinking
// so a stored path can never reach outside it.
function uploadPath(stored) {
  const name = path.basename(String(stored || '').replace(/^\/?uploads\//, ''));
  if (!name || name === '.' || name === '..') return null;
  const full = path.resolve(UPLOAD_DIR, name);
  return full.startsWith(path.resolve(UPLOAD_DIR) + path.sep) ? full : null;
}

function listAll() {
  const rows = db.prepare(`SELECT d.id, d.customer_name, d.status, d.delivery_date, u.email
                           FROM dresses d LEFT JOIN users u ON u.id = d.customer_user_id
                           ORDER BY d.id`).all();
  if (!rows.length) { console.log('No dresses in this database.'); return; }
  console.log(`${rows.length} dress(es):\n`);
  for (const r of rows) {
    const demo = r.email === DEMO_CUSTOMER_EMAIL ? '  <- seeded demo' : '';
    console.log(`  #${r.id}  ${r.customer_name || '(no name)'}  [${r.status || '-'}]  ${r.delivery_date || ''}${demo}`);
  }
  console.log('\nNothing deleted. Re-run with --demo, --ids <list>, or --all.');
}

function confirm(question) {
  if (yes) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(question, (a) => { rl.close(); r(a.trim().toLowerCase() === 'yes'); }));
}

(async () => {
  const targets = pickDresses();
  if (targets === null) return listAll();
  if (!targets.length) { console.log('Nothing matched — no dresses deleted.'); return; }

  const ids = targets.map((d) => d.id);
  console.log(`About to delete ${targets.length} dress(es):\n`);
  for (const d of targets) console.log(`  #${d.id}  ${d.customer_name || '(no name)'}  [${d.status || '-'}]`);
  const children = countChildren(ids);
  console.log('\nand the rows attached to them:');
  for (const [t, c] of Object.entries(children)) console.log(`  ${t}: ${c}`);

  const files = db.prepare(`SELECT image FROM dress_images WHERE dress_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids).map((r) => uploadPath(r.image)).filter((p) => p && fs.existsSync(p));
  console.log(`  uploaded image files on disk: ${files.length}`);

  if (!await confirm('\nThis cannot be undone. Type "yes" to delete: ')) {
    console.log('Cancelled — nothing deleted.');
    return;
  }

  const marks = ids.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    for (const t of CHILD_TABLES) db.prepare(`DELETE FROM ${t} WHERE dress_id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM dresses WHERE id IN (${marks})`).run(...ids);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Failed, nothing was deleted:', e.message);
    process.exit(1);
  }

  // Files go last: the rows are gone, so a failure here only leaves dead bytes.
  let removed = 0;
  for (const f of files) { try { fs.unlinkSync(f); removed++; } catch (_) { /* already gone */ } }
  console.log(`\nDeleted ${targets.length} dress(es) and ${removed} image file(s).`);
})();
