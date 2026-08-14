export async function retryCompensatingCleanup(recovery, rollback) {
  if (!recovery || !Array.isArray(recovery.pending) || recovery.pending.length === 0) return;
  const pending = [];
  const cleanupErrors = [];
  for (const value of recovery.pending) {
    try {
      await rollback(value);
    } catch (error) {
      pending.push(value);
      cleanupErrors.push(error);
    }
  }
  recovery.pending = pending;
  if (cleanupErrors.length > 0) {
    const error = new Error('Could not finish cleaning up the previous operation.');
    error.code = 'COMPENSATION_INCOMPLETE';
    error.cleanupErrors = cleanupErrors;
    error.compensation = recovery;
    throw error;
  }
}

export async function runCompensatingBatch(items, create, rollback, { recovery = null } = {}) {
  if (recovery?.pending?.length) {
    await retryCompensatingCleanup(recovery, rollback);
  }
  const created = [];
  try {
    for (const item of items) {
      try {
        created.push(await create(item));
      } catch (error) {
        // A multi-resource create may upload/commit before its response fails.
        // Including the supplied stable recovery value makes that current
        // stage participate in the same idempotent rollback as earlier stages.
        if (error?.recoveryValue) created.push(error.recoveryValue);
        throw error;
      }
    }
    return created;
  } catch (error) {
    const cleanupErrors = [];
    const compensation = { pending: [] };
    for (const value of [...created].reverse()) {
      try { await rollback(value); }
      catch (cleanupError) {
        compensation.pending.push(value);
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      error.cleanupErrors = cleanupErrors;
      error.compensation = compensation;
    }
    throw error;
  }
}
