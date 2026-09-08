// One registry covers every mounted PDF in a renderer, including hidden tabs.
// Targeted tab close uses the same participants without freezing other tabs.
export function createQuitSaveRegistry(getTabs) {
  const participants = new Map();
  const preparations = new WeakMap();
  let prepared = null;
  const failure = reason => ({ saved: false, tabIds: [], ...(reason ? { reason } : {}) });
  const success = attempt => ({ saved: true, tabIds: attempt.entries.map(entry => entry.tab.id) });
  const selectedTabs = tabId => tabId === undefined ? getTabs() : getTabs().filter(tab => tab.id === tabId);
  const cancelError = () => new Error('The close save check was canceled. Keep the document open and retry.');
  const waitFor = (run, signal) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      callback(value);
    };
    const aborted = () => finish(reject, cancelError());
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    try { Promise.resolve(run()).then(value => finish(resolve, value), error => finish(reject, error)); }
    catch (error) { finish(reject, error); }
  });
  function matches(attempt) {
    if (prepared !== attempt || !attempt || attempt.controller.signal.aborted) return false;
    const tabs = selectedTabs(attempt.tabId);
    if (tabs.length !== attempt.entries.length) return false;
    return attempt.entries.every((entry, index) => (
      tabs[index].id === entry.tab.id && tabs[index].file === entry.tab.file
      && tabs[index].actorUserId === entry.tab.actorUserId
      && participants.get(entry.tab.id) === entry.participant
      && entry.participant.getRevision() === entry.revision
      && [entry.participant.prepareClose, entry.participant.validateClose, entry.participant.isCloseCurrent]
        .every((method, methodIndex) => method === entry.contract[methodIndex])
    ));
  }
  function valid(attempt) {
    return !!attempt?.complete && matches(attempt) && attempt.entries.every(entry => (
      !entry.proof || entry.proof.current.call(entry.participant, entry.receipt) === true
    ));
  }
  function fail(attempt, error) {
    attempt.complete = false;
    attempt.controller.abort();
    return failure(error?.message);
  }
  function cancel() {
    const old = prepared;
    prepared = null;
    old?.controller.abort();
  }
  function start({ tabId } = {}) {
    cancel();
    const attempt = { tabId, complete: false, controller: new AbortController(), entries: [], confirmation: null };
    prepared = attempt;
    attempt.preparation = (async () => {
      try {
        attempt.entries = selectedTabs(tabId).map(tab => ({
          tab: { id: tab.id, file: tab.file, actorUserId: tab.actorUserId },
          participant: participants.get(tab.id), revision: null, proof: null, receipt: null,
        }));
        if (tabId !== undefined && attempt.entries.length !== 1) throw new Error('This document tab is no longer open.');
        // A partial contract cannot silently downgrade to a local-only save.
        for (const entry of attempt.entries) {
          const p = entry.participant;
          if (!p || typeof p.saveLocal !== 'function' || typeof p.getRevision !== 'function') {
            throw new Error('A document is still loading. Wait for it to finish, then close again.');
          }
          const trio = [p.prepareClose, p.validateClose, p.isCloseCurrent];
          entry.contract = trio;
          if (trio.some(value => value !== undefined)) {
            if (!trio.every(value => typeof value === 'function')) throw new Error('This document cannot confirm its complete local save yet.');
            entry.proof = { prepare: p.prepareClose, validate: p.validateClose, current: p.isCloseCurrent };
          }
        }
        await Promise.all(attempt.entries.map(async entry => {
          const result = await waitFor(() => entry.participant.saveLocal(), attempt.controller.signal);
          if (result?.saved !== true || typeof result.revision !== 'string') throw new Error(result?.reason || 'A local document save failed. Keep it open and retry Save.');
          entry.revision = result.revision;
        }));
        if (!matches(attempt)) throw cancelError();
        await Promise.all(attempt.entries.map(async entry => {
          if (!entry.proof) return;
          entry.receipt = await waitFor(() => entry.proof.prepare.call(entry.participant,
            { signal: attempt.controller.signal }), attempt.controller.signal);
          // A complete contract may explicitly prove that no extra receipt is
          // needed for a local-only file. Never infer that from a null value.
          if (entry.proof.current.call(entry.participant, entry.receipt) !== true) throw new Error('The local close receipt is no longer current.');
        }));
        attempt.complete = true;
        if (!valid(attempt)) throw cancelError();
        const result = success(attempt);
        preparations.set(result, attempt);
        return result;
      } catch (error) { return fail(attempt, error); }
    })();
    return attempt;
  }
  function confirmAttempt(attempt) {
    try {
      if (!valid(attempt)) return Promise.resolve(failure());
      if (attempt.confirmation) return attempt.confirmation;
      attempt.confirmation = (async () => {
        try {
          await Promise.all(attempt.entries.map(async entry => {
            if (!entry.proof) return;
            const result = await waitFor(() => entry.proof.validate.call(entry.participant, entry.receipt,
              { signal: attempt.controller.signal }), attempt.controller.signal);
            if (result !== true) throw new Error('The saved local document could not be verified.');
          }));
          if (!valid(attempt)) throw cancelError();
          return success(attempt);
        } catch (error) { return fail(attempt, error); }
      })();
      const confirmation = attempt.confirmation;
      confirmation.finally(() => {
        if (attempt.confirmation === confirmation) attempt.confirmation = null;
      }).catch(() => {});
      return attempt.confirmation;
    } catch (error) { return Promise.resolve(attempt ? fail(attempt, error) : failure()); }
  }
  return {
    register(tabId, participant) {
      participants.set(tabId, participant);
      return () => { if (participants.get(tabId) === participant) participants.delete(tabId); };
    },
    prepare: options => start(options).preparation,
    // Native IPC keeps its exact prepare result across the round trip. A tab
    // close that supersedes it must not donate its newer proof to the old quit.
    confirm: preparation => confirmAttempt(preparation === undefined ? prepared : preparations.get(preparation)),
    async prepareTabClose(tabId) {
      // Retain this exact attempt across awaits; never adopt another close's
      // receipt when a native quit or another tab close supersedes it.
      if (typeof tabId !== 'string' || !tabId) return failure('A document tab is required.');
      const attempt = start({ tabId });
      const result = await attempt.preparation;
      return result.saved === true ? confirmAttempt(attempt) : result;
    },
    cancel,
  };
}
