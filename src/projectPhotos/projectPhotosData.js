/* Data for the project Photos tab (projectPhotos.js has the rules). Reads and
   writes public.project_photos and public.project_photo_links (migration
   20261114120000_project_photos.sql) and the private `project-photos`
   bucket. Signed URLs are cached per path for most of their life. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase as defaultClient, isSupabaseAvailable } from '../supabaseClient';
import { normalizeMediaMime, preparePhotoForUpload } from '../services/surveyMediaService';
import {
  PHOTO_MAX_BYTES, PROJECT_PHOTOS_BUCKET, isUuid, markedPhotoPath, photoMimeAllowed, photoPath, shownPath,
} from './projectPhotos.js';

const PHOTO_COLUMNS = 'id, project_id, path, marked_path, width, height, bytes, caption, uploaded_by, created_at, marked_by, marked_at';
const SIGNED_SECONDS = 3600;
const urlCache = new Map(); // path -> { url, until }

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

/** Signed URLs for many paths in one call; cached until 5 minutes before expiry. */
export async function signPhotoUrls(paths, { client = defaultClient } = {}) {
  const now = Date.now();
  const out = new Map();
  const need = [];
  for (const p of new Set((paths || []).filter(Boolean))) {
    const hit = urlCache.get(p);
    if (hit && hit.until > now) out.set(p, hit.url);
    else need.push(p);
  }
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await client.storage.from(PROJECT_PHOTOS_BUCKET).createSignedUrls(chunk, SIGNED_SECONDS);
    if (error) continue;
    for (const row of data || []) {
      if (!row?.signedUrl || !row.path) continue;
      urlCache.set(row.path, { url: row.signedUrl, until: now + (SIGNED_SECONDS - 300) * 1000 });
      out.set(row.path, row.signedUrl);
    }
  }
  return out;
}

