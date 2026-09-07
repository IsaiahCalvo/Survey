// src/services/documentMetadataResolver.js
// KAL-250 / DB-sync — one shared per-open read of the documents row.
//
// Opening a document used to read the SAME documents row up to six times, each
// selecting one or two columns: lock state (documentLockService), tool
// preferences (useDatabase), the cutover seal (crdtBackfill + the hydrate hook),
// the owner id (YDocProvider cleanup audit), and the fast-open watermark
// (annotationCloudSync). Those reads fire SEQUENTIALLY across the open lifecycle
// (lock banner mount -> tool prefs -> backfill -> hydrate -> cleanup audit), so
// an in-flight-only coalescer like annotationCloudSync's inFlightHydrateReads
// would not collapse them. A short TTL cache keyed by documentId folds the whole
// open window into ONE select; concurrent first callers still share a single
// in-flight promise (single-flight).
//
// All folded reads are one-shot open-time DECIDE reads. The only same-open WRITE
// to any of these columns is the cutover seal (crdtBackfill), which calls
// invalidateDocumentMetadata after a successful seal so a later same-open read
// never sees the stale pre-seal value; the TTL self-heals regardless. Repeated
// reads (the onFocus watermark short-circuit) deliberately do NOT go through the
// resolver.
//
// Assumes the documents row carries annotations_changed_at (live in prod). If
// that column were absent the single union select would error and every
// consumer would fall back to its null/default path — the same graceful
// degradation each read already handles individually.
import { supabase as defaultClient } from '../supabaseClient.js';

const TTL_MS = 5000;
const META_COLUMNS =
  'user_id, locked_at, locked_by, locked_label, tool_preferences, cutover_completed_at, annotations_changed_at';

const MAX_CACHE_ENTRIES = 128;
const cache = new Map(); // client/document key -> { clientId, documentId, value, expiresAt }
const inFlight = new Map(); // client/document key -> request record
const clientScopes = new WeakMap();
let nextClientId = 0;

function dropClientEntries(clientId) {
  for (const [key, entry] of cache) if (entry.clientId === clientId) cache.delete(key);
  for (const [key, entry] of inFlight) if (entry.clientId === clientId) inFlight.delete(key);
}

function scopeForClient(client) {
  let scope = clientScopes.get(client);
  if (scope) return scope;
  scope = { id: ++nextClientId, generation: 0, userId: undefined };
  clientScopes.set(client, scope);
  // One synchronous listener per client. Do not call auth APIs from inside an
  // auth callback: Supabase holds its session lock while invoking listeners.
  client.auth?.onAuthStateChange?.((event, session) => {
    const userId = session?.user?.id ?? null;
    // INITIAL_SESSION announces the identity already used by a first read;
    // it is not an account change. Its async delivery must not discard that
    // first open. A later sign-in/out always invalidates, even for the same ID.
    const firstSession = event === 'INITIAL_SESSION' && scope.userId === undefined;
    if (!firstSession && (event !== 'TOKEN_REFRESHED' || scope.userId !== userId)) {
      scope.generation += 1;
      dropClientEntries(scope.id);
    }
    scope.userId = userId;
  });
  return scope;
}

function pruneCache(now) {
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

function nullMetadata() {
  return {
    userId: null,
    lockedAt: null,
    lockedBy: null,
    lockedLabel: null,
    toolPreferences: null,
    cutoverCompletedAt: null,
    annotationsChangedAt: null,
  };
}

/**
 * Read the per-open documents-row metadata once and serve it to every consumer
 * from a short-TTL, single-flight cache.
 *
 * @param {string|null|undefined} documentId
 * @param {{ supabase?: object }} [opts] - optional client (crdtBackfill passes
 *   the client it was handed via args rather than the singleton).
 * @returns {Promise<{ userId, lockedAt, lockedBy, lockedLabel, toolPreferences, cutoverCompletedAt, annotationsChangedAt }>}
 */
export async function resolveDocumentMetadata(documentId, { supabase: client = defaultClient } = {}) {
  if (!documentId || !client) return nullMetadata();

  const scope = scopeForClient(client);
  const key = JSON.stringify([scope.id, documentId]);
  pruneCache(Date.now());
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const existing = inFlight.get(key);
  if (existing) return existing.promise;

  const generation = scope.generation;
  const request = { clientId: scope.id, documentId, promise: null };
  inFlight.set(key, request);
  request.promise = (async () => {
    const { data, error } = await client
      .from('documents')
      .select(META_COLUMNS)
      .eq('id', documentId)
      .maybeSingle();
    if (error || !data || scope.generation !== generation) {
      // Do NOT cache transient failures / missing rows — let the next caller retry.
      return nullMetadata();
    }
    const value = {
      userId: data.user_id ?? null,
      lockedAt: data.locked_at ?? null,
      lockedBy: data.locked_by ?? null,
      lockedLabel: data.locked_label ?? null,
      toolPreferences: data.tool_preferences ?? null,
      cutoverCompletedAt: data.cutover_completed_at ?? null,
      annotationsChangedAt: data.annotations_changed_at ?? null,
    };
    // An invalidated request may finish after a newer read. Only the still-
    // registered request can fill the cache or remove its in-flight entry.
    if (inFlight.get(key) === request) {
      cache.set(key, { clientId: scope.id, documentId, value, expiresAt: Date.now() + TTL_MS });
      pruneCache(Date.now());
    }
    return value;
  })().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });

  return request.promise;
}

/** Drop the cached metadata so the next resolve refetches. Call after a write to
 *  any of the cached columns (e.g. the cutover seal) that must be visible to a
 *  same-open read. */
export function invalidateDocumentMetadata(documentId) {
  for (const [key, entry] of cache) if (entry.documentId === documentId) cache.delete(key);
  for (const [key, entry] of inFlight) if (entry.documentId === documentId) inFlight.delete(key);
}

/** Test hook — clear all cached/in-flight state between cases. */
export function __resetDocumentMetadataCacheForTests() {
  cache.clear();
  inFlight.clear();
}
