// The Survey panel's live sheet button (beta 'sheet-team-sync'): connect
// Google or a work/school Microsoft 365, make a live Google Sheet or Excel
// workbook from the survey, and while it is linked,
// keep both in step. The server runs each round (supabase/functions/sheet-sync);
// this asks for one every few seconds while the survey is open and shortly
// after any change, so a field tech's phone writes to the PM's sheet without
// either of them pressing anything.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icons';
import Spinner from './Spinner';
import { useTooltip } from './Tooltip';
import AnchoredPopover from './AnchoredPopover';
import { sheetLayoutInput, sheetSyncCall, sheetTemplateId, syncedAgo } from '../services/sheetSyncClient.js';
import { forgetClaim, readClaim } from '../services/sheetSyncClaim.js';
import { isNativeApp } from '../utils/proLock.js';
import { isElectronApp } from '../utils/layoutMode.js';
import './SheetSyncButton.css';

const IDLE_ROUND_MS = 15000;   // while open and nothing changed here
const CHANGE_ROUND_MS = 2500;  // after a change in the app
const CONNECT_POLL_MS = 1500;
const CONNECT_POLL_FOR_MS = 5 * 60 * 1000;
// The sign-in finishes on its own on every device (sheetSyncClaim.js). If it
// has not after this long, the person said yes somewhere this app cannot hear
// from (another browser or device): offer the code box as a way out.
const ASK_CODE_AFTER_MS = 20000;

// Which app pressed Connect, so the consent page's last screen knows how to
// hand the person back (service.js appParam).
const clientKind = () => (isElectronApp() ? 'desktop' : isNativeApp() ? 'phone' : 'web');

// What the button said last time, so it shows the right words at once instead
// of "Google Sheets" flipping to "Live sheet" when the server answers (owner
// 2026-11-03). The services set up on the server are the same for every
// survey; a survey's own link is kept per survey.
const PROVIDERS_KEY = 'survey-sheet-sync-providers';
const linkKey = (documentId, templateId) => `survey-sheet-sync-link:${documentId}:${templateId}`;
function readJson(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage off: the words just wait for the server */ }
}

