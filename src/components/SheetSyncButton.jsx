// The Survey panel's "Google Sheets" button (beta 'sheet-team-sync'): connect
// Google, make a live Google Sheet from the survey, and while it is linked,
// keep both in step. The server runs each round (supabase/functions/sheet-sync);
// this asks for one every few seconds while the survey is open and shortly
// after any change, so a field tech's phone writes to the PM's sheet without
// either of them pressing anything.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icons';
import Spinner from './Spinner';
import { useTooltip } from './Tooltip';
import { sheetLayoutInput, sheetSyncCall, sheetTemplateId, syncedAgo } from '../services/sheetSyncClient.js';

const IDLE_ROUND_MS = 15000;   // while open and nothing changed here
const CHANGE_ROUND_MS = 2500;  // after a change in the app
const CONNECT_POLL_MS = 2000;
const CONNECT_POLL_FOR_MS = 3 * 60 * 1000;

function useSheetSync({ documentId, template, markers, enabled }) {
  const templateId = sheetTemplateId(template);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null); // 'connect' | 'link' | 'sync' | 'choose' | 'unlink' | 'disconnect'
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const layoutInput = useMemo(() => sheetLayoutInput(template), [template]);
  const ids = useMemo(() => ({ documentId, templateId }), [documentId, templateId]);

  const apply = useCallback((res) => {
    if (res?.error) { setError(res.error); return res; }
    setError(null);
    setStatus(res);
    return res;
  }, []);

  const refresh = useCallback(async () => apply(await sheetSyncCall('status', ids)), [apply, ids]);

  const sync = useCallback(async ({ force = false } = {}) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      return apply(await sheetSyncCall('sync', { ...ids, ...layoutInput, force }));
    } finally {
      inFlight.current = false;
    }
  }, [apply, ids, layoutInput]);

  useEffect(() => {
    if (!enabled || !documentId || !templateId) return;
    refresh();
  }, [enabled, documentId, templateId, refresh]);

  const live = Boolean(status?.link && status.link.status === 'active' && (status.role === 'owner' || status.role === 'editor'));

  // Rounds while the survey is open and the page is visible.
  useEffect(() => {
    if (!enabled || !live) return undefined;
    let timer = null;
    const tick = async () => {
      if (document.visibilityState === 'visible') await sync();
      timer = setTimeout(tick, IDLE_ROUND_MS);
    };
    timer = setTimeout(tick, IDLE_ROUND_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, live, sync]);

  // And soon after anything in the survey changes.
  const firstMarkers = useRef(true);
  useEffect(() => {
    if (!enabled || !live) return undefined;
    if (firstMarkers.current) { firstMarkers.current = false; return undefined; }
    const timer = setTimeout(() => sync(), CHANGE_ROUND_MS);
    return () => clearTimeout(timer);
  }, [enabled, live, markers, sync]);

  const run = useCallback(async (kind, fn) => {
    setBusy(kind);
    try { return await fn(); } finally { setBusy(null); }
  }, []);

  const connect = useCallback(() => run('connect', async () => {
    const res = await sheetSyncCall('connect', { appOrigin: window.location.origin });
    if (res?.error || !res?.url) { setError(res?.error || 'Could not start Google sign-in.'); return; }
    window.open(res.url, '_blank', 'noopener');
    // The consent page opens in its own tab (the system browser on phones and
    // desktop); watch for the sign-in to land.
    const until = Date.now() + CONNECT_POLL_FOR_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
      const s = await sheetSyncCall('status', ids);
      if (s?.google?.connected) { apply(s); return; }
    }
    setError('Google sign-in did not finish. Try again.');
  }), [apply, ids, run]);

  const link = useCallback((title) => run('link', async () => apply(await sheetSyncCall('link', { ...ids, ...layoutInput, title }))), [apply, ids, layoutInput, run]);
  const choose = useCallback((markerId, choice) => run('choose', async () => apply(await sheetSyncCall('choose', { ...ids, markerId, choice }))), [apply, ids, run]);
  const unlink = useCallback(() => run('unlink', async () => apply(await sheetSyncCall('unlink', ids))), [apply, ids, run]);
  const disconnect = useCallback(() => run('disconnect', async () => {
    const res = await sheetSyncCall('disconnect');
    if (res?.error) setError(res.error); else await refresh();
  }), [refresh, run]);
  const syncNow = useCallback(() => run('sync', () => sync({ force: true })), [run, sync]);

  return { status, busy, error, live, connect, link, choose, unlink, disconnect, syncNow };
}

const panelStyle = {
  position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, zIndex: 60, width: 300, maxHeight: 420, overflowY: 'auto', padding: 12,
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
  color: 'var(--text-1)', fontSize: 13, lineHeight: 1.4, textAlign: 'left',
};
const small = { color: 'var(--text-2)', fontSize: 12 };
const btn = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-3)',
  color: 'var(--text-1)', font: 'inherit', fontSize: 13, cursor: 'pointer',
};
const primary = { ...btn, background: 'var(--accent, #2563eb)', borderColor: 'transparent', color: '#fff' };

