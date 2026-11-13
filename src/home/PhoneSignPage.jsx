// Nightly 'phone-sign': /sign/<token>, the page a phone opens from the QR
// code in the computer's Add signature dialog. No sign-in: the token in the
// link is the only key, it works once and runs out after 10 minutes.
import { useState } from 'react';
import SignaturePad from '../signature/SignaturePad.jsx';
import { phoneSignTokenFromPath, submitPhoneSignature } from '../signature/phoneSign.js';
import { SIGNATURE_INKS, SIGNATURE_WIDTHS } from '../signature/signaturePicture.js';
import '../components/SignatureCard.css';

export default function PhoneSignPage() {
  const [token] = useState(() => phoneSignTokenFromPath(window.location.pathname));
  const [strokes, setStrokes] = useState([]);
  const [status, setStatus] = useState(token ? 'drawing' : 'bad-link');
  const hasInk = strokes.some((s) => s.length > 0);

  const send = async () => {
    if (!hasInk || status === 'sending') return;
    setStatus('sending');
    const ok = await submitPhoneSignature(token, strokes).catch(() => false);
    setStatus(ok ? 'sent' : 'failed');
  };

  return (
    <main className="phone-sign-page" data-phone-sign-page={status}>
      {status === 'bad-link' && (
        <>
          <h1>This link doesn&apos;t work</h1>
          <p>Open Add signature on your computer, pick Phone and scan the new code.</p>
        </>
      )}
      {status === 'sent' && (
        <>
          <h1>Sent</h1>
          <p>Your signature is on your computer now. You can close this page.</p>
        </>
      )}
      {(status === 'drawing' || status === 'sending' || status === 'failed') && (
        <>
          <h1>Sign here</h1>
          <p>Draw your signature with your finger, then tap Send.</p>
          <SignaturePad strokes={strokes} setStrokes={setStrokes} ink={SIGNATURE_INKS[0].hex} lineWidth={SIGNATURE_WIDTHS[1].px} />
          {status === 'failed' && (
            <p role="alert">Couldn&apos;t send. The code may have run out: make a new one on your computer.</p>
          )}
          <div className="phone-sign-page__actions">
            <button type="button" className="hub-btn" onClick={() => setStrokes([])} disabled={!hasInk || status === 'sending'}>Clear</button>
            <button type="button" className="hub-btn hub-btn--primary" data-phone-sign-send="true" onClick={send} disabled={!hasInk || status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
