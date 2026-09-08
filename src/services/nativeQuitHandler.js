// Runs once per AppShell, not once per viewer. Every reply describes the whole
// renderer window. The main process owns the attempt and document generation.
export function createNativeQuitHandler({ registry, send, freeze, confirmedRef }) {
  let active = null;
  let release = null;
  const matches = (request) => active && active.quitAttemptId === request.quitAttemptId
    && active.generation === request.generation;
  const cancel = () => {
    active = null;
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
          if (active === attempt) send({ ...attempt, phase: 'prepare', ...result });
        } catch (error) {
          if (active === attempt) send({ ...attempt, phase: 'prepare', saved: false, tabIds: [],
            reason: error?.message || 'Finish editing, then close again.' });
        }
      } else if (request.phase === 'confirm' && matches(request)) {
        const result = registry.confirm();
        confirmedRef.current = result.saved === true;
        send({ ...active, phase: 'confirm', ...result });
      }
    },
  };
}