export default function SheetSyncButton({ className, phone = false, documentId, template, markers, documentName }) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  const [, setNow] = useState(0);
  const wrapRef = useRef(null);
  const sync = useSheetSync({ documentId, template, markers, enabled: Boolean(documentId && template) });
  const { status, busy, error, live } = sync;
  const link = status?.link || null;
  // Viewers see the sheet's state; only editors change anything.
  const canEdit = status?.role === 'owner' || status?.role === 'editor';

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const clock = setInterval(() => setNow(Date.now()), 5000);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearInterval(clock);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!documentId || !template) return null;
  const waiting = (link?.conflicts?.length || 0) + (link?.removedInSheet?.length || 0);
  const label = link ? (live ? 'Live in Sheets' : 'Google Sheets') : 'Google Sheets';

  let body;
  if (status && !status.configured) {
    body = <p style={{ margin: 0 }}>Google Sheets is not set up on this server yet.</p>;
  } else if (!status) {
    body = <p style={{ margin: 0, ...small }}>{error || 'Checking…'}</p>;
  } else if (link) {
    body = (
      <>
        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
          {link.status === 'active' ? 'Live in Google Sheets' : link.status === 'paused' ? 'Sync paused' : 'Sync stopped'}
        </p>
        <p style={{ margin: '0 0 8px', ...small }}>
          {link.lastError || (link.lastRoundAt ? `Synced ${syncedAgo(link.lastRoundAt)}. Changes here and in the sheet both land; only the same cell changed on both sides waits for you.` : 'Getting ready…')}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {link.fileUrl && <a href={link.fileUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none' }}>Open sheet</a>}
          {canEdit && <button type="button" style={btn} disabled={Boolean(busy)} onClick={sync.syncNow}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>}
        </div>
        {link.conflicts.map((c) => (
          <div key={c.markerId} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <p style={{ margin: '0 0 4px' }}><strong>{c.name || 'An item'}</strong> changed in both places</p>
            {c.fields.map((f) => (
              <p key={f.key} style={{ margin: '0 0 2px', ...small }}>{f.header}: here “{f.app || 'blank'}”, sheet “{f.sheet || 'blank'}”</p>
            ))}
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button type="button" style={btn} disabled={Boolean(busy)} onClick={() => sync.choose(c.markerId, 'app')}>Keep mine</button>
                <button type="button" style={btn} disabled={Boolean(busy)} onClick={() => sync.choose(c.markerId, 'sheet')}>Use the sheet’s</button>
              </div>
            )}
          </div>
        ))}
        {link.removedInSheet.map((r) => (
          <div key={r.markerId} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <p style={{ margin: '0 0 4px' }}><strong>{r.name || 'An item'}</strong>’s row was deleted in the sheet. The item is still here.</p>
            {canEdit && <button type="button" style={btn} disabled={Boolean(busy)} onClick={() => sync.choose(r.markerId, 'putBack')}>Put the row back</button>}
          </div>
        ))}
        {link.problems.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <p style={{ margin: '0 0 4px' }}>Not brought in from the sheet:</p>
            {link.problems.slice(0, 5).map((p, i) => <p key={i} style={{ margin: '0 0 2px', ...small }}>{p.message}</p>)}
          </div>
        )}
        {(link.isConnectionOwner || status.role === 'owner') && (
          <button type="button" style={{ ...btn, marginTop: 4 }} disabled={Boolean(busy)} onClick={sync.unlink}>Stop syncing</button>
        )}
        {link.status === 'broken' && link.isConnectionOwner && !status.google.connected && (
          <button type="button" style={{ ...primary, marginTop: 4, marginLeft: 6 }} disabled={Boolean(busy)} onClick={sync.connect}>Connect Google again</button>
        )}
      </>
    );
  } else if (!status.google.connected) {
    body = (
      <>
        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Live sync with Google Sheets</p>
        <p style={{ margin: '0 0 10px', ...small }}>
          Make a Google Sheet from this survey. Your team’s changes here (phone, web or desktop) and edits in the sheet stay in step. Survey can only see sheets it makes.
        </p>
        <button type="button" style={primary} disabled={Boolean(busy) || !canEdit} onClick={sync.connect}>
          {busy === 'connect' ? 'Waiting for Google…' : 'Connect Google'}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Live sync with Google Sheets</p>
        <p style={{ margin: '0 0 10px', ...small }}>A new sheet in {status.google.email || 'your Google Drive'}, one tab per category.</p>
        <button type="button" style={primary} disabled={Boolean(busy) || !canEdit} onClick={() => sync.link(documentName ? `${documentName.replace(/\.pdf$/i, '')} survey` : 'Survey')}>
          {busy === 'link' ? 'Making the sheet…' : 'Make a live Google Sheet'}
        </button>
        <p style={{ margin: '10px 0 0', ...small }}>
          Signed in as {status.google.email || 'Google'} · <button type="button" onClick={sync.disconnect} disabled={Boolean(busy)} style={{ border: 0, background: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>Disconnect</button>
        </p>
      </>
    );
  }

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-sheet-sync-state={link ? link.status : status?.google?.connected ? 'connected' : 'none'}
        onClick={() => setOpen((v) => !v)}
        {...(phone || open ? {} : tip(link ? 'Live Google Sheet' : 'Sync this survey with a Google Sheet', 'above'))}
      >
        {busy && busy !== 'sync'
          ? <Spinner size={phone ? 16 : 14} color="var(--text-1)" trackColor="var(--surface-3)" />
          : <Icon name="google" size={phone ? 16 : 14} color="currentColor" />}
        <span>{label}{waiting ? ` (${waiting})` : ''}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Google Sheets live sync" style={panelStyle}>
          {body}
          {error && status && <p role="alert" style={{ margin: '8px 0 0', color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</p>}
        </div>
      )}
    </span>
  );
}
