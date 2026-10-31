import { useEffect, useState } from 'react';
import { GET, POST, today, dt, toast, STUDIO_TZ } from '../api.js';
import { attMins, fmtDur, clockIn, runningSince, shift, dayMarks, markPills, hhmmOf, getPosition } from '../shiftRules.js';
import FormModal from '../FormModal.jsx';

function Pills({ marks }) {
  return <div className="d-pills">{markPills(marks).map(([k, label], i) => <span key={i} className={'d-pill ' + k}>{label}</span>)}</div>;
}

/* Her day: where it stands now, what it has come to this month, and the days
   behind it. The owner's screen and the staff's are the same screen — only who
   she asks when she forgets differs, because she is who the others ask. */
export default function MyCheck({ user, cfg, go }) {
  const [att, setAtt] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);

  const load = () => GET('/api/attendance?mine=1').then(setAtt).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  if (!att) return <div className="spinner" />;

  const s = shift(cfg, user);
  const rec = att.find((a) => a.date === today());
  const st = (!rec || !rec.check_in) ? 'out' : (!rec.check_out ? 'in' : 'done');
  const marks = rec ? dayMarks(rec, cfg, user) : null;
  const month = today().slice(0, 7);
  const mine = att.filter((a) => a.date.slice(0, 7) === month).map((a) => ({ a, m: dayMarks(a, cfg, user) }));
  const lateTotal = mine.reduce((x, r) => x + r.m.late, 0);
  const overTotal = mine.reduce((x, r) => x + r.m.over, 0);
  const lateDays = mine.filter((r) => r.m.late).length;

  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let body = {};
      if (cfg.geo_enabled === '1' && cfg.geo_lat) {
        toast('Getting your location…');
        try { const pos = await getPosition(); body = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }
        catch (e) { toast(e.code === 1 ? 'Please allow location to check in' : 'Could not get your location — try again'); return; }
      }
      const r = await POST('/api/attendance/check', body);
      toast(r.action === 'in' ? 'Checked in ✓' : r.action === 'out' ? 'Checked out ✓' : 'Done');
      await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      {user.role === 'admin' && (
        <div className="row" style={{ marginBottom: 4 }}>
          <button className="btn sec sm" onClick={() => go('home')}>‹ Back to admin</button>
        </div>
      )}
      <div className="page-title">🕒 {user.role === 'admin' ? 'My day' : `Welcome, ${user.name}`}</div>

      <div className="card checkin">
        <div className="ck-clock">{clockIn(now, STUDIO_TZ)}</div>
        <div className="ck-date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
        <div className="ck-shift">
          Your shift · {hhmmOf(s.inMin)} – {hhmmOf(s.outMin)}
          {s.grace ? ` · ${s.grace}m grace` : ''}
        </div>

        {st === 'done'
          ? <div className="ck-ring done"><span className="ic">✓</span><span className="lbl">Done</span></div>
          : (
            <button className={'ck-ring ' + st} onClick={check} disabled={busy}>
              <span className="ic">{st === 'out' ? '🕒' : '👋'}</span>
              <span className="lbl">{st === 'out' ? 'Check in' : 'Check out'}</span>
            </button>
          )}

        {st === 'out' && <div className="ck-status"><span className="muted">No check-in yet — tap to start your day</span></div>}
        {st === 'in' && (
          <div className="ck-running">
            <div className="run-k">Working since {rec.check_in}</div>
            <div className="run-t">{runningSince(rec.check_in)}</div>
            {marks && marks.late
              ? <div className="d-pills"><span className="d-pill late">Came in {fmtDur(marks.late)} late</span></div>
              : null}
          </div>
        )}
        {st === 'done' && (
          <>
            <div className="ck-pills">
              <div className="ck-pill"><div className="k">In</div><div className="v">{rec.check_in}</div></div>
              <div className="ck-pill"><div className="k">Out</div><div className="v">{rec.check_out}</div></div>
              <div className="ck-pill"><div className="k">Worked</div><div className="v">{fmtDur(attMins(rec.check_in, rec.check_out))}</div></div>
            </div>
            <Pills marks={marks} />
          </>
        )}
      </div>

      {/* The owner has nobody to ask — she is who the others ask — so she puts
          her own day right. Everybody else asks, and waits to be approved. */}
      {user.role === 'admin'
        ? <button className="btn ghost sm" style={{ margin: '0 0 14px' }} onClick={() => setForm('fix')}>✎ Forgot to check in/out? Put the day right</button>
        : <button className="btn ghost sm" style={{ margin: '0 0 14px' }} onClick={() => setForm('ask')}>🕒 Forgot to check in/out? Request a manual log</button>}

      {form === 'fix' && (
        <FormModal heading="Put the day right" onClose={() => setForm(null)}
          fields={[
            { name: 'date', label: 'Day', type: 'date', required: true, value: today() },
            { name: 'check_in', label: 'In', type: 'time', value: (rec && rec.check_in) || '' },
            { name: 'check_out', label: 'Out', type: 'time', value: (rec && rec.check_out) || '' },
          ]}
          onSubmit={async (d) => {
            const r = await POST('/api/attendance', { ...d, user_id: user.id, note: 'by hand' });
            toast(r && r.corrected ? 'Day put right ✓' : 'Day written down ✓');
            await load();
          }} />
      )}
      {form === 'ask' && (
        <FormModal heading="Request manual log" onClose={() => setForm(null)}
          fields={[
            { name: 'date', label: 'Day', type: 'date', required: true, value: today() },
            { name: 'time', label: 'Time', type: 'time' },
            { name: 'reason', label: 'Reason (optional)' },
          ]}
          onSubmit={async (d) => {
            await POST('/api/attendance-requests', { ...d, kind: rec && rec.check_in ? 'out' : 'in' });
            toast('Request sent to admin ✓');
          }} />
      )}

      <div className="sec-title">This month</div>
      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="stat" style={{ '--c1': '#d24b62', '--c2': '#f0a3b0', '--glow': '210,75,98' }}>
          <div className="n" style={{ color: lateTotal ? 'var(--bad)' : 'var(--ok)' }}>{fmtDur(lateTotal)}</div>
          <div className="l">Late · {lateDays} day{lateDays === 1 ? '' : 's'}</div>
        </div>
        <div className="stat" style={{ '--c1': '#2f9d66', '--c2': '#7fd3a6', '--glow': '47,157,102' }}>
          <div className="n" style={{ color: 'var(--ok)' }}>{fmtDur(overTotal)}</div>
          <div className="l">Overtime</div>
        </div>
      </div>

      <div className="sec-title">Recent</div>
      <div className="card">
        {att.length ? att.slice(0, 30).map((a) => {
          const m = dayMarks(a, cfg, user);
          return (
            <div className="item" key={a.id}>
              <div className="av">{a.check_out ? '✓' : (a.check_in ? '◐' : '—')}</div>
              <div className="main">
                <div className="nm">{dt(a.date)}</div>
                <div className="sub">In {a.check_in || '—'} · Out {a.check_out || '—'}</div>
                <Pills marks={m} />
              </div>
              {(a.check_in && a.check_out)
                ? <div className="sub" style={{ fontWeight: 800, color: 'var(--ink)' }}>{fmtDur(attMins(a.check_in, a.check_out))}</div>
                : null}
            </div>
          );
        }) : <div className="empty"><div className="ic">🕒</div><div>No records yet</div></div>}
      </div>
    </>
  );
}
