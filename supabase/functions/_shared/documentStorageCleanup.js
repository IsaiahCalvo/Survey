// Shared browser/Edge cleanup protocol. A committed SQL retirement receipt is
// required before touching Storage. Never fall back to a reference SELECT or
// direct removal on an old server. Retired paths are never reused.
const MAX_BATCH = 100;
async function waitForCleanup(work, timeoutMs) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Storage cleanup response timed out; queued paths were kept.')), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}
const message = (error, fallback) => typeof error?.message === 'string' && error.message.trim()
  ? error.message.slice(0, 500) : fallback;

function pathsInput(paths) {
  if (!Array.isArray(paths) || paths.length > 10000 || paths.some(path => typeof path !== 'string'
    || !path.length || path.length > 2048 || /[\u0000-\u001f\u007f]/.test(path))) {
    throw new TypeError('Storage cleanup requires valid exact object paths.');
  }
  return [...new Set(paths)];
}

function partition(data, requested, yesKey, noKey) {
  if (!data || typeof data !== 'object' || !Array.isArray(data[yesKey]) || !Array.isArray(data[noKey])) {
    throw new Error('Storage cleanup returned an invalid receipt.');
  }
  const expected = new Set(requested), seen = new Set();
  for (const path of [...data[yesKey], ...data[noKey]]) {
    if (typeof path !== 'string' || !expected.has(path) || seen.has(path)) {
      throw new Error('Storage cleanup receipt did not match the requested paths.');
    }
    seen.add(path);
  }
  if (seen.size !== expected.size) throw new Error('Storage cleanup receipt omitted requested paths.');
  return [data[yesKey], data[noKey]];
}

/**
 * `removedPaths` means Storage acknowledged the request and SQL confirmed no
 * metadata remains. It is not an independent physical-provider byte audit.
 * Failed/lost replies leave durable jobs for retry; shared paths are retained.
 */
export async function cleanupDocumentStorage(client, paths, { requestTimeoutMs = 15000, maxDurationMs = 45000 } = {}) {
  const exact = pathsInput(paths);
  if (![requestTimeoutMs, maxDurationMs].every(value => Number.isSafeInteger(value) && value > 0 && value <= 45000)) {
    throw new TypeError('Storage cleanup time limits must be 1–45000 milliseconds.');
  }
  const deadline = Date.now() + maxDurationMs;
  let requests = 0;
  const bounded = async work => {
    const remaining = Math.min(requestTimeoutMs, deadline - Date.now());
    if (remaining <= 0 || requests >= 200) throw new Error('Storage cleanup budget ended; queued paths were kept.');
    requests++;
    // Timing out does not cancel provider work already sent. It remains safe
    // because deletion was preceded by permanent, committed retirement.
    return waitForCleanup(work, remaining);
  };
  const report = { removedPaths: [], retainedPaths: [], pendingPaths: [], errors: [] };
  const removeRetired = async retired => {
    try {
      const { data, error } = await bounded(() => client.storage.from('documents').remove(retired));
      if (error) {
        // Isolate a failed key without turning every normal batch into 100
        // requests. All halves already have committed retirement receipts.
        if (retired.length > 1 && Date.now() < deadline && requests < 200) {
          const split = Math.ceil(retired.length / 2);
          await removeRetired(retired.slice(0, split));
          await removeRetired(retired.slice(split));
          return;
        }
        throw error;
      }
      // Empty is valid for an idempotent retry; SQL checks absence below.
      if (!Array.isArray(data) || data.some(row => !row || !retired.includes(row.name))) {
        throw new Error('Storage did not return a valid deletion acknowledgement.');
      }
      const { data: receipt, error: ackError } = await bounded(() => client.rpc('ack_document_storage_cleanup', { p_paths: retired }));
      if (ackError) throw ackError;
      const [acknowledged, pending] = partition(receipt, retired, 'acknowledged_paths', 'pending_paths');
      report.removedPaths.push(...acknowledged);
      report.pendingPaths.push(...pending);
      if (pending.length) report.errors.push('Some retired object metadata remains; cleanup is queued for retry.');
    } catch (error) {
      report.pendingPaths.push(...retired);
      report.errors.push(message(error, 'Retired object cleanup is queued for retry.'));
    }
  };
  for (let offset = 0; offset < exact.length; offset += MAX_BATCH) {
    if (Date.now() >= deadline || requests >= 200) {
      report.pendingPaths.push(...exact.slice(offset));
      report.errors.push('Storage cleanup time budget ended; remaining paths were not attempted.');
      break;
    }
    const chunk = exact.slice(offset, offset + MAX_BATCH);
    let retired;
    try {
      const { data, error } = await bounded(() => client.rpc('retire_document_storage_paths', { p_paths: chunk }));
      if (error) throw error;
      const [allowed, referenced] = partition(data, chunk, 'retired_paths', 'referenced_paths');
      retired = allowed;
      report.retainedPaths.push(...referenced);
    } catch (error) {
      report.pendingPaths.push(...chunk);
      report.errors.push(message(error, 'Storage paths could not be retired safely.'));
      continue;
    }
    if (!retired.length) continue;
    await removeRetired(retired);
  }
  return report;
}

// Called by the existing service-only sweep, independently of whether this run
// just deleted any document rows. This recovers committed jobs after lost replies.
export async function drainDocumentStorageCleanup(client, limit = MAX_BATCH) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new TypeError('Cleanup batch limit must be 1–100.');
  const { data, error } = await waitForCleanup(() => client.rpc('list_document_storage_cleanup', { p_limit: limit }), 15000);
  if (error) throw error;
  if (!data || !Array.isArray(data.paths) || data.paths.length > limit) throw new Error('Storage cleanup queue returned an invalid batch.');
  return cleanupDocumentStorage(client, data.paths);
}
