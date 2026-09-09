import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageReplacementRecoveryNotice from '../components/PageReplacementRecoveryNotice.jsx';
import { createDocumentPageReplacementClient } from '../services/documentPageReplacementClient.js';
import { createDocumentPageReplacementIntentStore } from '../services/documentPageReplacementIntentStore.js';
import { emptyCheckedPageStructure } from '../services/checkedPageStructure.js';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const GENERATION_ID = '33333333-3333-4333-8333-333333333333';

export default function PageReplacementExpiredHarness() {
  const dbName = useMemo(() => `survey-expired-page-replacement-fixture-${randomUUID()}`, []);
  const mountedRef = useRef(true);
  const store = useMemo(() => createDocumentPageReplacementIntentStore({
    indexedDB: globalThis.indexedDB, dbName, timeoutMs: 2_000,
  }), [dbName]);
  const lastBodyRef = useRef(null);
  const [recovery, setRecovery] = useState(null);
  const [lastCleared, setLastCleared] = useState(null);
  const [status, setStatus] = useState('Starting the expired-request fixture…');
  const [failClear, setFailClear] = useState(false);

  const client = useMemo(() => createDocumentPageReplacementClient({
    store,
    getActorUserId: () => ACTOR_ID,
    getAccessToken: async () => 'fixture-token-not-live-auth',
    isCurrent: ({ actorUserId, documentId }) => mountedRef.current
      && actorUserId === ACTOR_ID && documentId === DOCUMENT_ID,
    reacquire: async () => { throw new Error('The expiry fixture must not reacquire.'); },
    responseTimeoutMs: 2_000,
    transport: async ({ body }) => {
      lastBodyRef.current = structuredClone(body);
      return new Response(JSON.stringify({
        error: { code: 'replacement_expired', message: 'Fixture request expired.' },
        terminal: {
          version: 1, state: 'expired', actor_user_id: ACTOR_ID,
          document_id: body.document_id, source_id: body.source_id,
          candidate_operation_id: body.candidate_operation_id,
          archive_operation_ids: body.archive_operation_ids,
          expected_generation_id: body.generation_id,
          expected_wal_head: body.wal_head, operation: body.operation,
          prepared_at: '2026-09-09T12:00:00.000Z',
          expires_at: '2026-09-09T14:00:00.000Z',
        },
      }), { status: 409, headers: { 'content-type': 'application/json' } });
    },
  }), [store]);

  const seed = useCallback(async () => {
    setStatus('Creating one fixture-only expired request…');
    try {
      await client.replace({ documentId: DOCUMENT_ID,
        operation: { type: 'duplicate', page: 1 },
        localPageState: emptyCheckedPageStructure(), currentGenerationId: GENERATION_ID,
        captureAccepted: async () => ({ version: 1, actorUserId: ACTOR_ID,
          documentId: DOCUMENT_ID, pdfGenerationId: GENERATION_ID, coveredSeq: 0 }),
        revalidateCapture: async () => true,
        persistSourceLocalState: async () => {},
        retireGeneration: async () => {}, install: async () => false });
    } catch (error) {
      if (!mountedRef.current || error?.code !== 'DOCUMENT_PAGE_REPLACEMENT_EXPIRED') {
        setStatus('Fixture setup failed. No live cloud request was made.'); return;
      }
      const next = Object.freeze({ actorUserId: ACTOR_ID, documentId: DOCUMENT_ID,
        candidateOperationId: error.recovery.candidateOperationId,
        revision: error.recovery.revision });
      setRecovery(next);
      setStatus('Expired request is saved and blocks a new page action.');
    }
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    void seed();
    return () => {
      mountedRef.current = false;
      store.close();
      try { globalThis.indexedDB.deleteDatabase(dbName); } catch { /* exact fixture DB only */ }
    };
  }, [dbName, seed, store]);

  const clear = async exact => {
    if (failClear) throw new Error('Fixture clear failure');
    await client.resetExpired({ documentId: exact.documentId,
      expectedRevision: exact.revision, candidateOperationId: exact.candidateOperationId });
    setLastCleared(exact); setRecovery(null);
    setStatus('Expired request cleared. No page change was run.');
  };

  const staleClear = async () => {
    if (!lastCleared) return;
    try {
      await client.resetExpired({ documentId: DOCUMENT_ID,
        expectedRevision: lastCleared.revision,
        candidateOperationId: lastCleared.candidateOperationId });
      setStatus('Unexpected stale reset success.');
    } catch {
      setStatus('Old reset token was rejected; the current request was kept.');
    }
  };

  return <main style={{ minHeight: '100vh', padding: '190px 28px 28px', background: '#f5f5f5',
    color: '#20242b', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    <h1 style={{ fontSize: 22 }}>Expired page request recovery fixture</h1>
    <p data-fixture-scope="local-only">Fixture only: native browser storage and a local test reply. No live auth or cloud service.</p>
    <p data-fixture-status>{status}</p>
    <label style={{ display: 'block', margin: '12px 0' }}>
      <input type="checkbox" checked={failClear}
        onChange={event => setFailClear(event.target.checked)} /> Test a failed clear
    </label>
    {!recovery && <button type="button" onClick={() => { void seed(); }}>
      Create next expired fixture request
    </button>}
    {lastCleared && recovery && <button type="button" style={{ marginLeft: 8 }}
      onClick={() => { void staleClear(); }}>Try old reset token</button>}
    {lastBodyRef.current && <div data-current-candidate style={{ marginTop: 12, fontSize: 12 }}>
      Current fixture candidate: {lastBodyRef.current.candidate_operation_id}
    </div>}
    <PageReplacementRecoveryNotice recovery={recovery} onClear={clear} />
  </main>;
}
