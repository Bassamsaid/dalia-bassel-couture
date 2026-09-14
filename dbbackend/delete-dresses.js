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
//
// Add --with-purchases to delete the material purchases too. Those lines are
// vendor spending, so by default they are kept and only detached from the dress;
// with the flag they go, and any invoice left with no lines goes with them.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { db, ready } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
// The seed's demo customer (seed.js) — the one dress a fresh install ships with.
const DEMO_CUSTOMER_EMAIL = 'laila@d.com';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const yes = has('--yes') || has('-y');
const withPurchases = has('--with-purchases');

async function pickDresses() {
  if (has('--all')) return await db.prepare('SELECT * FROM dresses ORDER BY id').all();
  if (has('--demo')) {
    return await db.prepare(`SELECT d.* FROM dresses d LEFT JOIN users u ON u.id = d.customer_user_id
                       WHERE u.email = ? ORDER BY d.id`).all(DEMO_CUSTOMER_EMAIL);
  }
  const i = argv.indexOf('--ids');
  if (i !== -1) {
    const ids = String(argv[i + 1] || '').split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
    if (!ids.length) { console.error('--ids needs a list, e.g. --ids 3,7'); process.exit(1); }
    const picked = [];
    for (const id of ids) picked.push(await db.prepare('SELECT * FROM dresses WHERE id = ?').get(id));
    return picked.filter(Boolean);
  }
  return null; // no flag -> listing mode
}

// Rows that belong to the dress and die with it.
const CHILD_TABLES = ['dress_fittings', 'dress_images', 'dress_updates', 'dress_payments'];

// purchase_lines is NOT one of them: a line is money actually spent on a vendor
// invoice, and dress_id only says which dress it was for. Deleting the line would
// shrink that invoice's total (server.js sums its lines) and quietly drop the
// expense from the books, so the line is detached instead — the same state the
// app already allows via PUT /api/purchase-lines/:id.
async function countChildren(ids) {
  const marks = ids.map(() => '?').join(',');
  const out = {};
  for (const t of CHILD_TABLES) {
    out[t] = (await db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE dress_id IN (${marks})`).get(...ids)).c;
  }
  const lines = (await db.prepare(`SELECT COUNT(*) c FROM purchase_lines WHERE dress_id IN (${marks})`).get(...ids)).c;
  out[withPurchases ? 'purchase_lines (DELETED)' : 'purchase_lines (detached, kept)'] = lines;
  if (withPurchases) out['purchase_invoices left empty (DELETED)'] = await emptiedInvoices(ids).length;
  return out;
}

// Invoices that would have no lines left once the dress lines go. A line with no
// dress (general spending) keeps its invoice alive, so only fully-dress invoices
// are swept up here.
async function emptiedInvoices(ids) {
  const marks = ids.map(() => '?').join(',');
  return await db.prepare(`SELECT id, image FROM purchase_invoices WHERE id IN (
                       SELECT DISTINCT invoice_id FROM purchase_lines WHERE dress_id IN (${marks})
                     ) AND id NOT IN (
                       SELECT invoice_id FROM purchase_lines
                       WHERE dress_id IS NULL OR dress_id NOT IN (${marks})
                     )`).all(...ids, ...ids);
}

// Uploaded files are content under UPLOAD_DIR; resolve and confine before unlinking
// so a stored path can never reach outside it.
function uploadPath(stored) {
  const name = path.basename(String(stored || '').replace(/^\/?uploads\//, ''));
  if (!name || name === '.' || name === '..') return null;
  const full = path.resolve(UPLOAD_DIR, name);
  return full.startsWith(path.resolve(UPLOAD_DIR) + path.sep) ? full : null;
}

async function listAll() {
  const rows = await db.prepare(`SELECT d.id, d.customer_name, d.status, d.delivery_date, u.email
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
  const targets = await pickDresses();
  if (targets === null) return await listAll();
  if (!targets.length) { console.log('Nothing matched — no dresses deleted.'); return; }

  const ids = targets.map((d) => d.id);
  console.log(`About to delete ${targets.length} dress(es):\n`);
  for (const d of targets) console.log(`  #${d.id}  ${d.customer_name || '(no name)'}  [${d.status || '-'}]`);
  const children = await countChildren(ids);
  console.log('\nand the rows attached to them:');
  for (const [t, c] of Object.entries(children)) console.log(`  ${t}: ${c}`);

  const emptied = withPurchases ? await emptiedInvoices(ids) : [];
  const files = (await db.prepare(`SELECT image FROM dress_images WHERE dress_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids)).map((r) => r.image)
    .concat(emptied.map((inv) => inv.image))
    .map(uploadPath).filter((p) => p && fs.existsSync(p));
  console.log(`  uploaded image files on disk: ${files.length}`);
  if (withPurchases) console.log('\n  --with-purchases: vendor spending on these dresses is erased, not just unlinked.');

  if (!await confirm('\nThis cannot be undone. Type "yes" to delete: ')) {
    console.log('Cancelled — nothing deleted.');
    return;
  }

  const marks = ids.map(() => '?').join(',');
  try {
    await db.transaction(async (tx) => {
      for (const t of CHILD_TABLES) await tx.prepare(`DELETE FROM ${t} WHERE dress_id IN (${marks})`).run(...ids);
      if (withPurchases) {
        await tx.prepare(`DELETE FROM purchase_lines WHERE dress_id IN (${marks})`).run(...ids);
        for (const inv of emptied) await tx.prepare('DELETE FROM purchase_invoices WHERE id = ?').run(inv.id);
      } else {
        await tx.prepare(`UPDATE purchase_lines SET dress_id = NULL WHERE dress_id IN (${marks})`).run(...ids);
      }
      await tx.prepare(`DELETE FROM dresses WHERE id IN (${marks})`).run(...ids);
    });
  } catch (e) {
    console.error('Failed, nothing was deleted:', e.message);
    process.exit(1);
  }

  // Files go last: the rows are gone, so a failure here only leaves dead bytes.
  let removed = 0;
  for (const f of files) { try { fs.unlinkSync(f); removed++; } catch (_) { /* already gone */ } }
  console.log(`\nDeleted ${targets.length} dress(es) and ${removed} image file(s).`);
})();
