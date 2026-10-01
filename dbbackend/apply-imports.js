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
// Only the tables below can be written this way. An import is a record of days
// worked and days off, not a way to reach the rest of the database from a file
// on disk.
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = ['attendance', 'absences', 'leaves'];
const DIR = path.join(__dirname, 'imports');

async function applyImports(db) {
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
    done.push({ file, written, skipped });
  }
  return done;
}

module.exports = { applyImports, ALLOWED };
