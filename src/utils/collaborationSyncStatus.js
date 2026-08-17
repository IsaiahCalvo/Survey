export function combineCollaborationSyncStatus({
  annotationStatus,
  transportState,
  isSharedDocument,
}) {
  if (annotationStatus?.stage === 'error' || annotationStatus?.healthy === false) {
    return annotationStatus;
  }
  if (isSharedDocument == null) {
    return {
      stage: 'hydrating',
      healthy: true,
      error: 'checking whether this document uses live collaboration',
    };
  }
  if (!isSharedDocument) return annotationStatus;
  if (transportState === 'offline') {
    return {
      stage: 'error',
      healthy: false,
      error: 'live collaboration is offline',
    };
  }
  if (transportState !== 'online') {
    return {
      stage: 'hydrating',
      healthy: true,
      error: null,
    };
  }
  return annotationStatus;
}
