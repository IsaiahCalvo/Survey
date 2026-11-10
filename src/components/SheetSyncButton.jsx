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

// While the survey is open. An Excel workbook's version moves within a
// second or two of an edit, and checking it is one cheap read, so Excel is
// asked often; a Google round reads the whole sheet and keeps a slower pace.
// Hidden tabs keep asking too (owner 2026-11-03: an edit made in Excel while
// Survey sat in another tab waited for the one-minute background sync).
const IDLE_ROUND_MS = { msgraph: 3000, google: 15000 };
const HIDDEN_ROUND_MS = { msgraph: 10000, google: 30000 };
const CHANGE_ROUND_MS = 1200;  // after a change in the app
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
  const [busy, setBusy] = useState(null); // 'connect' | 'link' | 'sync' | 'choose' | 'unlink' | 'takeover' | 'disconnect'
  const [error, setError] = useState(null);
  const [codeAsk, setCodeAsk] = useState(null); // provider whose code box shows while connecting
  const [busyFor, setBusyFor] = useState(null); // the provider a connect or link is for
  const inFlight = useRef(false);
  const again = useRef(false); // a change came in while a round was running
  const retryTimer = useRef(null);
  const layoutInput = useMemo(() => sheetLayoutInput(template), [template]);
  const ids = useMemo(() => ({ documentId, templateId }), [documentId, templateId]);

  const refreshRef = useRef(null);
  const apply = useCallback((res) => {
    if (res?.error) {
      setError(res.error);
      // The sign-in ended and the server forgot it: show Connect again now.
      if (res.code === 'reconnect') refreshRef.current?.();
      return res;
    }
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
  refreshRef.current = refresh;

  // "Sync now" pressed while a round runs (or the server says "too soon")
  // must still read the sheet fully once it can: the force rides along.
  const forceNext = useRef(false);
  const sync = useCallback(async ({ force = false } = {}) => {
    if (force) forceNext.current = true;
    if (inFlight.current) { again.current = true; return null; }
    inFlight.current = true;
    const forced = forceNext.current;
    forceNext.current = false;
    let res = null;
    try {
      res = apply(await sheetSyncCall('sync', { ...ids, ...layoutInput, force: forced }));
      const ran = res?.round?.status;
      // Not run yet (another round, or too soon): keep the force for the retry.
      if (forced && (ran === 'recent' || ran === 'busy' || res?.error)) forceNext.current = true;
      return res;
    } finally {
      inFlight.current = false;
      // Another device's round just ran or is running: ask again once it is
      // done, so an edit here reaches the sheet in seconds, not at the next tick.
      const wait = res?.round?.retryInMs;
      if (again.current || wait || (forceNext.current && !res?.error)) {
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

  // Rounds while the survey is open: one at once, then on a steady beat,
  // slower while the tab is hidden, and at once when it comes back.
  const liveProvider = status?.link?.provider === 'msgraph' ? 'msgraph' : 'google';
  useEffect(() => {
    if (!enabled || !live) return undefined;
    let timer = null;
    let stopped = false;
    let beat = 0; // one chain of timers only, however often focus comes back
    const wait = () => (document.visibilityState === 'visible' ? IDLE_ROUND_MS : HIDDEN_ROUND_MS)[liveProvider];
    const tick = async () => {
      const mine = ++beat;
      clearTimeout(timer);
      await sync();
      if (!stopped && mine === beat) timer = setTimeout(tick, wait());
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled, live, liveProvider, sync]);

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

  // `fileLink`: a workbook the PM already has (Excel only); Survey adds its
  // sheets to it instead of making a new file.
  const link = useCallback((title, provider = 'google', folder = undefined, fileLink = '') => run('link', async () => apply(await sheetSyncCall('link', {
    ...ids, ...layoutInput, title, provider,
    ...(provider === 'msgraph' && folder != null && !fileLink ? { folder } : {}),
    ...(provider === 'msgraph' && fileLink ? { fileLink } : {}),
  })), provider), [apply, ids, layoutInput, run]);
  // The folders in one OneDrive or SharePoint folder, for "Save in";
  // `folderLink` opens a SharePoint/Teams folder link the person pasted.
  const folders = useCallback(async (folder, folderLink) => {
    const res = await sheetSyncCall('folders', { provider: 'msgraph', folder, ...(folderLink ? { folderLink } : {}) });
    if (res?.error && (res.code === 'bad_folder_link' || res.code === 'not_a_folder')) return res;
    if (res?.error) { apply(res); return null; }
    return res;
  }, [apply]);
  const choose = useCallback((markerId, choice) => run('choose', async () => apply(await sheetSyncCall('choose', { ...ids, markerId, choice }))), [apply, ids, run]);
  const putBackTab = useCallback((scopeId) => run('choose', async () => apply(await sheetSyncCall('choose', { ...ids, scopeId, choice: 'putBackTab' }))), [apply, ids, run]);
  const chooseForLink = useCallback((choice) => run('choose', async () => apply(await sheetSyncCall('choose', { ...ids, choice }))), [apply, ids, run]);
  const unlink = useCallback(() => run('unlink', async () => apply(await sheetSyncCall('unlink', ids))), [apply, ids, run]);
  // A stopped sheet kept going with this person's own sign-in (the one who
  // linked it left or their sign-in ended), then a round straight away.
  const takeOver = useCallback(() => run('takeover', async () => {
    const res = apply(await sheetSyncCall('takeover', ids));
    if (!res?.error) apply(await sheetSyncCall('sync', { ...ids, ...layoutInput, force: true }));
  }), [apply, ids, layoutInput, run]);
  // A workbook moved to another library or put back as a copy: point the
  // stopped link at it (Excel only).
  const relink = useCallback((fileLink) => run('relink', async () => apply(await sheetSyncCall('relink', { ...ids, provider: 'msgraph', fileLink }))), [apply, ids, run]);
  const disconnect = useCallback((provider = 'google') => run('disconnect', async () => {
    const res = await sheetSyncCall('disconnect', { provider });
    if (res?.error) setError(res.error); else await refresh();
  }), [refresh, run]);
  // Sync now waits for its own full round: a round already running, or the
  // server's "too soon", only delays it (owner 2026-11-03: Sync now did
  // nothing, because it was folded into whatever round was running).
  const syncNow = useCallback(() => run('sync', async () => {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (inFlight.current) { await new Promise((r) => setTimeout(r, 250)); continue; }
      const res = await sync({ force: true });
      const ran = res?.round?.status;
      if (res && (ran === 'recent' || ran === 'busy')) {
        await new Promise((r) => setTimeout(r, Math.min(Math.max(res.round.retryInMs || 1000, 300), 5000)));
        continue;
      }
      if (res) forceNext.current = false;
      return res;
    }
    return null;
  }), [run, sync]);

  const linking = busy === 'link' ? busyFor : null;
  const connecting = busy === 'connect' ? busyFor : null;
  return { status, busy, error, live, codeAsk, linking, connecting, connect, claimCode, link, folders, choose, putBackTab, chooseForLink, unlink, takeOver, relink, disconnect, syncNow };
}

const GLYPH = { google: 'google', msgraph: 'microsoft' };
const WHO = { google: 'Google', msgraph: 'Microsoft' };

// A button that keeps its words while it works: a spinner joins them and
// clicks are ignored, but nothing greys out (owner 2026-11-03: the gold
// "Make a live Excel workbook" button hid all its text while it ran).
function ActionButton({ busy, busyLabel, label, primary = false, danger = false, block = false, disabled = false, onClick }) {
  const cls = ['sheet-sync-btn', primary && 'sheet-sync-btn--primary', danger && 'sheet-sync-btn--danger', block && 'sheet-sync-btn--block', busy && 'is-busy'].filter(Boolean).join(' ');
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
      {busy && <Spinner size={14} color={primary ? 'var(--accent-text)' : danger ? 'var(--on-danger)' : 'var(--text-1)'} trackColor={primary ? 'rgba(21,17,10,0.2)' : 'var(--surface-1)'} />}
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


// "OneDrive › Survey › Jobs" for a folder path ('' is the top of OneDrive). A
// SharePoint or Teams folder ("~drive~item/…", from a shortcut or a pasted
// link) shows by its own name: "Documents › Jobs".
const FOLDER_KEY = 'survey-sheet-sync-folder';
const FOLDER_LABEL_KEY = 'survey-sheet-sync-folder-label';
const isPlace = (folder) => String(folder || '').startsWith('~');
const folderPath = (folder, placeName) => {
  const parts = String(folder || '').split('/').filter(Boolean);
  if (isPlace(folder)) return [placeName || 'SharePoint', ...parts.slice(1)].join(' › ');
  return ['OneDrive', ...parts].join(' › ');
};

// Pick where a new workbook goes: walk OneDrive's folders (and SharePoint
// folders added to it as shortcuts), or paste a SharePoint/Teams folder link,
// then "Save here".
// Linking a workbook the PM already has: paste its link; Survey adds its own
// sheets next to theirs (owner 2026-11-09: "the best integration with Microsoft").
function ExistingWorkbook({
  busy, error, onLink, onCancel,
  label = 'Paste the link to an Excel workbook (.xlsx) in OneDrive, SharePoint or Teams. Survey adds its own sheets and leaves yours as they are.',
  action = 'Add Survey’s sheets', busyAction = 'Adding sheets…',
}) {
  const [pasted, setPasted] = useState('');
  const submit = (e) => {
    e?.preventDefault?.();
    if (pasted.trim()) onLink(pasted.trim());
  };
  return (
    <div className="sheet-sync-body sheet-sync-folders">
      <form className="sheet-sync-code" onSubmit={submit}>
        <label htmlFor="sheet-sync-file-link">{label}</label>
        <input
          id="sheet-sync-file-link"
          type="url" inputMode="url"
          placeholder="https://…sharepoint.com/…"
          autoComplete="off" spellCheck={false}
          value={pasted} onChange={(e) => setPasted(e.target.value)}
        />
      </form>
      {error && <p className="sheet-sync-paste-error" role="alert">{error}</p>}
      <div className="sheet-sync-row">
        <ActionButton label="Cancel" disabled={busy} onClick={onCancel} />
        <ActionButton primary label={action} busyLabel={busyAction} busy={busy} disabled={busy || !pasted.trim()} onClick={submit} />
      </div>
    </div>
  );
}

function FolderPicker({ start, startName, load, onPick, onCancel }) {
  const [at, setAt] = useState(start || '');
  const [placeName, setPlaceName] = useState(isPlace(start) ? startName || '' : '');
  const [list, setList] = useState(null);
  const [places, setPlaces] = useState([]);
  const [failed, setFailed] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let live = true;
    setList(null);
    setFailed(false);
    load(at).then((res) => {
      if (!live) return;
      if (!res || res.error) { setFailed(true); setList([]); setPlaces([]); return; }
      setList(Array.isArray(res.folders) ? res.folders : []);
      setPlaces(Array.isArray(res.places) ? res.places : []);
    });
    return () => { live = false; };
  }, [at, load]);
  const openLink = async (e) => {
    e.preventDefault();
    const url = pasted.trim();
    if (!url) return;
    setOpening(true);
    setPasteError('');
    const res = await load('', url);
    setOpening(false);
    if (!res || res.error) { setPasteError(res?.error || 'Could not open that link.'); return; }
    setPlaceName(res.name || 'SharePoint');
    setPasted('');
    setAt(res.folder);
  };
  const parts = at.split('/').filter(Boolean);
  const place = isPlace(at);
  const crumbs = place ? parts.slice(1) : parts;
  const head = place ? [parts[0]] : [];
  const empty = list !== null && list.length === 0 && places.length === 0;
  return (
    <div className="sheet-sync-body sheet-sync-folders">
      <nav className="sheet-sync-crumbs" aria-label="Folder">
        <button type="button" className="sheet-sync-crumb" onClick={() => setAt('')}>OneDrive</button>
        {place && (
          <span>
            <span aria-hidden="true"> › </span>
            <button type="button" className="sheet-sync-crumb" onClick={() => setAt(parts[0])}>{placeName || 'SharePoint'}</button>
          </span>
        )}
        {crumbs.map((name, i) => (
          <span key={i}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="sheet-sync-crumb" onClick={() => setAt([...head, ...crumbs.slice(0, i + 1)].join('/'))}>{name}</button>
          </span>
        ))}
      </nav>
      <div className="sheet-sync-folder-list" role="list" aria-busy={list === null || undefined}>
        {list === null ? (
          <>
            <span className="sheet-sync-skeleton" />
            <span className="sheet-sync-skeleton is-short" />
          </>
        ) : empty ? (
          <p className="sheet-sync-empty">{failed ? 'Could not open this folder.' : 'No folders here.'}</p>
        ) : (
          <>
            {places.map((p) => (
              <button key={p.folder} type="button" role="listitem" className="sheet-sync-folder" onClick={() => { setPlaceName(p.name); setAt(p.folder); }}>
                <Icon name="folder" size={14} color="currentColor" />
                <span>{p.name}</span>
              </button>
            ))}
            {list.map((name) => (
              <button key={name} type="button" role="listitem" className="sheet-sync-folder" onClick={() => setAt(at ? `${at}/${name}` : name)}>
                <Icon name="folder" size={14} color="currentColor" />
                <span>{name}</span>
              </button>
            ))}
          </>
        )}
      </div>
      <form className="sheet-sync-code" onSubmit={openLink}>
        <label htmlFor="sheet-sync-folder-link">Folder in SharePoint or Teams? Paste its link.</label>
        <div className="sheet-sync-code__row">
          <input
            id="sheet-sync-folder-link"
            type="url" inputMode="url"
            placeholder="https://…sharepoint.com/…"
            autoComplete="off" spellCheck={false}
            value={pasted} onChange={(e) => { setPasted(e.target.value); setPasteError(''); }}
          />
          <ActionButton label="Open" busyLabel="Opening…" busy={opening} disabled={!pasted.trim()} onClick={openLink} />
        </div>
      </form>
      {pasteError && <p className="sheet-sync-paste-error" role="alert">{pasteError}</p>}
      <div className="sheet-sync-row">
        <ActionButton label="Cancel" onClick={onCancel} />
        <ActionButton primary label="Save here" onClick={() => onPick(at, place ? placeName : '')} />
      </div>
    </div>
  );
}

export default function SheetSyncButton({ className, phone = false, documentId, template, markers, documentName }) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  // 'main' | 'menu' (the ⋯ list) | 'stop' (confirm) | 'folders' (Save in)
  const [view, setView] = useState('main');
  const [folder, setFolder] = useState(() => {
    const saved = readJson(FOLDER_KEY);
    return typeof saved === 'string' ? saved : 'Survey';
  });
  const [folderName, setFolderName] = useState(() => {
    const saved = readJson(FOLDER_LABEL_KEY);
    return typeof saved === 'string' ? saved : '';
  });
  const [width, setWidth] = useState(320);
  const [, setNow] = useState(0);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  // The panel opens over the survey rail's foot and is never wider than the
  // rail (owner 2026-11-03: "it should fit within the survey window").
  const footOf = () => buttonRef.current?.closest('.survey-rail__foot, .mobile-survey-foot') || null;
  const getAnchor = useCallback(() => footOf() || buttonRef.current, []);
  const ready = Boolean(documentId && template);
  const sync = useSheetSync({ documentId, template, markers, enabled: ready });
  const { status, busy, error, live } = sync;
  const link = status?.link || null;
  // Viewers see the sheet's state; only owners and editors change anything.
  const canEdit = status?.role === 'owner' || status?.role === 'editor';

  useEffect(() => {
    if (!open) return undefined;
    setView('main');
    const foot = footOf();
    if (foot) setWidth(Math.max(240, Math.min(320, Math.floor(foot.getBoundingClientRect().width) - 16)));
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

  const loadFolders = sync.folders;

  if (!template) return null;

  // Until the server answers: the survey's own link from last time, or the
  // plain "Live sync" (owner 2026-11-03: it read "Google Sheets" first, then
  // flipped to "Live in Excel").
  const cachedLink = status || !documentId ? null : readJson(linkKey(documentId, sheetTemplateId(template)));
  const googleOn = Boolean(status?.providers?.google?.configured ?? status?.configured);
  const microsoftOn = Boolean(status?.providers?.msgraph?.configured);
  const shownLink = link || cachedLink;
  const linkProvider = shownLink?.provider === 'msgraph' ? 'msgraph' : shownLink ? 'google' : null;
  const shownLive = link ? live : shownLink?.status === 'active';
  const excelLink = linkProvider === 'msgraph';
  const label = shownLink
    ? (shownLive ? (excelLink ? 'Live in Excel' : 'Live in Sheets') : 'Sync stopped')
    : 'Live sync';
  const icon = linkProvider ? GLYPH[linkProvider] : 'listChecks';
  const waiting = (link?.conflicts?.length || 0) + (link?.removedInSheet?.length || 0) + (link?.missingTabs?.length || 0) + (link?.brokenTabs?.length || 0) + (link?.heldErase ? 1 : 0);
  const sheetTitle = documentName ? `${documentName.replace(/\.pdf$/i, '')} survey` : 'Survey';

  const pickFolder = (at, name = '') => {
    setFolder(at); writeJson(FOLDER_KEY, at);
    setFolderName(name); writeJson(FOLDER_LABEL_KEY, name);
    setView('main');
  };

  // One service: logo, name, account; then connect or make.
  const serviceBlock = ({ provider, name, account, makeLabel, makingLabel }) => {
    const making = busy === 'link' && sync.linking === provider;
    const connecting = busy === 'connect' && sync.connecting === provider;
    return (
      <div className="sheet-sync-body sheet-sync-service-block" key={provider}>
        <div className="sheet-sync-service">
          <span className="sheet-sync-logo"><Icon name={GLYPH[provider]} size={16} /></span>
          <div className="sheet-sync-service__text">
            <p className="sheet-sync-name">{name}</p>
            <p className="sheet-sync-meta">{account?.connected ? (account.email || `Signed in to ${WHO[provider]}`) : 'Not connected'}</p>
          </div>
          {account?.connected && (
            <button type="button" className="sheet-sync-link" onClick={() => sync.disconnect(provider)} disabled={Boolean(busy)}>Sign out</button>
          )}
        </div>
        {!canEdit ? null : account?.connected ? (
          <>
            {provider === 'msgraph' && (
              <p className="sheet-sync-place">
                <span>Save in {folderPath(folder, folderName)}</span>
                <button type="button" className="sheet-sync-link" disabled={Boolean(busy)} onClick={() => setView('folders')}>Change</button>
              </p>
            )}
            <ActionButton
              primary block
              label={makeLabel} busyLabel={makingLabel}
              busy={making}
              disabled={Boolean(busy)}
              onClick={() => sync.link(sheetTitle, provider, provider === 'msgraph' ? folder : undefined)}
            />
            {provider === 'msgraph' && (
              <p className="sheet-sync-place">
                <button type="button" className="sheet-sync-link" disabled={Boolean(busy)} onClick={() => setView('existing')}>Use a workbook I already have</button>
              </p>
            )}
          </>
        ) : (
          <ActionButton
            block
            label={`Connect ${WHO[provider]}`} busyLabel={`Waiting for ${WHO[provider]}…`}
            busy={connecting}
            disabled={Boolean(busy)}
            onClick={() => sync.connect(provider)}
          />
        )}
        {connecting && <p className="sheet-sync-note">Say yes on the {WHO[provider]} page. Survey finishes on its own.</p>}
        {busy === 'connect' && sync.codeAsk === provider && <ClaimCodeBox provider={provider} onClaim={sync.claimCode} />}
      </div>
    );
  };

  let head = { title: 'Live sync', sub: 'Edits here and in the sheet show up on both sides.' };
  let menu = false;
  let body;
  if (!ready) {
    body = <div className="sheet-sync-body"><p className="sheet-sync-note">Save this PDF to your Survey account to sync it.</p></div>;
  } else if (!status) {
    body = (
      <div className="sheet-sync-body" aria-busy="true">
        {error ? <p className="sheet-sync-note">{error}</p> : (
          <>
            <span className="sheet-sync-skeleton" />
            <span className="sheet-sync-skeleton is-short" />
          </>
        )}
      </div>
    );
  } else if (!link && !googleOn && !microsoftOn) {
    body = <div className="sheet-sync-body"><p className="sheet-sync-note">Live sync is not set up on this server yet.</p></div>;
  } else if (link && view === 'stop') {
    const file = excelLink ? `${link.title || 'the workbook'}.xlsx` : (link.title || 'the sheet');
    head = null;
    body = (
      <div className="sheet-sync-body sheet-sync-confirm">
        <p className="sheet-sync-confirm__title">Stop syncing for everyone?</p>
        <p className="sheet-sync-note">Survey and {file} stop updating each other for the whole team. The file stays in {excelLink ? 'OneDrive' : 'Google Drive'}.</p>
        <div className="sheet-sync-row">
          <ActionButton label="Keep syncing" disabled={Boolean(busy)} onClick={() => setView('main')} />
          <ActionButton
            danger label="Stop syncing" busyLabel="Stopping…" busy={busy === 'unlink'}
            disabled={Boolean(busy)}
            onClick={async () => { await sync.unlink(); setView('main'); }}
          />
        </div>
      </div>
    );
  } else if (link && view === 'relink' && link.status === 'broken') {
    head = { title: 'Find the workbook' };
    body = (
      <ExistingWorkbook
        busy={busy === 'relink'}
        error={error}
        label="Paste the link to the workbook where it is now. Survey checks it holds this survey’s sheets, then carries on syncing."
        action="Sync this workbook" busyAction="Checking the workbook…"
        onLink={async (url) => { const res = await sync.relink(url); if (res && !res.error) setView('main'); }}
        onCancel={() => setView('main')}
      />
    );
  } else if (link) {
    const state = link.status === 'active' ? 'live' : link.status === 'paused' ? 'paused' : 'broken';
    const where = link.folderLabel || (link.folder != null ? folderPath(link.folder) : 'OneDrive');
    menu = canEdit;
    head = {
      glyph: GLYPH[linkProvider],
      title: state === 'live' ? `Live in ${excelLink ? 'Excel' : 'Sheets'}` : state === 'paused' ? 'Sync paused' : 'Sync stopped',
      status: (
        <span className="sheet-sync-status">
          <span className={`sheet-sync-dot${state === 'paused' ? ' is-paused' : state === 'broken' ? ' is-broken' : ''}`} />
          {busy === 'sync' ? 'Syncing…' : link.lastRoundAt ? `Synced ${syncedAgo(link.lastRoundAt)}` : state === 'live' ? 'Starting…' : state === 'paused' ? 'Paused' : 'Stopped'}
        </span>
      ),
    };
    body = (
      <>
        <div className="sheet-sync-body">
          {link.title && (
            <div className="sheet-sync-file">
              <Icon name="document" size={16} color="var(--text-3)" />
              <div className="sheet-sync-file__text">
                <p className="sheet-sync-name">{excelLink ? `${link.title}.xlsx` : link.title}</p>
                <p className="sheet-sync-meta">{excelLink ? where : 'Google Drive'}</p>
              </div>
            </div>
          )}
          <div className="sheet-sync-row">
            {link.fileUrl && (
              <a href={link.fileUrl} target="_blank" rel="noopener noreferrer" className="sheet-sync-btn sheet-sync-btn--primary sheet-sync-grow">
                {excelLink ? 'Open in Excel' : 'Open in Sheets'}
              </a>
            )}
            {canEdit && (
              <button
                type="button"
                className="sheet-sync-btn sheet-sync-icon-btn"
                aria-label="Sync now"
                aria-busy={busy === 'sync' || undefined}
                disabled={Boolean(busy) && busy !== 'sync'}
                onClick={() => { if (busy !== 'sync') sync.syncNow(); }}
                {...tip('Sync now', 'above')}
              >
                {busy === 'sync'
                  ? <Spinner size={14} color="var(--text-1)" trackColor="var(--surface-1)" />
                  : <Icon name="rotateCw" size={14} color="currentColor" />}
              </button>
            )}
          </div>
          {link.lastError && <p className="sheet-sync-error-line">{link.lastError}</p>}
          {/* Real Excel on the web, 11-10: "Format as Table" was refused ("Can't
              Save Your Changes", unsaved typing lost) when a sync write landed
              first; Data > Filter was fine (0 of 3). */}
          {excelLink && shownLive && (
            <p className="sheet-sync-note">For filter buttons in Excel on the web, use Data › Filter. Format as Table may not save while the team is syncing.</p>
          )}
          {link.status === 'broken' && link.isConnectionOwner && !(excelLink ? status.microsoft : status.google)?.connected && (
            <ActionButton
              primary block
              label={`Connect ${excelLink ? 'Microsoft' : 'Google'} again`}
              busyLabel={`Waiting for ${excelLink ? 'Microsoft' : 'Google'}…`}
              busy={busy === 'connect'}
              disabled={Boolean(busy)}
              onClick={() => sync.connect(link.provider)}
            />
          )}
          {link.status === 'broken' && !link.isConnectionOwner && canEdit && (
            (excelLink ? status.microsoft : status.google)?.connected ? (
              <ActionButton
                primary block
                label={`Keep syncing with my ${excelLink ? 'Microsoft' : 'Google'} account`}
                busyLabel="Checking the file…"
                busy={busy === 'takeover'}
                disabled={Boolean(busy)}
                onClick={() => sync.takeOver()}
              />
            ) : (
              <ActionButton
                block
                label={`Connect ${excelLink ? 'Microsoft' : 'Google'} to keep it syncing`}
                busyLabel={`Waiting for ${excelLink ? 'Microsoft' : 'Google'}…`}
                busy={busy === 'connect'}
                disabled={Boolean(busy)}
                onClick={() => sync.connect(link.provider)}
              />
            )
          )}
          {busy === 'connect' && sync.codeAsk && <ClaimCodeBox provider={sync.codeAsk} onClaim={sync.claimCode} />}
          {link.status === 'broken' && excelLink && canEdit && status.microsoft?.connected && (
            <p className="sheet-sync-place">
              <button type="button" className="sheet-sync-link" disabled={Boolean(busy)} onClick={() => setView('relink')}>Moved or copied the workbook? Paste its new link</button>
            </p>
          )}
        </div>
        {(link.heldErase || link.conflicts.length > 0 || link.removedInSheet.length > 0 || (link.missingTabs || []).length > 0 || (link.brokenTabs || []).length > 0 || link.problems.length > 0) && (
          <div className="sheet-sync-body">
            {link.heldErase && (
              <div className="sheet-sync-item">
                <p className="sheet-sync-item__title">{link.heldErase.count} {link.heldErase.count === 1 ? 'answer' : 'answers'} on {link.heldErase.items} {link.heldErase.items === 1 ? 'item' : 'items'} {link.heldErase.count === 1 ? 'was' : 'were'} cleared in the sheet at once</p>
                <p className="sheet-sync-item__line">This happens when an older copy is restored or a column is cleared by mistake. They are kept here until you choose.</p>
                {canEdit && (
                  <div className="sheet-sync-row">
                    <button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.chooseForLink('blanksApp')}>Put them back in the sheet</button>
                    <button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.chooseForLink('blanksSheet')}>Clear them here too</button>
                  </div>
                )}
              </div>
            )}
            {link.conflicts.map((c) => (
              <div key={c.markerId} className="sheet-sync-item">
                <p className="sheet-sync-item__title"><strong>{c.name || 'An item'}</strong> changed in both</p>
                {c.fields.map((f) => (
                  <p key={f.key} className="sheet-sync-item__line">{f.header}: “{f.app || 'blank'}” here, “{f.sheet || 'blank'}” in the sheet</p>
                ))}
                {canEdit && (
                  <div className="sheet-sync-row">
                    <button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.choose(c.markerId, 'app')}>Keep mine</button>
                    <button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.choose(c.markerId, 'sheet')}>Use sheet’s</button>
                  </div>
                )}
              </div>
            ))}
            {canEdit && link.removedInSheet.length > 1 && (
              <div className="sheet-sync-row"><button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.chooseForLink('putBackAll')}>Put all {link.removedInSheet.length} rows back</button></div>
            )}
            {link.removedInSheet.map((r) => (
              <div key={r.markerId} className="sheet-sync-item">
                <p className="sheet-sync-item__title"><strong>{r.name || 'An item'}</strong>’s row was deleted in the sheet.</p>
                {canEdit && <div className="sheet-sync-row"><button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.choose(r.markerId, 'putBack')}>Put row back</button></div>}
              </div>
            ))}
            {(link.missingTabs || []).map((t) => (
              <div key={t.scopeId} className="sheet-sync-item">
                <p className="sheet-sync-item__title">The <strong>{t.title}</strong> {excelLink ? 'sheet' : 'tab'} was deleted.</p>
                {canEdit && <div className="sheet-sync-row"><button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.putBackTab(t.scopeId)}>Put it back</button></div>}
              </div>
            ))}
            {(link.brokenTabs || []).map((t) => (
              <div key={t.scopeId} className="sheet-sync-item">
                <p className="sheet-sync-item__title">The <strong>{t.title}</strong> {excelLink ? 'sheet' : 'tab'} lost its Row ID column or heading row, so it isn’t syncing.</p>
                <p className="sheet-sync-item__line">Undo that change in the {excelLink ? 'workbook' : 'sheet'}, or make a new {excelLink ? 'sheet' : 'tab'} from the survey. The old one stays as it is.</p>
                {canEdit && <div className="sheet-sync-row"><button type="button" className="sheet-sync-btn" disabled={Boolean(busy)} onClick={() => sync.putBackTab(t.scopeId)}>Make a new {excelLink ? 'sheet' : 'tab'}</button></div>}
              </div>
            ))}
            {link.problems.length > 0 && (
              <div className="sheet-sync-item">
                <p className="sheet-sync-item__title">Check these in the sheet:</p>
                {link.problems.slice(0, 5).map((p, i) => <p key={i} className="sheet-sync-item__line">{p.message}</p>)}
                {link.problems.length > 5 && <p className="sheet-sync-item__line">and {link.problems.length - 5} more.</p>}
              </div>
            )}
          </div>
        )}
      </>
    );
  } else if (view === 'existing') {
    head = { title: 'Use your workbook' };
    body = (
      <ExistingWorkbook
        busy={busy === 'link'}
        error={error}
        onLink={async (url) => { const res = await sync.link(sheetTitle, 'msgraph', undefined, url); if (res && !res.error) setView('main'); }}
        onCancel={() => setView('main')}
      />
    );
  } else if (view === 'folders') {
    head = { title: 'Save in' };
    body = <FolderPicker start={folder} startName={folderName} load={loadFolders} onPick={pickFolder} onCancel={() => setView('main')} />;
  } else {
    body = (
      <>
        {microsoftOn && serviceBlock({
          provider: 'msgraph', name: 'Excel', account: status.microsoft,
          makeLabel: 'Make Excel workbook', makingLabel: 'Making workbook…',
        })}
        {googleOn && serviceBlock({
          provider: 'google', name: 'Google Sheets', account: status.google,
          makeLabel: 'Make Google Sheet', makingLabel: 'Making sheet…',
        })}
        {!canEdit && (
          <div className="sheet-sync-body"><p className="sheet-sync-note">Only the survey’s owners and editors can make a live sheet.</p></div>
        )}
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
        {...(phone || open ? {} : tip(shownLink ? (excelLink ? 'Live Excel workbook' : 'Live Google Sheet') : 'Keep this survey and a sheet in step', 'above'))}
      >
        {busy && busy !== 'sync'
          ? <Spinner size={phone ? 16 : 14} color="var(--text-1)" trackColor="var(--surface-3)" />
          : <Icon name={icon} size={phone ? 16 : 14} color="currentColor" />}
        <span>{label}{waiting ? ` (${waiting})` : ''}</span>
      </button>
      {open && (
        // 7200: the popover layer the phone dock (6750) stays under; the
        // default 6500 let the dock cover the card's foot on a sideways phone.
        <AnchoredPopover getAnchor={getAnchor} gap={8} zIndex={7200}>
          <div ref={panelRef} role="dialog" aria-label="Live sync" className="sheet-sync-panel" style={{ width }}>
            {head && (
              <div className="sheet-sync-head">
                {head.glyph && <span className="sheet-sync-logo"><Icon name={head.glyph} size={16} /></span>}
                <div className="sheet-sync-head__text">
                  <p className="sheet-sync-title">{head.title}</p>
                  {head.status || (head.sub && <p className="sheet-sync-sub">{head.sub}</p>)}
                </div>
                {menu && (
                  <button
                    type="button"
                    className="sheet-sync-icon-btn sheet-sync-icon-btn--quiet"
                    aria-label="More"
                    aria-haspopup="menu"
                    aria-expanded={view === 'menu'}
                    onClick={() => setView((v) => (v === 'menu' ? 'main' : 'menu'))}
                    {...tip('More', 'above')}
                  >
                    <Icon name="moreHorizontal" size={16} color="currentColor" />
                  </button>
                )}
                {menu && view === 'menu' && (
                  <div className="sheet-sync-menu" role="menu">
                    <button type="button" role="menuitem" className="sheet-sync-menu__item is-danger" onClick={() => setView('stop')}>Stop syncing…</button>
                  </div>
                )}
              </div>
            )}
            {body}
            {error && status && view !== 'existing' && view !== 'relink' && <p role="alert" className="sheet-sync-error">{error}</p>}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
