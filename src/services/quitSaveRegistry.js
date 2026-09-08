// One renderer window owns one registry. AppShell supplies every open PDF tab,
// not only the active viewer, so a missing/lazy participant cannot count as saved.
export function createQuitSaveRegistry(getTabs) {
  const participants = new Map();
  let prepared = null;
  const failure = (reason) => ({ saved: false, tabIds: [], ...(reason ? { reason } : {}) });
  const valid = (attempt) => {
    if (prepared !== attempt || !attempt?.complete) return false;
    const tabs = getTabs();
    if (tabs.length !== attempt.entries.length) return false;
    return attempt.entries.every((entry, index) => (
      tabs[index].id === entry.tab.id && tabs[index].file === entry.tab.file
      && tabs[index].actorUserId === entry.tab.actorUserId
      && participants.get(entry.tab.id) === entry.participant
      && entry.participant.getRevision() === entry.revision
    ));
  };
  return {
    register(tabId, participant) {
      participants.set(tabId, participant);
      return () => { if (participants.get(tabId) === participant) participants.delete(tabId); };
    },
    async prepare() {
      const attempt = { complete: false, entries: getTabs().map((tab) => ({
        tab: { id: tab.id, file: tab.file, actorUserId: tab.actorUserId },
        participant: participants.get(tab.id), revision: null,
      })) };
      prepared = attempt;
      try {
        const results = await Promise.all(attempt.entries.map(async (entry) => {
          if (!entry.participant) return { saved: false, reason: 'A document is still loading. Wait for it to finish, then close again.' };
          const result = await entry.participant.saveLocal();
          if (result?.saved !== true || typeof result.revision !== 'string') return result || { saved: false };
          entry.revision = result.revision;
          return { saved: true };
        }));
        const failed = results.find((result) => result.saved !== true);
        if (failed) return failure(failed.reason);
        attempt.complete = true;
        return valid(attempt) ? { saved: true, tabIds: attempt.entries.map((entry) => entry.tab.id) } : failure();
      } catch { return failure(); }
    },
    confirm() {
      try {
        return valid(prepared) ? { saved: true, tabIds: prepared.entries.map((entry) => entry.tab.id) } : failure();
      } catch { return failure(); }
    },
    cancel() { prepared = null; },
  };
}
