/* The box under "Invite by email" after a send that needs a follow-up
 * (inviteFix, 2026-10-07). Words come from inviteSendSummary.js; this only
 * draws them. A send where access WAS granted, or an invite link exists, is a
 * caution (warning tokens), not an error: only an address that got nothing at
 * all turns it red. Each address that has an invite offers "Copy link"; a
 * definite email failure offers one "Try again" for all of them.
 */
import { useState } from 'react';

const TONE = {
  warning: { background: 'var(--alert-warning-bg)', border: 'var(--alert-warning-border)' },
  danger: { background: 'var(--alert-danger-bg)', border: 'var(--alert-danger-border)' },
};

export default function InviteSendNotice({ summary, busy = false, onCopyLink, onRetry }) {
  const [copiedEmail, setCopiedEmail] = useState(null);
  if (!summary || !TONE[summary.tone]) return null;
  const items = summary.items || [];
  const single = summary.total === 1;
  const canRetry = items.some((i) => i.canRetry) && typeof onRetry === 'function';

  const copy = async (item) => {
    const ok = await onCopyLink?.(item);
    if (ok) {
      setCopiedEmail(item.email);
      setTimeout(() => setCopiedEmail((cur) => (cur === item.email ? null : cur)), 1800);
    }
  };
  const copyButton = (item) => (item.canCopyLink && typeof onCopyLink === 'function' ? (
    <button
      type="button"
      className="hub-btn share-dialog-touch-pad"
      disabled={busy}
      data-invite-notice-copy={item.email || ''}
      onClick={() => copy(item)}
    >
      {copiedEmail === item.email ? 'Copied' : 'Copy link'}
    </button>
  ) : null);

  return (
    <div
      role="status"
      data-invite-notice={summary.tone}
      style={{
        ...TONE[summary.tone],
        borderRadius: 'var(--alert-radius)',
        padding: '10px 12px',
        color: 'var(--text-1)',
        fontSize: 12,
        lineHeight: 1.45,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div>{summary.message}</div>
      {!single && items.map((item) => (
        <div key={item.email} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, color: 'var(--text-2)' }}>{item.text}</div>
          {copyButton(item)}
        </div>
      ))}
      {(single ? (items[0]?.canCopyLink || canRetry) : canRetry) && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {single && items[0] ? copyButton(items[0]) : null}
          {canRetry && (
            <button type="button" className="hub-btn share-dialog-touch-pad" disabled={busy} data-invite-notice-retry="true" onClick={onRetry}>
              {busy ? 'Trying again…' : 'Try again'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
