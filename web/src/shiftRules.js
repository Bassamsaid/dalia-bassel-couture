/* How a day measures against the shift. These are the salary sheet's own rules,
   kept in one place here so the screen can never call somebody late when the
   sheet does not, nor stay quiet when it does. */

const hm = (s, d) => { const [h, m] = String(s || d).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export const hhmmOf = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function attMins(ci, co) {           // minutes between two "HH:MM" times
  if (!ci || !co) return 0;
  const [ih, im] = ci.split(':').map(Number);
  const [oh, om] = co.split(':').map(Number);
  let m = (oh * 60 + om) - (ih * 60 + im);
  if (m < 0) m += 1440;
  return m;
}
export const fmtDur = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export function clockIn(d, tz) {
  if (tz) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); }
    catch (e) { /* unknown zone: the phone's own clock is the better guess */ }
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* H:MM:SS since a check-in time today */
export function runningSince(at) {
  const [h, m] = String(at).split(':').map(Number);
  const start = new Date(); start.setHours(h || 0, m || 0, 0, 0);
  let sec = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
  const hh = Math.floor(sec / 3600); sec -= hh * 3600;
  const mm = Math.floor(sec / 60); const ss = sec - mm * 60;
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function shift(cfg = {}, me = {}) {
  // Her own hours if she has them, the studio's otherwise.
  const inMin = hm(me.shift_start || cfg.check_in_time, '09:00');
  // Coming in later than this costs half the day. Held as the gap from the
  // start of the day rather than a fixed hour, so her own start carries it.
  const gap = /^\d{1,2}:\d{2}$/.test(String(cfg.half_day_after || ''))
    ? hm(cfg.half_day_after, '11:00') - hm(cfg.check_in_time, '09:00') : 0;
  return {
    inMin,
    outMin: hm(me.shift_end || cfg.check_out_time, '17:00'),
    grace: Number(cfg.late_grace_min) || 0,
    halfCut: gap > 0 && inMin + gap < 1440 ? inMin + gap : null,
    halfFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.half_day_from || '')) ? String(cfg.half_day_from) : null,
  };
}

const offDays = (me) => new Set(String((me && me.off_days) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const weekdayOf = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

export function dayMarks(a, cfg, me) {
  if (offDays(me).has(weekdayOf(a.date))) {
    // Her day off. If she came in anyway, the whole of it is overtime — the day
    // was paid for either way, so every hour of it was given rather than owed.
    const over = (a.check_in && a.check_out) ? attMins(a.check_in, a.check_out) : 0;
    return { off: true, late: 0, over, half: false };
  }
  const s = shift(cfg, me);
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  let late = 0, over = 0, half = false;
  if (a.check_in) {
    const l = toMin(a.check_in) - s.inMin;
    // Past the hour it stops being minutes and becomes half the day — and only
    // one of the two is charged for.
    if (s.halfCut !== null && (!s.halfFrom || a.date >= s.halfFrom) && toMin(a.check_in) > s.halfCut) half = true;
    else if (l > s.grace) late = l - s.grace;
  }
  if (a.check_out) { const o = toMin(a.check_out) - s.outMin; if (o > 0) over = o; }
  return { off: false, late, over, half };
}

export function markPills(m) {
  if (m.off) return m.over ? [['off', 'Off day'], ['over', `Came in · ${fmtDur(m.over)} overtime`]] : [['off', 'Off day']];
  const pills = [];
  if (m.half) pills.push(['late', 'Half day']);
  if (m.late) pills.push(['late', `Late ${fmtDur(m.late)}`]);
  if (m.over) pills.push(['over', `Overtime ${fmtDur(m.over)}`]);
  if (!pills.length) pills.push(['ok', 'On time']);
  return pills;
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location not supported on this device'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
