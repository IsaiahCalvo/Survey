// src/components/DocumentVersionsButton.jsx
//
// "v3" in the viewer's top-right cluster when the open document has older
// versions (Nightly, flag 'document-versions'): opens the versions list, and
// from there an older version or the overlay compare. The dialogs render at
// the app shell's root (DocumentVersionsDialogs) through BodyPortal on the
// modal layer, like the viewer's other dialogs.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import {
  DOCUMENT_VERSIONS_CHANGED_EVENT, listDocumentVersions, removeDocumentVersion, restoreDocumentVersion, versionDeletedText,
} from '../services/documentVersionService.js';
import { isFeatureOn } from '../featureFlags.js';
import { createBackoffState } from '../utils/pollingBackoff.js';
import { showToast } from '../utils/toast';
import BodyPortal from './BodyPortal';

const DocumentVersionsDialog = lazy(() => import('./DocumentVersionsDialog.jsx'));
const VersionCompareDialog = lazy(() => import('./VersionCompareDialog.jsx'));

const VERSION_RECHECK_MS = 20_000;
const VERSION_FOCUS_COOLDOWN_MS = 10_000;
const VERSION_ERROR_BACKOFF_BASE_MS = 30_000;
const VERSION_ERROR_BACKOFF_MAX_MS = 300_000;

function sameVersions(a, b) {
  return a.length === b.length && a.every((v, i) => v.id === b[i].id && v.isCurrent === b[i].isCurrent && v.versionNumber === b[i].versionNumber && v.name === b[i].name);
}

/**
 * Versions of `documentId` (null = feature off or nothing open) and the
 * dialogs' state. `onSuperseded(documentId, superseded)` is told after every
 * look whether a newer version replaced the open copy, so its read-only mode
 * can outlive this hook's list (it is cleared on every document switch).
 */
