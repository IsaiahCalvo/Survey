/* `/agent-link`: the user lets an AI agent in by typing the code the agent
 * showed them (the "user claimed" flow in /auth.md). `/oauth/consent`: the
 * consent screen for outside agents signing in through the Supabase OAuth
 * server; they then act as the person, with the person's role and plan, under
 * RLS. Both list agents with access and let the user cut them off. */
import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { buildAppDestination } from '../utils/accountPlatform';
import { AuthModal } from '../components/AuthModal';
import { C } from '../uiPalette';
// This page renders outside the app shell, so the modal's scrim and motion
// variables are not loaded unless we pull them in here.
import '../styles/tokens.css';
import '../styles/motion.css';
import {
  readPendingAgentCode, savePendingAgentCode, clearPendingAgentCode,
  isConsentId, readPendingConsent, savePendingConsent, clearPendingConsent,
} from './agentLinkPending';

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

function consentIdFromUrl() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const id = params.get('authorization_id');
  if (isConsentId(id)) return id;
  // A link carrying an agent code starts that flow, not an older consent.
  if (params.get('user_code') || /^\/agent-link(?:\/|$)/.test(window.location.pathname)) return '';
  try { return readPendingConsent(window.localStorage); } catch { return ''; }
}

// What an outside agent may do, shown before the person says yes.
export const AGENT_RULES = [
  'It acts as you, with your rights on each document: where you can only view, it can only view.',
  'It gets your plan, nothing more.',
  'It cannot pay, change your plan, delete your account, use your linked accounts, or let other agents in.',
];

const card = {
  // The width calc keeps a 16px gutter on phones instead of touching the edges.
  maxWidth: 440, width: 'calc(100% - 32px)', boxSizing: 'border-box', margin: '64px auto', padding: 24, borderRadius: 12,
  background: C.card, color: C.ink, border: `1px solid ${C.rule}`, fontFamily: 'system-ui, sans-serif',
  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
};
const btn = { padding: '10px 16px', borderRadius: 8, border: 'none', background: C.gold, color: C.onGold, cursor: 'pointer', fontSize: 14, fontWeight: 600, minHeight: 44 };
const plain = { ...btn, background: 'transparent', color: C.ink, border: `1px solid ${C.ruleStrong}` };
const THING = {
  document_annotations: 'markup', survey_items: 'survey item', documents: 'document', projects: 'project',
  spaces: 'space', templates: 'template', kits: 'kit', document_collaborators: 'sharing', project_collaborators: 'sharing',
  template_collaborators: 'sharing', document_invites: 'invite', project_invites: 'invite', template_invites: 'invite',
  excel_schema_mapping: 'Excel mapping',
};
const DID = { insert: 'added', update: 'changed', delete: 'removed' };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
export function describeActivity(row) {
  const thing = THING[row.table_name] || row.table_name;
  return `${DID[row.action] || row.action} ${thing}${row.row_label ? ` "${row.row_label}"` : ''}`;
}

const ghost = { ...btn, background: 'transparent', color: C.dangerText, border: `1px solid ${C.rule}`, padding: '4px 10px', fontSize: 12, fontWeight: 400 };

function Consent({ authorizationId }) {
  const [details, setDetails] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!live) return;
      if (error || !data) { setMessage('This request is old or not valid. Start again from your agent.'); return; }
      // Allowed before: go straight back to the agent.
      if (!('authorization_id' in data)) {
        try { clearPendingConsent(window.localStorage); } catch { /* storage blocked */ }
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails(data);
    })();
    return () => { live = false; };
  }, [authorizationId]);

  const decide = async (allow) => {
    setBusy(true);
    const { data, error } = allow
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    setBusy(false);
    try { clearPendingConsent(window.localStorage); } catch { /* storage blocked */ }
    if (error || !data?.redirect_url) { setMessage('Could not finish. Start again from your agent.'); return; }
    window.location.assign(data.redirect_url);
  };

  if (!details) return <p style={{ fontSize: 14, color: C.inkSoft }}>{message || 'Loading…'}</p>;
  const name = details.client?.name || 'An AI agent';
  return (
    <>
      <p style={{ fontSize: 15, margin: '8px 0' }}><strong>{name}</strong> wants to use Survey as you.</p>
      <ul style={{ fontSize: 14, paddingLeft: 18, color: C.inkSoft, margin: '8px 0 16px' }}>
        {AGENT_RULES.map((rule) => <li key={rule} style={{ margin: '4px 0' }}>{rule}</li>)}
      </ul>
      <p style={{ fontSize: 13, color: C.inkSoft }}>Only allow agents you started. You can remove it here at any time.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={btn} disabled={busy} onClick={() => decide(true)}>Allow</button>
        <button style={plain} disabled={busy} onClick={() => decide(false)}>Deny</button>
      </div>
      {message && <p style={{ fontSize: 14 }}>{message}</p>}
    </>
  );
}

