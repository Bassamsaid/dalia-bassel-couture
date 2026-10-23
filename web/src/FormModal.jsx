import { useState } from 'react';

/* The studio's own little form-in-a-box, in React. Same markup and same class
   names as the one in service — and the same ids, so what it looks like and
   what the tests reach for both stay put.
   Three fields or fewer is one step, which is every form it is asked for so
   far; the stepping through longer ones comes with the screens that need it. */
export default function FormModal({ heading, fields, submitLabel = 'Save', onClose, onSubmit }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const missing = fields.find((f) => f.required && !String(vals[f.name] || '').trim());
    if (missing) return setErr(`${missing.label} is needed`);
    setSaving(true); setErr('');
    try { await onSubmit(vals); onClose(); }
    catch (ex) { setErr(ex.message || 'Could not save'); setSaving(false); }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <button className="close" onClick={onClose}>✕</button>
        <h3>{heading}</h3>
        <form id="fm" onSubmit={submit}>
          <div className="wstep">
            {fields.map((f) => (
              <label key={f.name}>
                {f.label}
                <input name={f.name} type={f.type || 'text'} value={vals[f.name]}
                  onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))} />
              </label>
            ))}
          </div>
          {err ? <div className="err" id="fmErr">{err}</div> : <div className="err hidden" id="fmErr" />}
          <div className="wnav">
            <button className="btn" id="wSave" type="submit" disabled={saving}>{submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
