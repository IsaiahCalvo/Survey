import test from 'node:test';
import assert from 'node:assert/strict';

import { getImportedRedactionOverlayMarks } from '../src/utils/importedRedactionOverlay.js';

test('imported Redact annotations become page-fraction overlay marks', () => {
  const viewport = {
    width: 200,
    height: 100,
    convertToViewportPoint(x, y) {
      return [x, 100 - y];
    },
  };
  const marks = getImportedRedactionOverlayMarks([
    { id: 'redact-1', subtype: 'Redact', rect: [20, 40, 120, 60] },
    { id: 'stamp-1', subtype: 'Stamp', rect: [0, 0, 10, 10] },
    { id: 'bad-redact', subtype: 'Redact', rect: [10, 10, 10, 10] },
  ], viewport);

  assert.deepEqual(marks, [{
    id: 'redact-1',
    left: 10,
    top: 40,
    width: 50,
    height: 20,
  }]);
});
