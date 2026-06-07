/**
 * Cloud sync queue — Phase 21.
 *
 * In-memory queue of annotation upserts that failed because Supabase was
 * unreachable (offline, RLS, transient 5xx). The queue retries on reconnect
 * and surfaces a count for UI indicators.
 *
 * Persisted to localStorage so a page refresh while offline doesn't lose
 * pending pushes.
 */

const QUEUE_KEY_PREFIX = 'cloudSyncQueue_';
const MAX_QUEUE_SIZE = 5000; // sanity cap; huge documents cluster around 200 marks

function readQueue(documentId) {
  if (!documentId || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${QUEUE_KEY_PREFIX}${documentId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(documentId, queue) {
  if (!documentId || typeof localStorage === 'undefined') return;
  try {
    if (queue.length === 0) {
      localStorage.removeItem(`${QUEUE_KEY_PREFIX}${documentId}`);
      return;
    }
    const trimmed = queue.length > MAX_QUEUE_SIZE
      ? queue.slice(queue.length - MAX_QUEUE_SIZE)
      : queue;
    localStorage.setItem(`${QUEUE_KEY_PREFIX}${documentId}`, JSON.stringify(trimmed));
  } catch (err) {
    // Quota exceeded or storage disabled — drop the queue rather than crash
    console.warn('[CloudSyncQueue] failed to persist queue:', err?.message || err);
  }
}

/**
 * Append an entry to the queue.
 * Each entry: { kind: 'fabric' | 'callout' | 'delete', payload, opts, addedAt }
 */
export function enqueueSync(documentId, entry) {
  const queue = readQueue(documentId);
  queue.push({ ...entry, addedAt: Date.now() });
  writeQueue(documentId, queue);
}

export function getQueueSize(documentId) {
  return readQueue(documentId).length;
}

/**
 * Drain the queue, calling the supplied flusher on each entry. Entries that
 * fail are kept in the queue for the next drain attempt.
 *
 * @param {string} documentId
 * @param {(entry: object) => Promise<{ success: boolean }>} flush
 * @returns {Promise<{ flushed: number, remaining: number }>}
 */
export async function drainQueue(documentId, flush) {
  const queue = readQueue(documentId);
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const remaining = [];
  let flushed = 0;
  for (const entry of queue) {
    try {
      const result = await flush(entry);
      if (result?.success) {
        flushed += 1;
      } else {
        remaining.push(entry);
      }
    } catch (err) {
      console.warn('[CloudSyncQueue] flush threw:', err?.message || err);
      remaining.push(entry);
    }
  }
  writeQueue(documentId, remaining);
  return { flushed, remaining: remaining.length };
}
