import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocumentUploadJournal } from '../services/documentUploadJournal.js';
import { createDocumentUploadCloud } from '../services/documentUploadCloud.js';
import { stageDocumentUpload, runDocumentUpload, withDocumentUploadLock } from './documentUploadRecovery.js';
import { preparePdfUpload, readPdfPageCount } from './pdfUploadWork.js';
import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer.js';
import { computeContentSha256 } from '../services/contentHash.js';
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';

const prepareFile = file => preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256 });
const readPageCount = file => readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs }).catch(() => null);
const stale = () => Object.assign(new Error('The account or upload view changed. Saved retry bytes were kept.'), { code: 'scope-changed' });

// List only local metadata. Never poll or replay cloud work on startup. A new
// render token retires work on account/view changes, including A -> B -> A.
export function useDocumentUploadRecovery({ actorId, tier, client, active = true, onSaved, chooseAlias,
  getJournal = getDocumentUploadJournal, makeCloud = createDocumentUploadCloud }) {
  const scopeRef = useRef(null);
  if (scopeRef.current?.actorId !== actorId || scopeRef.current?.active !== active) scopeRef.current = { actorId, active };
  const scope = scopeRef.current;
  const mounted = useRef(false), busyRef = useRef(null), generation = useRef(0);
  const [snapshot, setSnapshot] = useState(null), [work, setWork] = useState(null);
  const current = useCallback(() => mounted.current && scopeRef.current === scope && !!actorId && active, [scope, actorId, active]);
  const refresh = useCallback(async () => {
    if (!current()) return;
    const request = ++generation.current;
    try {
      const rows = await getJournal().list(actorId);
      if (current() && request === generation.current) setSnapshot({ scope, rows, error: '' });
    } catch {
      if (current() && request === generation.current) setSnapshot(previous => ({ scope,
        rows: previous?.scope === scope ? previous.rows : [], error: 'Could not read file upload recovery on this device.' }));
    }
  }, [actorId, current, getJournal, scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active || !actorId) return undefined;
    void refresh();
    let timer;
    const changed = () => {
      if (busyRef.current?.scope === scope) return;
      clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150);
    };
    const visible = () => { if (document.visibilityState === 'visible') changed(); };
    window.addEventListener('document-upload-journal-changed', changed);
    window.addEventListener('focus', changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++; clearTimeout(timer);
      window.removeEventListener('document-upload-journal-changed', changed);
      window.removeEventListener('focus', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, actorId, refresh, scope]);

  const perform = async (action, operation) => {
    if (!current()) throw stale();
    if (busyRef.current?.scope === scope) throw new Error('A file upload action is already running.');
    const token = { scope, action, error: '' };
    busyRef.current = token; setWork(token);
    let refreshed = false;
    try {
      const result = await operation(getJournal());
      if (!current()) throw stale();
      if (action !== 'discard') {
        try { await onSaved?.(result); } catch { /* Read failures do not undo confirmed writes. */ }
      }
      if (!current()) throw stale();
      await refresh(); refreshed = true;
      if (!current()) throw stale();
      setWork({ scope, notice: action === 'discard' ? 'Local retry copy removed. Cloud files were not changed.' : 'File saved to the cloud.' });
      return result;
    } catch (error) {
      if (current()) setWork({ scope, action, error: error.attemptId && error.recoveryCreated !== false
        ? 'This file upload needs attention. Its saved bytes and unfinished steps are kept for retry. Cloud work may already be saved.'
        : 'Could not start this file upload. Keep the original file and check device storage. No retry copies were removed.' });
      throw error;
    } finally {
      if (current() && !refreshed) await refresh();
      if (busyRef.current === token) busyRef.current = null;
      if (current()) setWork(previous => previous?.scope === scope ? { ...previous, action: null } : previous);
    }
  };
  const run = async (journal, attemptId) => {
    const attempt = await journal.get(actorId, attemptId);
    if (!current()) throw stale();
    const cloud = attempt?.phase === 'complete' ? {} : await makeCloud({ client, actorId, tier, isCurrent: current });
    if (!current()) throw stale();
    return runDocumentUpload({ actorId, attemptId, journal, cloud, isCurrent: current, readPageCount,
      chooseAlias: async (row, name) => {
        if (!current()) throw stale();
        const answer = await chooseAlias?.(row, name);
        if (!current()) throw stale();
        if (![true, false, 'add-alias', 'skip-alias'].includes(answer)) {
          throw Object.assign(new Error('Choose whether to keep the extra file name before retry can finish.'), { code: 'alias-choice-required' });
        }
        return answer === true || answer === 'add-alias';
      } });
  };
  return {
    isCurrent: current,
    rows: snapshot?.scope === scope ? snapshot.rows : [],
    listError: snapshot?.scope === scope ? snapshot.error : '',
    busy: work?.scope === scope && !!work.action,
    error: work?.scope === scope ? work.error || '' : '',
    notice: work?.scope === scope ? work.notice || '' : '', refresh,
    start: ({ file, prepared, projectId = null, archiveDocument = null }) => perform('upload', async journal => {
      const attemptId = await stageDocumentUpload({ actorId, projectId, file, archiveDocument, journal,
        prepareFile: prepared ? async () => prepared : prepareFile, isCurrent: current });
      try { return await run(journal, attemptId); }
      catch (error) { if (!error.attemptId) error.attemptId = attemptId; throw error; }
    }),
    retry: attemptId => perform('retry', async journal => {
      try { return await run(journal, attemptId); }
      catch (error) { if (!error.attemptId) error.attemptId = attemptId; throw error; }
    }),
    discard: attemptId => perform('discard', journal => withDocumentUploadLock({ actorId, attemptId, isCurrent: current }, async () => {
      if (!current()) throw stale();
      return journal.discard(actorId, attemptId);
    })),
  };
}