export default function AgentLinkPage() {
  const auth = useContext(AuthContext) || {};
  const user = auth.user || null;
  const [consentId] = useState(consentIdFromUrl);
  const [code, setCode] = useState(codeFromUrl);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState([]);
  const [grants, setGrants] = useState([]);
  const [activity, setActivity] = useState([]);
  const [lastActive, setLastActive] = useState({});
  // Closed at first so the person reads why they're here before signing in.
  const [authOpen, setAuthOpen] = useState(false);

  // Keep the code or consent request through sign-up's email check or a
  // Google sign-in, which come back to the app's front page (see main.jsx).
  // Only one flow is kept: starting one drops the other's leftover.
  useEffect(() => {
    try {
      if (consentId) {
        if (!user) savePendingConsent(window.localStorage, consentId);
        clearPendingAgentCode(window.localStorage);
      } else if (code) {
        if (!user) savePendingAgentCode(window.localStorage, code);
        clearPendingConsent(window.localStorage);
      }
    } catch { /* storage blocked */ }
  }, [code, consentId, user]);

  const loadLinks = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('agent_links')
      .select('id, agent_name, status, token_expires_at, approved_at')
      .neq('status', 'revoked')
      .order('approved_at', { ascending: false });
    setLinks(data || []);
    // Fails quietly while the project's OAuth server is off.
    const grantResult = await supabase.auth.oauth.listGrants().catch(() => null);
    setGrants(Array.isArray(grantResult?.data) ? grantResult.data : []);
    const [{ data: log }, { data: seen }] = await Promise.all([
      supabase.from('agent_activity').select('id, client_id, action, table_name, row_label, created_at')
        .order('created_at', { ascending: false }).limit(50),
      supabase.rpc('my_agent_last_active'),
    ]);
    setActivity(log || []);
    setLastActive(Object.fromEntries((seen || []).map((r) => [r.client_id, r.last_active])));
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

  const revokeGrant = async (clientId) => {
    await supabase.auth.oauth.revokeGrant({ clientId });
    loadLinks();
  };

  // Until sign-in is known, show neither form: a consent return must not
  // flash the code form with a leftover code in it.
  if (auth.loading) return <div style={card}><p style={{ margin: 0, color: C.inkSoft }}>Loading…</p></div>;

  if (!user) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Sign in or create a free account</h2>
        <p style={{ margin: '8px 0 16px', color: C.inkSoft }}>
          An AI agent asked to use Survey for you. The account is yours: it uses your email, starts on the free plan, and only you can pay or change it.
          {consentId ? ' After you sign in, you\'ll see what the agent can do and choose Allow or Deny.'
            : code ? ` After you sign in, you'll press Allow for code ${code}.` : ''}
        </p>
        <button style={btn} onClick={() => setAuthOpen(true)}>Sign in or sign up</button>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} initialMode="signup" />
      </div>
    );
  }

  const agents = [
    ...grants.map((g) => ({
      key: `g:${g.client?.id}`, name: g.client?.name || 'AI agent', remove: () => revokeGrant(g.client?.id),
      note: [g.granted_at && `allowed ${when(g.granted_at)}`, lastActive[g.client?.id] && `last active ${when(lastActive[g.client?.id])}`].filter(Boolean).join(', '),
    })),
    ...links.map((l) => ({ key: `l:${l.id}`, name: l.agent_name, remove: () => revoke(l.id), note: l.approved_at ? `allowed ${when(l.approved_at)}, read only` : 'read only' })),
  ];
  const agentName = (clientId) => grants.find((g) => g.client?.id === clientId)?.client?.name || 'Removed agent';

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Let an AI agent use Survey</h2>
      {consentId && user ? (
        <Consent authorizationId={consentId} />
      ) : (
        <>
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
        </>
      )}
      {agents.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 24 }}>Agents with access</h3>
          {agents.map((a) => (
            <div key={a.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '6px 0' }}>
              <span>{a.name}{a.note && <span style={{ display: 'block', fontSize: 12, color: C.inkSoft }}>{a.note}</span>}</span>
              <button style={ghost} onClick={a.remove}>Remove</button>
            </div>
          ))}
        </>
      )}
      {(agents.length > 0 || activity.length > 0) && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 24 }}>What agents changed</h3>
          {activity.length === 0 ? (
            <p style={{ fontSize: 13, color: C.inkSoft }}>Nothing yet. Changes an agent makes show here for 90 days.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
              {activity.map((r) => (
                <li key={r.id} style={{ padding: '4px 0', borderTop: `1px solid ${C.rule}` }}>
                  <span style={{ color: C.inkSoft }}>{when(r.created_at)}</span> · <strong>{agentName(r.client_id)}</strong> {describeActivity(r)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p style={{ marginTop: 24 }}><a href={buildAppDestination()} style={{ color: C.gold }}>Back to Survey</a></p>
    </div>
  );
}
