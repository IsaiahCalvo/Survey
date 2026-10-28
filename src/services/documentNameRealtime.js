// src/services/documentNameRealtime.js
//
// Renames made on another screen (another device, another browser window, or
// the owner while a teammate has the document open) reach this one through a
// PRIVATE Realtime Broadcast topic per person, `doc-names:<user uuid>`.
//
// The database sends to it: a trigger on documents.name posts
// { id, name, updated_at } to the owner's topic and to the topic of each active
// collaborator (supabase/migrations/*_document_rename_broadcast.sql). A
// realtime.messages policy lets a person join only their own topic. Nothing on
// the client sends; the row stays the only truth and this is just the echo.
//
// Each message goes through the same bus a local rename uses, so every list
// and tab on this screen updates at once. Our own renames come back here too;
// the bus drops them (not newer, by the database's updated_at).

import { announceRemoteDocumentName } from '../hooks/documentNameBus.js';

export const DOCUMENT_RENAMED_EVENT = 'document_renamed';

export function documentNamesTopic(userId) {
  return `doc-names:${userId}`;
}

/** Apply one broadcast payload. Exported for tests. */
export function applyDocumentRenameMessage(payload) {
  const row = payload && typeof payload === 'object' ? payload : null;
  if (!row?.id || typeof row.name !== 'string') return false;
  return announceRemoteDocumentName(row.id, row.name, row.updated_at);
}

/**
 * Listen for renames of the signed-in person's documents (owned and shared
 * with them). Returns a stop function. A refused join (no policy yet, or a
 * signed-out socket) just leaves this screen on local renames and refetches.
 */
export function subscribeDocumentRenames(supabase, userId) {
  if (!userId || typeof supabase?.channel !== 'function') return () => {};
  let stopped = false;
  const channel = supabase.channel(documentNamesTopic(userId), {
    config: { private: true, broadcast: { self: false, ack: false } },
  });
  channel.on('broadcast', { event: DOCUMENT_RENAMED_EVENT }, (message) => {
    if (stopped) return;
    // realtime.send() wraps the row as the message payload.
    applyDocumentRenameMessage(message?.payload);
  });
  channel.subscribe((status, error) => {
    if (stopped || status !== 'CHANNEL_ERROR') return;
    const refused = /unauthori|permission|forbidden|denied|not allowed/i
      .test(String(error?.message || error || ''));
    if (refused) {
      // No retry storm against the database: renames from elsewhere then
      // show on the next list read, as before.
      stopped = true;
      Promise.resolve().then(() => supabase.removeChannel?.(channel)).catch(() => {});
    }
  });
  return () => {
    if (stopped) return;
    stopped = true;
    Promise.resolve().then(() => supabase.removeChannel?.(channel)).catch(() => {});
  };
}
