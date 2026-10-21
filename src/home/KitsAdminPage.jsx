/* `/kits`: the custom builds library's admin page. The people who run Survey
 * (the /flags admin list) publish kits and give them to customer accounts.
 * Every change goes through the kits-admin edge function, which checks the
 * caller on the server; the browser has no write access to the kit tables. */
import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { AuthModal } from '../components/AuthModal';
import { C } from '../uiPalette';
import { getExportKit } from '../services/exportFormats/registry.js';
import '../styles/tokens.css';
import '../styles/motion.css';

const card = {
  maxWidth: 640, width: 'calc(100% - 32px)', boxSizing: 'border-box', margin: '48px auto', padding: 24, borderRadius: 12,
  background: C.card, color: C.ink, border: `1px solid ${C.rule}`, fontFamily: 'system-ui, sans-serif',
  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
};
const btn = { padding: '10px 16px', borderRadius: 8, border: 'none', background: C.gold, color: C.onGold, cursor: 'pointer', fontSize: 14, fontWeight: 600, minHeight: 44 };
const field = { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, borderRadius: 8, border: `1px solid ${C.rule}`, font: 'inherit', fontSize: 14, color: C.ink, background: 'transparent' };
const section = { borderTop: `1px solid ${C.rule}`, padding: '16px 0' };

// A starting point for a new kit: the lock kit, renamed.
const starterKit = () => {
  const { id: _id, label: _label, ...rest } = getExportKit('wireless-lock-schedule') || {};
  return JSON.stringify({ ...rest, id: 'customer-name', version: '1.0.0', label: 'Customer name', extends: 'wireless-lock-schedule@0.1.0' }, null, 2);
};

async function callKitsAdmin(body) {
  const { data, error } = await supabase.functions.invoke('kits-admin', { body });
  if (error) {
    let message = 'That did not work. Try again.';
    try { message = (await error.context?.json())?.error || message; } catch { /* keep the plain message */ }
    return { error: message, status: error.context?.status };
  }
  return { data };
}

export default function KitsAdminPage() {
  const auth = useContext(AuthContext) || {};
  const user = auth.user || null;
  const [state, setState] = useState({ loading: true, allowed: false, kits: [], assignments: [] });
  const [message, setMessage] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [kitRef, setKitRef] = useState('');
  const [kitJson, setKitJson] = useState(starterKit);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error, status } = await callKitsAdmin({ action: 'list' });
    if (error) {
      setState({ loading: false, allowed: status !== 403 && status !== 401 ? null : false, kits: [], assignments: [] });
      if (status !== 403 && status !== 401) setMessage(error);
      return;
    }
    setState({ loading: false, allowed: true, kits: data.kits || [], assignments: data.assignments || [] });
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const run = async (body, done) => {
    setBusy(true);
    const { data, error } = await callKitsAdmin(body);
    setBusy(false);
    setMessage(error || done(data));
    if (!error) load();
  };

  const give = () => {
    const [kitId, version] = kitRef.split('@');
    run({ action: 'assign', email, kitId, version }, () => `Gave ${kitRef} to ${email}. They see it next time they sign in.`);
  };
  const publish = () => {
    let kit;
    try { kit = JSON.parse(kitJson); } catch { setMessage('The kit is not valid JSON.'); return; }
    run({ action: 'publish', kit }, (d) => `Published ${d.published}.`);
  };

  if (auth.loading) return <div style={card}><p style={{ margin: 0, color: C.inkSoft }}>Loading…</p></div>;

  if (!user) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Kits</h2>
        <p style={{ color: C.inkSoft }}>Sign in to manage customers' Excel layouts.</p>
        <button style={btn} onClick={() => setAuthOpen(true)}>Sign in</button>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} initialMode="login" />
      </div>
    );
  }

  if (state.loading) return <div style={card}><p style={{ margin: 0, color: C.inkSoft }}>Loading…</p></div>;

  if (state.allowed === false) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Kits</h2>
        <p style={{ color: C.inkSoft, marginBottom: 16 }}>This page is only for the people who run Survey.</p>
        <a href="/" style={{ color: C.gold }}>Back to Survey</a>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Kits</h2>
      <p style={{ color: C.inkSoft, marginTop: 0 }}>Excel layouts built for one customer. Give one to an account and it shows in that account's template editor.</p>

      <div style={section}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Who has which kit</h3>
        {state.assignments.length === 0 && <p style={{ color: C.inkSoft, margin: 0 }}>No one has a kit yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {state.assignments.map((a) => (
            <li key={`${a.user_id}-${a.kit_id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{a.email} · {a.kit_id}@{a.kit_version}</span>
              <button style={{ ...btn, background: 'transparent', color: C.ink, border: `1px solid ${C.rule}` }} disabled={busy}
                aria-label={`Take ${a.kit_id} from ${a.email}`}
                onClick={() => run({ action: 'unassign', email: a.email, kitId: a.kit_id }, () => `Took ${a.kit_id} from ${a.email}.`)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={section}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Give a kit</h3>
        <label style={{ fontSize: 13, color: C.inkSoft }}>Customer email
          <input type="email" aria-label="Customer email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
        </label>
        <label style={{ fontSize: 13, color: C.inkSoft, display: 'block', marginTop: 8 }}>Kit
          <select aria-label="Kit" value={kitRef} onChange={(e) => setKitRef(e.target.value)} style={field}>
            <option value="">Pick a kit</option>
            {state.kits.map((k) => <option key={`${k.id}@${k.version}`} value={`${k.id}@${k.version}`}>{k.label || k.id} ({k.id}@{k.version})</option>)}
          </select>
        </label>
        <button style={{ ...btn, marginTop: 10 }} disabled={busy || !email || !kitRef} onClick={give}>Give kit</button>
      </div>

      <div style={section}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Publish a kit</h3>
        <p style={{ fontSize: 13, color: C.inkSoft, margin: '0 0 6px' }}>Kits never change once published. To change one, publish it again with a higher version.</p>
        <label style={{ fontSize: 13, color: C.inkSoft }}>Kit (JSON)
          <textarea aria-label="Kit (JSON)" value={kitJson} onChange={(e) => setKitJson(e.target.value)} rows={12}
            style={{ ...field, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
        </label>
        <button style={{ ...btn, marginTop: 10 }} disabled={busy} onClick={publish}>Publish kit</button>
      </div>

      {message && <p role="status" style={{ fontSize: 14 }}>{message}</p>}
      <a href="/" style={{ color: C.gold, fontSize: 14 }}>Back to Survey</a>
    </div>
  );
}
