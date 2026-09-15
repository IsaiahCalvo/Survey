import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { useDocumentFirstGenerationAdoption } from '../src/hooks/useDocumentFirstGenerationAdoption.js';
import { createDocumentFirstGenerationAdoptionClient } from '../src/services/documentFirstGenerationAdoptionClient.js';
import { createDocumentFirstGenerationAdoptionIntentStore } from '../src/services/documentFirstGenerationAdoptionIntentStore.js';

const id = n => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1), actorB = id(2), documentId = id(3);
const review = Object.freeze({ state: 'review', review_sha256: 'a'.repeat(64) });
const sha = char => char.repeat(64);

const adoptionReceipt = (state, row) => ({ version: 1, state,
  actor_user_id: actorA, owner_user_id: actorA, document_id: documentId,
  adoption_operation_id: row.ids.adoptionOperationId, source_id: row.ids.sourceId,
  candidate_operation_id: row.ids.candidateOperationId,
  offered_archive_operation_ids: [...row.ids.archiveOperationIds],
  used_archive_operation_ids: [row.ids.archiveOperationIds[0]],
  review_sha256: sha('a'), source_sql_sha256: sha('b'), wal_head: '4',
  objects: [{ kind: 'pdf', byte_length: '120', content_sha256: sha('c') }],
  canonical_annotations: { version: 1, policy: 'legacy-sql-v1', through_seq: '4',
    baseline_sha256: sha('e'), contributors: ['annotation-wal'] },
  entity_catalog: { status: 'accepted', revision: '2', content_sha256: sha('f') },
  survey_definition: { status: 'absent', revision: null, content_sha256: null },
  expires_at: '2026-09-16T12:00:00.000Z',
  ...(['confirmed', 'published'].includes(state)
    ? { confirmed_at: '2026-09-15T12:00:00.000Z' } : {}),
  ...(state === 'published' ? { generation_id: id(9), content_model_version: 2,
    pdf: { byte_length: '120', content_sha256: sha('c') },
    legacy_sidecar_migration: { version: 2, state: 'archived',
      origin: { mode: 'legacy', adoption_operation_id: row.ids.adoptionOperationId } },
    published_at: '2026-09-15T12:01:00.000Z' } : {}),
});

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

const waitFor = async predicate => {
  for (let tries = 0; tries < 100; tries++) {
    if (predicate()) return;
    await act(async () => new Promise(resolve => setImmediate(resolve)));
  }
  assert.fail('mounted adoption hook did not settle');
};

function mount(t) {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window,
    document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of [...prior].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return root;
}

function Probe({ input, report }) {
  report(useDocumentFirstGenerationAdoption(input));
  return null;
}

const base = client => ({ enabled: true, actorUserId: actorA, documentId, legacy: true,
  ownerHint: true, client, captureAccepted: async () => ({ local: 'preflight' }),
  revalidateCapture: async () => true, retireGeneration: async () => {},
  install: async () => true, isCurrent: () => true });

test('same mounted review retries a durable consent failure through resume', async t => {
  const root = mount(t);
  const calls = { confirm: 0, resume: 0 };
  const client = {
    resume: async () => {
      calls.resume++;
      if (calls.resume === 1) return { status: 'no-intent', row: null };
      return { status: 'published', row: { phase: 'published' } };
    },
    review: async () => ({ needsReview: true, row: { phase: 'review', receipt: review } }),
    confirm: async () => {
      calls.confirm++;
      throw new Error('The confirmed upgrade was kept for retry.');
    },
  };
  let latest;
  await act(async () => root.render(React.createElement(Probe, {
    input: base(client), report: value => { latest = value; },
  })));
  await waitFor(() => calls.resume === 1 && !latest.busy);
  await act(async () => { await latest.requestReview(); });
  assert.equal(latest.review, review);
  await assert.rejects(async () => {
    await act(async () => { await latest.confirm(); });
  }, /kept for retry/);
  await waitFor(() => latest.error === 'The confirmed upgrade was kept for retry.');
  assert.equal(latest.review, review, 'the same review stays visible for a deliberate retry');
  assert.equal(latest.error, 'The confirmed upgrade was kept for retry.');
  await act(async () => { await latest.confirm(); });
  assert.equal(calls.confirm, 1, 'the durable consent is not submitted as a fresh confirm');
  assert.equal(calls.resume, 2, 'the second user action resumes the saved phase');
  assert.equal(latest.review, null);
  assert.equal(latest.error, '');
});

