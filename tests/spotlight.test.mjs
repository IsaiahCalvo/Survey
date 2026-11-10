// Spotlight (Nightly flag spotlight), copied from Drawboard Projects:
// present your view on the document's live channel, others follow it, a pan
// of their own pauses following, the presenter counts followers, and opening
// another sheet takes the followers along.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPOTLIGHT_VERSION, SPOTLIGHT_STALE_MS, __spotlightTest, applyRemoteSpotlight, clearSpotlightGo,
  follow, followAgain, getSpotlightSnapshot, registerSpotlightViewer, setSpotlightDocument,
  setSpotlightIdentity, setSpotlightSink, spotlightViewMovedByHand, startPresenting, stopFollowing,
  stopPresenting,
} from '../src/services/annotationSpotlight.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

function screen({ userId, name, doc = 'doc-1', writer = `w-${userId}` }) {
  const sent = [];
  __spotlightTest.reset();
  let now = 1_000_000;
  __spotlightTest.setNow(() => now);
  setSpotlightIdentity({ userId, name });
  setSpotlightSink({ documentId: doc, writerId: writer, send: (p) => { sent.push(p); return true; } });
  setSpotlightDocument(doc);
  return { sent, advance: (ms) => { now += ms; }, at: () => now };
}

test.afterEach(() => __spotlightTest.reset());

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS.spotlight?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110176000_spotlight.sql', import.meta.url), 'utf8');
  assert.match(sql, /'spotlight', 'off'/);
});

test('a presenter sends the view box in page units, only when it moves, plus a heartbeat', () => {
  const s = screen({ userId: 'u1', name: 'Ana Lee' });
  let view = { page: 2, rect: { x: 10.04, y: 20, width: 300, height: 200 } };
  registerSpotlightViewer({ readView: () => view, showView: () => true });
  startPresenting();
  assert.equal(getSpotlightSnapshot().presenting, true);
  assert.deepEqual(s.sent.at(-1), { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'p', p: 2, r: [10, 20, 300, 200], n: 'Ana Lee' });
  const count = s.sent.length;
  s.advance(200); __spotlightTest.tick();
  assert.equal(s.sent.length, count, 'a still view sends nothing');
  view = { page: 2, rect: { x: 50, y: 20, width: 300, height: 200 } };
  s.advance(200); __spotlightTest.tick();
  assert.equal(s.sent.length, count + 1);
  s.advance(2_000); __spotlightTest.tick();
  assert.equal(s.sent.length, count + 2, 'heartbeat');
  stopPresenting();
  assert.equal(s.sent.at(-1).k, 's');
  assert.equal(getSpotlightSnapshot().presenting, false);
});

test('a follower sees who presents, follows, and shows the presenter box', () => {
  const s = screen({ userId: 'u2', name: 'Ben' });
  const shown = [];
  registerSpotlightViewer({ readView: () => null, showView: (page, rect) => { shown.push([page, rect]); return true; } });
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'p', n: 'Ana Lee', p: 3, r: [1, 2, 300, 200] });
  assert.deepEqual(getSpotlightSnapshot().presenter, { userId: 'u1', name: 'Ana Lee', documentId: 'doc-1' });
  assert.equal(shown.length, 0, 'nothing moves before Follow');
  follow('u1');
  assert.deepEqual(shown.at(-1), [3, { x: 1, y: 2, width: 300, height: 200 }]);
  assert.deepEqual(s.sent.at(-1), { v: SPOTLIGHT_VERSION, w: 'w-u2', u: 'u2', k: 'f', t: 'u1' });
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'p', p: 4, r: [5, 6, 100, 80] });
  assert.deepEqual(shown.at(-1), [4, { x: 5, y: 6, width: 100, height: 80 }]);

  // A pan of the follower's own pauses following; "Follow again" jumps back.
  spotlightViewMovedByHand();
  assert.equal(getSpotlightSnapshot().paused, true);
  assert.equal(s.sent.at(-1).k, 'uf');
  const before = shown.length;
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'p', p: 5, r: [5, 6, 100, 80] });
  assert.equal(shown.length, before, 'paused: the view stays');
  followAgain();
  assert.deepEqual(shown.at(-1), [5, { x: 5, y: 6, width: 100, height: 80 }]);
  stopFollowing();
  assert.equal(getSpotlightSnapshot().following, null);
});

