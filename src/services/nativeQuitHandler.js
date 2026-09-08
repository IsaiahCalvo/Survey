// Runs once per AppShell, not once per viewer. Every reply describes the whole
// renderer window. The main process owns the attempt and document generation.
export function createNativeQuitHandler({ registry, send, freeze, confirmedRef }) {
  let active = null;
  let release = null;
  let confirming = null;
  let preparation = null;
  const matches = (request) => active && active.quitAttemptId === request.quitAttemptId
    && active.generation === request.generation;
  const cancel = () => {
    active = null;
    confirming = null;
    preparation = null;
    confirmedRef.current = false;
    registry.cancel();
    release?.();
    release = null;
  };
  return {
    cancel,
    async receive(request) {
      if (!Number.isSafeInteger(request?.quitAttemptId) || !Number.isSafeInteger(request?.generation)) return;
      if (request.phase === 'cancel') { if (matches(request)) cancel(); return; }
      if (request.phase === 'prepare') {
        if (matches(request)) return;
        cancel();
        const attempt = { quitAttemptId: request.quitAttemptId, generation: request.generation };
        active = attempt;
        try {
          release = freeze();
          send({ ...attempt, phase: 'pending' });
          const result = await registry.prepare();
          if (active === attempt) {
            preparation = result;
            send({ ...attempt, phase: 'prepare', ...result });
          }
        } catch (error) {
          if (active === attempt) send({ ...attempt, phase: 'prepare', saved: false, tabIds: [],
            reason: error?.message || 'Finish editing, then close again.' });
        }
      } else if (request.phase === 'confirm' && matches(request)) {
        const attempt = active;
        if (confirming === attempt) return;
        confirming = attempt;
        let result;
        try { result = await registry.confirm(preparation); }
        catch (error) { result = { saved: false, tabIds: [], reason: error?.message || 'The local save could not be verified.' }; }
        // Cancellation or a new main-process generation can arrive while the
        // fresh storage checks run. Never reply using a newer active attempt.
        if (active !== attempt) return;
        confirmedRef.current = result.saved === true;
        send({ ...attempt, phase: 'confirm', ...result });
      }
    },
  };
}