export function useDocumentVersions(documentId, onOpenVersion, onSuperseded = null) {
  const onSupersededRef = useRef(onSuperseded);
  onSupersededRef.current = onSuperseded;
  const [versions, setVersions] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [comparing, setComparing] = useState(null); // { older, newer }
  // Delete one version (Nightly, 'version-delete'; Drawboard DL-28).
  const [deleteOn] = useState(() => isFeatureOn('version-delete'));
  const openIdRef = useRef(documentId);
  openIdRef.current = documentId;
  // The open copy's guarded look (the effect below), for refreshes after a
  // delete or its Undo.
  const loadRef = useRef(null);

  useEffect(() => {
    setVersions([]);
    setListOpen(false);
    setComparing(null);
    if (!documentId) return undefined;
    let cancelled = false;
    let wasCurrent = null;
    // Only the newest look counts: a list asked for before a version change
    // that answers after it would undo what the change just said.
    let ask = 0;
    // A delete or Undo made on this device needs no "newer version" notice.
    let quietNext = false;
    let inFlight = false;
    let queuedForce = false;
    let lastAttemptAt = 0;
    let timer = null;
    const backoff = createBackoffState({
      baseMs: VERSION_ERROR_BACKOFF_BASE_MS,
      maxMs: VERSION_ERROR_BACKOFF_MAX_MS,
    });

    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = (delayMs) => {
      clearTimer();
      if (cancelled || !isVisible() || !isOnline()) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (cancelled || !isVisible() || !isOnline()) return;
        load({ force: false });
      }, Math.max(0, delayMs));
    };

    const load = ({ force = true } = {}) => {
      if (cancelled) return undefined;
      if (!force) {
        if (!isVisible() || !isOnline()) return undefined;
        if (inFlight) return undefined;
        if (backoff.isBlocked()) {
          scheduleNext(backoff.remainingMs());
          return undefined;
        }
      } else {
        backoff.reset();
        if (inFlight) {
          queuedForce = true;
          return undefined;
        }
      }
      clearTimer();
      inFlight = true;
      lastAttemptAt = Date.now();
      ask += 1;
      const mine = ask;
      const quiet = quietNext;
      quietNext = false;
      return listDocumentVersions(supabase, documentId)
        .then((list) => {
          backoff.recordSuccess();
          if (cancelled || mine !== ask) return;
          // Someone else uploaded a new version while this copy was open: say
          // so once; the older-version bar and read-only mode follow from it.
          const isCurrent = list.find((v) => v.id === documentId)?.isCurrent ?? null;
          if (wasCurrent === true && isCurrent === false && !quiet) {
            showToast('A newer version was uploaded, so this copy is now read-only.', 'info');
          }
          if (isCurrent != null) {
            wasCurrent = isCurrent;
            onSupersededRef.current?.(documentId, isCurrent === false);
          }
          setVersions((prev) => (sameVersions(prev, list) ? prev : list));
        })
        .catch((err) => {
          // A copy this hook saw in its chain is gone for this person now
          // (deleted to the Archive, or no longer shared): it stays open
          // read-only. A copy never seen (on this device only, still
          // uploading) is left alone.
          if (!cancelled && mine === ask && wasCurrent != null && err?.code === '42501') onSupersededRef.current?.(documentId, true);
          else console.warn('[versions] could not list versions', err);
          backoff.recordFailure();
        })
        .finally(() => {
          inFlight = false;
          if (cancelled) return;
          if (queuedForce) {
            queuedForce = false;
            load({ force: true });
            return;
          }
          scheduleNext(backoff.failures > 0 ? backoff.remainingMs() : VERSION_RECHECK_MS);
        });
    };
    loadRef.current = load;
    load({ force: true });
    // Nothing pushes a supersede to other people's open copies, so look again
    // on return to the tab (with a short cooldown + outage backoff) and on the
    // scheduled recheck while visible.
    const onVisible = () => {
      if (cancelled || !isVisible() || !isOnline() || inFlight) return;
      if (backoff.isBlocked()) {
        if (timer == null) scheduleNext(backoff.remainingMs());
        return;
      }
      const sinceLast = Date.now() - lastAttemptAt;
      if (sinceLast < VERSION_FOCUS_COOLDOWN_MS) {
        if (timer == null) scheduleNext(VERSION_RECHECK_MS - sinceLast);
        return;
      }
      load({ force: false });
    };
    const onOnline = () => {
      if (cancelled) return;
      backoff.reset();
      if (isVisible() && !inFlight) load({ force: false });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    // The upload that made this copy a new version can finish after it opened.
    const onChanged = (e) => {
      const { oldDocumentId, newDocumentId, removed, restored } = e?.detail || {};
      if (documentId === oldDocumentId || documentId === newDocumentId) {
        quietNext = Boolean(removed || restored);
        load({ force: true });
      }
    };
    window.addEventListener(DOCUMENT_VERSIONS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      if (loadRef.current === load) loadRef.current = null;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(DOCUMENT_VERSIONS_CHANGED_EVENT, onChanged);
    };
  }, [documentId]);

  const open = versions.find((v) => v.id === documentId) || null;

  const openVersion = useCallback(async (version) => {
    const { data: row, error } = await supabase.from('documents').select('*').eq('id', version.id).single();
    if (error || !row?.file_path) {
      showToast('That version couldn’t be opened.');
      return;
    }
    setListOpen(false);
    onOpenVersion({
      ...row,
      filePath: row.file_path,
      supabaseFilePath: row.file_path,
      projectId: row.project_id,
      user_id: row.user_id || null,
      contentSha256: row.content_sha256 ?? null,
    }, row.file_path);
  }, [onOpenVersion]);

  // The version goes to the Archive and the chain closes over the gap. When
  // it was the open copy, the copy that takes its place opens. Undo puts it
  // back (and reopens it if its stand-in is still the open copy).
  const deleteVersion = useCallback(async (version) => {
    const wasOpen = version.id === openIdRef.current;
    let receipt;
    try {
      receipt = await removeDocumentVersion(supabase, version.id);
    } catch (err) {
      showToast(err?.message || 'That version couldn’t be deleted.');
      return;
    }
    const before = versions;
    const standIn = receipt.current || receipt.next || receipt.previous[receipt.previous.length - 1] || null;
    if (wasOpen && standIn) await openVersion({ id: standIn });
    else loadRef.current?.();
    showToast(versionDeletedText(before, receipt), 'success', {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            await restoreDocumentVersion(supabase, receipt);
          } catch (err) {
            showToast(err?.message || 'That version couldn’t be put back.');
            return;
          }
          if (wasOpen && openIdRef.current === standIn) await openVersion({ id: receipt.documentId });
          else loadRef.current?.();
        },
      },
    });
  }, [openVersion, versions]);

  const compareWith = useCallback((version) => {
    if (!open) return;
    const [older, newer] = version.versionNumber < open.versionNumber ? [version, open] : [open, version];
    setListOpen(false);
    setComparing({ older, newer });
  }, [open]);

  return {
    documentId,
    versions,
    open,
    shown: Boolean(open && versions.length > 1),
    listOpen,
    comparing,
    showList: () => setListOpen(true),
    closeList: () => setListOpen(false),
    closeCompare: () => setComparing(null),
    openVersion,
    compareWith,
    deleteVersion: deleteOn ? deleteVersion : null,
  };
}

export default function DocumentVersionsButton({ state, tip }) {
  if (!state?.shown) return null;
  const { open, versions } = state;
  return (
    <button
      type="button"
      data-document-versions-button="true"
      className="btn btn-ghost chrome-control"
      aria-label={`Versions (v${open.versionNumber} of ${versions.length})`}
      {...tip('Versions', 'below')}
      onClick={state.showList}
      style={{ width: 'auto', padding: '0 8px', fontSize: 12, fontWeight: 600 }}
    >
      v{open.versionNumber}
    </button>
  );
}

export function DocumentVersionsDialogs({ state }) {
  if (!state?.shown || (!state.listOpen && !state.comparing)) return null;
  return (
    <BodyPortal>
      <Suspense fallback={null}>
        {state.listOpen && (
          <DocumentVersionsDialog
            versions={state.versions}
            openId={state.documentId}
            onOpen={state.openVersion}
            onCompare={state.compareWith}
            onDelete={state.deleteVersion}
            onClose={state.closeList}
          />
        )}
        {state.comparing && (
          <VersionCompareDialog older={state.comparing.older} newer={state.comparing.newer} versions={state.versions} onClose={state.closeCompare} />
        )}
      </Suspense>
    </BodyPortal>
  );
}
