/* Survey Hub — Share / Invite popup.
   Ported from the Claude Design prototype (survey-hub/manage-team.jsx,
   InviteModal). Reused across documents, projects, and templates — the `kind`
   prop only swaps the wording.

   UI only for now: "Copy link" copies a placeholder link and "Send invite"
   just closes. Real link generation and email sending are wired separately.

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
};

const KIND_LABEL = { document: 'document', project: 'project', template: 'template' };

export default function ShareModal({ open, onClose, kind = 'project', name = '' }) {
  const [emails, setEmails] = useState('');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const noun = KIND_LABEL[kind] || 'item';
  const slug = (name || noun).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || noun;
  const link = `survey.app/${noun}/${slug}`;

  const copyLink = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(link); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const fieldLabel = { fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 8 };

  return (
    <div
      onClick={onClose}
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
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.muted, width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'grid', placeItems: 'center', fontFamily: 'inherit', flex: 'none' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={fieldLabel}>Share link</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0, background: C.deep, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', fontSize: 11.5, color: C.inkSoft, fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{link}</div>
              <button onClick={copyLink} style={{ flex: 'none', height: 30, whiteSpace: 'nowrap', background: C.card, color: C.ink, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '0 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box' }}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>Anyone with this link can request access.</div>
          </div>

          <div>
            <div style={fieldLabel}>Invite by email</div>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="name@example.com, name@example.com"
              rows={3}
              style={{ width: '100%', background: C.deep, border: `1px solid ${C.rule}`, borderRadius: 6, padding: '9px 11px', fontSize: 12.5, fontFamily: 'inherit', color: C.ink, resize: 'vertical', outline: 'none', minHeight: 72, lineHeight: 1.45, boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>Separate addresses with commas. Invitees get an email with a link to join.</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.muted, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}>Cancel</button>
          <button
            disabled={!emails.trim()}
            onClick={onClose}
            style={{ opacity: emails.trim() ? 1 : 0.45, cursor: emails.trim() ? 'pointer' : 'not-allowed', background: C.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit' }}
          >
            Send invite
          </button>
        </div>
      </div>
    </div>
  );
}
