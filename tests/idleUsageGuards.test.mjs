// w34 (2026-09-25): background work that cost Supabase requests or egress
// while nobody was looking. Found with agent-cli/usage-budget-probe.mjs:
//   * the Documents-list thumbnail fill kept downloading other documents'
//     PDFs while a document was open (the hub stays laid out under the
//     viewer): ~14 MB in the first minute on the owner's library;
//   * the "is this document shared" check reads twice every 30 s per open
//     document, also in a background tab;
//   * the open History panel polls every 10 s, also in a background tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createThumbnailBackfill, isBackfillHostVisible } from '../src/services/thumbnailBackfill.js';

const classList = (...names) => ({ contains: (name) => names.includes(name) });
const host = ({ connected = true, rects = 1 } = {}) => ({
  isConnected: connected,
  getClientRects: () => Array.from({ length: rects }, () => ({})),
});

test('the thumbnail fill treats the list as hidden while a document is open', () => {
  const listRoot = { classList: classList('survey-hub-mobile-scroll-page') };
  const viewerRoot = { classList: classList('survey-hub-mobile-scroll-page', 'survey-viewer-open') };
  assert.equal(isBackfillHostVisible(host(), listRoot), true, 'list on screen');
  assert.equal(isBackfillHostVisible(host(), viewerRoot), false, 'viewer open over the list');
  assert.equal(isBackfillHostVisible(host({ rects: 0 }), listRoot), false, 'list not rendered');
  assert.equal(isBackfillHostVisible(host({ connected: false }), listRoot), false, 'list unmounted');
  assert.equal(isBackfillHostVisible(null, listRoot), false);
});

test('no thumbnail download starts while the viewer is open; it resumes on the list', async () => {
  let root = { classList: classList('survey-viewer-open') };
  const generated = [];
  let sleeps = 0;
  const backfill = createThumbnailBackfill({
    needsThumbnail: async () => true,
    generate: async (doc) => { generated.push(doc.id); },
    waitForIdle: async () => {},
    isBusy: () => !isBackfillHostVisible(host(), root),
    sleep: async () => {
      sleeps += 1;
      // The user closes the document after a few busy checks.
      if (sleeps === 3) root = { classList: classList() };
    },
    gapMs: 0,
    busyRetryMs: 0,
  });
  backfill.setDocuments([{ id: 'a' }, { id: 'b' }]);
  await backfill.whenIdle();
  assert.ok(sleeps >= 3, 'it waited while the viewer was open');
  assert.deepEqual(generated, ['a', 'b'], 'and caught up once back on the list');
  assert.equal(backfill.stats.busyWaits, 3);
});

test('background tabs skip the shared-state and History polls', () => {
  const provider = readFileSync(new URL('../src/components/collab/YDocProvider.jsx', import.meta.url), 'utf8');
  const sharedState = provider.slice(provider.indexOf('const refreshSharedState = async'), provider.indexOf('// 2026-07-01 — resolve the caller'));
  assert.match(sharedState, /!options\?\.force && [^\n]*visibilityState === 'hidden'\) return;/, 'hidden tab skips the 30 s shared check');
  assert.match(sharedState, /setInterval\(refreshSharedState, 30_000\)/, 'only the timer calls it without force');
  assert.equal((sharedState.match(/void refreshSharedState\(\{ force: true \}\)/g) || []).length, 3, 'first check, realtime change and becoming visible always run');
  assert.match(sharedState, /addEventListener\('visibilitychange', refreshWhenShown\)/, 'and refreshes when shown');
  assert.match(sharedState, /removeEventListener\('visibilitychange', refreshWhenShown\)/, 'and cleans up');

  const panel = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
  const poll = panel.slice(panel.indexOf('const intervalId = window.setInterval'), panel.indexOf('}, 10000);'));
  assert.match(poll, /visibilityState === 'hidden'\) return;/, 'hidden tab skips the 10 s History poll');
});
