export function isTransportChannelJoined(providerHandle) {
  try {
    return providerHandle?.getChannel?.()?.state === 'joined';
  } catch {
    return false;
  }
}

export function hasRemoteDocumentCollaborator({
  activeCollaboratorUserIds,
  currentUserId,
  currentRole,
}) {
  if (!currentUserId || !Array.isArray(activeCollaboratorUserIds)) return false;
  if (activeCollaboratorUserIds.some((userId) => userId && userId !== currentUserId)) {
    return true;
  }
  // A collaborator may be the only document_collaborators row because the
  // document owner is represented by documents.user_id/project ownership.
  return activeCollaboratorUserIds.includes(currentUserId) &&
    currentRole != null &&
    currentRole !== 'owner';
}

export async function recreateTransportProvider({
  currentProvider,
  createProvider,
}) {
  if (typeof createProvider !== 'function') {
    throw new TypeError('createProvider must be a function');
  }
  try {
    currentProvider?.disconnect?.();
  } catch {
    // A dead provider must not prevent a fresh channel from being created.
  }
  return createProvider();
}

function disconnectProvider(provider) {
  try {
    provider?.disconnect?.();
  } catch {
    // A dead provider must not prevent replacement or cleanup.
  }
}

/**
 * Coordinates provider replacement across boot, manual Retry, and unmount.
 *
 * restart() is single-flight for user actions. replace() remains available for
 * lifecycle supersession and is generation guarded: if async attempts resolve
 * out of order, only the newest can be installed and every stale candidate is
 * disconnected.
 */
export function createTransportProviderCoordinator({
  getCurrentProvider,
  setCurrentProvider,
  createProvider,
}) {
  if (typeof getCurrentProvider !== 'function') {
    throw new TypeError('getCurrentProvider must be a function');
  }
  if (typeof setCurrentProvider !== 'function') {
    throw new TypeError('setCurrentProvider must be a function');
  }
  if (typeof createProvider !== 'function') {
    throw new TypeError('createProvider must be a function');
  }

  let generation = 0;
  let inFlight = null;
  let disposed = false;

  const replace = async () => {
    if (disposed) {
      throw new Error('Transport provider coordinator is disposed');
    }

    const attempt = generation + 1;
    generation = attempt;
    const previousProvider = getCurrentProvider();
    disconnectProvider(previousProvider);

    let candidate;
    try {
      candidate = await createProvider({
        attempt,
        isCurrent: () => !disposed && generation === attempt,
      });
    } catch (error) {
      if (disposed || generation !== attempt) return null;
      throw error;
    }

    if (disposed || generation !== attempt) {
      disconnectProvider(candidate);
      return null;
    }

    const displacedProvider = getCurrentProvider();
    if (
      displacedProvider &&
      displacedProvider !== previousProvider &&
      displacedProvider !== candidate
    ) {
      disconnectProvider(displacedProvider);
    }
    setCurrentProvider(candidate);
    return candidate;
  };

  const restart = () => {
    if (inFlight) return inFlight;
    const pending = replace();
    inFlight = pending;
    const clear = () => {
      if (inFlight === pending) inFlight = null;
    };
    pending.then(clear, clear);
    return pending;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const currentProvider = getCurrentProvider();
    disconnectProvider(currentProvider);
    setCurrentProvider(null);
  };

  return Object.freeze({
    replace,
    restart,
    dispose,
  });
}
