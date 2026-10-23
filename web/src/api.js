/* The same door the current app knocks on: same origin, same session cookie,
   same errors. Nothing about the server changes for this rewrite. */
export async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  let data = null;
  try { data = await r.json(); } catch (e) { /* an empty body is not an error */ }
  if (!r.ok) throw new Error((data && data.error) || 'Connection error');
  return data;
}
export const GET = (p) => api('GET', p);
export const POST = (p, b) => api('POST', p, b);
export const PUT = (p, b) => api('PUT', p, b);
export const DEL = (p) => api('DELETE', p);

/* The studio's day, not the browser's. Egypt runs three hours ahead of UTC, so
   from nine in the evening until midnight the two disagree about the date — and
   a timesheet that disagrees about the date is worth nothing. */
export let STUDIO_TZ = 'Africa/Cairo';
export function setStudioTz(tz) { if (tz) STUDIO_TZ = tz; }
export function dayIn(d, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); }
  catch (e) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
}
export const today = () => dayIn(new Date(), STUDIO_TZ);

export const dt = (s) => (s ? String(s).slice(0, 10) : '—');
export const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase();
export const roleLabel = (r) => ({ admin: 'Admin', manager: 'Manager', trainee: 'Student', staff: 'Staff', customer: 'Client', visitor: 'Visitor' }[r] || r);
export const mediaUrl = (u) => (!u ? '' : (/^https?:\/\//.test(u) ? u : u.startsWith('/') ? u : '/uploads/' + u));

export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern || [70, 60, 70, 60, 140]); } catch (e) { /* no vibration here */ }
}
/* The same note that slides up from the bottom today, kept outside React: it
   has to survive a screen being replaced under it. */
export function toast(msg, kind) {
  const bad = kind === 'error';
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle('toast-error', bad);
  t.classList.remove('show'); void t.offsetWidth;        // restart the animation
  t.classList.add('show');
  if (bad) buzz();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), bad ? 4200 : 2400);
}
