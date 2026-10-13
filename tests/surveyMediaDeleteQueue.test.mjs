// Codex review (release PR, P1): removing a photo from a Survey Marker drops
// the note's reference first; a failed storage delete was only logged, so the
// file's path was lost and it kept using the uploader's storage quota.
// Now the path is queued per user and retried (app start, 'online', after a
// later successful media upload/removal) until it is removed, already gone,
// or storage says this user may not remove it.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  __setSurveyMediaClientForTests,
  deleteSurveyMedia,
  deleteSurveyMediaPaths,
} from '../src/services/surveyMediaService.js';
import {
  __setSurveyMediaDeleteQueueForTests,
  deleteSurveyMediaOrQueue,
  queueSurveyMediaDeletes,
  readSurveyMediaDeleteQueue,
  retrySurveyMediaDeletes,
  retrySurveyMediaDeletesSoon,
  startSurveyMediaDeleteRetry,
} from '../src/services/surveyMediaDeleteQueue.js';
import { fakeSurveyMediaCloud, memoryStorage } from './helpers/fakeSurveyMediaStorage.mjs';

const DOC = '11111111-2222-4333-8444-555555555555';
const MARKER = 'surveyMarker-1';
const P1 = `${DOC}/${MARKER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
const P2 = `${DOC}/${MARKER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
const P3 = `${DOC}/${MARKER}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.m4a`;
const OWNER = 'owner-1';
const EDITOR = 'editor-1';
const OTHER = 'editor-2';

let store;
let cloud;
function setup({ uid = EDITOR, objects = { [P1]: EDITOR, [P2]: OTHER } } = {}) {
  cloud = fakeSurveyMediaCloud({
    uid,
    documents: { [DOC]: { owner: OWNER, members: [EDITOR, OTHER] } },
    objects,
  });
  store = memoryStorage();
  __setSurveyMediaClientForTests(cloud.client);
  __setSurveyMediaDeleteQueueForTests({ storage: store });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  __setSurveyMediaClientForTests(null);
  __setSurveyMediaDeleteQueueForTests();
});

describe('deleteSurveyMediaPaths tells removed, gone, not-allowed and failed apart', () => {
  beforeEach(() => setup());

  it('own upload: deleted; already gone: gone; another editor\'s upload: forbidden (Storage gives no error)', async () => {
    const outcome = await deleteSurveyMediaPaths([P1, P2, P3]);
    assert.deepEqual(outcome.deleted, [P1]);
    assert.deepEqual(outcome.gone, [P3]);
    assert.deepEqual(outcome.forbidden, [P2]);
    assert.deepEqual(outcome.failed, []);
    assert.ok(cloud.state.objects.has(P2), 'policy kept the other editor\'s file');
  });

  it('offline: every path failed (retryable)', async () => {
    cloud.state.offline = true;
    const outcome = await deleteSurveyMediaPaths([P1]);
    assert.deepEqual(outcome.failed.map((entry) => entry.path), [P1]);
    assert.equal(outcome.failed[0].code, 'network');
  });

  it('deleteSurveyMedia throws "forbidden" instead of reporting success when the file stays', async () => {
    await assert.rejects(deleteSurveyMedia({ path: P2 }), (error) => error.code === 'forbidden');
    assert.equal(await deleteSurveyMedia({ path: P1 }), true);
  });
});

