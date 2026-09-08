import { cleanupDocumentStorage } from './documentStorageCleanup.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_SIZE = 100;

async function waitForPage(work, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Account cleanup response timed out; retry is safe.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function validPage(page, userId) {
  if (!page || typeof page.has_remaining !== 'boolean' || typeof page.cycle_complete !== 'boolean'
    || !Array.isArray(page.paths) || page.paths.length > PAGE_SIZE
    || new Set(page.paths).size !== page.paths.length
    || page.paths.some(path => typeof path !== 'string' || path.length > 2048
      || !path.startsWith(userId + '/') || /[\u0000-\u001f\u007f]/.test(path))
    || (!page.has_remaining && (page.paths.length > 0 || !page.cycle_complete))) {
    throw new Error('Account cleanup returned an invalid inventory receipt.');
  }
}

/**
 * Each claim advances a durable RAW-key cursor before returning eligible paths.
 * A lost reply or failed object is revisited on a later cycle. No full inventory
 * is loaded, and references are never treated as an empty account. Completion
 * requires a fresh, explicit absence receipt for both metadata and queued work.
 */
export async function cleanupAccountStorage(client, userId, {
  requestTimeoutMs = 15000, maxDurationMs = 45000, maxClaims = 3,
} = {}) {
  if (typeof userId !== 'string' || !UUID.test(userId)) throw new TypeError('A canonical account UUID is required.');
  if (![requestTimeoutMs, maxDurationMs].every(value => Number.isSafeInteger(value) && value > 0 && value <= 45000)
    || !Number.isSafeInteger(maxClaims) || maxClaims < 1 || maxClaims > 3) {
    throw new TypeError('Account cleanup requires bounded request, duration and claim limits.');
  }
  const report = { complete: false, removedCount: 0, retainedCount: 0, errors: [] };
  const deadline = Date.now() + maxDurationMs;
  for (let claim = 0; claim < maxClaims; claim++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const { data, error } = await waitForPage(() => client.rpc('claim_account_storage_cleanup', {
        target_user_id: userId, p_limit: PAGE_SIZE,
      }), Math.min(requestTimeoutMs, remaining));
      if (error) throw error;
      validPage(data, userId);
      if (!data.paths.length) {
        if (!data.has_remaining) report.complete = true;
        // A full raw page of shared paths may contain no eligible deletions.
        // Continue from the advanced cursor, without scanning past the budget.
        if (report.complete || data.cycle_complete) return report;
        continue;
      }
      const cleanupTime = deadline - Date.now();
      if (cleanupTime <= 0) break;
      const cleanup = await cleanupDocumentStorage(client, data.paths, {
        requestTimeoutMs: Math.min(requestTimeoutMs, cleanupTime), maxDurationMs: cleanupTime,
      });
      report.removedCount += cleanup.removedPaths.length;
      report.retainedCount += cleanup.retainedPaths.length;
      report.errors.push(...cleanup.errors);
      if (cleanup.pendingPaths.length || cleanup.retainedPaths.length || cleanup.errors.length) return report;
      // Even a short final page needs a separate empty receipt after removal.
      // Never infer completion from a count or the scan's cursor position.
    } catch (error) {
      report.errors.push(typeof error?.message === 'string' ? error.message.slice(0, 500) : 'Account storage cleanup could not finish.');
      return report;
    }
  }
  return report;
}
