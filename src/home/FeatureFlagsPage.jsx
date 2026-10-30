/* `/flags`: the switch board for unfinished features (src/featureFlags.js).
 * Only people in feature_flag_admins see the switches; everyone else is told
 * the page is not for them. Each flag is Off, Testers only, or On for
 * everyone. Changes show for each person on their next reload. */
import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { AuthModal } from '../components/AuthModal';
import { C } from '../uiPalette';
import { FEATURE_FLAGS, isBetaFlag, normalizeTesterEmails, refreshFeatureFlags, releaseChannel } from '../featureFlags';
import '../styles/tokens.css';
import '../styles/motion.css';

const MODES = [
  { id: 'off', label: 'Off' },
  { id: 'testers', label: 'Testers only' },
  { id: 'on', label: 'Everyone' },
];

const card = {
  maxWidth: 560, width: 'calc(100% - 32px)', boxSizing: 'border-box', margin: '48px auto', padding: 24, borderRadius: 12,
  background: C.card, color: C.ink, border: `1px solid ${C.rule}`, fontFamily: 'system-ui, sans-serif',
  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
};
const btn = { padding: '10px 16px', borderRadius: 8, border: 'none', background: C.gold, color: C.onGold, cursor: 'pointer', fontSize: 14, fontWeight: 600, minHeight: 44 };
const modeBtn = (active) => ({
  flex: 1, minHeight: 40, padding: '8px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? C.gold : C.rule}`, borderRadius: 8,
  background: active ? C.gold : 'transparent', color: active ? C.onGold : C.ink,
});

function FlagRow({ flag, onSave }) {
  const [emails, setEmails] = useState((flag.tester_emails || []).join(', '));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEmails((flag.tester_emails || []).join(', ')); }, [flag.tester_emails]);

  const save = async (patch) => {
    setBusy(true);
    await onSave(flag.key, patch);
    setBusy(false);
  };

  return (
    <div style={{ borderTop: `1px solid ${C.rule}`, padding: '16px 0' }}>
      <div style={{ fontWeight: 600 }}>
        {FEATURE_FLAGS[flag.key]?.label || flag.key}
        {isBetaFlag(flag.key) && (
          <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: C.ink, border: `1px solid ${C.rule}` }}>
            Nightly only
          </span>
        )}
      </div>
      {flag.description && <div style={{ fontSize: 13, color: C.inkSoft, margin: '4px 0 10px' }}>{flag.description}</div>}
      <div role="radiogroup" aria-label={`Who sees ${flag.key}`} style={{ display: 'flex', gap: 8 }}>
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={flag.mode === m.id} disabled={busy}
            style={modeBtn(flag.mode === m.id)} onClick={() => save({ mode: m.id })}>
            {m.label}
          </button>
        ))}
      </div>
      {flag.mode === 'testers' && (
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 13, color: C.inkSoft }}>
            Tester emails, separated by commas
            <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={2}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, borderRadius: 8, border: `1px solid ${C.rule}`, font: 'inherit', fontSize: 14, color: C.ink, background: 'transparent' }} />
          </label>
          <button style={{ ...btn, marginTop: 8 }} disabled={busy}
            onClick={() => save({ tester_emails: normalizeTesterEmails(emails) })}>
            Save testers
          </button>
        </div>
      )}
    </div>
  );
}

export default function FeatureFlagsPage() {
  const auth = useContext(AuthContext) || {};
  const user = auth.user || null;
  const [isAdmin, setIsAdmin] = useState(null);
  const [flags, setFlags] = useState([]);
  const [message, setMessage] = useState('');
  const [authOpen, setAuthOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: admin } = await supabase.rpc('is_feature_flag_admin');
    setIsAdmin(admin === true);
    if (admin !== true) return;
    const { data, error } = await supabase.from('feature_flags')
      .select('key, mode, tester_emails, description, updated_at')
      .order('key');
    if (error) setMessage('Could not load the flags. Reload to try again.');
    // Only flags the app knows about can do anything.
    else setFlags((data || []).filter((f) => FEATURE_FLAGS[f.key]));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const saveFlag = async (key, patch) => {
    const { error } = await supabase.from('feature_flags').update(patch).eq('key', key);
    if (error) { setMessage('That change did not save. Try again.'); return; }
    setMessage('Saved. People see it the next time they reload Survey.');
    await refreshFeatureFlags(supabase);
    load();
  };

  if (auth.loading) return <div style={card}><p style={{ margin: 0, color: C.inkSoft }}>Loading…</p></div>;

  if (!user) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Feature switches</h2>
        <p style={{ color: C.inkSoft }}>Sign in to manage which unfinished features people can see.</p>
        <button style={btn} onClick={() => setAuthOpen(true)}>Sign in</button>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} initialMode="login" />
      </div>
    );
  }

  if (isAdmin === null) return <div style={card}><p style={{ margin: 0, color: C.inkSoft }}>Loading…</p></div>;

  if (!isAdmin) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Feature switches</h2>
        <p style={{ color: C.inkSoft, marginBottom: 16 }}>This page is only for the people who run Survey.</p>
        <a href="/" style={{ color: C.gold }}>Back to Survey</a>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Feature switches</h2>
      <p style={{ color: C.inkSoft, marginTop: 0 }}>
        Unfinished features stay hidden until you turn them on here.
        Features marked Nightly only show in Survey Nightly and never on surveytool.app, whatever you pick;
        they reach surveytool.app once they are moved to stable in the code.
        {releaseChannel() === 'nightly' ? ' This is Survey Nightly, where every Nightly only feature is on no matter what you pick; the rest follow what you pick, as on surveytool.app.' : ''}
      </p>
      {flags.map((f) => <FlagRow key={f.key} flag={f} onSave={saveFlag} />)}
      {flags.length === 0 && !message && <p style={{ color: C.inkSoft }}>No features are waiting behind a switch.</p>}
      {message && <p role="status" style={{ fontSize: 14 }}>{message}</p>}
      <a href="/" style={{ color: C.gold, fontSize: 14 }}>Back to Survey</a>
    </div>
  );
}
