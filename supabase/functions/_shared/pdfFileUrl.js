// pdf-file-url: a short-lived Cloudflare R2 link for one stored PDF.
//
// Supabase decides who may open the file: the caller's own token asks Storage
// for the object's details (the same per-open check the app makes,
// fetchStoredPdfInfo in useDatabase.js), so the storage.objects access rules
// apply unchanged. Only when that passes and R2 holds the current version (its
// copy's ETag and size match Storage's) is an R2 link signed. Otherwise the
// copy is made in the background and the caller is told to read from Supabase
// this time.
//
// Never past Cloudflare's free tier: every R2 operation is reserved first with
// public.r2_reserve (migration 20261028090000), which refuses at 80% of each
// allowance. A refusal, or a failed reservation, answers "use Supabase".
import { PART_SIZE, headObject, presignGet, putObjectStream, r2KeyForDocument } from './r2.js';

// Same lifetime as the Supabase signed links the app streams from
// (STREAM_SIGNED_URL_SECONDS in src/services/cloudPdfStream.js).
export const PDF_LINK_SECONDS = 10 * 60;

// Reads a signed link can cause, at most: pdf.js fetches the whole file in
// range requests of this size (STREAM_RANGE_CHUNK_BYTES in cloudPdfStream.js),
// plus the presentation-tag probe's few small reads.
export const RANGE_CHUNK_BYTES = 256 * 1024;
export const linkReadOps = (size) => Math.ceil(Math.max(size, 1) / RANGE_CHUNK_BYTES) + 4;
// Writes one copy takes: one PUT, or start + parts + finish (putObjectStream).
export const copyWriteOps = (size) => (size <= PART_SIZE ? 1 : 2 + Math.ceil(size / PART_SIZE));

export const normalizeEtag = (value) => {
  const text = String(value ?? '').trim().replace(/^W\//, '').replace(/^"+|"+$/g, '');
  return text || null;
};

export function validPdfPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

// Storage's answer for a path, through the caller's token: { etag, size } or
// { status } when the caller may not read it (or it is gone).
export function infoFromStorage(info) {
  const etag = normalizeEtag(info?.etag ?? info?.eTag ?? info?.metadata?.eTag);
  const size = Number(info?.size ?? info?.metadata?.size);
  if (!etag || !Number.isFinite(size) || size < 0) return null;
  return { etag, size };
}

const inFlight = new Set();

// Copies one PDF from Storage into R2, tagging it with the ETag Storage sent
// with the bytes. Never throws; returns what happened for the log.
export async function mirrorPdf({ config, path, expected, download, fetchImpl = fetch }) {
  const key = r2KeyForDocument(path);
  if (inFlight.has(key)) return 'already_copying';
  inFlight.add(key);
  try {
    return await copyPdf({ config, path, key, expected, download, fetchImpl });
  } finally {
    inFlight.delete(key);
  }
}

async function copyPdf({ config, path, key, expected, download, fetchImpl }) {
  try {
    const res = await download(path);
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      return `download_${res.status}`;
    }
    const etag = normalizeEtag(res.headers.get('etag')) ?? expected.etag;
    // No header (a chunked answer) means unknown, not 0.
    const header = res.headers.get('content-length');
    const length = header == null ? NaN : Number(header);
    if (Number.isFinite(length) && length !== expected.size && etag === expected.etag) {
      await res.body.cancel();
      return 'size_mismatch';
    }
    await putObjectStream(config, key, res.body, { meta: { 'src-etag': etag }, fetchImpl });
    return 'copied';
  } catch (error) {
    return `failed: ${error?.message ?? error}`;
  }
}

/**
 * @param {any} body - { path }
 * @param {object} deps
 * @param {any} deps.config - r2ConfigFromEnv(...) or null
 * @param {(path: string) => Promise<{ ok: boolean, status: number, data?: any }>} deps.storageInfo - with the caller's token
 * @param {(path: string) => Promise<Response>} [deps.download] - the stored bytes
 * @param {(classA: number, classB: number, path?: string, bytes?: number) => Promise<boolean>} deps.reserve - r2_reserve; false = over the free-tier cap
 * @param {(path: string) => Promise<unknown>} [deps.forget] - drops a reserved copy's bytes when the copy failed and none existed
 * @param {(promise: Promise<unknown>) => void} [deps.background] - keeps the copy running after the answer
 * @param {(event: string, fields?: Record<string, unknown>) => void} [deps.log] - content-free logger
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {Date} [deps.now]
 */
export async function handlePdfFileUrl(body, {
  config, storageInfo, reserve, forget = async () => {}, download, background, log = () => {}, fetchImpl = fetch, now,
}) {
  const path = body?.path;
  if (!validPdfPath(path)) return { status: 400, body: { error: 'invalid_path' } };
  if (!config) return { status: 503, body: { error: 'r2_off' } };

  const info = await storageInfo(path);
  if (!info.ok) {
    // Storage answers 400 or 404 for a path the caller may not see; never say which.
    const status = info.status >= 500 ? 502 : 404;
    return { status, body: { error: status === 404 ? 'not_found' : 'storage_unavailable' } };
  }
  const expected = infoFromStorage(info.data);
  if (!expected) return { status: 502, body: { error: 'storage_info_unreadable' } };

  const allowed = async (classA, classB, copyPath, bytes) => {
    try {
      if (await reserve(classA, classB, copyPath, bytes)) return true;
      log('r2_budget', { class_a: classA, class_b: classB, bytes: bytes ?? 0 });
    } catch (error) {
      log('r2_reserve_failed', { message: String(error?.message ?? error) });
    }
    return false;
  };
  const overBudget = { status: 503, body: { error: 'r2_budget' } };

  const key = r2KeyForDocument(path);
  if (!await allowed(0, 1)) return overBudget;
  let copy;
  try {
    copy = await headObject(config, key, { fetchImpl });
  } catch (error) {
    log('r2_head_failed', { message: String(error?.message ?? error) });
    return { status: 503, body: { error: 'r2_unavailable' } };
  }

  if (copy.exists && normalizeEtag(copy.meta['src-etag']) === expected.etag && copy.size === expected.size) {
    if (!await allowed(0, linkReadOps(expected.size))) return overBudget;
    const url = await presignGet(config, key, { expiresIn: PDF_LINK_SECONDS, now });
    return { status: 200, body: { url, expiresIn: PDF_LINK_SECONDS, etag: expected.etag, size: expected.size } };
  }

  if (!await allowed(copyWriteOps(expected.size), 0, path, expected.size)) return overBudget;
  background(mirrorPdf({ config, path, expected, download, fetchImpl }).then(async (outcome) => {
    log('mirror', { outcome, size: expected.size, replaced: copy.exists });
    // A failed first copy leaves nothing in R2, so its reserved bytes go back.
    if (outcome !== 'copied' && outcome !== 'already_copying' && !copy.exists) await forget(path).catch(() => {});
  }));
  return { status: 202, body: { copying: true } };
}
