'use strict';
// Putting right the shifts that were recorded on the wrong clock.
//
// Until this was fixed, a check from the button took the time off the machine
// the server runs on, which is UTC — so seven in the evening in Cairo went into
// the timesheet as four. A time typed into a manual log, though, is whatever the
// person meant by it and was stored exactly as typed, so those rows are already
// right and must not be touched.
//
// The two can be told apart with certainty rather than guessed at: a row's
// check-in or check-out is hand-written if, and only if, there is an approved
// manual request for that person, that day and that direction. Nothing else in
// the app writes to this table. So each half of each row is examined on its own
// — a day whose check-in was typed and whose check-out came from the button has
// only its check-out corrected.
//
// Rows carry tz_ok once they are known to be on the studio's clock, so this can
// run as often as it likes and a corrected row is never shifted twice. Data
// restored from a backup taken before the fix arrives without the mark and is
// put right on the next start.

// How far ahead of UTC the studio was on a given day — +3 in summer, +2 once
// the clocks go back. Read from the date rather than assumed, so a shift in
// March is not corrected by October's offset.
function offsetHoursOn(dateStr, tz) {
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(noonUtc)) return null;
  const hourThere = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23',
  }).format(noonUtc));
  if (!isFinite(hourThere)) return null;
  return hourThere - 12; // midday never crosses a date boundary
}

// Move "HH:MM" forward by whole hours. Returns null if that would land on the
// following day: the row's date would have to move too, which could collide
// with another row, so such a case is reported and left for a person to judge.
function shift(hhmm, hours) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]) + hours;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

async function fixAttendanceTz(db, tz = 'Africa/Cairo') {
  const rows = await db.prepare(
    'SELECT id, user_id, date, check_in, check_out FROM attendance WHERE COALESCE(tz_ok,0) = 0'
  ).all();
  if (!rows.length) return { examined: 0, corrected: 0, left: 0, skipped: [], odd: [] };

  // Every half-row a person typed themselves, as "user|date|in".
  const typed = new Set();
  for (const r of await db.prepare(
    "SELECT user_id, date, kind FROM attendance_requests WHERE status = 'approved'"
  ).all()) typed.add(`${r.user_id}|${r.date}|${r.kind}`);

  let corrected = 0, left = 0;
  const skipped = [];
  const odd = [];
  for (const r of rows) {
    const off = offsetHoursOn(r.date, tz);
    if (off === null || off === 0) { left++; continue; } // unreadable date, or nothing to do
    const next = { check_in: r.check_in, check_out: r.check_out };
    let touched = false;
    let overflowed = false;
    for (const [field, kind] of [['check_in', 'in'], ['check_out', 'out']]) {
      const was = r[field];
      if (!was) continue;
      if (typed.has(`${r.user_id}|${r.date}|${kind}`)) continue; // already the studio's clock
      const now = shift(was, off);
      if (now === null) { overflowed = true; continue; }
      next[field] = now;
      touched = true;
    }
    // A row that would have to move to another day is left exactly as it is,
    // and unmarked, so it shows up again rather than being quietly accepted.
    if (overflowed) {
      skipped.push({ id: r.id, date: r.date, check_in: r.check_in, check_out: r.check_out });
      continue;
    }
    await db.prepare('UPDATE attendance SET check_in=?, check_out=?, tz_ok=1 WHERE id=?')
      .run(next.check_in, next.check_out, r.id);
    if (touched) corrected++; else left++;
    // A day that still ends before it began means the evidence was wrong — an
    // approved request deleted since, most likely, so one half was treated as
    // machine-written when a person had typed it. Worth a human's eye.
    if (next.check_in && next.check_out && next.check_out < next.check_in) {
      odd.push({ id: r.id, date: r.date, check_in: next.check_in, check_out: next.check_out });
    }
  }
  return { examined: rows.length, corrected, left, skipped, odd };
}

// Clearing out the shifts from before the studio started keeping this properly.
//
// Deleting a timesheet is not undoable, so: it happens once for a given date
// and remembers that it has, it touches nothing but the attendance rows, and it
// writes what it removed to the log first — a count per person and the span of
// dates — so there is a record of what was there even though the rows are gone.
async function pruneAttendanceBefore(db, dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return { deleted: 0, invalid: true };
  const done = await db.prepare("SELECT value FROM settings WHERE key = 'attendance_pruned_before'").get();
  if (done && done.value === dateStr) return { deleted: 0, alreadyDone: true };

  const going = await db.prepare(
    `SELECT u.name, COUNT(*) n, MIN(a.date) first, MAX(a.date) last
       FROM attendance a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.date < ? GROUP BY a.user_id ORDER BY n DESC`
  ).all(dateStr);
  const r = await db.prepare('DELETE FROM attendance WHERE date < ?').run(dateStr);
  await db.prepare(
    "INSERT INTO settings (key,value) VALUES ('attendance_pruned_before',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(dateStr);
  return { deleted: Number(r.changes || 0), perPerson: going, before: dateStr };
}

module.exports = { fixAttendanceTz, pruneAttendanceBefore, offsetHoursOn, shift };
