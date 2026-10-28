// src/components/DocumentVersionsButton.jsx
//
// "v3" in the viewer's top-right cluster when the open document has older
// versions (Nightly, flag 'document-versions'): opens the versions list, and
// from there an older version or the overlay compare. The dialogs render at
// the app shell's root (DocumentVersionsDialogs) through BodyPortal on the
// modal layer, like the viewer's other dialogs.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { DOCUMENT_VERSIONS_CHANGED_EVENT, listDocumentVersions } from '../services/documentVersionService.js';
import { showToast } from '../utils/toast';
import BodyPortal from './BodyPortal';

const DocumentVersionsDialog = lazy(() => import('./DocumentVersionsDialog.jsx'));
const VersionCompareDialog = lazy(() => import('./VersionCompareDialog.jsx'));

/** Versions of `documentId` (null = feature off or nothing open) and the dialogs' state. */
export function useDocumentVersions(documentId, onOpenVersion) {
  const [versions, setVersions] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [comparing, setComparing] = useState(null); // { older, newer }

  useEffect(() => {
    setVersions([]);
    setListOpen(false);
    setComparing(null);
    if (!documentId) return undefined;
    let cancelled = false;
    const load = () => listDocumentVersions(supabase, documentId)
      .then((list) => { if (!cancelled) setVersions(list); })
      .catch((err) => console.warn('[versions] could not list versions', err));
    load();
    // The upload that made this copy a new version can finish after it opened.
    const onChanged = (e) => {
      const { oldDocumentId, newDocumentId } = e?.detail || {};
      if (documentId === oldDocumentId || documentId === newDocumentId) load();
    };
    window.addEventListener(DOCUMENT_VERSIONS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
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
            onClose={state.closeList}
          />
        )}
        {state.comparing && (
          <VersionCompareDialog older={state.comparing.older} newer={state.comparing.newer} onClose={state.closeCompare} />
        )}
      </Suspense>
    </BodyPortal>
  );
}
