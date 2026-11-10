// "Make available offline" in the document row menu (Nightly flag
// offline-docs, 2026-11-10; Drawboard's wording, drawboard-trial/file-model.md).
// Switching it on keeps the PDF on this device (services/offlineDocuments.js)
// and opens the document's marks once, so the annotation store's own device
// copy is filled before the user leaves signal.
import { useCallback, useEffect, useState } from 'react';
import { isFeatureOn, FLAGS_CHANGED_EVENT } from '../featureFlags.js';
import { offlineDocuments, OFFLINE_DOCS_CHANGED_EVENT } from '../services/offlineDocuments.js';
import { supabase } from '../supabaseClient';
import { showToast } from '../utils/toast';

/* Open the marks once with no live channel and close again: the store writes
   its device copy (y-indexeddb + accepted checkpoint) as part of any open. */
async function warmMarksCopy(documentId, actorUserId) {
  if (!supabase || !documentId || !actorUserId) return;
  const { openAnnotationDoc } = await import('../services/annotationDocSync.js');
  const handle = await openAnnotationDoc({
    documentId,
    supabase,
    actorUserId,
    enableRealtime: false,
  });
  try { await handle.drain?.(); } catch { /* nothing pending */ }
  await handle.destroy();
}

export async function makeDocumentAvailableOffline({ row, actorId, downloadDocument, fileStamp }) {
  const path = row?.file_path || row?.filePath;
  if (!row?.id || !path || !actorId || typeof downloadDocument !== 'function') return false;
  const blob = await downloadDocument(path);
  const stamp = typeof fileStamp === 'function' ? await fileStamp(path).catch(() => null) : null;
  const kept = await offlineDocuments().pin({ actorId, row, bytes: blob, stamp });
  if (!kept) return false;
  try {
    await warmMarksCopy(row.id, actorId);
  } catch (error) {
    // The file is kept; the marks copy fills on the next open instead.
    console.warn('[offline-docs] marks copy not filled now:', error?.message || error);
  }
  return true;
}

/**
 * For a list: is the flag on, which documents are kept, and the menu item.
 *   const offline = useOfflineDocumentActions({ userId, downloadDocument, fileStamp });
 *   items: [...(offline.menuItem(doc.raw) ? [offline.menuItem(doc.raw)] : [])]
 */
export function useOfflineDocumentActions({ userId, downloadDocument, fileStamp } = {}) {
  const [enabled, setEnabled] = useState(() => isFeatureOn('offline-docs'));
  const [, setVersion] = useState(0);
  const [busy, setBusy] = useState(() => new Set());

  useEffect(() => {
    const onFlags = () => setEnabled(isFeatureOn('offline-docs'));
    globalThis.addEventListener?.(FLAGS_CHANGED_EVENT, onFlags);
    return () => globalThis.removeEventListener?.(FLAGS_CHANGED_EVENT, onFlags);
  }, []);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let live = true;
    const bump = () => { if (live) setVersion((v) => v + 1); };
    offlineDocuments().load(userId).then(bump).catch(() => {});
    globalThis.addEventListener?.(OFFLINE_DOCS_CHANGED_EVENT, bump);
    return () => {
      live = false;
      globalThis.removeEventListener?.(OFFLINE_DOCS_CHANGED_EVENT, bump);
    };
  }, [enabled, userId]);

  const isKept = useCallback(
    (documentId) => Boolean(enabled && userId && offlineDocuments().isPinned(userId, documentId)),
    [enabled, userId],
  );

  const setBusyFor = (id, on) => setBusy((current) => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const toggle = useCallback(async (row) => {
    if (!row?.id || !userId) return;
    if (offlineDocuments().isPinned(userId, row.id)) {
      await offlineDocuments().unpin(userId, row.id);
      showToast(`${row.name || 'Document'} is no longer kept on this device`, 'info');
      return;
    }
    setBusyFor(row.id, true);
    try {
      const ok = await makeDocumentAvailableOffline({ row, actorId: userId, downloadDocument, fileStamp });
      showToast(
        ok ? `${row.name || 'Document'} is available offline on this device` : 'Couldn’t keep this document on this device',
        ok ? 'success' : 'warn',
      );
    } catch {
      showToast('Couldn’t keep this document on this device. Check your connection and try again.', 'warn');
    } finally {
      setBusyFor(row.id, false);
    }
  }, [userId, downloadDocument, fileStamp]);

  const menuItem = useCallback((row) => {
    if (!enabled || !userId || !row?.id || !(row.file_path || row.filePath)) return null;
    const kept = offlineDocuments().isPinned(userId, row.id);
    return {
      label: busy.has(row.id)
        ? 'Making available offline…'
        : (kept ? 'Remove offline copy' : 'Make available offline'),
      disabled: busy.has(row.id),
      onClick: () => { void toggle(row); },
    };
  }, [enabled, userId, busy, toggle]);

  return { enabled, isKept, menuItem, toggle, busy };
}
