/* Survey Hub — Archive tab data container.

   KAL-430 keeps ArchiveScreen presentational: it takes normalized items and
   callbacks and never touches Supabase. This container is the seam — it loads
   the Archive, hands the screen its items, and turns Restore / Delete forever
   into the owner-enforced service calls.

   It also tells the rest of the hub that documents and projects changed, so a
   restored item reappears on the Documents and Projects screens without a
   reload.
*/
import { useCallback, useEffect, useState } from 'react';
import ArchiveScreen from './ArchiveScreen';
import { loadArchive, restoreArchiveItems, deleteArchiveItemsForever } from '../services/archiveService';
import { notifyLibraryChanged } from '../hooks/libraryChangeBus';
import { readLibraryListCache, writeLibraryListCache } from '../hooks/libraryListCache';

export default function ArchiveScreenContainer({ user, onNav, templatesLocked = false }) {
  const userId = user?.id || null;
  // Seed the first render from the device cache so a repeat visit never
  // paints the loading rows before the mount effect runs.
  const [initialCached] = useState(() => readLibraryListCache(userId, 'archive'));
  const [items, setItems] = useState(() => initialCached || []);
  const [loading, setLoading] = useState(() => !initialCached);
  const [error, setError] = useState(null);

  const refresh = useCallback(async ({ showSpinner = false } = {}) => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    // A repeat visit paints the last known Archive from the device cache and
    // re-reads behind it, so a just-archived item still appears within a read.
    const cached = showSpinner ? readLibraryListCache(userId, 'archive') : null;
    if (cached) {
      setItems(cached);
      setLoading(false);
    } else if (showSpinner) setLoading(true);
    const { data, error: loadError } = await loadArchive(userId);
    setError(loadError || null);
    setItems(loadError ? [] : data);
    if (!loadError) writeLibraryListCache(userId, 'archive', data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    // Re-read on every mount (the cached copy only paints first): the user arrives here right
    // after archiving something, and a stale list is the one thing that would
    // make them think the archive failed.
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refresh({ showSpinner: true });
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  /* Both actions re-read the Archive afterwards so a partial failure leaves the
     list showing exactly what is really still archived, and announce the change
     so the Documents and Projects screens pick up restored rows. */
  const afterMutation = useCallback(async (result) => {
    if (result?.succeeded?.length) notifyLibraryChanged();
    await refresh();
    return result;
  }, [refresh]);

  const onRestore = useCallback(
    (selected) => restoreArchiveItems(selected).then(afterMutation),
    [afterMutation],
  );

  const onDeleteForever = useCallback(
    (selected) => deleteArchiveItemsForever(selected).then(afterMutation),
    [afterMutation],
  );

  return (
    <ArchiveScreen
      items={items}
      loading={loading}
      error={error}
      onRestore={onRestore}
      onDeleteForever={onDeleteForever}
      onNav={onNav}
      user={user}
      templatesLocked={templatesLocked}
    />
  );
}
