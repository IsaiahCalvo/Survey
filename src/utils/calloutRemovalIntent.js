const CALLOUT_REMOVAL_INTENT_KEY = '__pdfLastCalloutRemovalIntent';
export const CALLOUT_REMOVAL_INTENT_TTL_MS = 5000;

const INTENT_SOURCES = new Set([
  'undo',
  'redo',
  'delete',
  'delete-blank',
  'cancel-new',
]);

export function markCalloutRemovalIntent(detail = {}, target = globalThis) {
  if (!target) return null;
  const now = Number(detail.atMs) || Date.now();
  const intent = {
    source: detail.source || 'unknown',
    reason: detail.reason || null,
    calloutIds: Array.isArray(detail.calloutIds) ? detail.calloutIds.filter(Boolean) : [],
    count: Number.isFinite(detail.count) ? detail.count : null,
    atMs: now,
  };
  target[CALLOUT_REMOVAL_INTENT_KEY] = intent;
  return intent;
}

export function getRecentCalloutRemovalIntent(target = globalThis, now = Date.now(), ttlMs = CALLOUT_REMOVAL_INTENT_TTL_MS) {
  const intent = target?.[CALLOUT_REMOVAL_INTENT_KEY] || null;
  if (!intent || !Number.isFinite(intent.atMs)) return null;
  if (now - intent.atMs > ttlMs) return null;
  return intent;
}

export function diffCalloutIds(before, after) {
  const afterIds = new Set((Array.isArray(after) ? after : [])
    .map((c) => c?.id || c?.annotationId)
    .filter(Boolean));
  return (Array.isArray(before) ? before : [])
    .map((c) => c?.id || c?.annotationId)
    .filter(Boolean)
    .filter((id) => !afterIds.has(id));
}

export function classifyCalloutShrink({ priorCount, currentCount, deletedIds = [], intent = null } = {}) {
  const prior = Number(priorCount) || 0;
  const current = Number(currentCount) || 0;
  if (current >= prior) {
    return { level: 'none', expected: true, reason: 'not-a-shrink' };
  }

  const source = intent?.source || null;
  const expectedSource = INTENT_SOURCES.has(source);
  const intentIds = new Set(Array.isArray(intent?.calloutIds) ? intent.calloutIds : []);
  const idsMatch = intentIds.size === 0
    || deletedIds.every((id) => intentIds.has(id))
    || (Number(intent?.count) || 0) === deletedIds.length;

  if (expectedSource && idsMatch) {
    return {
      level: 'normal',
      expected: true,
      reason: `explained-by-${source}`,
    };
  }

  if (current === 0 && prior > 1) {
    return { level: 'high-warning', expected: false, reason: 'many-callouts-emptied-without-intent' };
  }

  return { level: 'warning', expected: false, reason: 'callouts-shrank-without-intent' };
}
