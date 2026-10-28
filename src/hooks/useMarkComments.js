// src/hooks/useMarkComments.js
//
// A document's comments and the people who can be @mentioned, kept live:
// other screens' new comments, edits and deletes arrive through Realtime
// (mark_comments is in the publication; its select policy applies).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { listCommentPeople, listMarkComments, mapCommentRow, mergeComment } from '../services/markComments.js';

export function useMarkComments(documentId, { enabled = true } = {}) {
  const [comments, setComments] = useState([]);
  const [people, setPeople] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error

  useEffect(() => {
    setComments([]);
    setPeople([]);
    if (!enabled || !documentId) {
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
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
    const channel = typeof supabase?.channel === 'function'
      ? supabase
        .channel(`mark-comments:${documentId}:${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'mark_comments',
          filter: `document_id=eq.${documentId}`,
        }, (payload) => {
          const row = payload?.new;
          if (!row?.id || row.document_id !== documentId) return;
          setComments((current) => mergeComment(current, mapCommentRow(row)));
        })
        .subscribe()
      : null;
    return () => {
      cancelled = true;
      try { if (channel) supabase.removeChannel?.(channel); } catch { /* best-effort teardown */ }
    };
  }, [documentId, enabled]);

  // The writer's own change shows at once, before Realtime echoes it.
  const applyLocal = useCallback((comment) => {
    if (comment?.id) setComments((current) => mergeComment(current, comment));
  }, []);

  return { comments, people, status, applyLocal };
}
