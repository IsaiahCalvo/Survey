export function getCalloutHistoryId(callout) {
  return callout?.id || callout?.highlightId || callout?.data?.id || null;
}

export function getCalloutHistoryAuthorId(callout) {
  return callout?.meta?.authorId
    || callout?.__meta?.authorId
    || callout?.authorId
    || callout?.userId
    || callout?.data?.authorId
    || callout?.data?.userId
    || null;
}

function isOwnCallout(callout, userId) {
  if (!userId) return true;
  const authorId = getCalloutHistoryAuthorId(callout);
  return !authorId || authorId === userId;
}

export function getCalloutIdsFromHistoryMeta(meta) {
  const context = meta?.context || {};
  const ids = [
    context.calloutId,
    ...(Array.isArray(context.calloutIds) ? context.calloutIds : []),
  ].filter(Boolean);
  return [...new Set(ids)];
}

export function scopeCalloutsForHistoryRestore({
  currentCallouts,
  targetCallouts,
  targetIds,
  userId,
}) {
  const current = Array.isArray(currentCallouts) ? currentCallouts : [];
  const target = Array.isArray(targetCallouts) ? targetCallouts : [];
  const scopedIds = new Set(Array.isArray(targetIds) ? targetIds.filter(Boolean) : []);
  if (scopedIds.size === 0) return target;

  const targetById = new Map();
  target.forEach((callout) => {
    const id = getCalloutHistoryId(callout);
    if (id) targetById.set(id, callout);
  });

  const output = [];
  const seen = new Set();

  current.forEach((callout) => {
    const id = getCalloutHistoryId(callout);
    if (!id || !scopedIds.has(id)) {
      output.push(callout);
      if (id) seen.add(id);
      return;
    }

    const desired = targetById.get(id) || null;
    const ownershipSource = desired || callout;
    if (!isOwnCallout(ownershipSource, userId)) {
      output.push(callout);
      seen.add(id);
      return;
    }

    if (desired) {
      output.push(desired);
      seen.add(id);
    }
  });

  target.forEach((callout) => {
    const id = getCalloutHistoryId(callout);
    if (!id || !scopedIds.has(id) || seen.has(id)) return;
    if (!isOwnCallout(callout, userId)) return;
    output.push(callout);
    seen.add(id);
  });

  return output;
}

export function scopeHistoryStateForCalloutRestore({
  currentState,
  targetState,
  meta,
  userId,
}) {
  if (!targetState || typeof targetState !== 'object') return targetState;
  const targetIds = getCalloutIdsFromHistoryMeta(meta);
  if (targetIds.length === 0) return targetState;
  return {
    ...targetState,
    callouts: scopeCalloutsForHistoryRestore({
      currentCallouts: currentState?.callouts,
      targetCallouts: targetState?.callouts,
      targetIds,
      userId,
    }),
  };
}
