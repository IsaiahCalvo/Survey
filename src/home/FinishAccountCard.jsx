/* KAL-649: "Finish your account" for a person who joined from an invite email.
 * The invite link signs them in with no name, no password and no Terms tick
 * (see finishAccount.js). This asks for all three in one step, the same rules
 * as Create account, so they can sign in again later. */
import { useState } from 'react';
import { validateNewPassword, authErrorMessage } from '../components/authFlow';
import PasswordRequirements from '../components/PasswordRequirements';
import { termsAcceptance } from '../legal/legalVersions';
import { C } from '../uiPalette';
import { finishAccountError } from './finishAccount';

const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, fontSize: 12, fontWeight: 600, color: C.ink };
const inputStyle = {
  width: '100%', boxSizing: 'border-box', minWidth: 0, height: 36, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.ruleStrong}`,
  background: 'transparent', color: C.ink, fontSize: 14, fontFamily: 'inherit',
};

export default function FinishAccountCard({ user, updatePassword, updateProfile, onDone, accent, skip = null }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const problem = finishAccountError({ firstName, lastName, agreed })
      || validateNewPassword(password, confirmPassword, { email: user?.email, firstName, lastName });
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      await updatePassword(password);
      const first = firstName.trim();
      const last = lastName.trim();
      await updateProfile({ first_name: first, last_name: last, full_name: `${first} ${last}`, terms_accepted: termsAcceptance() });
      onDone?.();
    } catch (err) {
      setError(authErrorMessage(err, 'That did not save. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-finish-account style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.rule}`, paddingTop: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Finish your account</div>
      <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>
        Add your name and a password so you can sign in again as {user?.email}.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          First name
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" disabled={busy} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Last name
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" disabled={busy} style={inputStyle} />
        </label>
      </div>
      <label style={labelStyle}>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={busy} style={inputStyle} />
      </label>
      <PasswordRequirements password={password} email={user?.email} firstName={firstName} lastName={lastName} theme={C} />
      <label style={labelStyle}>
        Confirm password
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" disabled={busy} style={inputStyle} />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: C.inkSoft }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} style={{ marginTop: 2 }} />
        <span>
          I agree to the <a href="/terms.html" target="_blank" rel="noreferrer" style={{ color: C.ink }}>Terms of Service</a>
          {' '}and <a href="/privacy.html" target="_blank" rel="noreferrer" style={{ color: C.ink }}>Privacy Policy</a>.
        </span>
      </label>
      {error && (
        <div role="alert" style={{ background: 'var(--alert-danger-bg)', border: 'var(--alert-danger-border)', borderRadius: 'var(--alert-radius)', padding: '8px 10px', color: C.ink, fontSize: 12 }}>
          {error}
        </div>
      )}
      {/* Skip sits beside Save, plain button first, like every other dialog. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        {skip}
        <button type="submit" disabled={busy} style={{
          background: accent || C.gold, color: 'var(--accent-text)', border: 0, borderRadius: 6,
          padding: '6px 14px', height: 30, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
      </div>
    </form>
  );
}
