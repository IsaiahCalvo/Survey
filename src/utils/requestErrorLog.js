/**
 * requestErrorLog.js — turns failed requests to Survey's own servers into
 * crash records (kind 'request'), so they reach the client_errors table and
 * the hourly spike alert like any other crash.
 *
 * Counted: a 5xx answer from Supabase (database, storage, functions) or from
 * this site's /api, and a request that never got an answer while the device
 * says it is online. Not counted: 4xx (usually a normal "no" such as an
 * expired session), requests to anyone else, the crash reporter's own call,
 * and anything while offline.
 *
 * The message is "METHOD /path -> status" with ids and query strings taken
 * out, so the same failure from different people groups together and no
 * document or person can be read from it.
 */
import { onNetworkEntry } from './networkLogger.js';
import { recordCrash } from './crashLog.js';

const SKIP_PATHS = [/\/rpc\/report_client_error\b/, /\/api\/analytics\//];

/** "/rest/v1/documents/1a2b…" -> "/rest/v1/documents/[id]"; null if not ours. */
export function requestErrorPath(url, { origins = [] } = {}) {
  let parsed;
  try { parsed = new URL(url, origins[0] || 'http://localhost'); } catch { return null; }
  const ours = origins.some((origin) => {
    try { return new URL(origin).origin === parsed.origin; } catch { return false; }
  });
  if (!ours) return null;
  if (SKIP_PATHS.some((re) => re.test(parsed.pathname))) return null;
  return parsed.pathname
    .split('/')
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) || /\d{4,}/.test(part) || part.length > 40 || /\.\w{2,4}$/.test(part) ? '[id]' : part))
    .join('/')
    .slice(0, 120);
}

/** The crash record for one finished request, or null when it is fine. */
export function requestErrorRecord(entry, { origins = [], online = true } = {}) {
  if (!entry || /abort/i.test(String(entry.error || ''))) return null;
  const failedOnServer = Number(entry.status) >= 500;
  const neverAnswered = !entry.status && !!entry.error && online;
  if (!failedOnServer && !neverAnswered) return null;
  const path = requestErrorPath(entry.url, { origins });
  if (!path) return null;
  const outcome = failedOnServer ? String(entry.status) : 'no answer';
  return { kind: 'request', message: `${entry.method || 'GET'} ${path} -> ${outcome}`, stack: '' };
}

export function installRequestErrorLog({
  supabaseUrl,
  win = typeof window !== 'undefined' ? window : null,
  record = recordCrash,
} = {}) {
  if (!win) return () => {};
  const origins = [win.location?.origin, supabaseUrl].filter(Boolean);
  return onNetworkEntry((entry) => {
    const crash = requestErrorRecord(entry, { origins, online: win.navigator?.onLine !== false });
    if (crash) record(crash);
  });
}