describe('the retry queue', () => {
  beforeEach(() => setup());

  it('a delete that fails offline keeps the path; the next retry removes it and empties the queue', async () => {
    cloud.state.offline = true;
    assert.equal(await deleteSurveyMediaOrQueue({ path: P1 }), 'queued');
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR).map((entry) => entry.path), [P1]);
    assert.ok(cloud.state.objects.has(P1));

    // Still offline: kept, attempt counted.
    let result = await retrySurveyMediaDeletes(EDITOR);
    assert.equal(result.remaining, 1);
    assert.equal(readSurveyMediaDeleteQueue(EDITOR)[0].attempts, 1);

    cloud.state.offline = false;
    result = await retrySurveyMediaDeletes(EDITOR);
    assert.deepEqual(result, { removed: 1, forbidden: 0, remaining: 0 });
    assert.equal(cloud.state.objects.has(P1), false);
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
    assert.equal(store.map.size, 0, 'an empty queue leaves no key behind');
  });

  it('a file this user may not remove is not queued (left for its uploader / the document owner)', async () => {
    assert.equal(await deleteSurveyMediaOrQueue({ path: P2 }), 'forbidden');
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });

  it('a queued path that turns out forbidden or already gone is dropped', async () => {
    queueSurveyMediaDeletes(EDITOR, [P2, P3]);
    const result = await retrySurveyMediaDeletes(EDITOR);
    assert.deepEqual(result, { removed: 1, forbidden: 1, remaining: 0 });
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });

  it('the queue is per user', async () => {
    queueSurveyMediaDeletes(EDITOR, [P1]);
    queueSurveyMediaDeletes(OTHER, [P2]);
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR).map((entry) => entry.path), [P1]);
    assert.deepEqual(readSurveyMediaDeleteQueue(OTHER).map((entry) => entry.path), [P2]);
    queueSurveyMediaDeletes(EDITOR, [P1]);
    assert.equal(readSurveyMediaDeleteQueue(EDITOR).length, 1, 'a path is queued once');
  });

  it('a later successful removal retries the older failures', async () => {
    const extra = `${DOC}/${MARKER}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg`;
    cloud.state.objects.set(extra, EDITOR);
    queueSurveyMediaDeletes(EDITOR, [P1]);
    assert.equal(await deleteSurveyMediaOrQueue({ path: extra }), 'deleted');
    await flush();
    await retrySurveyMediaDeletes(EDITOR); // joins the run already started
    assert.equal(cloud.state.objects.has(P1), false);
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });

  it('a later successful upload retries the older failures', async () => {
    queueSurveyMediaDeletes(EDITOR, [P1]);
    retrySurveyMediaDeletesSoon();
    for (let i = 0; i < 5 && readSurveyMediaDeleteQueue(EDITOR).length > 0; i += 1) await flush();
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });

  it('app start retries at once and again when the device comes back online', async () => {
    const listeners = new Map();
    const realWindow = globalThis.window;
    globalThis.window = {
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
    };
    try {
      cloud.state.offline = true;
      queueSurveyMediaDeletes(EDITOR, [P1]);
      const stop = startSurveyMediaDeleteRetry(EDITOR);
      await flush();
      assert.equal(readSurveyMediaDeleteQueue(EDITOR).length, 1, 'still offline: kept');
      cloud.state.offline = false;
      listeners.get('online')();
      for (let i = 0; i < 5 && readSurveyMediaDeleteQueue(EDITOR).length > 0; i += 1) await flush();
      assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
      stop();
      assert.equal(listeners.has('online'), false);
    } finally {
      globalThis.window = realWindow;
    }
  });

  it('localStorage that throws never breaks a removal (falls back to log-only)', async () => {
    __setSurveyMediaDeleteQueueForTests({ storage: memoryStorage({ broken: true }) });
    cloud.state.offline = true;
    assert.equal(await deleteSurveyMediaOrQueue({ path: P1 }), 'queued');
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
    assert.deepEqual(await retrySurveyMediaDeletes(EDITOR), { removed: 0, forbidden: 0, remaining: 0 });
  });

  it('a corrupt stored value reads as an empty queue', () => {
    store.setItem(`surveyMedia.pendingDeletes.v1:${EDITOR}`, '{not json');
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });
});

describe('wiring', () => {
  it('SurveyMarkerNotes removes media through the queue and retries after an upload; AppShell starts the retry', () => {
    const notes = readFileSync(new URL('../src/components/SurveyMarkerNotes.jsx', import.meta.url), 'utf8');
    assert.match(notes, /deleteSurveyMediaOrQueue\(item\)/);
    assert.match(notes, /retrySurveyMediaDeletesSoon\(\)/);
    assert.doesNotMatch(notes, /deleteSurveyMedia\(item\)\.catch/);
    const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
    assert.match(shell, /startSurveyMediaDeleteRetry\(signedInUserId\)/);
  });
});
