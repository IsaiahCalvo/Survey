// src/services/checkpointBodyFetch.js
//
// Upload a multi-MB annotation checkpoint without building its request body
// as one big JavaScript string on the main thread (2026-10-06).
//
// supabase-js serializes RPC arguments with JSON.stringify and hands fetch a
// string body. For a checkpoint that string is several MB of hex text, and
// fetch converting it cost ~30 ms of main thread on a desktop (Package 2,
// 4 MB) and ~100 ms with a phone-like 4x CPU slowdown. Instead, the checkpoint worker produces the JSON
// text of the hex argument as a Blob; the sync layer passes a short unique
// marker as p_snapshot; and this fetch (installed as the Supabase client's
// fetch) swaps the marker's JSON string for those bytes. The request body the
// server receives is byte for byte what JSON.stringify of the real arguments
// would have been (tests/annotationCheckpointWorker.test.mjs checks this).
//
// Only a client created with this fetch may be given a marker
// (canSubstituteCheckpointBody); a body naming a marker that is not
// registered is never sent (the request fails instead, and the checkpoint is
// retried later, as after any failed upload).

const MARKER_PREFIX = '__surveyCheckpointBody_';
const bodies = new Map();
const substitutingClients = new WeakSet();
let nextMarker = 1;

function randomPart() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID().replace(/-/g, '');
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** Mark a Supabase client whose fetch is checkpointBodyFetch. */
export function enableCheckpointBodySubstitution(client) {
  if (client && typeof client === 'object') substitutingClients.add(client);
  return client;
}

export function canSubstituteCheckpointBody(client) {
  return Boolean(client && typeof client === 'object' && substitutingClients.has(client));
}

/**
 * Register the JSON text (bytes, or a Blob) that stands for one argument
 * value. Returns the marker string to pass as that argument instead.
 */
export function registerCheckpointBody(jsonText) {
  const marker = `${MARKER_PREFIX}${nextMarker}_${randomPart()}__`;
  nextMarker += 1;
  bodies.set(marker, jsonText instanceof Blob ? jsonText : new Blob([jsonText]));
  return marker;
}

export function releaseCheckpointBody(marker) {
  bodies.delete(marker);
}

/**
 * The request body with every registered marker's JSON string replaced by
 * its registered JSON text, or the body unchanged when it names none.
 * Throws when it names a marker that is not registered.
 */
export function substituteCheckpointBody(body) {
  if (typeof body !== 'string' || !body.includes(MARKER_PREFIX)) return body;
  const parts = [];
  let rest = body;
  let found = false;
  for (;;) {
    const at = rest.indexOf(`"${MARKER_PREFIX}`);
    if (at < 0) break;
    const end = rest.indexOf('"', at + 1);
    const marker = end > at ? rest.slice(at + 1, end) : '';
    const text = bodies.get(marker);
    if (!text) throw new Error('checkpoint upload body is no longer available');
    parts.push(rest.slice(0, at), text);
    rest = rest.slice(end + 1);
    found = true;
  }
  if (!found) {
    // The prefix appears but not as a whole JSON string: never send it.
    throw new Error('checkpoint upload body marker is malformed');
  }
  parts.push(rest);
  return new Blob(parts);
}

/** fetch for the Supabase client: plain fetch, plus the substitution above. */
export function checkpointBodyFetch(input, init) {
  if (init && typeof init.body === 'string' && init.body.includes(MARKER_PREFIX)) {
    let body;
    try {
      body = substituteCheckpointBody(init.body);
    } catch (error) {
      return Promise.reject(error);
    }
    return fetch(input, { ...init, body });
  }
  return fetch(input, init);
}
