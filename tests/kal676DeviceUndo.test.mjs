// KAL-676: with no account (Nightly 'device-files') the device is the viewer,
// so its own edits get Undo steps. The history keeps nothing for an unknown
// viewer (w54), and a PDF kept on this device has no user id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { filterAnnotationHistoryActionByOwner } from '../src/utils/annotationLocalHistory.js';
import { DEVICE_ACTOR_ID } from '../src/services/deviceFiles.js';

const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('the device id stands in for the viewer on a PDF kept on this device', () => {
  assert.match(viewer, /deviceHistoryViewerIdRef\.current = isDeviceDocumentId\(pdfFile\?\.id\) \? DEVICE_ACTOR_ID : null;/);
  const ids = viewer.match(/const viewerId = yjsUndoCtx\?\.userId[^;]+;/g) || [];
  assert.ok(ids.length > 0);
  for (const line of ids) assert.match(line, /deviceHistoryViewerIdRef\.current/, line);
});

test('a step made under the device id is kept; an unknown viewer still records nothing', () => {
  const step = { type: 'fabric:update', pageNumber: 1, entries: [] };
  assert.equal(filterAnnotationHistoryActionByOwner(step, DEVICE_ACTOR_ID, null), step);
  assert.equal(filterAnnotationHistoryActionByOwner(step, null, null), null);
});
