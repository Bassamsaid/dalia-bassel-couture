import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GET, setStudioTz } from './api.js';
import { legacyUrl } from './nav.js';
import Shell from './Shell.jsx';
import MyCheck from './pages/MyCheck.jsx';

/* The screens that live here. Everything else is still the app in service, and
   `go` hands anybody asking for one of those straight back to it — so there is
   never a door in this app that opens onto nothing. */
const PAGES = {
  mycheck: MyCheck,
};

function App() {
  const [boot, setBoot] = useState(null);         // { user, cfg } | { error }
  const [page, setPage] = useState('mycheck');

  useEffect(() => {
    (async () => {
      try {
        const [me, cfg] = await Promise.all([GET('/api/me'), GET('/api/settings')]);
        if (!me || !me.user) return setBoot({ signedOut: true });
        setStudioTz(cfg && cfg.studio_tz);
        setBoot({ user: me.user, cfg: cfg || {} });
      } catch (e) { setBoot({ signedOut: true }); }
    })();
  }, []);

  const go = (key, opt) => {
    if (PAGES[key] && !(opt && opt.legacy)) return setPage(key);
    location.href = legacyUrl(key);               // not rewritten yet
  };

  if (!boot) return <div className="spinner" />;
  // Signing in is still the old app's job; the session cookie is the same one,
  // so coming back here afterwards just works.
  if (boot.signedOut) { location.href = '/'; return <div className="spinner" />; }

  const Page = PAGES[page] || MyCheck;
  return (
    <Shell user={boot.user} page={page} go={go}>
      <Page user={boot.user} cfg={boot.cfg} go={go} />
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
