// The owner's "Guest links" part of Document access (Nightly, flag
// 'guest-links'): pick viewer or editor and how long, make the link (copied
// at once; it is shown only this one time), see who came in and turn a link
// off. Guests need no account; the server rules are in
// supabase/migrations/20261028070000_guest_links.sql.
import { useCallback, useEffect, useState } from 'react';
import ValueSelect from '../components/ValueSelect.jsx';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  GUEST_LINK_DURATIONS,
  createGuestLink,
  guestLinkEnds,
  guestLinkUrl,
  listGuestLinks,
  revokeGuestLink,
} from '../services/guestLinks.js';
import './guestLinks.css';

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can mark up and comment' },
];
const DURATION_OPTIONS = GUEST_LINK_DURATIONS.map((d) => ({ value: d, label: `For ${d}` }));

export default function GuestLinksSection({ client, documentId }) {
  const [links, setLinks] = useState([]);
  const [role, setRole] = useState('viewer');
  const [expiresIn, setExpiresIn] = useState('1 week');
  const [made, setMade] = useState(null); // { id, url, copied }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!documentId) return;
    try {
      setLinks(await listGuestLinks(client, documentId));
    } catch (err) {
      setError(err.message);
    }
  }, [client, documentId]);

  useEffect(() => { setMade(null); setError(''); refresh(); }, [refresh]);

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      const link = await createGuestLink(client, { documentId, role, expiresIn });
      const url = guestLinkUrl(link.token);
      const result = await copyTextToClipboard(url, { surface: 'document_guest_link' });
      setMade({ id: link.id, url, copied: result.ok });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (id) => {
    setBusy(true);
    setError('');
    try {
      await revokeGuestLink(client, id);
      if (made?.id === id) setMade(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const live = links.filter((l) => l.live);
  return (
    <section className="guest-links" data-testid="guest-links" aria-label="Guest links">
      <div className="guest-links__head">
        <span className="guest-links__title">Guest links</span>
        <span className="guest-links__hint">No account needed. Guests see this document only and cannot add files.</span>
      </div>
      <div className="guest-links__make">
        <span className="guest-links__pick" data-guest-role><ValueSelect size="sm" label="Guests" value={role} options={ROLE_OPTIONS} onChange={setRole} /></span>
        <span className="guest-links__pick" data-guest-duration><ValueSelect size="sm" label="Link works" value={expiresIn} options={DURATION_OPTIONS} onChange={setExpiresIn} /></span>
        <button type="button" className="hub-btn hub-btn--primary" onClick={make} disabled={busy} data-guest-make>Make link</button>
      </div>
      {made ? (
        <div className="guest-links__made" role="status">
          <input className="guest-links__url" readOnly value={made.url} aria-label="Guest link" data-guest-url onFocus={(e) => e.target.select()} />
          <span>{made.copied ? 'Copied. This is the only time it shows.' : 'Copy it now: this is the only time it shows.'}</span>
        </div>
      ) : null}
      {error ? <div className="guest-links__error" role="alert">{error}</div> : null}
      {live.length ? (
        <ul className="guest-links__list">
          {live.map((l) => (
            <li key={l.id} className="guest-links__row" data-guest-link={l.id}>
              <span className="guest-links__role">{l.role === 'editor' ? 'Mark up and comment' : 'View'}</span>
              <span className="guest-links__ends">{guestLinkEnds(l.expiresAt)}</span>
              <span className="guest-links__who">{l.guests.length ? l.guests.join(', ') : 'Nobody yet'}</span>
              <button type="button" className="hub-btn" onClick={() => turnOff(l.id)} disabled={busy} data-guest-revoke>Turn off</button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
