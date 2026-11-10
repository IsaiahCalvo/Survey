export function combineCollaborationSyncStatus({
  annotationStatus,
  transportState,
  isSharedDocument,
}) {
  // Opened from this device's kept copy (offline-docs): the server cannot be
  // asked, so whether the document is shared is unknown and does not matter.
  if (annotationStatus?.stage === 'offline-copy' || annotationStatus?.stage === 'device-only') return annotationStatus;
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
