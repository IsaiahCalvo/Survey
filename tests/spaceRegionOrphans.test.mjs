import test from 'node:test';
import assert from 'node:assert/strict';

import { isAnnotationVisibleInContext } from '../src/utils/annotationVisibilityRules.js';
import {
  collectLiveRegionIds,
  spaceHasActivatableRegions,
  unscopeOrphanedRegionAnnotations,
} from '../src/utils/spaceRegionOrphans.js';
import { isSameReSignInUser } from '../src/components/collab/reSignInAccount.js';
import { PRESENCE_STALE_MS, isFreshRow } from '../src/hooks/presenceRoster.js';
import { surveyGlobalLogPath, surveyTestLogsDir } from '../src/utils/surveyDiagPaths.js';

const spaces = [{
  id: 'space-a',
  assignedPages: [{
    pageId: 1,
    regions: [{ regionId: 'r-live', pageId: 1 }],
  }],
}];

test('P1-51: empty space is not activatable', () => {
  assert.equal(spaceHasActivatableRegions({ id: 'empty', assignedPages: [] }), false);
  assert.equal(spaceHasActivatableRegions({ id: 'pages-only', assignedPages: [{ pageId: 1, regions: [] }] }), false);
  assert.equal(spaceHasActivatableRegions(spaces[0]), true);
});

test('P1-52: orphaned regionId is unscoped and stays visible', () => {
  const annotation = { type: 'rect', regionId: 'r-gone', left: 1 };
  assert.equal(isAnnotationVisibleInContext({
    annotation,
    pageNumber: 1,
    spaces,
    activeSpaceId: 'space-a',
    selectedSpaceId: 'space-a',
  }), true);
});

test('P1-52: GC clears regionId when the region is gone', () => {
  const byPage = {
    1: { objects: [{ id: 'a', regionId: 'r-gone' }, { id: 'b', regionId: 'r-live' }] },
  };
  const next = unscopeOrphanedRegionAnnotations(byPage, spaces);
  assert.equal(next[1].objects[0].regionId, null);
  assert.equal(next[1].objects[1].regionId, 'r-live');
  assert.deepEqual([...collectLiveRegionIds(spaces)], ['r-live']);
});

test('P2-17: idle timeout is 10 minutes', () => {
  assert.equal(PRESENCE_STALE_MS, 10 * 60 * 1000);
  const now = Date.parse('2026-08-20T22:00:00.000Z');
  assert.equal(isFreshRow({ last_seen: '2026-08-20T21:51:00.000Z' }, now), true);
  assert.equal(isFreshRow({ last_seen: '2026-08-20T21:49:00.000Z' }, now), false);
});

test('P2-18: re-sign-in rejects a different account', () => {
  assert.equal(isSameReSignInUser('user-a', 'user-a'), true);
  assert.equal(isSameReSignInUser('user-a', 'user-b'), false);
  assert.equal(isSameReSignInUser(null, 'user-b'), true);
});

test('P2-39: Save Log paths use the current home directory', () => {
  assert.equal(surveyTestLogsDir('/Users/someone'), '/Users/someone/Desktop/Survey-BetaSafeS2/TestLogs');
  assert.equal(surveyGlobalLogPath('/Users/someone'), '/Users/someone/Desktop/Survey-BetaSafeS2/1.log');
  assert.equal(surveyTestLogsDir(''), null);
});
