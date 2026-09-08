import { useCallback, useEffect, useRef, useState } from 'react';
import { getProjectUploadJournal } from '../services/projectUploadJournal.js';
import { createProjectUploadCloud } from '../services/projectUploadCloud.js';
import { stageProjectUpload, resumeStaging, runProjectUpload, withProjectUploadLock } from './projectUploadRecovery.js';
import { preparePdfUpload, readPdfPageCount } from './pdfUploadWork.js';
import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer.js';
import { computeContentSha256 } from '../services/contentHash.js';
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';

const prepareFile = file => preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256 });
const readPageCount = file => readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs }).catch(() => null);
const stale = () => Object.assign(new Error('The signed-in account changed. Saved upload copies were kept.'), { code: 'actor-changed' });

// No polling or automatic cloud replay. Lists contain metadata only. The scope
// token changes during render so even A -> B -> A retires the first A's work.
export function useProjectUploadRecovery({ actorId, tier, client, active = true, onSaved,
  getJournal = getProjectUploadJournal, makeCloud = createProjectUploadCloud }) {
  const scopeRef = useRef(null);
  if (scopeRef.current?.actorId !== actorId) scopeRef.current = { actorId };
  const scope = scopeRef.current;
  const mounted = useRef(false);
  const busyRef = useRef(null);
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState(null);
  const [work, setWork] = useState(null);
  const current = useCallback(() => mounted.current && scopeRef.current === scope && !!actorId, [scope, actorId]);
  const refresh = useCallback(async () => {
    if (!current() || !active) return;
    const request = ++generation.current;
    try {
      const rows = await getJournal().list(actorId);
      if (current() && request === generation.current) setSnapshot({ scope, rows, error: '' });
    } catch {
      if (current() && request === generation.current) setSnapshot(previous => ({ scope,
        rows: previous?.scope === scope ? previous.rows : [],
        error: 'Could not read upload recovery on this device. Try refreshing the list.' }));
    }
  }, [active, actorId, current, getJournal, scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active || !actorId) return undefined;
    void refresh();
    let timer;
    const changed = () => {
      if (busyRef.current?.scope === scope) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, 150);
    };
    const visible = () => { if (document.visibilityState === 'visible') changed(); };
    window.addEventListener('project-upload-journal-changed', changed);
    window.addEventListener('focus', changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++;
      clearTimeout(timer);
      window.removeEventListener('project-upload-journal-changed', changed);
      window.removeEventListener('focus', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, actorId, refresh, scope]);

  const perform = async (action, operation) => {
    if (!current()) throw stale();
    if (busyRef.current?.scope === scope) throw new Error('An upload action is already running.');
    const token = { scope, action, error: '' };
    busyRef.current = token; setWork(token);
    let refreshed = false;
    try {
      const result = await operation(getJournal());
      if (!current()) throw stale();
      if (result?.attemptId) setSnapshot(previous => previous?.scope === scope
        ? { ...previous, rows: previous.rows.filter(row => row.id !== result.attemptId) } : previous);
      if (action !== 'discard') {
        // Refresh errors must not turn confirmed persistence into an upload failure.
        try { await onSaved?.(); } catch { /* hooks expose their own read errors */ }
      }
      if (!current()) throw stale();
      await refresh(); refreshed = true;
      if (!current()) throw stale();
      setWork({ scope, notice: action === 'discard' ? 'Local retry copies removed. Cloud files were not changed.' : 'Project saved to the cloud.' });
      return result;
    } catch (error) {
      if (current()) setWork({ scope, error: error.attemptId && error.recoveryCreated !== false
        ? 'This upload needs attention. Any staged PDFs are kept here. Retry the saved attempt below; cloud work may already be saved.'
        : 'Could not start this upload action. No retry copies have been removed. Check device storage and try again.' });
      throw error;
    } finally {
      if (busyRef.current === token) busyRef.current = null;
      if (current()) { setWork(previous => previous?.scope === scope ? { ...previous, action: null } : previous); if (!refreshed) await refresh(); }
    }
  };
  const run = async (journal, attemptId) => {
    if (!current()) throw stale();
    const attempt = await journal.get(actorId, attemptId);
    if (!current()) throw stale();
    // A confirmed attempt may only need local cleanup; do not require network.
    const cloud = attempt?.phase === 'complete' ? {} : await makeCloud({ client, actorId, tier, isCurrent: current });
    if (!current()) throw stale();
    return runProjectUpload({ actorId, attemptId, journal, cloud: { ...cloud, readPageCount }, isCurrent: current });
  };
  return {
    rows: snapshot?.scope === scope ? snapshot.rows : [],
    listError: snapshot?.scope === scope ? snapshot.error : '',
    busy: work?.scope === scope && !!work.action,
    error: work?.scope === scope ? work.error || '' : '',
    notice: work?.scope === scope ? work.notice || '' : '',
    refresh,
    start: (name, files) => perform('upload', async journal => {
      const attemptId = await stageProjectUpload({ actorId, name, files, journal, prepareFile, isCurrent: current });
      try { return await run(journal, attemptId); }
      catch (error) { if (!error.attemptId) error.attemptId = attemptId; throw error; }
    }),
    retry: (attemptId, files) => perform('retry', async journal => {
      if (files) await resumeStaging({ actorId, attemptId, files, journal, prepareFile, isCurrent: current });
      try { return await run(journal, attemptId); }
      catch (error) { if (!error.attemptId) error.attemptId = attemptId; throw error; }
    }),
    discard: attemptId => perform('discard', journal => withProjectUploadLock({ actorId, attemptId, isCurrent: current }, async () => {
      if (!current()) throw stale();
      return journal.discard(actorId, attemptId);
    })),
  };
}
