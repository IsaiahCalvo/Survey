/* Shared password-requirements affordance used by every place a password is
 * set (reset page, account settings, sign-up). Shows a compact "Password does
 * not meet requirements" error with an info icon; hovering (or focusing) the
 * icon reveals a live checklist that turns each rule green as it is met — the
 * way professional apps surface password rules without a wall of text.
 *
 * Rules come from authFlow.passwordRequirements so the tooltip and the submit
 * validators can never drift apart.
 */
import { useState } from 'react';
import { passwordRequirements } from './authFlow';
import Icon from '../Icons';

const DEFAULT_THEME = {
  ink: '#f4f1ea', muted: '#8d96a6', card: '#181c24', rule: '#2a3140',
  danger: '#d95a56', good: '#5fbf83',
};

export default function PasswordRequirements({
  password = '',
  email = '',
  firstName = '',
  lastName = '',
  theme = {},
  align = 'left',
}) {
  const [open, setOpen] = useState(false);
  const t = { ...DEFAULT_THEME, ...theme };
  const reqs = passwordRequirements(password, { email, firstName, lastName });
  const allMet = reqs.every((r) => r.met);
  const touched = String(password || '').length > 0;
  const invalid = touched && !allMet;
  const iconColor = invalid ? t.danger : t.muted;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 }}>
      {invalid && (
        <span style={{ color: t.danger, fontSize: 12, fontWeight: 600 }}>Password does not meet requirements</span>
      )}
      {!invalid && (
        <span style={{ color: t.muted, fontSize: 11.5 }}>Password requirements</span>
      )}
      <span
        role="button"
        tabIndex={0}
        aria-label="Password requirements"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%',
          border: `1px solid ${iconColor}`, color: iconColor,
          fontSize: 11, fontWeight: 700, cursor: 'help', flex: 'none',
          fontStyle: 'italic', lineHeight: 1, userSelect: 'none',
        }}
      >
        i
      </span>

      {open && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)',
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 60, width: 300, background: t.card,
            border: `1px solid ${t.rule}`, borderRadius: 8, padding: '11px 13px',
            boxShadow: '0 14px 34px rgba(0,0,0,0.55)', cursor: 'default',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: t.ink, marginBottom: 7 }}>Your password must:</div>
          {reqs.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 7, fontSize: 11.5, color: r.met ? t.good : t.muted, lineHeight: 1.55 }}>
              <span style={{ width: 12, height: 12, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.met ? <Icon name="check" size={12} /> : '○'}</span>
              <span>{r.label}</span>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: t.muted, marginTop: 8, lineHeight: 1.45, borderTop: `1px solid ${t.rule}`, paddingTop: 7 }}>
            It must also be different from your current password, and can't be a
            common or breached password.
          </div>
        </div>
      )}
    </div>
  );
}
