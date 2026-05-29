/**
 * safeSnapshot.js — guards against cloud-backed state being wiped by an empty incoming snapshot.
 *
 * Exports countSnapshotItems (counts object-map entries, arrays, or 'annotation-pages'
 * objects) and resolveSafeSnapshot, which keeps the current value instead of an empty
 * incoming one when the source is cloudBacked, currently has data, and the emptiness
 * isn't confirmed. Returns {value, preserved, currentCount, incomingCount, context}.
 */
export function countSnapshotItems(value, kind = 'object-map') {
  if (!value) return 0;
  if (kind === 'annotation-pages') {
    return Object.values(value || {}).reduce(
      (sum, page) => sum + (Array.isArray(page?.objects) ? page.objects.length : 0),
      0
    );
  }
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 0;
}

export function resolveSafeSnapshot({
  current,
  incoming,
  kind = 'object-map',
  cloudBacked = false,
  confirmedEmpty = false,
  context = 'snapshot',
} = {}) {
  const currentCount = countSnapshotItems(current, kind);
  const incomingCount = countSnapshotItems(incoming, kind);
  const incomingEmpty = incomingCount === 0;
  const currentHasData = currentCount > 0;
  const preserve = cloudBacked && currentHasData && incomingEmpty && !confirmedEmpty;

  return {
    value: preserve ? current : (incoming ?? (Array.isArray(current) ? [] : {})),
    preserved: preserve,
    currentCount,
    incomingCount,
    context,
  };
}