test('a view that cannot be shown yet (still opening) is tried again', () => {
  screen({ userId: 'u2' });
  let ready = false;
  const shown = [];
  registerSpotlightViewer({ readView: () => null, showView: (page) => { if (!ready) return false; shown.push(page); return true; } });
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'p', p: 2, r: [0, 0, 100, 100] });
  follow('u1');
  assert.equal(shown.length, 0);
  ready = true;
  __spotlightTest.tick();
  assert.deepEqual(shown, [2]);
});

test('the presenter counts followers; a silent one drops off', () => {
  const s = screen({ userId: 'u1' });
  registerSpotlightViewer({ readView: () => ({ page: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }), showView: () => true });
  startPresenting();
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u2', u: 'u2', k: 'f', t: 'u1' });
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u3', u: 'u3', k: 'f', t: 'u1' });
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u4', u: 'u4', k: 'f', t: 'someone-else' });
  assert.equal(getSpotlightSnapshot().followerCount, 2);
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u3', u: 'u3', k: 'uf', t: 'u1' });
  assert.equal(getSpotlightSnapshot().followerCount, 1);
  s.advance(SPOTLIGHT_STALE_MS + 1); __spotlightTest.tick();
  assert.equal(getSpotlightSnapshot().followerCount, 0);
});

test('a presenter who opens another sheet takes followers along; Home ends it', () => {
  const s = screen({ userId: 'u1' });
  registerSpotlightViewer({ readView: () => ({ page: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }), showView: () => true });
  startPresenting();
  setSpotlightDocument('doc-2');
  assert.deepEqual(s.sent.at(-1), { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'go', d: 'doc-2' });
  setSpotlightDocument(null);
  assert.equal(getSpotlightSnapshot().presenting, false);

  // The follower's side: "go" from the followed presenter asks to open it.
  screen({ userId: 'u2' });
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'p', p: 1, r: [0, 0, 10, 10] });
  follow('u1');
  applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', k: 'go', d: 'doc-2' });
  const go = getSpotlightSnapshot().go;
  assert.equal(go?.documentId, 'doc-2');
  clearSpotlightGo(go.seq);
  assert.equal(getSpotlightSnapshot().go, null);
});

test('stop, silence, own messages and bad input', () => {
  const s = screen({ userId: 'u2' });
  const ok = (payload) => applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u1', u: 'u1', ...payload });
  assert.equal(ok({ k: 'p', p: 0, r: [0, 0, 1, 1] }), false);
  assert.equal(ok({ k: 'p', p: 1, r: [0, 0, -1, 1] }), false);
  assert.equal(ok({ k: 'p', p: 1, r: [0, 0, 'x', 1] }), false);
  assert.equal(applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'w-u2b', u: 'u2', k: 'p', p: 1, r: [0, 0, 1, 1] }), false, 'my own other screen');
  assert.equal(applyRemoteSpotlight('doc-1', { v: SPOTLIGHT_VERSION, w: 'mine', u: 'u1', k: 'p', p: 1, r: [0, 0, 1, 1] }, { ownWriterId: 'mine' }), false);
  assert.equal(ok({ k: 'p', p: 1, r: [0, 0, 1, 1] }), true);
  follow('u1');
  ok({ k: 's' });
  assert.equal(getSpotlightSnapshot().presenter, null);
  assert.equal(getSpotlightSnapshot().following, null);
  ok({ k: 'p', p: 1, r: [0, 0, 1, 1] });
  s.advance(SPOTLIGHT_STALE_MS + 1); __spotlightTest.tick();
  assert.equal(getSpotlightSnapshot().presenter, null, 'a presenter who went quiet is gone');
});

test('wiring: the live channel routes v6, the viewer registers, AppShell shows the overlay', () => {
  const sync = readFileSync(new URL('../src/services/annotationDocSync.js', import.meta.url), 'utf8');
  assert.match(sync, /payload\?\.v === SPOTLIGHT_VERSION/);
  assert.match(sync, /setSpotlightSink\(/);
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /registerSpotlightViewer\(/);
  assert.match(viewer, /focusPageRect\(page, rect, \{ fill: 1/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /<SpotlightOverlay /);
  assert.match(shell, /setSpotlightDocument\(doc\.id\)/);
});
