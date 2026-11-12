// Nightly 'phone-sign': the Phone tab of the Add signature dialog. Shows a
// QR code for /sign/<token>; when the phone sends its strokes they go to the
// Draw pad (onStrokes). See signature/phoneSign.js.
import { useEffect, useMemo, useState } from 'react';
import {
  PHONE_SIGN_LIFETIME_MS,
  PHONE_SIGN_POLL_MS,
  createPhoneSignRequest,
  dropPhoneSignRequest,
  phoneSignUrl,
  readPhoneSignRequest,
} from '../signature/phoneSign.js';

// The QR code as one SVG path: crisp at any size, no HTML injected.
function QrCode({ text }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    let live = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      if (!live) return;
      const code = qrcode(0, 'M');
      code.addData(text);
      code.make();
      setQr(code);
    }).catch(() => {});
    return () => { live = false; };
  }, [text]);
  const path = useMemo(() => {
    if (!qr) return '';
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return d;
  }, [qr]);
  if (!qr) return <div className="phone-sign__qr phone-sign__qr--empty" aria-hidden="true" />;
  const size = qr.getModuleCount() + 8;
  return (
    <svg
      className="phone-sign__qr"
      data-phone-sign-qr="true"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code: scan it with your phone's camera"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export default function PhoneSignPanel({ onStrokes }) {
  const [round, setRound] = useState(0);
  const [state, setState] = useState({ status: 'starting', token: null });
  useEffect(() => {
    let live = true;
    let token = null;
    let timer = 0;
    let startedAt = 0;
    const poll = async () => {
      if (!live) return;
      if (Date.now() - startedAt > PHONE_SIGN_LIFETIME_MS) {
        setState({ status: 'expired', token: null });
        dropPhoneSignRequest(token);
        token = null;
        return;
      }
      const strokes = await readPhoneSignRequest(token);
      if (!live) return;
      if (strokes) {
        dropPhoneSignRequest(token);
        token = null;
        onStrokes?.(strokes);
        return;
      }
      timer = window.setTimeout(poll, PHONE_SIGN_POLL_MS);
    };
    setState({ status: 'starting', token: null });
    createPhoneSignRequest().then((result) => {
      if (!live) {
        if (result.token) dropPhoneSignRequest(result.token);
        return;
      }
      if (!result.token) {
        setState({ status: result.error === 'signed-out' ? 'signed-out' : 'error', token: null });
        return;
      }
      token = result.token;
      startedAt = Date.now();
      setState({ status: 'ready', token });
      timer = window.setTimeout(poll, PHONE_SIGN_POLL_MS);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      if (token) dropPhoneSignRequest(token);
    };
    // onStrokes is read when the phone answers; a new identity needn't restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const url = state.token ? phoneSignUrl(state.token) : '';
  return (
    <div className="phone-sign" data-phone-sign-status={state.status}>
      {state.status === 'ready' && (
        <>
          <QrCode text={url} />
          <p className="phone-sign__hint">
            Scan the code with your phone&apos;s camera, sign there and tap Send. Your signature shows up here.
          </p>
          <p className="phone-sign__wait" aria-live="polite">Waiting for your phone…</p>
          <a className="phone-sign__link" data-phone-sign-link="true" href={url} target="_blank" rel="noreferrer">{url}</a>
        </>
      )}
      {state.status === 'starting' && <p className="phone-sign__hint">Making a code…</p>}
      {state.status === 'signed-out' && <p className="phone-sign__hint">Sign in to send a signature from your phone.</p>}
      {(state.status === 'expired' || state.status === 'error') && (
        <>
          <p className="phone-sign__hint">
            {state.status === 'expired' ? 'That code ran out after 10 minutes.' : 'Couldn’t make a code. Check your connection.'}
          </p>
          <button type="button" className="hub-btn" onClick={() => setRound((n) => n + 1)}>New code</button>
        </>
      )}
    </div>
  );
}
