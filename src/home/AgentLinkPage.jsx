/* `/agent-link`: the user lets an AI agent in by typing the code the agent
 * showed them (the "user claimed" flow in /auth.md). Also lists agents with
 * access and lets the user cut them off. Agents get read-only, one-hour
 * tokens; see supabase/functions/agent-auth. */
import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { buildAppDestination } from '../utils/accountPlatform';
import { C } from '../uiPalette';

export function normalizeAgentCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function codeFromUrl() {
  if (typeof window === 'undefined') return '';
  return normalizeAgentCode(new URLSearchParams(window.location.search).get('code'));
}

const card = {
  maxWidth: 440, margin: '64px auto', padding: 24, borderRadius: 12,
  background: C?.panel || '#fff', color: C?.text || '#111', fontFamily: 'system-ui, sans-serif',
  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
};
const btn = { padding: '10px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 14 };
const ghost = { ...btn, background: 'transparent', color: '#b91c1c', border: '1px solid #e5e7eb', padding: '4px 10px', fontSize: 12 };

export default function AgentLinkPage() {
  const auth = useContext(AuthContext) || {};
  const user = auth.user || null;
  const [code, setCode] = useState(codeFromUrl);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState([]);

  const loadLinks = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('agent_links')
      .select('id, agent_name, status, token_expires_at, approved_at')
      .neq('status', 'revoked')
      .order('approved_at', { ascending: false });
    setLinks(data || []);
  }, [user]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const approve = async () => {
    if (code.length !== 8) { setMessage('The code has 8 letters and numbers.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('approve_agent_link', { p_user_code: code });
    setBusy(false);
    if (error) setMessage('Could not check that code. Try again.');
    else if (!data) setMessage('That code is wrong, used, or more than 10 minutes old. Ask the agent for a new one.');
    else { setMessage(`Done. "${data}" can now read your Survey data for one hour.`); setCode(''); loadLinks(); }
  };

  const revoke = async (id) => {
    await supabase.rpc('revoke_agent_link', { p_id: id });
    loadLinks();
  };

  if (!auth.loading && !user) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Sign in to let an agent in</h2>
        <p>Sign in to Survey, then open this link again.</p>
        <button style={btn} onClick={() => window.location.assign(buildAppDestination({ params: { signIn: '1' } }))}>Sign in</button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Let an AI agent use Survey</h2>
      <p style={{ fontSize: 14 }}>Type the code your agent showed you. It gets read-only access to your account for one hour. Only enter codes from agents you started.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="Agent code"
          value={code}
          onChange={(e) => setCode(normalizeAgentCode(e.target.value))}
          placeholder="ABCD2345"
          style={{ flex: 1, padding: 10, fontSize: 18, letterSpacing: 2, borderRadius: 8, border: '1px solid #d1d5db' }}
        />
        <button style={btn} disabled={busy} onClick={approve}>Allow</button>
      </div>
      {message && <p style={{ fontSize: 14 }}>{message}</p>}
      {links.length > 0 && (
        <>
          <h3 style={{ fontSize: 15 }}>Agents with access</h3>
          {links.map((l) => (
            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '6px 0' }}>
              <span>{l.agent_name}</span>
              <button style={ghost} onClick={() => revoke(l.id)}>Remove</button>
            </div>
          ))}
        </>
      )}
      <p style={{ marginTop: 24 }}><a href={buildAppDestination()}>Back to Survey</a></p>
    </div>
  );
}
