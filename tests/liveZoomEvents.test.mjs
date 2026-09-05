import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLiveZoomViewerId,
  isLiveZoomEventForViewer,
  LIVE_ZOOM_EVENT,
} from '../src/utils/liveZoomEvents.js';

test('live zoom events are scoped to the active tab viewer', () => {
  const activeViewerId = getLiveZoomViewerId('tab-a');

  assert.equal(LIVE_ZOOM_EVENT, 'survey-pdfjs-live-zoom');
  assert.equal(activeViewerId, 'pdfjs-pdf-viewer-tab-a');
  assert.equal(isLiveZoomEventForViewer({ viewerId: activeViewerId }, activeViewerId), true);
  assert.equal(isLiveZoomEventForViewer({ viewerId: getLiveZoomViewerId('tab-b') }, activeViewerId), false);
  assert.equal(isLiveZoomEventForViewer({}, activeViewerId), false);
});