function useSheetSync({ documentId, template, markers, enabled }) {
  const templateId = sheetTemplateId(template);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null); // 'connect' | 'link' | 'sync' | 'choose' | 'unlink' | 'disconnect'
  const [error, setError] = useState(null);
  const [codeAsk, setCodeAsk] = useState(null); // provider whose code box shows while connecting
  const [busyFor, setBusyFor] = useState(null); // the provider a connect or link is for
  const inFlight = useRef(false);
  const again = useRef(false); // a change came in while a round was running
  const retryTimer = useRef(null);
  const layoutInput = useMemo(() => sheetLayoutInput(template), [template]);
  const ids = useMemo(() => ({ documentId, templateId }), [documentId, templateId]);

  const apply = useCallback((res) => {
    if (res?.error) { setError(res.error); return res; }
    setError(null);
    setStatus(res);
    if (res?.providers || res?.configured !== undefined) {
      writeJson(PROVIDERS_KEY, {
        google: Boolean(res.providers?.google?.configured ?? res.configured),
        msgraph: Boolean(res.providers?.msgraph?.configured),
      });
    }
    if (documentId && templateId && 'link' in (res || {})) {
      writeJson(linkKey(documentId, templateId), res.link ? { provider: res.link.provider, status: res.link.status } : null);
    }
    return res;
  }, [documentId, templateId]);

  const refresh = useCallback(async () => apply(await sheetSyncCall('status', ids)), [apply, ids]);

  const sync = useCallback(async ({ force = false } = {}) => {
    if (inFlight.current) { again.current = true; return null; }
    inFlight.current = true;
    let res = null;
    try {
      res = apply(await sheetSyncCall('sync', { ...ids, ...layoutInput, force }));
      return res;
    } finally {
      inFlight.current = false;
      // Another device's round just ran or is running: ask again once it is
      // done, so an edit here reaches the sheet in seconds, not at the next tick.
      const wait = res?.round?.retryInMs;
      if (again.current || wait) {
        again.current = false;
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { syncRef.current?.(); }, Math.min(Math.max(wait || 1000, 500), 10000));
      }
    }
  }, [apply, ids, layoutInput]);
  const syncRef = useRef(null);
  syncRef.current = sync;
  useEffect(() => () => clearTimeout(retryTimer.current), []);

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

  const run = useCallback(async (kind, fn, provider = null) => {
    setBusy(kind);
    setBusyFor(provider);
    try { return await fn(); } finally { setBusy(null); setBusyFor(null); }
  }, []);

  // A sign-in finished while this survey was closed (the phone app was
  // reopened from the consent page, say): finish it now.
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    (async () => {
      for (const provider of ['google', 'msgraph']) {
        const code = readClaim(provider, Date.now() - 10 * 60 * 1000);
        if (!code || stale) continue;
        forgetClaim();
        const claimed = await sheetSyncCall('claim', { provider, code });
        if (!stale && !claimed?.error) refresh();
      }
    })();
    return () => { stale = true; };
  }, [enabled, refresh]);

  const connect = useCallback((provider = 'google') => run('connect', async () => {
    const who = provider === 'msgraph' ? 'Microsoft' : 'Google';
    const res = await sheetSyncCall('connect', { appOrigin: window.location.origin, provider, client: clientKind() });
    if (res?.error || !res?.url) { setError(res?.error || `Could not start ${who} sign-in.`); return; }
    setError(null);
    const started = Date.now();
    window.open(res.url, '_blank', 'noopener');
    // The consent page opens in its own tab (the desktop app's own window, the
    // system browser on phones). Its code comes back on its own
    // (sheetSyncClaim.js); claim it, then watch for the sign-in to land.
    let refused = null;
    const stopListening = window.electronAPI?.onSheetSyncConsent?.((finish) => {
      if (finish?.provider === provider && finish.result && finish.result !== 'finish' && finish.result !== 'connected') refused = finish.result;
    });
    try {
      while (Date.now() < started + CONNECT_POLL_FOR_MS) {
        await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
        if (refused) {
          setError(refused === 'cancelled' ? `${who} was not connected: you stopped before saying yes.` : `${who} did not finish connecting. Try again.`);
          return;
        }
        const code = readClaim(provider, started);
        if (code) {
          forgetClaim();
          const claimed = await sheetSyncCall('claim', { provider, code });
          if (claimed?.error) { setError(claimed.error); return; }
        }
        const s = await sheetSyncCall('status', ids);
        if ((provider === 'msgraph' ? s?.microsoft : s?.google)?.connected) { apply(s); return; }
        if (Date.now() - started > ASK_CODE_AFTER_MS) setCodeAsk(provider);
      }
      setError(`${who} sign-in did not finish. Try again.`);
    } finally {
      stopListening?.();
      setCodeAsk(null);
    }
  }, provider), [apply, ids, run]);

  // The code typed from the consent page, when it was opened in another
  // browser or device. The connect loop above sees the sign-in land.
  const claimCode = useCallback(async (provider, code) => {
    const res = await sheetSyncCall('claim', { provider, code });
    if (res?.error) { setError(res.error); return false; }
    setError(null);
    return true;
  }, []);

  const link = useCallback((title, provider = 'google') => run('link', async () => apply(await sheetSyncCall('link', { ...ids, ...layoutInput, title, provider })), provider), [apply, ids, layoutInput, run]);
  const choose = useCallback((markerId, choice) => run('choose', async () => apply(await sheetSyncCall('choose', { ...ids, markerId, choice }))), [apply, ids, run]);
  const putBackTab = useCallback((scopeId) => run('choose', async () => apply(await sheetSyncCall('choose', { ...ids, scopeId, choice: 'putBackTab' }))), [apply, ids, run]);
  const unlink = useCallback(() => run('unlink', async () => apply(await sheetSyncCall('unlink', ids))), [apply, ids, run]);
  const disconnect = useCallback((provider = 'google') => run('disconnect', async () => {
    const res = await sheetSyncCall('disconnect', { provider });
    if (res?.error) setError(res.error); else await refresh();
  }), [refresh, run]);
  const syncNow = useCallback(() => run('sync', () => sync({ force: true })), [run, sync]);

  const linking = busy === 'link' ? busyFor : null;
  const connecting = busy === 'connect' ? busyFor : null;
  return { status, busy, error, live, codeAsk, linking, connecting, connect, claimCode, link, choose, putBackTab, unlink, disconnect, syncNow };
}

const GLYPH = { google: 'google', msgraph: 'microsoft' };
const WHO = { google: 'Google', msgraph: 'Microsoft' };

