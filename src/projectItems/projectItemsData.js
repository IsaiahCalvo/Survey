/* Data for Projects Issues and Tasks (projectItems.js has the rules). Reads
   and writes public.project_items and its events and comments (migration
   20261110172000_project_items.sql). Writes show at once and are taken back
   when the server refuses them. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase as defaultClient, isSupabaseAvailable } from '../supabaseClient';
import { duplicateFields } from './projectItems.js';

const ITEM_COLUMNS = 'id, project_id, kind, number, title, description, status, assignee_id, due_date, tags, links, created_by, created_at, updated_at, archived_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useProjectItems({ projectId, enabled = true, client = defaultClient } = {}) {
  const live = Boolean(enabled && projectId && UUID_RE.test(String(projectId)) && client && isSupabaseAvailable());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  const reload = useCallback(async () => {
    if (!live) return;
    const forProject = projectId;
    const { data, error: err } = await client.from('project_items').select(ITEM_COLUMNS)
      .eq('project_id', forProject).order('number', { ascending: false }).limit(5000);
    if (projectRef.current !== forProject) return;
    if (err) { setError(err.message || 'load failed'); setLoading(false); return; }
    setError(null);
    setItems(data || []);
    setLoading(false);
  }, [client, live, projectId]);

  useEffect(() => {
    setItems([]);
    if (!live) { setLoading(false); return undefined; }
    setLoading(true);
    reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live, reload]);

  const create = useCallback(async (kind, fields = {}) => {
    if (!live) return { error: 'offline' };
    const { data, error: err } = await client.from('project_items')
      .insert({ project_id: projectId, kind, title: '', ...fields })
      .select(ITEM_COLUMNS).single();
    if (err) return { error: err.message || 'create failed' };
    setItems((cur) => [data, ...cur.filter((i) => i.id !== data.id)]);
    return { item: data };
  }, [client, live, projectId]);

  // Each field remembers the newest save that touched it. A save that comes
  // back late only writes back the fields no newer save has touched, so
  // quick edits to the summary, status, assignee and so on never undo each
  // other on screen.
  const fieldSaves = useRef(new Map()); // `${id}:${field}` -> save number
  const saveSeq = useRef(0);
  const saveChains = useRef(new Map()); // item id -> the last save's promise
  // `patch` may be a function of the item as it stands now (with every
  // earlier unsaved change in it): two quick edits to one list, such as tags
  // or links, then build on each other instead of the later one writing the
  // earlier value back.
  const update = useCallback(async (id, patchArg) => {
    if (!live) return { error: 'offline' };
    const before = itemsRef.current.find((i) => i.id === id);
    const patch = typeof patchArg === 'function' ? patchArg(before || {}) : patchArg;
    if (!patch || !Object.keys(patch).length) return { error: null };
    const seq = ++saveSeq.current;
    const fields = Object.keys(patch);
    for (const f of fields) fieldSaves.current.set(`${id}:${f}`, seq);
    // The ref moves at once, so a second edit before the next render sees this one.
    itemsRef.current = itemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i));
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    // One item's saves go to the server one after another: two in flight at
    // once can land out of order, and the older list would win.
    const prior = saveChains.current.get(id) || Promise.resolve();
    const sent = prior.then(() => client.from('project_items').update(patch).eq('id', id).select(ITEM_COLUMNS).single());
    const settled = sent.then(() => undefined, () => undefined);
    saveChains.current.set(id, settled);
    settled.then(() => { if (saveChains.current.get(id) === settled) saveChains.current.delete(id); });
    const { data, error: err } = await sent.catch((e) => ({ data: null, error: e }));
    const mine = fields.filter((f) => fieldSaves.current.get(`${id}:${f}`) === seq);
    for (const f of mine) fieldSaves.current.delete(`${id}:${f}`);
    if (err) {
      if (before) {
        setItems((cur) => cur.map((i) => {
          if (i.id !== id) return i;
          const back = { ...i };
          for (const f of mine) back[f] = before[f];
          return back;
        }));
      }
      return { error: err.message || 'save failed' };
    }
    setItems((cur) => cur.map((i) => {
      if (i.id !== id) return i;
      // updated_at only moves forward: a slow, older save never rewinds it.
      const newer = !i.updated_at || (data.updated_at && Date.parse(data.updated_at) > Date.parse(i.updated_at));
      const next = { ...i, updated_at: newer ? data.updated_at : i.updated_at };
      for (const f of mine) next[f] = data[f];
      return next;
    }));
    return { item: data };
  }, [client, live]);

  const setArchived = useCallback(async (ids, archived) => {
    if (!live || !ids?.length) return { error: null };
    const stamp = archived ? new Date().toISOString() : null;
    const before = new Map(itemsRef.current.filter((i) => ids.includes(i.id)).map((i) => [i.id, i]));
    setItems((cur) => cur.map((i) => (ids.includes(i.id) ? { ...i, archived_at: stamp } : i)));
    const { error: err } = await client.from('project_items').update({ archived_at: stamp }).in('id', ids);
    if (err) {
      setItems((cur) => cur.map((i) => before.get(i.id) || i));
      return { error: err.message || 'archive failed' };
    }
    return { error: null };
  }, [client, live]);

  const remove = useCallback(async (ids) => {
    if (!live || !ids?.length) return { error: null };
    const before = itemsRef.current;
    setItems((cur) => cur.filter((i) => !ids.includes(i.id)));
    const { data, error: err } = await client.from('project_items').delete().in('id', ids).select('id');
    if (err || (data || []).length !== ids.length) {
      setItems(before);
      await reload();
      return { error: err?.message || 'Only the project owner can delete, and only archived items.' };
    }
    return { error: null };
  }, [client, live, reload]);

  const duplicate = useCallback(async (item) => create(item.kind, duplicateFields(item)), [create]);

  return {
    live, items, loading, error, reload, create, update, remove, duplicate,
    archive: (ids) => setArchived(ids, true),
    unarchive: (ids) => setArchived(ids, false),
  };
}

export async function loadItemEvents(itemId, { client = defaultClient } = {}) {
  const { data, error } = await client.from('project_item_events')
    .select('id, actor_id, action, from_value, to_value, created_at')
    .eq('item_id', itemId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200);
  return error ? { error: error.message, events: [] } : { events: data || [] };
}

export async function loadItemComments(itemId, { client = defaultClient } = {}) {
  const { data, error } = await client.from('project_item_comments')
    .select('id, author_id, body, created_at')
    .eq('item_id', itemId).order('created_at', { ascending: true }).limit(500);
  return error ? { error: error.message, comments: [] } : { comments: data || [] };
}

export async function addItemComment(itemId, body, { client = defaultClient } = {}) {
  const { data, error } = await client.from('project_item_comments')
    .insert({ item_id: itemId, body })
    .select('id, author_id, body, created_at').single();
  return error ? { error: error.message } : { comment: data };
}

export async function deleteItemComment(commentId, { client = defaultClient } = {}) {
  const { error } = await client.from('project_item_comments').delete().eq('id', commentId);
  return { error: error?.message || null };
}

/* The newest comment of every item in a project, for the register's "Most
   recent comment" column. */
export async function loadLatestComments(projectId, { client = defaultClient } = {}) {
  const { data, error } = await client.from('project_item_comments')
    .select('item_id, body, created_at')
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(5000);
  const map = new Map();
  if (!error) for (const row of data || []) if (!map.has(row.item_id)) map.set(row.item_id, row.body);
  return map;
}

/* "Assigned to you" email (Nightly 'item-assign-email'): ask the server to
   email the item's new assignee. The server reads who assigned whom from the
   item's activity log, so the request carries only the item id. Best effort:
   a failed send never blocks or undoes the assignment. */
export async function notifyItemAssignee(itemId, { client = defaultClient } = {}) {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { data, error } = await client.functions.invoke('notify-comment-mentions', { body: { itemId, origin } });
    if (error) return { sent: 0, error: error.message || String(error) };
    return { sent: Number(data?.sent) || 0, reason: data?.reason || null };
  } catch (err) {
    return { sent: 0, error: err?.message || String(err) };
  }
}
