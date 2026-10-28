// src/hooks/useDocumentPeople.js
//
// Everyone who can open a document, for an "Assigned to" list (Nightly
// marker tracking). The same server list the comment @mentions use
// (mark_comment_people): the owner and the project's members.
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { listCommentPeople } from '../services/markComments.js';

export function useDocumentPeople(documentId, { enabled = true } = {}) {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    setPeople([]);
    if (!enabled || !documentId) return undefined;
    let cancelled = false;
    listCommentPeople(supabase, documentId)
      .then((list) => { if (!cancelled) setPeople(list); })
      .catch((err) => console.warn('[tracking] could not read who is on this document', err?.message || err));
    return () => { cancelled = true; };
  }, [documentId, enabled]);
  return people;
}
