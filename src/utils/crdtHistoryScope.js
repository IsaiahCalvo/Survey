/**
 * When a CRDT/Y.Doc owns annotation objects, legacy whole-document
 * checkpoints must not write annotationsByPage (or derived callouts)
 * back over live teammate edits. Survey markers / spaces / pending
 * survey-marker UI still restore from the snapshot.
 */
export function scopeHistoryStateForCrdtRestore({ currentState, targetState }) {
  if (!targetState || typeof targetState !== 'object') return targetState;
  if (!currentState || typeof currentState !== 'object') return targetState;
  return {
    ...targetState,
    annotationsByPage: currentState.annotationsByPage,
    callouts: currentState.callouts,
  };
}
