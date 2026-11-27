// src/hooks/useMarkComments.js
//
// A document's comments and the people who can be @mentioned, kept live:
// other screens' new comments, edits and deletes arrive through Realtime
// (mark_comments is in the publication; its select policy applies).
// Multiple mounts for the same document (e.g. CommentsPanel + PagePinsHost)
// share one visibility-gated postgres_changes channel to avoid duplicate
// Realtime subscriptions and pause while the browser tab is hidden.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import { listCommentPeople, listMarkComments, mapCommentRow, mergeComment } from '../services/markComments.js';
import { isDeviceDocumentId } from '../services/deviceFiles.js';
import { createVisibilityGatedSubscription } from '../utils/realtimePolicy.js';

const sharedCommentSubscriptions = new Map();

export function acquireMarkCommentsRealtime(documentId, { onRow, onResume, client = supabase, doc } = {}) {
  if (!documentId || typeof client?.channel !== 'function') {
    return () => {};
  }
  const key = documentId;
  let entry = sharedCommentSubscriptions.get(key);
  if (!entry) {
    const listeners = new Set();
    const gatedSub = createVisibilityGatedSubscription({
      doc,
      subscribe: () => {
        const channel = client
          .channel(`mark-comments:${documentId}:${Math.random().toString(36).slice(2)}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'mark_comments',
            filter: `document_id=eq.${documentId}`,
          }, (payload) => {
            const row = payload?.new;
            if (!row?.id || row.document_id !== documentId) return;
            for (const listener of listeners) listener.onRow?.(row);
          })
          .subscribe();
        return () => {
          try { client.removeChannel?.(channel); } catch { /* best-effort teardown */ }
        };
      },
      onResume: () => {
        for (const listener of listeners) listener.onResume?.();
      },
    });
    entry = { listeners, gatedSub };
    sharedCommentSubscriptions.set(key, entry);
  }
  const listener = { onRow, onResume };
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      sharedCommentSubscriptions.delete(key);
      entry.gatedSub.dispose();
    }
  };
}

export function useMarkComments(documentId, { enabled = true } = {}) {
  const [comments, setComments] = useState([]);
  const [people, setPeople] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error

  useEffect(() => {
    setComments([]);
    setPeople([]);
    // A file opened with no account is not on the server: nothing to ask it.
    if (!enabled || !documentId || isDeviceDocumentId(documentId)) {
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    const loadComments = () => {
      Promise.all([listMarkComments(supabase, documentId), listCommentPeople(supabase, documentId).catch(() => [])])
        .then(([list, who]) => {
          if (cancelled) return;
          setComments((live) => live.reduce(mergeComment, list));
          setPeople(who);
          setStatus('ready');
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn('[comments] could not load', err?.message || err);
          setStatus('error');
        });
    };
    loadComments();
    const releaseChannel = acquireMarkCommentsRealtime(documentId, {
      onRow: (row) => {
        if (cancelled) return;
        setComments((current) => mergeComment(current, mapCommentRow(row)));
      },
      onResume: () => {
        if (cancelled) return;
        listMarkComments(supabase, documentId)
          .then((list) => {
            if (cancelled) return;
            setComments((live) => live.reduce(mergeComment, list));
          })
          .catch(() => {});
      },
    });
    return () => {
      cancelled = true;
      releaseChannel();
    };
  }, [documentId, enabled]);

  // The writer's own change shows at once, before Realtime echoes it.
  const applyLocal = useCallback((comment) => {
    if (comment?.id) setComments((current) => mergeComment(current, comment));
  }, []);

  return { comments, people, status, applyLocal };
}
