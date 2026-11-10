/* Data for the Home extras (homeLibrary.js): your tags, when you last opened
   each document, and which of your documents you have shared. All three are
   yours alone (migration 20261110171000_home_library.sql). A copy is kept on
   the device so the list paints with them at once, then the server's answer
   replaces it. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase as defaultClient, isSupabaseAvailable } from '../supabaseClient';
import { subscribeLibraryChange } from '../hooks/libraryChangeBus.js';
import { hasTag } from './homeLibrary.js';
import { isFeatureOn } from '../featureFlags.js';

const OPENED_EVENT = 'survey:document-opened';
const cacheKey = (userId) => `survey.home.extras.${userId}`;

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function readCache(userId) {
  try {
    const parsed = JSON.parse(safeStorage()?.getItem(cacheKey(userId)) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      tags: new Map(Object.entries(parsed.tags || {})),
      opened: new Map(Object.entries(parsed.opened || {}).map(([id, ms]) => [id, Number(ms) || 0])),
      sharedByMe: new Set(Array.isArray(parsed.sharedByMe) ? parsed.sharedByMe : []),
    };
  } catch {
    return null;
  }
}

function writeCache(userId, state) {
  try {
    safeStorage()?.setItem(cacheKey(userId), JSON.stringify({
      tags: Object.fromEntries(state.tags),
      opened: Object.fromEntries(state.opened),
      sharedByMe: [...state.sharedByMe],
    }));
  } catch { /* full or private */ }
}

const EMPTY = { tags: new Map(), opened: new Map(), sharedByMe: new Set() };

/* Opening a document stamps its Last opened on the server, by the server's
   clock. The device shows its own time at once ("Just now") only until the
   server answers; then the server's time replaces it, so a device clock set
   ahead cannot pin a document to the top. Only while home-columns is on: with
   it off nothing reads Last opened, so nothing is written. A guest, a
   signed-out session or an offline device skips the server part. */
const pendingOpens = new Map(); // documentId -> device time, until the server answers
// documentId -> newest server time this page has heard. Server times only go
// forward, so an answer that comes back late (an older open, or a read that
// left before the write) never moves Last opened back.
const serverOpens = new Map();

export function recordDocumentOpened(documentId, { client = defaultClient, enabled } = {}) {
  if (!documentId || String(documentId).startsWith('temp-')) return;
  if (!(enabled ?? isFeatureOn('home-columns'))) return;
  const at = Date.now();
  const emit = (detail) => {
    try { globalThis.dispatchEvent?.(new CustomEvent(OPENED_EVENT, { detail })); } catch { /* no window */ }
  };
  if (!client?.rpc || !isSupabaseAvailable()) return;
  pendingOpens.set(documentId, at);
  emit({ documentId, at });
  Promise.resolve(client.rpc('mark_document_opened', { p_document_id: documentId }))
    .then((res) => {
      const newerPending = pendingOpens.has(documentId) && pendingOpens.get(documentId) !== at;
      if (!newerPending) pendingOpens.delete(documentId);
      if (res?.error) { console.warn('[home] mark opened failed:', res.error.message); return; }
      const serverAt = Date.parse(res?.data || '');
      if (!serverAt || serverAt < (serverOpens.get(documentId) || 0)) return;
      serverOpens.set(documentId, serverAt);
      // A later open of the same document is still out: it will answer.
      if (!newerPending) emit({ documentId, at: serverAt, server: true });
    })
    .catch(() => { if (pendingOpens.get(documentId) === at) pendingOpens.delete(documentId); });
}

export async function loadHomeExtras(client, { tags, opened, shared }) {
  const [tagRes, openRes, sharedRes] = await Promise.all([
    tags ? client.from('document_tags').select('document_id, tag').order('created_at', { ascending: true }).limit(2000) : null,
    opened ? client.from('document_opens').select('document_id, opened_at').limit(5000) : null,
    shared ? client.rpc('my_shared_document_ids') : null,
  ]);
  const out = {};
  if (tagRes && !tagRes.error) {
    const map = new Map();
    for (const row of tagRes.data || []) {
      const list = map.get(row.document_id) || [];
      if (!hasTag(list, row.tag)) list.push(row.tag);
      map.set(row.document_id, list);
    }
    out.tags = map;
  }
  if (openRes && !openRes.error) {
    out.opened = new Map((openRes.data || []).map((row) => [row.document_id, Date.parse(row.opened_at) || 0]));
  }
  if (sharedRes && !sharedRes.error) {
    out.sharedByMe = new Set((sharedRes.data || []).map((row) => (typeof row === 'string' ? row : row?.my_shared_document_ids || row?.id)).filter(Boolean));
  }
  return out;
}

