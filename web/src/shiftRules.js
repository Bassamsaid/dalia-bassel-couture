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
  return {
    inMin,
    outMin: hm(me.shift_end || cfg.check_out_time, '17:00'),
    grace: Number(cfg.late_grace_min) || 0,
  };
}

const offDays = (me) => new Set(String((me && me.off_days) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const weekdayOf = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

export function dayMarks(a, cfg, me) {
  if (offDays(me).has(weekdayOf(a.date))) {
    // Her day off. If she came in anyway, the whole of it is overtime — the day
    // was paid for either way, so every hour of it was given rather than owed.
    const over = (a.check_in && a.check_out) ? attMins(a.check_in, a.check_out) : 0;
    return { off: true, late: 0, over };
  }
  const s = shift(cfg, me);
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  let late = 0, over = 0;
  if (a.check_in) { const l = toMin(a.check_in) - s.inMin; if (l > s.grace) late = l - s.grace; }
  if (a.check_out) {
    // never more overtime than there were minutes in the day — the salary
    // sheet's own ceiling, so this screen cannot promise what it will not pay
    const worked = Math.max(0, toMin(a.check_out) - toMin(a.check_in || a.check_out));
    const o = Math.min(toMin(a.check_out) - s.outMin, worked);
    if (o > 0) over = o;
  }
  return { off: false, late, over };
}

export function markPills(m) {
  if (m.off) return m.over ? [['off', 'Off day'], ['over', `Came in · ${fmtDur(m.over)} overtime`]] : [['off', 'Off day']];
  const pills = [];
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
