/* `/agent-link`: the user lets an AI agent in by typing the code the agent
 * showed them (the "user claimed" flow in /auth.md). Also lists agents with
 * access and lets the user cut them off. Agents get read-only, one-hour
 * tokens; see supabase/functions/agent-auth. */
import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { buildAppDestination } from '../utils/accountPlatform';
import { AuthModal } from '../components/AuthModal';
import { C } from '../uiPalette';
import { readPendingAgentCode, savePendingAgentCode, clearPendingAgentCode } from './agentLinkPending';

export function normalizeAgentCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// `user_code` is ours. A bare `code` is only ours when it looks like one: on
// the way back from sign-in, Supabase also uses `code` for its own exchange.
function codeFromUrl() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const own = normalizeAgentCode(params.get('user_code'));
  if (own) return own;
  const bare = params.get('code') || '';
  if (/^[A-Za-z0-9]{8}$/.test(bare)) return normalizeAgentCode(bare);
  return readPendingAgentCode(window.localStorage);
}

const card = {
  // The width calc keeps a 16px gutter on phones instead of touching the edges.
  maxWidth: 440, width: 'calc(100% - 32px)', boxSizing: 'border-box', margin: '64px auto', padding: 24, borderRadius: 12,
  background: C.card, color: C.ink, border: `1px solid ${C.rule}`, fontFamily: 'system-ui, sans-serif',
  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
};
const btn = { padding: '10px 16px', borderRadius: 8, border: 'none', background: C.gold, color: C.onGold, cursor: 'pointer', fontSize: 14, fontWeight: 600, minHeight: 44 };
const ghost = { ...btn, background: 'transparent', color: C.dangerText, border: `1px solid ${C.rule}`, padding: '4px 10px', fontSize: 12, fontWeight: 400 };

export default function AgentLinkPage() {
  const auth = useContext(AuthContext) || {};
  const user = auth.user || null;
  const [code, setCode] = useState(codeFromUrl);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState([]);
  const [authOpen, setAuthOpen] = useState(true);

  // Keep the code through sign-up's email check or a Google sign-in, which
  // come back to the app's front page (see main.jsx).
  useEffect(() => {
    try { if (code && !user) savePendingAgentCode(window.localStorage, code); } catch { /* storage blocked */ }
  }, [code, user]);

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
    else {
      setMessage(`Done. "${data}" can now read your Survey data. Remove it below at any time.`);
      setCode('');
      try { clearPendingAgentCode(window.localStorage); } catch { /* storage blocked */ }
      loadLinks();
    }
  };

  const revoke = async (id) => {
    await supabase.rpc('revoke_agent_link', { p_id: id });
    loadLinks();
  };

  if (!auth.loading && !user) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Sign in or create a free account</h2>
        <p style={{ margin: '8px 0 16px', color: C.inkSoft }}>
          An AI agent asked to use Survey for you. The account is yours: it uses your email, starts on the free plan, and only you can pay or change it.
          {code ? ` After you sign in, you'll press Allow for code ${code}.` : ''}
        </p>
        <button style={btn} onClick={() => setAuthOpen(true)}>Sign in or sign up</button>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Let an AI agent use Survey</h2>
      <p style={{ fontSize: 14, margin: '8px 0 16px', color: C.inkSoft }}>Type the code your agent showed you. It gets read-only access to your account until you remove it (at most 30 days without being used). Only enter codes from agents you started.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="Agent code"
          value={code}
          onChange={(e) => setCode(normalizeAgentCode(e.target.value))}
          placeholder="ABCD2345"
          style={{ flex: 1, minWidth: 0, padding: 10, fontSize: 18, letterSpacing: 2, borderRadius: 8, border: `1px solid ${C.ruleStrong}`, background: C.bg, color: C.ink }}
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
      <p style={{ marginTop: 24 }}><a href={buildAppDestination()} style={{ color: C.gold }}>Back to Survey</a></p>
    </div>
  );
}
