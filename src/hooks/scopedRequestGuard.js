export function isScopedRequestCurrent({
  requestId,
  latestRequestId,
  requestScopeKey,
  currentScopeKey,
}) {
  return requestId === latestRequestId && requestScopeKey === currentScopeKey;
}