// A button that keeps its words while it works: a spinner joins them and
// clicks are ignored, but nothing greys out (owner 2026-11-03: the gold
// "Make a live Excel workbook" button hid all its text while it ran).
function ActionButton({ busy, busyLabel, label, primary = false, block = false, disabled = false, onClick }) {
  const cls = ['sheet-sync-btn', primary && 'sheet-sync-btn--primary', block && 'sheet-sync-btn--block', busy && 'is-busy'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      // Not disabled while busy: the app-wide disabled rule (states.css)
      // paints a disabled button's words in 36% grey, which on gold vanished.
      disabled={disabled && !busy}
      aria-busy={busy || undefined}
      onClick={(e) => { if (busy) { e.preventDefault(); return; } onClick?.(e); }}
    >
      {busy && <Spinner size={14} color={primary ? 'var(--accent-text)' : 'var(--text-1)'} trackColor={primary ? 'rgba(21,17,10,0.2)' : 'var(--surface-1)'} />}
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}

function ClaimCodeBox({ provider, onClaim }) {
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const ready = code.replace(/[^A-Za-z0-9]/g, '').length === 8;
  const send = async (e) => {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    try { if (await onClaim(provider, code)) setCode(''); } finally { setSending(false); }
  };
  if (!open) {
    return (
      <p className="sheet-sync-note">
        Said yes in another browser or on another device?{' '}
        <button type="button" className="sheet-sync-link" onClick={() => setOpen(true)}>Enter its code</button>
      </p>
    );
  }
  return (
    <form onSubmit={send} className="sheet-sync-code">
      <label htmlFor="sheet-sync-claim-code">Type the code that page shows to finish connecting {WHO[provider]}.</label>
      <div className="sheet-sync-code__row">
        <input
          id="sheet-sync-claim-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))}
          placeholder="ABCD-EFGH"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
        />
        <ActionButton primary label="Finish" busy={sending} busyLabel="Checking…" disabled={!ready} onClick={send} />
      </div>
    </form>
  );
}

export default function SheetSyncButton({ className, phone = false, documentId, template, markers, documentName }) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  const [, setNow] = useState(0);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const getAnchor = useCallback(() => buttonRef.current, []);
  const ready = Boolean(documentId && template);
  const sync = useSheetSync({ documentId, template, markers, enabled: ready });
  const { status, busy, error, live } = sync;
  const link = status?.link || null;
  // Viewers see the sheet's state; only editors change anything.
  const canEdit = status?.role === 'owner' || status?.role === 'editor';

  useEffect(() => {
    if (!open) return undefined;
    const inside = (target) => buttonRef.current?.contains(target) || panelRef.current?.contains(target);
    const onDown = (e) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); } };
    const clock = setInterval(() => setNow(Date.now()), 5000);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearInterval(clock);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!template) return null;

  // Until the server answers, the words from last time (or the neutral
  // "Live sheet"), never a guess that flips.
  const cachedProviders = status ? null : readJson(PROVIDERS_KEY);
  const cachedLink = status || !documentId ? null : readJson(linkKey(documentId, sheetTemplateId(template)));
  const googleOn = status ? Boolean(status.providers?.google?.configured ?? status.configured) : cachedProviders ? cachedProviders.google : null;
  const microsoftOn = status ? Boolean(status.providers?.msgraph?.configured) : cachedProviders ? cachedProviders.msgraph : null;
  const shownLink = link || cachedLink;
  const linkProvider = shownLink?.provider === 'msgraph' ? 'msgraph' : shownLink ? 'google' : null;
  const shownLive = link ? live : shownLink?.status === 'active';
  const excelLink = linkProvider === 'msgraph';
  const where = excelLink ? 'Excel' : 'Google Sheets';
  const label = shownLink ? (shownLive ? (excelLink ? 'Live in Excel' : 'Live in Sheets') : where)
    : googleOn && !microsoftOn ? 'Google Sheets' : microsoftOn && !googleOn ? 'Excel' : 'Live sheet';
  const icon = linkProvider ? GLYPH[linkProvider] : googleOn && !microsoftOn ? 'google' : microsoftOn && !googleOn ? 'microsoft' : 'listChecks';
  const waiting = (link?.conflicts?.length || 0) + (link?.removedInSheet?.length || 0) + (link?.missingTabs?.length || 0);
  const sheetTitle = documentName ? `${documentName.replace(/\.pdf$/i, '')} survey` : 'Survey';

  // One service's row: logo, name, account; then connect or make.
  const serviceBlock = ({ provider, name, account, intro, place, makeLabel, makingLabel }) => (
    <div className="sheet-sync-section" key={provider}>
      <div className="sheet-sync-service">
        <span className="sheet-sync-logo"><Icon name={GLYPH[provider]} size={16} /></span>
        <div className="sheet-sync-service__text">
          <p className="sheet-sync-name">{name}</p>
          <p className="sheet-sync-meta">
            {account?.connected ? `Signed in as ${account.email || WHO[provider]}` : 'Not connected'}
          </p>
        </div>
        {account?.connected && (
          <button type="button" className="sheet-sync-link" onClick={() => sync.disconnect(provider)} disabled={Boolean(busy)}>Disconnect</button>
        )}
      </div>
      <p className="sheet-sync-note">{account?.connected ? place(account.email) : intro}</p>
      {account?.connected ? (
        <ActionButton
          primary block
          label={makeLabel} busyLabel={makingLabel}
          busy={busy === 'link' && sync.linking === provider}
          disabled={Boolean(busy) || !canEdit}
          onClick={() => sync.link(sheetTitle, provider)}
        />
      ) : (
        <ActionButton
          block
          label={`Connect ${WHO[provider]}`} busyLabel={`Waiting for ${WHO[provider]}…`}
          busy={busy === 'connect' && sync.connecting === provider}
          disabled={Boolean(busy) || !canEdit}
          onClick={() => sync.connect(provider)}
        />
      )}
      {busy === 'link' && sync.linking === provider && (
        <p className="sheet-sync-note">Setting up one {provider === 'msgraph' ? 'sheet' : 'tab'} per category and filling in your items. This takes a few seconds.</p>
      )}
      {busy === 'connect' && sync.connecting === provider && (
        <p className="sheet-sync-note">Say yes on the {WHO[provider]} page. Survey finishes on its own when you are done.</p>
      )}
      {busy === 'connect' && sync.codeAsk === provider && <ClaimCodeBox provider={provider} onClaim={sync.claimCode} />}
    </div>
  );

  let head = { title: 'Live sheet', sub: 'Keep this survey and a spreadsheet in step. Edits on either side show up on the other in seconds.' };
  let body;
  if (!ready) {
    body = <div className="sheet-sync-section"><p className="sheet-sync-note" style={{ marginTop: 0 }}>Save this PDF to your Survey account to sync it with a live sheet.</p></div>;
  } else if (status && !googleOn && !microsoftOn) {
    body = <div className="sheet-sync-section"><p className="sheet-sync-note" style={{ marginTop: 0 }}>Live sheet sync is not set up on this server yet.</p></div>;
  } else if (!status) {
    body = (
      <div className="sheet-sync-section" aria-busy="true">
        {error ? <p className="sheet-sync-note" style={{ marginTop: 0 }}>{error}</p> : (
          <>
            <span className="sheet-sync-skeleton" />
            <span className="sheet-sync-skeleton is-short" />
          </>
        )}
      </div>
    );
  } else if (link) {
    const state = link.status === 'active' ? 'live' : link.status === 'paused' ? 'paused' : 'broken';
    head = {
      title: state === 'live' ? `Live in ${where}` : state === 'paused' ? 'Sync paused' : 'Sync stopped',
      sub: link.lastError || (link.lastRoundAt
        ? 'Changes here and in the sheet both land. Only the same cell changed on both sides waits for you.'
        : 'Getting ready…'),
      glyph: GLYPH[linkProvider],
    };
    body = (
      <>
        <div className="sheet-sync-section">
          <span className="sheet-sync-status">
            <span className={`sheet-sync-dot${state === 'paused' ? ' is-paused' : state === 'broken' ? ' is-broken' : ''}`} />
            {link.lastRoundAt ? `Synced ${syncedAgo(link.lastRoundAt)}` : state === 'live' ? 'Starting…' : state === 'paused' ? 'Paused' : 'Stopped'}
          </span>
          {link.title && (
            <p className="sheet-sync-meta sheet-sync-where">
              {excelLink ? `OneDrive › Survey › ${link.title}.xlsx` : `Google Drive › ${link.title}`}
            </p>
          )}
          <div className="sheet-sync-row">
            {link.fileUrl && (
              <a href={link.fileUrl} target="_blank" rel="noopener noreferrer" className="sheet-sync-btn sheet-sync-btn--primary">
                {excelLink ? 'Open workbook' : 'Open sheet'}
              </a>
            )}
            {canEdit && <ActionButton label="Sync now" busyLabel="Syncing…" busy={busy === 'sync'} disabled={Boolean(busy)} onClick={sync.syncNow} />}
          </div>
          {link.status === 'broken' && link.isConnectionOwner && !(excelLink ? status.microsoft : status.google)?.connected && (
            <ActionButton
              primary block
              label={excelLink ? 'Connect Microsoft again' : 'Connect Google again'}
              busyLabel={`Waiting for ${excelLink ? 'Microsoft' : 'Google'}…`}
              busy={busy === 'connect'}
              disabled={Boolean(busy)}
              onClick={() => sync.connect(link.provider)}
            />
          )}
          {busy === 'connect' && sync.codeAsk && <ClaimCodeBox provider={sync.codeAsk} onClaim={sync.claimCode} />}
        </div>
        {(link.conflicts.length > 0 || link.removedInSheet.length > 0 || (link.missingTabs || []).length > 0 || link.problems.length > 0) && (
          <div className="sheet-sync-section">
            {link.conflicts.map((c) => (
              <div key={c.markerId} className="sheet-sync-item">
                <p className="sheet-sync-item__title"><strong>{c.name || 'An item'}</strong> changed in both places</p>
                {c.fields.map((f) => (
                  <p key={f.key} className="sheet-sync-item__line">{f.header}: here “{f.app || 'blank'}”, sheet “{f.sheet || 'blank'}”</p>
                ))}
                {canEdit && (
                  <div className="sheet-sync-row">
                    <button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.choose(c.markerId, 'app')}>Keep mine</button>
                    <button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.choose(c.markerId, 'sheet')}>Use the sheet’s</button>
                  </div>
                )}
              </div>
            ))}
            {link.removedInSheet.map((r) => (
              <div key={r.markerId} className="sheet-sync-item">
                <p className="sheet-sync-item__title"><strong>{r.name || 'An item'}</strong>’s row was deleted in the sheet. The item is still here.</p>
                {canEdit && <div className="sheet-sync-row"><button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.choose(r.markerId, 'putBack')}>Put the row back</button></div>}
              </div>
            ))}
            {(link.missingTabs || []).map((t) => (
              <div key={t.scopeId} className="sheet-sync-item">
                <p className="sheet-sync-item__title">The <strong>{t.title}</strong> tab was deleted in the sheet. Its items are still here.</p>
                {canEdit && <div className="sheet-sync-row"><button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.putBackTab(t.scopeId)}>Put the tab back</button></div>}
              </div>
            ))}
            {link.problems.length > 0 && (
              <div className="sheet-sync-item">
                <p className="sheet-sync-item__title">Not brought in from the sheet:</p>
                {link.problems.slice(0, 5).map((p, i) => <p key={i} className="sheet-sync-item__line">{p.message}</p>)}
                {link.problems.length > 5 && <p className="sheet-sync-item__line">and {link.problems.length - 5} more.</p>}
              </div>
            )}
          </div>
        )}
        {(link.isConnectionOwner || status.role === 'owner') && (
          <div className="sheet-sync-section">
            <button type="button" className="sheet-sync-link is-danger" disabled={Boolean(busy)} onClick={sync.unlink}>Stop syncing</button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        {googleOn && serviceBlock({
          provider: 'google', name: 'Google Sheets', account: status.google,
          intro: 'Make a Google Sheet from this survey. Survey can only see sheets it makes.',
          place: (email) => `A new sheet in ${email ? `${email}’s` : 'your'} Google Drive, one tab per category.`,
          makeLabel: 'Make a live Google Sheet', makingLabel: 'Making the sheet…',
        })}
        {microsoftOn && serviceBlock({
          provider: 'msgraph', name: 'Excel', account: status.microsoft,
          intro: 'Make an Excel workbook in your work or school OneDrive. PMs keep it open in Excel while the team works here.',
          place: (email) => `A new workbook in ${email ? `${email}’s` : 'your'} OneDrive, folder “Survey”, one sheet per category.`,
          makeLabel: 'Make a live Excel workbook', makingLabel: 'Making the workbook…',
        })}
      </>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-sheet-sync-state={link ? link.status : status?.google?.connected || status?.microsoft?.connected ? 'connected' : 'none'}
        onClick={() => setOpen((v) => !v)}
        {...(phone || open ? {} : tip(shownLink ? (excelLink ? 'Live Excel workbook' : 'Live Google Sheet') : 'Sync this survey with a live sheet', 'above'))}
      >
        {busy && busy !== 'sync'
          ? <Spinner size={phone ? 16 : 14} color="var(--text-1)" trackColor="var(--surface-3)" />
          : <Icon name={icon} size={phone ? 16 : 14} color="currentColor" />}
        <span>{label}{waiting ? ` (${waiting})` : ''}</span>
      </button>
      {open && (
        <AnchoredPopover getAnchor={getAnchor} gap={8}>
          <div ref={panelRef} role="dialog" aria-label="Live sheet sync" className="sheet-sync-panel">
            <div className="sheet-sync-head">
              {head.glyph && <span className="sheet-sync-logo"><Icon name={head.glyph} size={16} /></span>}
              <div className="sheet-sync-head__text">
                <p className="sheet-sync-title">{head.title}</p>
                <p className="sheet-sync-sub">{head.sub}</p>
              </div>
            </div>
            {body}
            {error && status && <p role="alert" className="sheet-sync-error">{error}</p>}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
