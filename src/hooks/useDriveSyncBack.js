// OneDrive / Google Drive save-back for the open document (Nightly flag
// 'drive-sync-back'). Drawboard's model: the marks live in Survey; a linked
// drive file gets the marked-up PDF written back on a timer (every N minutes,
// only after a change made on this screen) or on "Sync now". The bytes go
// straight to the drive's one-file upload link (services/driveFilesClient.js).
//
// Three of Drawboard's dialogs come back as `dialog`:
//   'conflict'  - the file changed in OneDrive since Survey last saved it:
//                 keep Survey's version (overwrite) or stop saving back.
//   'gone'      - the file was moved or deleted: unlink, the document stays.
//   'read_only' - this sign-in can open the file but not change it.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRIVE_LINK_CHANGED_EVENT,
  driveCall,
  sha256Hex,
  uploadToDrive,
} from '../services/driveFilesClient.js';
import { LOCAL_MARK_EDIT_EVENT } from '../utils/localMarkEdit.js';

const CHECK_EVERY_MS = 15_000;
// After a push fails for a reason that may pass (Microsoft busy, no signal),
// wait this long before the timer tries again.
const RETRY_AFTER_MS = 60_000;
const DIALOG_CODES = new Set(['conflict', 'gone', 'read_only']);
// Stable defaults: a fresh function each render would rerun the effects below.
const wallClock = () => Date.now();

/** When the next timed push is due, or null when nothing needs pushing. */
export function nextPushAt({ link, canPush, dirtySince, lastAttemptAt = 0, retryAt = 0 }) {
  if (!link || !canPush || link.syncOff || !dirtySince) return null;
  const minutes = Math.min(1440, Math.max(1, Number(link.syncMinutes) || 5));
  return Math.max(dirtySince + minutes * 60_000, lastAttemptAt ? lastAttemptAt + minutes * 60_000 : 0, retryAt || 0);
}

/**
 * Was this screen's change already carried by a push from another screen?
 * Only when that push started after the change (with a little slack for
 * clocks), since that screen had then already received the change.
 */
export function pushedElsewhereSince(link, dirtySince) {
  const at = Date.parse(link?.lastPushedAt || '');
  return Boolean(dirtySince && Number.isFinite(at) && at > dirtySince + 5_000);
}

/**
 * @param {object} opts
 * @param {string|null} opts.documentId
 * @param {boolean} opts.enabled  the flag is on and someone is signed in
 * @param {() => Promise<Uint8Array|null>} opts.exportBytes  the marked-up PDF
 */
