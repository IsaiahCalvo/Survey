// Supabase Storage answers a busy moment with a brief 5xx: 544 when its
// database connection times out, 502/503/504 from the gateway. One such answer
// used to fail the whole PDF open ("Couldn't open this PDF"); the iPhone app
// walk hit it on every run on its slow CI machine. Reads retry those, and
// dropped connections, a couple of times. A 4xx (no access, missing file) is
// an answer, not a hiccup, and is never retried.

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504, 520, 522, 524, 544]);
const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network connection was lost|network request failed/i;

function statusOf(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isFinite(status) && status > 0 ? status : null;
}

export function isTransientStorageError(error) {
  if (!error || error.name === 'AbortError') return false;
  const status = statusOf(error);
  if (status !== null) return TRANSIENT_STATUSES.has(status);
  const cause = error.originalError || error.cause;
  if (cause && cause !== error && isTransientStorageError(cause)) return true;
  return error.name === 'TypeError' || NETWORK_MESSAGE.test(String(error.message || ''));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a storage read that returns `{ data, error }` (or throws), retrying a
 * transient failure after each of `delaysMs`. The last outcome is returned or
 * thrown as is. */
export async function retryStorageRead(read, { delaysMs = [400, 1500], sleep = wait } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const more = attempt < delaysMs.length;
    let result;
    try {
      result = await read();
    } catch (error) {
      if (!more || !isTransientStorageError(error)) throw error;
      await sleep(delaysMs[attempt]);
      continue;
    }
    if (!more || !isTransientStorageError(result?.error)) return result;
    await sleep(delaysMs[attempt]);
  }
}
