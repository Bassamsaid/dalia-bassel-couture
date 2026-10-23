import { useState } from 'react';
import { initials, roleLabel, mediaUrl, POST } from './api.js';
import { NAV, BOTTOM, legacyUrl } from './nav.js';

/* A drawn bell rather than an emoji — it sits on the line properly and follows
   the type colour. */
function Bell() {
  return (
    <svg className="bell-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3a5.6 5.6 0 0 0-5.6 5.6v3.03c0 .5-.18.98-.5 1.36l-.94 1.1A1.2 1.2 0 0 0 5.88 16h12.24a1.2 1.2 0 0 0 .92-1.97l-.94-1.1a2.1 2.1 0 0 1-.5-1.36V8.6A5.6 5.6 0 0 0 12 3Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.9 19a2.2 2.2 0 0 0 4.2 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function Avatar({ user, cls = 'pav' }) {
  if (user && user.avatar) {
    return (
      <span className={cls} style={{ padding: 0, overflow: 'hidden' }}>
        <img src={mediaUrl(user.avatar)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
      </span>
    );
  }
  return <span className={cls}>{initials(user && user.name)}</span>;
}

function Drawer({ user, page, go, onClose }) {
  const rows = NAV[user.role] || NAV.staff;
  return (
    <div className="drawer-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer">
        <div className="drawer-head">
          <div className="logo">DB</div>
          <div><div className="dn">{user.name}</div><div className="dr">{roleLabel(user.role)}</div></div>
        </div>
        <div className="drawer-nav">
          {rows.map(([k, label, ic, opt]) => (
            <button key={k} className={'draw-item' + (page === k ? ' active' : '')}
              onClick={() => { onClose(); go(k, opt); }}>
              <span className="ic">{ic}</span>{label}
            </button>
          ))}
        </div>
        <button className="btn sec" style={{ marginTop: 8 }}
          onClick={async () => { try { await POST('/api/logout'); } catch (e) { /* signed out either way */ } location.href = '/'; }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/* The frame every screen sits in: the bar across the top, the row along the
   bottom, and the drawer behind the logo — the same three the studio already
   knows, down to the class names, because they share the one stylesheet. */
export default function Shell({ user, page, go, children }) {
  const [drawer, setDrawer] = useState(false);
  const bottom = BOTTOM[user.role] || (NAV[user.role] || NAV.staff).slice(0, 5);
  const navFor = (k) => (NAV[user.role] || NAV.staff).find(([key]) => key === k);
  return (
    <>
      <div className="app">
        <div className="topbar">
          <div className="logo" onClick={() => setDrawer(true)} style={{ cursor: 'pointer' }}>DB</div>
          <h1>Dalia Bassel</h1>
          <button className="bell-btn" onClick={() => { location.href = legacyUrl('notifications'); }} aria-label="Notifications"><Bell /></button>
          <button className="profile-btn" onClick={() => setDrawer(true)} aria-label={user.name}>
            <span className="who">{user.name}<br /><span className="muted">{roleLabel(user.role)}</span></span>
            <Avatar user={user} />
          </button>
        </div>
        <div className="content" id="content">{children}</div>
      </div>
      <div className={'bottomnav bn' + bottom.length} id="nav">
        {bottom.map(([k, label, ic]) => (
          <button key={k} data-p={k} className={page === k ? 'active' : ''}
            onClick={() => { const row = navFor(k); go(k, row && row[3]); }}>
            <span className="ic">{ic}</span>{label}
          </button>
        ))}
      </div>
      {drawer && <Drawer user={user} page={page} go={go} onClose={() => setDrawer(false)} />}
    </>
  );
}