/* The hook DocumentsLedger uses. Each part loads only when its flag is on. */
export function useHomeExtras({ userId, tags = false, opened = false, shared = false, client = defaultClient } = {}) {
  const enabled = Boolean(userId && (tags || opened || shared) && client && isSupabaseAvailable());
  const [state, setState] = useState(() => (enabled ? readCache(userId) || EMPTY : EMPTY));
  const stateRef = useRef(state);
  stateRef.current = state;
  const tagWrites = useRef(0);
  const staleTags = useRef(false);

  const commit = useCallback((next) => {
    stateRef.current = next;
    setState(next);
    if (userId) writeCache(userId, next);
  }, [userId]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const fresh = await loadHomeExtras(client, { tags, opened, shared });
      const cur = stateRef.current;
      // A document opened while the read was out (the server has not answered
      // yet) keeps its local time; every other time is the server's.
      let openedMap = fresh.opened || cur.opened;
      if (fresh.opened) {
        openedMap = new Map(fresh.opened);
        for (const [id, ms] of serverOpens) if ((openedMap.get(id) || 0) < ms) openedMap.set(id, ms);
        for (const [id, ms] of pendingOpens) if ((openedMap.get(id) || 0) < ms) openedMap.set(id, ms);
      }
      // While a tag write is out, the read may predate it: keep what is on
      // screen and read again once the writes are done.
      let nextTags = fresh.tags || cur.tags;
      if (tagWrites.current > 0) { nextTags = cur.tags; staleTags.current = true; }
      commit({ tags: nextTags, opened: openedMap, sharedByMe: fresh.sharedByMe || cur.sharedByMe });
    } catch (error) {
      console.warn('[home] extras load failed:', error?.message || error);
    }
  }, [client, commit, enabled, opened, shared, tags]);

  useEffect(() => {
    if (!enabled) return undefined;
    setState(readCache(userId) || EMPTY);
    reload();
    const off = subscribeLibraryChange(() => { reload(); });
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { off(); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, reload, userId]);

  useEffect(() => {
    if (!enabled || !opened) return undefined;
    const onOpened = (event) => {
      const { documentId, at } = event.detail || {};
      if (!documentId) return;
      const cur = stateRef.current;
      const next = new Map(cur.opened);
      next.set(documentId, at || Date.now());
      commit({ ...cur, opened: next });
    };
    window.addEventListener(OPENED_EVENT, onOpened);
    return () => window.removeEventListener(OPENED_EVENT, onOpened);
  }, [commit, enabled, opened]);

  /* Tag writes are counted so a reload that overlaps one cannot put back an
     older list (the read then waits for the last write). */
  const trackTagWrite = useCallback(async (write) => {
    tagWrites.current += 1;
    try {
      return await write();
    } finally {
      tagWrites.current -= 1;
      if (tagWrites.current === 0 && staleTags.current) { staleTags.current = false; reload(); }
    }
  }, [reload]);

  /* Add tags to one or many documents. Shown at once; a refused write (a
     document you lost access to) is taken back and reported. */
  const addTags = useCallback(async (docIds, newTags) => {
    if (!enabled || !docIds?.length || !newTags?.length) return true;
    const cur = stateRef.current;
    const map = new Map(cur.tags);
    const rows = [];
    for (const id of docIds) {
      const list = [...(map.get(id) || [])];
      for (const tag of newTags) {
        if (hasTag(list, tag)) continue;
        list.push(tag);
        rows.push({ user_id: userId, document_id: id, tag });
      }
      map.set(id, list);
    }
    if (!rows.length) return true;
    commit({ ...cur, tags: map });
    const { error } = await trackTagWrite(() => client.from('document_tags').upsert(rows, { onConflict: 'user_id,document_id,tag', ignoreDuplicates: true }));
    if (error) {
      console.warn('[home] add tag failed:', error.message);
      await reload();
      return false;
    }
    return true;
  }, [client, commit, enabled, reload, trackTagWrite, userId]);

  const removeTag = useCallback(async (docIds, tag) => {
    if (!enabled || !docIds?.length || !tag) return true;
    const cur = stateRef.current;
    const map = new Map(cur.tags);
    const key = tag.toLowerCase();
    const exact = new Set();
    for (const id of docIds) {
      const list = map.get(id) || [];
      for (const t of list) if (t.toLowerCase() === key) exact.add(t);
      const left = list.filter((t) => t.toLowerCase() !== key);
      if (left.length) map.set(id, left); else map.delete(id);
    }
    commit({ ...cur, tags: map });
    const { error } = await trackTagWrite(() => client.from('document_tags').delete().eq('user_id', userId).in('document_id', docIds).in('tag', [...exact].length ? [...exact] : [tag]));
    if (error) {
      console.warn('[home] remove tag failed:', error.message);
      await reload();
      return false;
    }
    return true;
  }, [client, commit, enabled, reload, trackTagWrite, userId]);

  return { enabled, tagsByDoc: state.tags, openedByDoc: state.opened, sharedByMeIds: state.sharedByMe, addTags, removeTag, reload };
}