export function useDriveSyncBack({
  documentId,
  enabled,
  exportBytes,
  call = driveCall,
  upload = uploadToDrive,
  now = wallClock,
}) {
  const [link, setLink] = useState(null);
  const [canPush, setCanPush] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'problem'
  const [problem, setProblem] = useState(null); // { code, error }
  const [dialog, setDialog] = useState(null); // 'conflict' | 'gone' | 'read_only'
  const [dirty, setDirty] = useState(false);
  const stateRef = useRef({ dirtySince: 0, editsSeen: 0, lastAttemptAt: 0, retryAt: 0, pushing: false, unconfirmed: null });
  const linkRef = useRef(null);
  linkRef.current = link;
  const exportRef = useRef(exportBytes);
  exportRef.current = exportBytes;

  const active = Boolean(enabled && documentId);

  const refresh = useCallback(async () => {
    if (!active) return null;
    const res = await call('driveStatus', { documentId });
    if (!res || res.error) return null;
    setLink(res.link || null);
    setCanPush(Boolean(res.canPush));
    return res;
  }, [active, call, documentId]);

  // Load on open and whenever this document is linked or unlinked.
  useEffect(() => {
    setLink(null);
    setCanPush(false);
    setPhase('idle');
    setProblem(null);
    setDialog(null);
    setDirty(false);
    stateRef.current = { dirtySince: 0, editsSeen: 0, lastAttemptAt: 0, retryAt: 0, pushing: false, unconfirmed: null };
    if (!active) return undefined;
    refresh();
    const onLink = (event) => { if (String(event?.detail?.documentId) === String(documentId)) refresh(); };
    const onEdit = (event) => {
      if (String(event?.detail?.documentId) !== String(documentId)) return;
      const s = stateRef.current;
      s.editsSeen += 1;
      if (!s.dirtySince) s.dirtySince = now();
      setDirty(true);
    };
    window.addEventListener(DRIVE_LINK_CHANGED_EVENT, onLink);
    window.addEventListener(LOCAL_MARK_EDIT_EVENT, onEdit);
    return () => {
      window.removeEventListener(DRIVE_LINK_CHANGED_EVENT, onLink);
      window.removeEventListener(LOCAL_MARK_EDIT_EVENT, onEdit);
    };
  }, [active, documentId, now, refresh]);

  const push = useCallback(async ({ force = false, manual = false } = {}) => {
    const s = stateRef.current;
    if (!active || s.pushing) return false;
    let current = linkRef.current;
    if (!current) return false;
    s.pushing = true;
    s.lastAttemptAt = now();
    setPhase('saving');
    setProblem(null);
    const editsAtStart = s.editsSeen;
    const clean = () => {
      // Edits made while this push ran stay unsaved for the next round.
      if (stateRef.current.editsSeen === editsAtStart) {
        stateRef.current.dirtySince = 0;
        setDirty(false);
      } else {
        stateRef.current.dirtySince = now();
      }
    };
    try {
      // The last upload reached the drive but the server never heard: tell it
      // first, or this push would meet Survey's own write as a conflict.
      if (s.unconfirmed) {
        const confirmed = await call('drivePushed', s.unconfirmed);
        if (!confirmed || confirmed.error) throw Object.assign(new Error(confirmed?.error || 'Survey could not reach the server.'), { code: confirmed?.code || 'graph' });
        s.unconfirmed = null;
        if (confirmed.link) { setLink(confirmed.link); current = confirmed.link; }
      }
      // Another screen may have pushed this change already.
      if (!manual && !force) {
        const fresh = await refresh();
        if (!fresh) { s.retryAt = now() + RETRY_AFTER_MS; setPhase('idle'); return false; } // no answer: try later
        if (!fresh.link) { setPhase('idle'); return false; } // unlinked elsewhere
        current = fresh.link;
        if (pushedElsewhereSince(current, s.dirtySince)) { clean(); setPhase('saved'); return true; }
      }
      const bytes = await exportRef.current?.();
      if (!bytes) throw Object.assign(new Error('Survey could not make the PDF to save.'), { code: 'export' });
      const sha = await sha256Hex(bytes);
      if (!force && sha && sha === current.lastPushedSha) { clean(); setPhase('saved'); return true; }
      // appOrigin: Google's upload link then answers this browser (CORS).
      const appOrigin = typeof window !== 'undefined' ? window.location?.origin : undefined;
      const session = await call('drivePush', { documentId, ...(appOrigin && appOrigin !== 'null' ? { appOrigin } : {}), ...(force ? { force: true } : {}) });
      if (!session || session.error) throw Object.assign(new Error(session?.error || 'The drive did not take the file.'), { code: session?.code || 'graph' });
      await upload(session.uploadUrl, bytes);
      const pushedBody = { documentId, sha, ...(force ? { force: true } : {}) };
      let done = await call('drivePushed', pushedBody);
      if (!done || done.error) done = await call('drivePushed', pushedBody);
      // The drive has the file either way; the next push confirms it first.
      if (!done || done.error) s.unconfirmed = pushedBody;
      if (done?.link) setLink(done.link);
      clean();
      s.retryAt = 0;
      setPhase('saved');
      return true;
    } catch (err) {
      const code = err?.code || (Number(err?.status) === 412 ? 'conflict' : 'graph');
      setProblem({ code, error: err?.message || 'The drive did not take the file.' });
      setPhase('problem');
      if (DIALOG_CODES.has(code)) setDialog(code);
      else {
        s.retryAt = now() + RETRY_AFTER_MS;
        // A failed try is not a save: the retry comes after RETRY_AFTER_MS,
        // not a whole save interval later.
        s.lastAttemptAt = 0;
      }
      return false;
    } finally {
      s.pushing = false;
    }
  }, [active, call, documentId, now, refresh, upload]);

  // The timer: push once the minutes since the first unsaved change pass.
  useEffect(() => {
    if (!active || !link || !canPush || link.syncOff) return undefined;
    const tick = () => {
      const s = stateRef.current;
      if (dialog || s.pushing) return;
      const due = nextPushAt({ link: linkRef.current, canPush, dirtySince: s.dirtySince, lastAttemptAt: s.lastAttemptAt, retryAt: s.retryAt });
      if (due != null && now() >= due) push();
    };
    const timer = setInterval(tick, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [active, canPush, dialog, link, now, push]);

  const settings = useCallback(async (patch) => {
    const res = await call('driveSettings', { documentId, ...patch });
    if (res?.link) setLink(res.link);
    return res;
  }, [call, documentId]);

  return {
    enabled: active,
    link,
    canPush,
    phase,
    problem,
    dialog,
    dirty,
    syncNow: () => push({ manual: true }),
    keepSurveyVersion: async () => { setDialog(null); return push({ force: true, manual: true }); },
    stopSyncing: async () => { setDialog(null); return settings({ syncOff: true }); },
    resumeSyncing: async () => settings({ syncOff: false }),
    setMinutes: async (minutes) => settings({ syncMinutes: Math.round(Number(minutes)) }),
    unlink: async () => {
      setDialog(null);
      const res = await call('driveUnlink', { documentId });
      if (!res?.error) { setLink(null); setPhase('idle'); setProblem(null); }
      return res;
    },
    closeDialog: () => setDialog(null),
  };
}