export function useProjectPhotos({ projectId, enabled = true, client = defaultClient } = {}) {
  const live = Boolean(enabled && isUuid(projectId) && client && isSupabaseAvailable());
  const [photos, setPhotos] = useState([]);
  const [links, setLinks] = useState([]); // { photo_id, item_id }
  const [urls, setUrls] = useState(() => new Map());
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  const signFor = useCallback(async (rows) => {
    const map = await signPhotoUrls(rows.map(shownPath), { client });
    setUrls((cur) => {
      const next = new Map(cur);
      for (const [k, v] of map) next.set(k, v);
      return next;
    });
  }, [client]);

  const reload = useCallback(async () => {
    if (!live) return;
    const forProject = projectId;
    const [ph, ln] = await Promise.all([
      client.from('project_photos').select(PHOTO_COLUMNS).eq('project_id', forProject)
        .order('created_at', { ascending: false }).limit(5000),
      client.from('project_photo_links').select('photo_id, item_id').eq('project_id', forProject).limit(20000),
    ]);
    if (projectRef.current !== forProject) return;
    if (ph.error) { setError(ph.error.message || 'load failed'); setLoading(false); return; }
    setError(null);
    setPhotos(ph.data || []);
    setLinks(ln.error ? [] : (ln.data || []));
    setLoading(false);
    signFor(ph.data || []);
  }, [client, live, projectId, signFor]);

  useEffect(() => {
    setPhotos([]); setLinks([]);
    if (!live) { setLoading(false); return undefined; }
    setLoading(true);
    reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live, reload]);

  /** Shrink (max edge per survey media rules, GPS stripped), upload, add the
     row; when itemId is given, link it too. Returns { photo } or { error }. */
  const add = useCallback(async (file, { itemId } = {}) => {
    if (!live) return { error: 'offline' };
    const mime0 = normalizeMediaMime(file?.type, file?.name);
    if (!String(mime0 || '').startsWith('image/')) return { error: `"${file?.name || 'That file'}" is not a photo.` };
    let prepared;
    try {
      prepared = await preparePhotoForUpload(file, mime0);
    } catch (e) {
      return { error: e?.message || 'This photo could not be read.' };
    }
    const { blob, mime, width, height } = prepared;
    if (!photoMimeAllowed(mime)) return { error: `"${file?.name || 'This photo'}" could not be read on this device. Try a JPEG or PNG.` };
    if (blob.size > PHOTO_MAX_BYTES) return { error: `"${file?.name || 'This photo'}" is over 10 MB.` };
    const id = newId();
    const path = photoPath(projectId, id, mime);
    const up = await client.storage.from(PROJECT_PHOTOS_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
    if (up.error) return { error: up.error.message || 'upload failed' };
    const { data, error: err } = await client.from('project_photos')
      .insert({ id, project_id: projectId, path, width: width || null, height: height || null, bytes: blob.size })
      .select(PHOTO_COLUMNS).single();
    if (err) {
      await client.storage.from(PROJECT_PHOTOS_BUCKET).remove([path]).catch(() => {});
      return { error: err.message || 'save failed' };
    }
    if (projectRef.current === projectId) {
      setPhotos((cur) => [data, ...cur.filter((p) => p.id !== data.id)]);
      // The blob is on hand: show it at once, no signed-URL round trip.
      try {
        const local = URL.createObjectURL(blob);
        setUrls((cur) => new Map(cur).set(path, local));
      } catch (_e) { signFor([data]); }
    }
    if (itemId) {
      const linked = await client.from('project_photo_links').insert({ photo_id: id, item_id: itemId, project_id: projectId });
      if (!linked.error) setLinks((cur) => [...cur, { photo_id: id, item_id: itemId }]);
    }
    return { photo: data };
  }, [client, live, projectId, signFor]);

  /** Save markup as a new marked copy (PNG blob), then drop the old copy. */
  const saveMarkup = useCallback(async (photoId, pngBlob) => {
    const before = photosRef.current.find((p) => p.id === photoId);
    if (!live || !before) return { error: 'offline' };
    const next = markedPhotoPath(projectId, photoId, before.marked_path);
    const up = await client.storage.from(PROJECT_PHOTOS_BUCKET).upload(next, pngBlob, { contentType: 'image/png', upsert: true });
    if (up.error) return { error: up.error.message || 'upload failed' };
    const { data, error: err } = await client.from('project_photos').update({ marked_path: next })
      .eq('id', photoId).select(PHOTO_COLUMNS).single();
    if (err) {
      await client.storage.from(PROJECT_PHOTOS_BUCKET).remove([next]).catch(() => {});
      return { error: err.message || 'save failed' };
    }
    if (before.marked_path && before.marked_path !== next) {
      client.storage.from(PROJECT_PHOTOS_BUCKET).remove([before.marked_path]).catch(() => {});
    }
    setPhotos((cur) => cur.map((p) => (p.id === photoId ? data : p)));
    try { setUrls((cur) => new Map(cur).set(next, URL.createObjectURL(pngBlob))); } catch (_e) { signFor([data]); }
    return { photo: data };
  }, [client, live, projectId, signFor]);

  /** Back to the clean photo (the original was never touched). */
  const clearMarkup = useCallback(async (photoId) => {
    const before = photosRef.current.find((p) => p.id === photoId);
    if (!live || !before?.marked_path) return { error: null };
    const { data, error: err } = await client.from('project_photos').update({ marked_path: null })
      .eq('id', photoId).select(PHOTO_COLUMNS).single();
    if (err) return { error: err.message || 'save failed' };
    client.storage.from(PROJECT_PHOTOS_BUCKET).remove([before.marked_path]).catch(() => {});
    setPhotos((cur) => cur.map((p) => (p.id === photoId ? data : p)));
    signFor([data]);
    return { photo: data };
  }, [client, live, signFor]);

  /** Delete rows first (links go with them), then their files. */
  const remove = useCallback(async (ids) => {
    if (!live || !ids?.length) return { error: null };
    const before = photosRef.current;
    const gone = before.filter((p) => ids.includes(p.id));
    setPhotos((cur) => cur.filter((p) => !ids.includes(p.id)));
    setLinks((cur) => cur.filter((l) => !ids.includes(l.photo_id)));
    const { data, error: err } = await client.from('project_photos').delete().in('id', ids).select('id');
    const deleted = new Set((data || []).map((r) => r.id));
    if (err || deleted.size !== ids.length) {
      await reload();
      if (deleted.size) {
        const files = gone.filter((p) => deleted.has(p.id)).flatMap((p) => [p.path, p.marked_path].filter(Boolean));
        if (files.length) client.storage.from(PROJECT_PHOTOS_BUCKET).remove(files).catch(() => {});
      }
      return { error: err?.message || 'Only the person who added a photo, or the project owner, can delete it.' };
    }
    const files = gone.flatMap((p) => [p.path, p.marked_path].filter(Boolean));
    if (files.length) client.storage.from(PROJECT_PHOTOS_BUCKET).remove(files).catch(() => {});
    return { error: null };
  }, [client, live, reload]);

  const link = useCallback(async (photoIds, itemId) => {
    if (!live || !itemId) return { error: null };
    const have = new Set(links.filter((l) => l.item_id === itemId).map((l) => l.photo_id));
    const add2 = (photoIds || []).filter((id) => !have.has(id));
    if (!add2.length) return { error: null };
    setLinks((cur) => [...cur, ...add2.map((photo_id) => ({ photo_id, item_id: itemId }))]);
    const { error: err } = await client.from('project_photo_links')
      .insert(add2.map((photo_id) => ({ photo_id, item_id: itemId, project_id: projectId })));
    if (err) { setLinks((cur) => cur.filter((l) => !(l.item_id === itemId && add2.includes(l.photo_id)))); return { error: err.message }; }
    return { error: null };
  }, [client, links, live, projectId]);

  const unlink = useCallback(async (photoId, itemId) => {
    if (!live) return { error: null };
    setLinks((cur) => cur.filter((l) => !(l.photo_id === photoId && l.item_id === itemId)));
    const { error: err } = await client.from('project_photo_links').delete().eq('photo_id', photoId).eq('item_id', itemId);
    if (err) { setLinks((cur) => [...cur, { photo_id: photoId, item_id: itemId }]); return { error: err.message }; }
    return { error: null };
  }, [client, live]);

  return { live, photos, links, urls, loading, error, reload, add, saveMarkup, clearMarkup, remove, link, unlink };
}

/** Fetch a photo's bytes (for download / zip). */
export async function downloadPhotoBlob(path, { client = defaultClient } = {}) {
  const { data, error } = await client.storage.from(PROJECT_PHOTOS_BUCKET).download(path);
  return error ? { error: error.message } : { blob: data };
}