test('an actor change hides a prior review and rejects its late result', async t => {
  const root = mount(t);
  const late = deferred();
  let latest;
  const client = {
    resume: async () => ({ status: 'no-intent', row: null }),
    review: async () => late.promise,
    confirm: async () => assert.fail('late review must not confirm'),
  };
  const inputA = base(client);
  await act(async () => root.render(React.createElement(Probe, {
    input: inputA, report: value => { latest = value; },
  })));
  await waitFor(() => !latest.busy);
  let request;
  await act(async () => { request = latest.requestReview(); });
  assert.equal(latest.busy, true);
  await act(async () => root.render(React.createElement(Probe, {
    input: { ...inputA, actorUserId: actorB }, report: value => { latest = value; },
  })));
  assert.equal(latest.review, null);
  late.resolve({ needsReview: true, row: { phase: 'review', receipt: review } });
  await assert.rejects(request, /document or account changed/i);
  assert.equal(latest.review, null);
});

test('guest, checked, and non-owner scopes stay unavailable and do no client work', async t => {
  const root = mount(t);
  let latest, work = 0;
  const client = new Proxy({}, { get: () => async () => { work++; } });
  for (const input of [
    { ...base(client), actorUserId: null },
    { ...base(client), legacy: false },
    { ...base(client), ownerHint: false },
    { ...base(client), enabled: false },
  ]) {
    await act(async () => root.render(React.createElement(Probe, {
      input, report: value => { latest = value; },
    })));
    assert.equal(latest.available, false);
  }
  assert.equal(work, 0);
});

test('a cold saved consent can retry from the offer without preview or confirm', async t => {
  const root = mount(t);
  const calls = { resume: 0, review: 0, confirm: 0 };
  const client = {
    resume: async () => {
      calls.resume++;
      if (calls.resume === 1) throw new Error('The saved consent is offline.');
      return { status: 'published', row: { phase: 'published' } };
    },
    review: async () => {
      calls.review++;
      return { needsReview: false, row: { phase: 'consent', receipt: review } };
    },
    confirm: async () => { calls.confirm++; },
  };
  let latest;
  await act(async () => root.render(React.createElement(Probe, {
    input: base(client), report: value => { latest = value; },
  })));
  await waitFor(() => latest.error === 'The saved consent is offline.');
  assert.equal(latest.review, null);
  await act(async () => { await latest.requestReview(); });
  assert.deepEqual(calls, { resume: 2, review: 1, confirm: 0 });
  assert.equal(latest.error, '');
  assert.equal(latest.review, null);
});

test('a mounted confirm accepts the exact checked install that retires its legacy scope', async t => {
  const root = mount(t);
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let legacyCurrent = true, latest, resumes = 0, resumeSettled = false;
  const deepClient = createDocumentFirstGenerationAdoptionClient({ store,
    transport: async ({ body }) => {
      const row = await store.get(actorA, documentId);
      if (body.action === 'preview') return adoptionReceipt('review', row);
      if (body.action === 'confirm') return adoptionReceipt('confirmed', row);
      if (body.action === 'publish') return adoptionReceipt('published', row);
      throw new Error(`unexpected action ${body.action}`);
    },
    getActorUserId: () => actorA,
    getAccessToken: async () => 'token-a',
    isCurrent: ({ actorUserId, documentId: currentDocumentId }) => legacyCurrent
      && actorUserId === actorA && currentDocumentId === documentId,
    reacquire: async () => {
      const row = await store.get(actorA, documentId);
      return { mode: 'checked', actorUserId: actorA, documentId,
        checkedBundle: { pdfGenerationId: row.receipt.generation_id, contentModelVersion: 2,
          pdf: { ...row.receipt.pdf }, legacy_sidecar_migration: row.receipt.legacy_sidecar_migration } };
    },
  });
  const client = { review: input => deepClient.review(input), confirm: input => deepClient.confirm(input),
    resume: async input => { resumes++; try { return await deepClient.resume(input); }
      finally { resumeSettled = true; } } };
  const input = { ...base(client), isCurrent: () => legacyCurrent,
    install: async ({ opened }) => {
      assert.equal(opened.mode, 'checked');
      legacyCurrent = false;
      return true;
    } };
  await act(async () => root.render(React.createElement(Probe, {
    input, report: value => { latest = value; },
  })));
  await waitFor(() => resumes === 1 && resumeSettled && !latest.busy);
  let returnedReview;
  await act(async () => { returnedReview = await latest.requestReview(); });
  assert.equal(returnedReview?.review_sha256, sha('a'));
  await waitFor(() => latest.review?.review_sha256 === sha('a'));
  assert.equal(latest.review?.review_sha256, sha('a'));
  await act(async () => { await latest.confirm(); });
  assert.equal(await store.get(actorA, documentId), null,
    'the exact published intent clears only after the checked install succeeds');
});
