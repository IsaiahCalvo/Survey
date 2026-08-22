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

/* Supabase archive rows key on uuid user_id. A preview / mock id that is
   not a UUID must not be sent — Postgres answers
   "invalid input syntax for type uuid" and Archive shows a host error
   instead of the empty or preview list. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

export default function ArchiveScreenContainer({ user, onNav, templatesLocked = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const userId = isUuid(user?.id) ? user.id : null;

  const refresh = useCallback(async ({ showSpinner = false } = {}) => {
    if (!userId) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    const { data, error: loadError } = await loadArchive(userId);
    setError(loadError || null);
    setItems(loadError ? [] : data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    // Re-read on every mount rather than caching: the user arrives here right
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
