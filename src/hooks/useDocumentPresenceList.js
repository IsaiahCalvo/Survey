import { useEffect, useState } from 'react';
import {
  getDocumentPresence,
  subscribeToDocumentPresence
} from '../services/documentAnnotationService';

/**
 * useDocumentPresenceList — returns the live list of users currently viewing
 * the given document. Powers the stacked-avatars row next to the sync chip.
 *
 * Each entry is the raw presence row:
 *   { document_id, user_id, display_name, current_page, last_seen, ... }
 *
 * Stale rows (last_seen > 2 min ago) are filtered server-side by
 * getDocumentPresence. The hook polls on a slow interval as a backup so
 * disconnected sessions drop off the avatar pile without waiting for an
 * explicit DELETE row from the other side.
 */
export function useDocumentPresenceList({ documentId, enabled = true } = {}) {
  const [presence, setPresence] = useState([]);

  useEffect(() => {
    if (!enabled || !documentId) {
      setPresence([]);
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      try {
        const { data } = await getDocumentPresence(documentId);
        if (!cancelled) setPresence(Array.isArray(data) ? data : []);
      } catch (err) {
        // Presence is non-critical; log and keep the last list.
        console.warn('[Presence] refresh failed: ' + (err?.message || String(err)));
      }
    };

    refresh(); // initial paint

    const unsub = subscribeToDocumentPresence(documentId, (rows) => {
      if (!cancelled) setPresence(Array.isArray(rows) ? rows : []);
    });

    // Slow poll (every 30s) so users who close the app without a clean
    // disconnect age out of the pile within a couple of minutes.
    const pollHandle = setInterval(refresh, 30000);

    return () => {
      cancelled = true;
      clearInterval(pollHandle);
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [documentId, enabled]);

  return presence;
}
