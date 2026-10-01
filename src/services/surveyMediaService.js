/**
 * surveyMediaService.js — Survey Marker media (photos, videos, audio) as real
 * files in the private `survey-media` Storage bucket.
 *
 * Contract: scratch MEDIA-CONTRACT.md (owner approval 2026-10-01). Bucket and
 * policies: supabase/proposed/20261001_survey_media_bucket.sql — until that is
 * applied every upload fails with "Media storage isn't set up yet".
 *
 * Notes keep their text where they are today; media lives in `note.media` as
 * MediaRef[] (no base64):
 *   { id, kind: 'photo'|'video'|'audio', mime, path, name, size,
 *     durationMs?, width?, height?, createdBy, createdAt }
 * Older notes carry inline base64 in `note.photos[]` / `note.videos[]`
 * ({ name, dataUrl }). normalizeNoteMedia reads both; legacy items come back as
 * { id, kind, mime, name, size, legacyDataUrl } (no path).
 * migrateLegacyNoteMedia uploads those once and returns a note without them.
 *
 * Object name: `{document_id}/{marker_id}/{media_id}.{ext}`.
 */
import { supabase } from '../supabaseClient.js';

export const SURVEY_MEDIA_BUCKET = 'survey-media';
export const SURVEY_MEDIA_LIMITS = {
  photoMaxEdge: 2560,
  videoMaxBytes: 50 * 1024 * 1024,
  audioMaxBytes: 25 * 1024 * 1024,
  // A photo that cannot be re-encoded here (e.g. HEIC on desktop Chromium) is
  // uploaded as-is; this caps that case.
  photoMaxBytes: 25 * 1024 * 1024,
};

export const SURVEY_MEDIA_NOT_SET_UP_MESSAGE = "Media storage isn't set up yet.";

// Must match allowed_mime_types in the proposed bucket migration.
export const SURVEY_MEDIA_ALLOWED_MIME_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm',
  'audio/ogg', 'audio/wav', 'audio/x-wav',
]);
const ALLOWED = new Set(SURVEY_MEDIA_ALLOWED_MIME_TYPES);

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;
const PHOTO_JPEG_QUALITY = 0.85;
const REMOVE_CHUNK = 100;

export class SurveyMediaError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'SurveyMediaError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Test seams (node tests have no Supabase client and no canvas).
// ---------------------------------------------------------------------------
let clientOverride = null;
let imageToolsOverride = null;
export function __setSurveyMediaClientForTests(client) {
  clientOverride = client || null;
  signedUrlCache.clear();
}
export function __setSurveyMediaImageToolsForTests(tools) {
  imageToolsOverride = tools || null;
}
const getClient = () => clientOverride || supabase;

// ---------------------------------------------------------------------------
// Types and classification
// ---------------------------------------------------------------------------
const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heif',
  'video/x-m4v': 'video/mp4',
  'audio/m4a': 'audio/x-m4a',
  'audio/x-mp4': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/mpeg3': 'audio/mpeg',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-aac': 'audio/aac',
  'audio/opus': 'audio/ogg',
};

const EXTENSION_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  m4a: 'audio/x-m4a', aac: 'audio/aac', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', wav: 'audio/wav', weba: 'audio/webm',
};

const MIME_EXTENSION = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};

const fileExtension = (name) => {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
};

/** `audio/webm;codecs=opus` -> `audio/webm`; aliases folded; '' when unknown. */
export function normalizeMediaMime(type, name) {
  let mime = String(type || '').split(';')[0].trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream') mime = EXTENSION_MIME[fileExtension(name)] || '';
  return MIME_ALIASES[mime] || mime;
}

// Photos we can decode get re-encoded as JPEG, so a few non-bucket image types
// are still acceptable inputs.
const CONVERTIBLE_PHOTO_TYPES = new Set(['image/gif', 'image/bmp', 'image/avif']);

