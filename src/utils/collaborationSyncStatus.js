export function combineCollaborationSyncStatus({
  annotationStatus,
  transportState,
  isSharedDocument,
  managedLocal = false,
  hasUnsavedChanges = false,
}) {
  // Device-managed files have no cloud identity or collaboration lookup.
  if (managedLocal) {
    return { managedLocal: true, stage: hasUnsavedChanges ? 'pending' : 'idle' };
  }
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
