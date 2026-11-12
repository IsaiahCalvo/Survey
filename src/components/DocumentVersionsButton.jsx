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
import { showToast } from '../utils/toast';
import BodyPortal from './BodyPortal';

const DocumentVersionsDialog = lazy(() => import('./DocumentVersionsDialog.jsx'));
const VersionCompareDialog = lazy(() => import('./VersionCompareDialog.jsx'));

const VERSION_RECHECK_MS = 20_000;

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
    const load = () => {
      ask += 1;
      const mine = ask;
      return listDocumentVersions(supabase, documentId)
        .then((list) => {
          if (cancelled || mine !== ask) return;
          // Someone else uploaded a new version while this copy was open: say
          // so once; the older-version bar and read-only mode follow from it.
          const isCurrent = list.find((v) => v.id === documentId)?.isCurrent ?? null;
          if (wasCurrent === true && isCurrent === false) {
            showToast('A newer version was uploaded, so this copy is now read-only.', 'info');
          }
          if (isCurrent != null) {
            wasCurrent = isCurrent;
            onSupersededRef.current?.(documentId, isCurrent === false);
          }
          setVersions((prev) => (sameVersions(prev, list) ? prev : list));
        })
        .catch((err) => console.warn('[versions] could not list versions', err));
    };
    load();
    // Nothing pushes a supersede to other people's open copies, so look again
    // on return to the tab and every 20 s while it is in view.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    const timer = window.setInterval(onVisible, VERSION_RECHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // The upload that made this copy a new version can finish after it opened.
    const onChanged = (e) => {
      const { oldDocumentId, newDocumentId } = e?.detail || {};
      if (documentId === oldDocumentId || documentId === newDocumentId) load();
    };
    window.addEventListener(DOCUMENT_VERSIONS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
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
    else listDocumentVersions(supabase, openIdRef.current).then(setVersions).catch(() => {});
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
          else if (openIdRef.current) listDocumentVersions(supabase, openIdRef.current).then(setVersions).catch(() => {});
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