/** -> 'photo' | 'video' | 'audio' | null (null = not something we can store). */
export function classifyMediaFile(file) {
  if (!file) return null;
  const mime = normalizeMediaMime(file.type, file.name);
  if (!mime) return null;
  if (mime.startsWith('image/')) {
    return ALLOWED.has(mime) || CONVERTIBLE_PHOTO_TYPES.has(mime) ? 'photo' : null;
  }
  if (mime.startsWith('video/')) return ALLOWED.has(mime) ? 'video' : null;
  if (mime.startsWith('audio/')) return ALLOWED.has(mime) ? 'audio' : null;
  return null;
}

const formatMb = (bytes) => {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
};

/**
 * Size limits, enforced before any upload. Returns null when the file fits,
 * else a SurveyMediaError with a sentence the UI can show as-is.
 */
export function checkSurveyMediaLimits({ kind, size, name }) {
  const bytes = Number(size) || 0;
  const label = name ? `"${name}"` : `This ${kind}`;
  if (bytes <= 0) return new SurveyMediaError(`${label} is empty.`, 'empty-file');
  const max = kind === 'video' ? SURVEY_MEDIA_LIMITS.videoMaxBytes
    : kind === 'audio' ? SURVEY_MEDIA_LIMITS.audioMaxBytes
      : SURVEY_MEDIA_LIMITS.photoMaxBytes;
  if (bytes > max) {
    const noun = kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audio recordings' : 'Photos';
    return new SurveyMediaError(
      `${label} is ${formatMb(bytes)}. ${noun} can be up to ${formatMb(max)}.`,
      'too-large',
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Notes: old base64 entries and new refs
// ---------------------------------------------------------------------------
const LEGACY_FIELDS = [['photos', 'photo'], ['videos', 'video']];

const parseNote = (note) => {
  if (note && typeof note === 'object') return note;
  // document_annotations.notes is TEXT; an object round-trips as JSON text.
  if (typeof note === 'string' && note.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(note);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const dataUrlMime = (dataUrl) => {
  const match = /^data:([^;,]+)[;,]/i.exec(String(dataUrl || ''));
  return match ? normalizeMediaMime(match[1]) : '';
};

const dataUrlByteLength = (dataUrl) => {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (comma < 0) return 0;
  if (!/;base64$/i.test(text.slice(0, comma))) return text.length - comma - 1;
  const b64 = text.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
};

const legacyItemDataUrl = (item) => {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return null;
  for (const key of ['dataUrl', 'url', 'src']) {
    if (typeof item[key] === 'string' && item[key]) return item[key];
  }
  return null;
};

const isMediaRef = (item) => Boolean(item && typeof item === 'object' && typeof item.path === 'string' && item.path);

/**
 * Every media item on a note, oldest first: legacy inline photos/videos, then
 * stored refs from `note.media`. Accepts null, plain-text notes and notes
 * serialized as JSON text.
 */
export function normalizeNoteMedia(note) {
  const source = parseNote(note);
  if (!source) return [];
  const out = [];
  const seen = new Set();
  for (const [field, kind] of LEGACY_FIELDS) {
    const list = Array.isArray(source[field]) ? source[field] : [];
    list.forEach((item, index) => {
      const dataUrl = legacyItemDataUrl(item);
      // A cache stub (saveSurveyMarkers dropped the bytes) still shows up, as unavailable.
      const omitted = Boolean(item && typeof item === 'object' && item.cacheOmitted);
      if (!dataUrl && !omitted) return;
      const id = `legacy-${kind}-${index}`;
      seen.add(id);
      out.push({
        id,
        kind,
        mime: dataUrl ? (dataUrlMime(dataUrl) || (kind === 'photo' ? 'image/jpeg' : 'video/mp4')) : '',
        name: (item && typeof item === 'object' && item.name) || `${kind === 'photo' ? 'Photo' : 'Video'} ${index + 1}`,
        size: dataUrl ? dataUrlByteLength(dataUrl) : 0,
        legacyDataUrl: dataUrl || null,
        ...(omitted && !dataUrl ? { unavailable: true } : {}),
      });
    });
  }
  const refs = Array.isArray(source.media) ? source.media : [];
  for (const ref of refs) {
    if (!isMediaRef(ref)) continue;
    const id = String(ref.id || ref.path);
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = ['photo', 'video', 'audio'].includes(ref.kind) ? ref.kind : classifyMediaFile({ type: ref.mime, name: ref.path }) || 'photo';
    out.push({ ...ref, id, kind });
  }
  return out;
}

/** True when the note still carries inline base64 media that should be uploaded. */
export function noteHasLegacyMedia(note) {
  return normalizeNoteMedia(note).some((item) => !item.path && typeof item.legacyDataUrl === 'string' && item.legacyDataUrl.startsWith('data:'));
}

const REF_FIELDS = ['id', 'kind', 'mime', 'path', 'name', 'size', 'durationMs', 'width', 'height', 'createdBy', 'createdAt'];
const toStoredRef = (ref) => {
  const stored = {};
  for (const key of REF_FIELDS) {
    if (ref[key] !== undefined && ref[key] !== null) stored[key] = ref[key];
  }
  return stored;
};

/**
 * The note to save for an edited media list (what normalizeNoteMedia returned,
 * with items added/removed/reordered). Refs go to `note.media` (stripped of
 * anything transient such as signed URLs); legacy items that are still
 * un-migrated go back to `photos` / `videos` unchanged. Never adds base64:
 * an item is written as legacy only if it already was legacy.
 */
export function buildNoteWithMedia(note, mediaList) {
  const base = parseNote(note) || (typeof note === 'string' ? { text: note } : {});
  const next = { ...base };
  const refs = [];
  const legacy = { photos: [], videos: [] };
  for (const item of mediaList || []) {
    if (isMediaRef(item)) refs.push(toStoredRef(item));
    else if (item && (typeof item.legacyDataUrl === 'string' || item.unavailable)) {
      const field = item.kind === 'video' ? 'videos' : 'photos';
      legacy[field].push(item.unavailable && !item.legacyDataUrl
        ? { name: item.name, dataUrl: null, cacheOmitted: true }
        : { name: item.name, dataUrl: item.legacyDataUrl });
    }
  }
  next.media = refs;
  for (const field of ['photos', 'videos']) {
    if (legacy[field].length) next[field] = legacy[field];
    else delete next[field];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Paths and ids
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marker ids become one path segment of [A-Za-z0-9_-] (max 128), as the bucket policy requires. */
export function sanitizeMarkerSegment(markerId) {
  const cleaned = String(markerId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return cleaned || 'marker';
}

export function buildSurveyMediaPath({ documentId, markerId, mediaId, mime }) {
  const ext = MIME_EXTENSION[mime] || 'bin';
  return `${String(documentId).toLowerCase()}/${sanitizeMarkerSegment(markerId)}/${String(mediaId).toLowerCase()}.${ext}`;
}

const newMediaId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new SurveyMediaError('This device cannot create media ids (crypto.randomUUID is missing).', 'unsupported-device');
};

// Content-derived id for legacy migration: two editors (or a retry) migrating
// the same base64 land on the same object instead of a duplicate.
async function contentMediaId(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // name-based (v5-style) marker
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Errors from Storage
// ---------------------------------------------------------------------------
export function describeSurveyMediaStorageError(error, { action = 'upload', name } = {}) {
  if (error instanceof SurveyMediaError) return error;
  const message = String(error?.message || error?.error || error || '');
  const status = String(error?.statusCode || error?.status || '');
  const what = name ? `"${name}"` : 'this file';
  if (/bucket not found/i.test(message) || (status === '404' && /bucket/i.test(message))) {
    return new SurveyMediaError(SURVEY_MEDIA_NOT_SET_UP_MESSAGE, 'not-set-up', error);
  }
  if (/quota exceeded/i.test(message)) {
    return new SurveyMediaError('Your storage is full. Free up space or upgrade your plan to add more media.', 'quota', error);
  }
  if (/maximum allowed size|payload too large|entity too large/i.test(message) || status === '413') {
    return new SurveyMediaError(`${what} is larger than media storage allows.`, 'too-large', error);
  }
  if (/mime type|invalid_mime_type|not supported/i.test(message) || status === '415') {
    return new SurveyMediaError(`${what} is not a supported photo, video or audio type.`, 'unsupported-type', error);
  }
  if (/already exists|duplicate/i.test(message) || status === '409') {
    return new SurveyMediaError(`${what} is already stored.`, 'exists', error);
  }
  if (/row-level security|unauthori[sz]ed|not authori[sz]ed|permission/i.test(message) || status === '403' || status === '401') {
    const verb = action === 'delete' ? 'remove media from' : action === 'read' ? 'view media on' : 'add media to';
    return new SurveyMediaError(`You don't have permission to ${verb} this document.`, 'forbidden', error);
  }
  if (/not found/i.test(message) || status === '404') {
    return new SurveyMediaError(`${what} could not be found in media storage.`, 'not-found', error);
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return new SurveyMediaError(`Couldn't reach media storage. Check your connection and try again.`, 'network', error);
  }
  const verb = action === 'delete' ? 'remove' : action === 'read' ? 'open' : 'upload';
  return new SurveyMediaError(`Couldn't ${verb} ${what}${message ? `: ${message}` : '.'}`, `${verb}-failed`, error);
}

// ---------------------------------------------------------------------------
// Photo preparation (browser only; node tests inject tools)
// ---------------------------------------------------------------------------
const browserImageTools = {
  async decode(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch { /* fall through to <img> */ }
    }
    if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    } finally {
      // An <img> keeps its decoded pixels after the URL is revoked.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  },
  async encodeJpeg(image, width, height, quality) {
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
    else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    } else return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  },
};

const imageSize = (image) => ({
  width: Number(image?.width || image?.naturalWidth || 0),
  height: Number(image?.height || image?.naturalHeight || 0),
});

const KEEP_AS_IS_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Downscale to `photoMaxEdge` JPEG unless already small. "Small" = longest
 * edge within the limit AND a type every viewer can show (JPEG/PNG/WebP);
 * HEIC/HEIF/GIF/etc. are re-encoded when this device can decode them. If it
 * cannot (HEIC on desktop Chromium), the original is kept when the bucket
 * accepts its type. Re-encoding also drops EXIF (incl. GPS).
 * -> { blob, mime, width?, height? }
 */
export async function preparePhotoForUpload(file, mime) {
  const tools = imageToolsOverride || browserImageTools;
  let image = null;
  try {
    image = await tools.decode(file);
  } catch {
    image = null;
  }
  const { width, height } = imageSize(image);
  const longest = Math.max(width, height);
  const maxEdge = SURVEY_MEDIA_LIMITS.photoMaxEdge;
  try {
    if (image && longest > 0) {
      if (longest <= maxEdge && KEEP_AS_IS_PHOTO_TYPES.has(mime)) {
        return { blob: file, mime, width, height };
      }
      const scale = Math.min(1, maxEdge / longest);
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));
      const jpeg = await tools.encodeJpeg(image, outW, outH, PHOTO_JPEG_QUALITY);
      if (jpeg && jpeg.size > 0) return { blob: jpeg, mime: 'image/jpeg', width: outW, height: outH };
    }
  } finally {
    try { image?.close?.(); } catch { /* ImageBitmap only */ }
  }
  if (!ALLOWED.has(mime)) {
    throw new SurveyMediaError(`"${file?.name || 'This photo'}" could not be read on this device. Try a JPEG or PNG.`, 'unsupported-type');
  }
  return { blob: file, mime, ...(longest > 0 ? { width, height } : {}) };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
async function currentUserId(client) {
  try {
    const { data } = await client.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

async function accessToken(client) {
  try {
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

// Upload with real progress events. supabase-js has no progress callback, so
// when one is asked for (and this is a browser) the same POST the SDK makes
// goes through XMLHttpRequest. Anything missing -> SDK upload.
async function uploadWithProgress(client, path, blob, mime, onProgress) {
  const storageUrl = client?.storage?.url || (client?.storageUrl ? String(client.storageUrl) : '');
  const apiKey = client?.supabaseKey;
  const token = await accessToken(client);
  if (typeof XMLHttpRequest === 'undefined' || typeof FormData === 'undefined' || !storageUrl || !apiKey || !token) {
    return null;
  }
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${storageUrl}/object/${SURVEY_MEDIA_BUCKET}/${path}`);
    xhr.setRequestHeader('apikey', apiKey);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(0.99, event.loaded / event.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ error: null });
      let body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ }
      resolve({ error: { message: body.message || body.error || `HTTP ${xhr.status}`, statusCode: String(body.statusCode || xhr.status), status: xhr.status } });
    };
    xhr.onerror = () => resolve({ error: { message: 'Failed to fetch (network error)' } });
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', blob);
    xhr.send(form);
  });
}

async function putObject(client, path, blob, mime, onProgress) {
  // The SDK posts a Blob as multipart; the part's type is the Blob's own type,
  // so make sure it carries the (normalized) contentType.
  const body = blob.type === mime ? blob : new Blob([blob], { type: mime });
  if (typeof onProgress === 'function') {
    const viaXhr = await uploadWithProgress(client, path, body, mime, onProgress);
    if (viaXhr) return viaXhr;
  }
  return client.storage.from(SURVEY_MEDIA_BUCKET).upload(path, body, {
    contentType: mime,
    upsert: false,
    cacheControl: '3600',
  });
}

/**
 * Upload one file for a Survey Marker. -> MediaRef.
 * Throws SurveyMediaError with a user-facing message (`code` says why:
 * 'not-set-up', 'no-document', 'unsupported-type', 'too-large', 'quota',
 * 'forbidden', 'network', 'upload-failed').
 */
export async function uploadSurveyMedia({ documentId, markerId, file, kind, durationMs, onProgress, mediaId, _allowExisting = false } = {}) {
  const client = getClient();
  if (!client?.storage) {
    throw new SurveyMediaError('Media needs a connection to your account. Sign in and try again.', 'offline');
  }
  if (!documentId || !UUID_RE.test(String(documentId))) {
    throw new SurveyMediaError('Save this document to your account before adding media.', 'no-document');
  }
  if (!markerId) throw new SurveyMediaError('Pick a Survey Marker before adding media.', 'no-marker');
  if (!file || typeof file.size !== 'number') throw new SurveyMediaError('No file to upload.', 'empty-file');

  const resolvedKind = kind || classifyMediaFile(file);
  const inputMime = normalizeMediaMime(file.type, file.name)
    || (resolvedKind === 'audio' ? 'audio/mp4' : resolvedKind === 'video' ? 'video/mp4' : '');
  if (!resolvedKind || !['photo', 'video', 'audio'].includes(resolvedKind)) {
    throw new SurveyMediaError(`"${file.name || 'This file'}" is not a photo, video or audio recording.`, 'unsupported-type');
  }
  const name = file.name || `${resolvedKind}-${new Date().toISOString().slice(0, 10)}`;

  // Cheap checks first (before decoding a photo or touching the network).
  if (resolvedKind !== 'photo') {
    if (!ALLOWED.has(inputMime)) {
      throw new SurveyMediaError(`"${name}" is not a supported ${resolvedKind} type.`, 'unsupported-type');
    }
    const limitError = checkSurveyMediaLimits({ kind: resolvedKind, size: file.size, name });
    if (limitError) throw limitError;
  } else if (file.size <= 0) {
    throw checkSurveyMediaLimits({ kind: 'photo', size: 0, name });
  }

  onProgress?.(0);
  let blob = file;
  let mime = inputMime;
  let dims = {};
  if (resolvedKind === 'photo') {
    const prepared = await preparePhotoForUpload(file, inputMime);
    blob = prepared.blob;
    mime = prepared.mime;
    if (prepared.width && prepared.height) dims = { width: prepared.width, height: prepared.height };
    const limitError = checkSurveyMediaLimits({ kind: 'photo', size: blob.size, name });
    if (limitError) throw limitError;
  }

  const id = mediaId || newMediaId();
  const path = buildSurveyMediaPath({ documentId, markerId, mediaId: id, mime });
  let result;
  try {
    result = await putObject(client, path, blob, mime, onProgress);
  } catch (err) {
    throw describeSurveyMediaStorageError(err, { action: 'upload', name });
  }
  if (result?.error) {
    const described = describeSurveyMediaStorageError(result.error, { action: 'upload', name });
    if (!(_allowExisting && described.code === 'exists')) throw described;
  }
  onProgress?.(1);

  const createdBy = await currentUserId(client);
  const ref = {
    id,
    kind: resolvedKind,
    mime,
    path,
    name,
    size: blob.size,
    ...(resolvedKind !== 'photo' && Number(durationMs) > 0 ? { durationMs: Math.round(Number(durationMs)) } : {}),
    ...dims,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  return ref;
}

// ---------------------------------------------------------------------------
// Read (signed URLs) and delete
// ---------------------------------------------------------------------------
const signedUrlCache = new Map(); // path -> { url, expiresAt } | { promise }

/** Signed URL for a ref (cached ~50 min), or the legacy data URL. */
export async function getSurveyMediaUrl(ref) {
  if (!ref) return null;
  if (!ref.path) return typeof ref.legacyDataUrl === 'string' ? ref.legacyDataUrl : null;
  const now = Date.now();
  const cached = signedUrlCache.get(ref.path);
  if (cached?.url && cached.expiresAt > now) return cached.url;
  if (cached?.promise) return cached.promise;
  const client = getClient();
  if (!client?.storage) throw new SurveyMediaError('Media needs a connection to your account.', 'offline');
  const promise = (async () => {
    let response;
    try {
      response = await client.storage.from(SURVEY_MEDIA_BUCKET).createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
    } catch (err) {
      throw describeSurveyMediaStorageError(err, { action: 'read', name: ref.name });
    }
    const url = response?.data?.signedUrl;
    if (response?.error || !url) {
      throw describeSurveyMediaStorageError(response?.error || 'No signed URL returned', { action: 'read', name: ref.name });
    }
    signedUrlCache.set(ref.path, { url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
    return url;
  })();
  signedUrlCache.set(ref.path, { promise });
  try {
    return await promise;
  } catch (err) {
    signedUrlCache.delete(ref.path);
    throw err;
  }
}

/** Remove a stored media object. No-op (true) for legacy inline items. */
export async function deleteSurveyMedia(ref) {
  if (!ref?.path) return true;
  signedUrlCache.delete(ref.path);
  const client = getClient();
  if (!client?.storage) throw new SurveyMediaError('Media needs a connection to your account.', 'offline');
  let response;
  try {
    response = await client.storage.from(SURVEY_MEDIA_BUCKET).remove([ref.path]);
  } catch (err) {
    throw describeSurveyMediaStorageError(err, { action: 'delete', name: ref.name });
  }
  if (response?.error) {
    const described = describeSurveyMediaStorageError(response.error, { action: 'delete', name: ref.name });
    if (described.code !== 'not-found') throw described;
  }
  return true;
}

/**
 * Best-effort clean-up for "delete forever": remove every media object of the
 * document that this user may delete (their own uploads; all of it while the
 * document row still exists and they own it). Never throws. Media other
 * people uploaded to an already-purged document is left for the server-side
 * orphan sweep (public.list_orphaned_survey_media).
 */
export async function removeSurveyMediaForDocument(documentId) {
  const client = getClient();
  if (!client?.storage || !documentId) return { removed: 0 };
  const bucket = client.storage.from(SURVEY_MEDIA_BUCKET);
  try {
    const paths = [];
    const { data: folders, error } = await bucket.list(String(documentId), { limit: 1000 });
    if (error) return { removed: 0, error };
    for (const folder of folders || []) {
      // Folders come back with id null; files directly under the document (none expected) have an id.
      const prefix = `${documentId}/${folder.name}`;
      if (folder.id) {
        paths.push(prefix);
        continue;
      }
      const { data: files } = await bucket.list(prefix, { limit: 1000 });
      for (const file of files || []) if (file?.name) paths.push(`${prefix}/${file.name}`);
    }
    let removed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const chunk = paths.slice(i, i + REMOVE_CHUNK);
      const { data, error: removeError } = await bucket.remove(chunk);
      if (!removeError) removed += Array.isArray(data) ? data.length : 0;
      chunk.forEach((path) => signedUrlCache.delete(path));
    }
    return { removed };
  } catch (error) {
    return { removed: 0, error };
  }
}

// ---------------------------------------------------------------------------
// Legacy base64 -> stored refs
// ---------------------------------------------------------------------------
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  const header = dataUrl.slice(5, comma);
  const mime = normalizeMediaMime(header.split(';')[0]);
  const payload = dataUrl.slice(comma + 1);
  let bytes;
  if (/;base64/i.test(header)) {
    const binary = globalThis.atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  return { blob: new Blob([bytes], { type: mime }), bytes, mime };
}

const withFileName = (blob, name, mime) => {
  if (typeof File === 'function') return new File([blob], name, { type: mime });
  const copy = new Blob([blob], { type: mime });
  Object.defineProperty(copy, 'name', { value: name });
  return copy;
};

/**
 * Upload a note's legacy inline photos/videos once and return the note with
 * refs in `note.media` and the base64 gone. Returns the SAME note object when
 * there is nothing to migrate (so callers can skip the write). Items that fail
 * to upload stay inline; if every item fails, the first error is thrown (e.g.
 * 'not-set-up' before the bucket exists) and nothing changes.
 * Uploads use content-derived ids, so a retry or a second editor migrating the
 * same note reuses the object instead of duplicating it.
 */
export async function migrateLegacyNoteMedia({ documentId, markerId, note } = {}) {
  const items = normalizeNoteMedia(note);
  const pending = items.filter((item) => !item.path && typeof item.legacyDataUrl === 'string' && item.legacyDataUrl.startsWith('data:'));
  if (!pending.length) return note;

  const migrated = new Map(); // legacy id -> ref
  let firstError = null;
  for (const item of pending) {
    try {
      const decoded = dataUrlToBlob(item.legacyDataUrl);
      if (!decoded || decoded.blob.size === 0) continue;
      const mime = decoded.mime || item.mime;
      const kind = classifyMediaFile({ type: mime, name: item.name }) || item.kind;
      const mediaId = await contentMediaId(decoded.bytes);
      const file = withFileName(decoded.blob, item.name, mime);
      const ref = await uploadSurveyMedia({ documentId, markerId, file, kind, mediaId, _allowExisting: true });
      migrated.set(item.id, ref);
    } catch (err) {
      if (!firstError) firstError = err;
      // Bucket missing / no access / offline: no point trying the rest now.
      if (['not-set-up', 'forbidden', 'offline', 'no-document', 'network', 'quota'].includes(err?.code)) break;
    }
  }
  if (!migrated.size) {
    if (firstError) throw firstError;
    return note;
  }
  const nextList = items.map((item) => migrated.get(item.id) || item);
  // Keep legacy order: migrated items sit where their base64 was (oldest first).
  return buildNoteWithMedia(note, nextList);
}
