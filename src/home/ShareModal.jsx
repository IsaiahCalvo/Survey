/* Survey Hub — Share / Invite popup.
   Ported from the Claude Design prototype (survey-hub/manage-team.jsx,
   InviteModal). Reused across documents, projects, and templates — the `kind`
   prop only swaps the wording.

   KAL-23: real invite backend + permissioned links live in KAL-31. Until that
   ships, the modal is intentionally honest:
     - Copy link still puts a placeholder slug on the clipboard so the affordance
       works, with a small note that the link is a preview until the real
       invite/link service lands.
     - Send invite shows a loading state on click, then surfaces an inline
       error block explaining that invite delivery is not enabled yet. The
       sending/error/success scaffolding is exactly what the future KAL-31
       wiring will reuse — once the backend exists, replace the simulated
       failure inside handleSend with the real call.

   Colors are literal hex (the hub palette) because this overlay renders
   outside the `.survey-hub` root, where the CSS variables are not in scope.
*/
import React, { useState } from 'react';

const C = {
  scrim: 'rgba(13,15,20,0.55)',
  card: '#181c24',
  deep: '#12151c',
  rule: '#2a3140',
  ink: '#f4f1ea',
  inkSoft: '#e8e2d4',
  muted: '#8d96a6',
  gold: '#d8a84e',
  error: '#f97373',
  errorBg: 'rgba(249, 115, 115, 0.08)',
  success: '#86d99e',
  successBg: 'rgba(134, 217, 158, 0.08)',
};

const KIND_LABEL = { document: 'document', project: 'project', template: 'template' };

export default function ShareModal({ open, onClose, kind = 'project', name = '' }) {
  const [emails, setEmails] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  if (!open) return null;

  const noun = KIND_LABEL[kind] || 'item';
  const slug = (name || noun).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || noun;
  const link = `survey.app/${noun}/${slug}`;

  const copyLink = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(link); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // KAL-23 scaffold: real wiring lands with KAL-31. Until then we keep the
  // button reachable but honest — clicking enters a loading state and falls
  // through to an inline error message so users do not believe an email was
  // sent. When KAL-31 ships, replace the simulated failure below with the
  // real Supabase Edge Function call and emit setSendSuccess on success.
  const handleSend = async () => {
    if (!emails.trim() || sending) return;
    setSendError('');
    setSendSuccess('');
    setSending(true);
    try {
      // Placeholder: simulate a short async call so the loading state is
      // visible. KAL-31 will swap this for the real invite request.
      await new Promise((resolve) => setTimeout(resolve, 350));
      throw new Error('Invite delivery is not enabled yet. Email sending lights up once KAL-31 ships.');
    } catch (err) {
      setSendError(err?.message || 'Could not send invite. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    if (sending) return;
    setSendError('');
    setSendSuccess('');
    onClose();
  };

  const fieldLabel = { fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 8 };
  const sendDisabled = !emails.trim() || sending;

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, background: C.scrim,
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 3, height: 30, background: C.gold, borderRadius: 2, flex: 'none' }}></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>Share {noun}</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Untitled'}</div>
          </div>
          <button onClick={handleClose} title="Close" style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.muted, width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'grid', placeItems: 'center', fontFamily: 'inherit', flex: 'none' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={fieldLabel}>Share link</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0, background: C.deep, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', fontSize: 11.5, color: C.inkSoft, fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{link}</div>
              <button onClick={copyLink} style={{ flex: 'none', height: 30, whiteSpace: 'nowrap', background: C.card, color: C.ink, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box' }}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>
              Preview link. Permissioned invite links activate with the upcoming sharing release.
            </div>
          </div>

          <div>
            <div style={fieldLabel}>Invite by email</div>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="name@example.com, name@example.com"
              rows={3}
              disabled={sending}
              style={{ width: '100%', background: C.deep, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '9px 11px', fontSize: 12.5, fontFamily: 'inherit', color: C.ink, resize: 'vertical', outline: 'none', minHeight: 72, lineHeight: 1.45, boxSizing: 'border-box', opacity: sending ? 0.6 : 1 }}
            />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>Separate addresses with commas. Invitees get an email with a link to join.</div>
          </div>

          {sendError && (
            <div role="alert" style={{ background: C.errorBg, border: `1px solid ${C.error}`, borderRadius: 6, padding: '10px 12px', color: C.error, fontSize: 12, lineHeight: 1.5 }}>
              {sendError}
            </div>
          )}
          {sendSuccess && (
            <div role="status" style={{ background: C.successBg, border: `1px solid ${C.success}`, borderRadius: 6, padding: '10px 12px', color: C.success, fontSize: 12, lineHeight: 1.5 }}>
              {sendSuccess}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={handleClose} disabled={sending} style={{ background: 'transparent', border: 0, color: C.muted, padding: '6px 10px', fontSize: 12, cursor: sending ? 'not-allowed' : 'pointer', fontFamily: 'inherit', borderRadius: 6, opacity: sending ? 0.6 : 1 }}>Cancel</button>
          <button
            disabled={sendDisabled}
            onClick={handleSend}
            style={{ opacity: sendDisabled ? 0.45 : 1, cursor: sendDisabled ? 'not-allowed' : 'pointer', background: C.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {sending && <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #15110a', borderTopColor: 'transparent', animation: 'share-modal-spin 0.7s linear infinite' }} />}
            {sending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
      <style>{`@keyframes share-modal-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
