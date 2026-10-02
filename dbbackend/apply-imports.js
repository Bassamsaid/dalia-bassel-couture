'use strict';
// Months of attendance that were kept on paper, loaded when the app starts.
//
// The studio has no way to reach the database and no terminal to run anything
// in, and a month of timesheets is too much to type into a screen. So a month
// arrives as a file in imports/, and is applied once, on the next start, with
// nothing for anyone to upload or click.
//
// Each file is named after what it holds (2026-09-juliana.json) and is applied
// at most once — the name is written to settings when it is done. Rows carry
// their own ids as well, so even a file applied under a new name adds nothing
// twice.
//
// They are applied in the order their names sort, which is why a file that
// corrects an earlier one is named for the day it was written rather than the
// month it is about: 2026-10-01-juliana-september-correction.json comes after
// every 2026-09-* file and so has the last word. On a database that has already
// taken the first file this does not matter; on an empty one it decides whether
// the correction survives.
//
// Only the tables below can be written this way. Days worked and days off, and
// studio costs — a stack of paper invoices is the same problem as a month of
// paper timesheets, and arrives the same way. Nothing else: an import is not a
// way to reach the rest of the database from a file on disk, and in particular
// never users, sessions or anything that decides what somebody may see.
//
// An invoice has a photograph, so a file may carry its photographs too. They sit
// in imports/files/ and are copied into the uploads directory under the exact
// names the rows refer to, which is the only way a row written from disk can
// point at a picture that is really there.
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = ['attendance', 'absences', 'leaves', 'expenses'];
const DIR = path.join(__dirname, 'imports');
const FILES = path.join(DIR, 'files');

async function applyImports(db, uploadDir) {
  // the same place the app itself keeps photographs, so a copied one is served
  const UPLOAD_DIR = uploadDir || process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
  let files;
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(); }
  catch (e) { return []; }

  const done = [];
  for (const file of files) {
    const key = `import_${file}`;
    const already = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (already) continue;

    let payload;
    try { payload = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); }
    catch (e) { console.warn(`Import ${file} is not readable JSON — skipped.`); continue; }
    const tables = (payload && payload.tables) || {};

    // A file may say it is replacing what an earlier one wrote — a month going
    // back in with a column that did not exist the first time. Rows still carry
    // their own ids, so this overwrites those exact rows and nothing else.
    const replace = payload && payload.replace === true;

    // A file may also take rows away. Days entered before the studio's own
    // timesheet was to hand turned out to be a test, and a correction that can
    // only add would leave them there for ever. By id, so it can only reach rows
    // an import put in, and only in the tables an import may write.
    let removed = 0;
    for (const [t, ids] of Object.entries((payload && payload.remove) || {})) {
      if (!ALLOWED.includes(t) || !Array.isArray(ids)) continue;
      for (const id of ids) {
        if (!Number.isInteger(id)) continue;
        const r = await db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id);
        removed += Number(r.changes || 0);
      }
    }

    // The photographs first, so no row is ever written pointing at a picture
    // that is not there yet. Copied by name, never overwriting one already in
    // the uploads directory — a photo that is there is the real one.
    let copied = 0;
    for (const name of (Array.isArray(payload && payload.files) ? payload.files : [])) {
      const safe = path.basename(String(name || ''));
      if (!safe || safe !== name) continue; // a name, never a path
      const from = path.join(FILES, safe);
      const to = path.join(UPLOAD_DIR, safe);
      try {
        if (!fs.existsSync(from) || fs.existsSync(to)) continue;
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.copyFileSync(from, to);
        copied += 1;
      } catch (e) { console.warn(`Import ${file}: ${safe} could not be put in place — ${e.message}`); }
    }

    let written = 0, skipped = 0;
    for (const t of ALLOWED) {
      const rows = tables[t];
      if (!Array.isArray(rows) || !rows.length) continue;
      // Only columns this database actually has, so a file written against a
      // newer version still applies against an older one.
      const cols = (await db.prepare(`PRAGMA table_info(${t})`).all()).map((c) => c.name);
      for (const row of rows) {
        const use = cols.filter((c) => row[c] !== undefined);
        if (!use.length) continue;
        const sql = `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO ${t} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`;
        const r = await db.prepare(sql).run(...use.map((c) => row[c]));
        if (r.changes) written++; else skipped++;
      }
    }
    await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, new Date().toISOString());
    done.push({ file, written, skipped, removed, copied });
  }
  return done;
}

module.exports = { applyImports, ALLOWED };
