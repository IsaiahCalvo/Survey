import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTENT_TYPE_COLORS,
  getContentTypeIconColor,
} from '../src/utils/contentTypeColors.js';

test('documents, projects, and templates keep their visual identity colors', () => {
  assert.deepEqual(CONTENT_TYPE_COLORS, {
    document: '#7ab7e6',
    project: '#d8a84e',
    template: '#c293e6',
  });
  assert.equal(getContentTypeIconColor('document'), '#7ab7e6');
  assert.equal(getContentTypeIconColor('project'), '#d8a84e');
  assert.equal(getContentTypeIconColor('template'), '#c293e6');
  assert.equal(getContentTypeIconColor('other', 'currentColor'), 'currentColor');
});
