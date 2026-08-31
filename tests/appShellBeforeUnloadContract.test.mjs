import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldWarnBeforeUnloadForTab } from '../src/utils/beforeUnloadGuard.js';

test('saved local PDF with annotations does not warn on reload', () => {
  assert.equal(shouldWarnBeforeUnloadForTab({
    isHome: false,
    file: { name: 'local.pdf' },
    hasAnyAnnotations: true,
    hasUnsavedAnnotations: false,
  }), false);
});

test('unsaved local PDF edit warns on reload', () => {
  assert.equal(shouldWarnBeforeUnloadForTab({
    isHome: false,
    file: { name: 'local.pdf' },
    hasAnyAnnotations: true,
    hasUnsavedAnnotations: true,
  }), true);
});

test('home, missing, and cloud-backed tabs do not warn', () => {
  assert.equal(shouldWarnBeforeUnloadForTab(null), false);
  assert.equal(shouldWarnBeforeUnloadForTab({ isHome: true }), false);
  assert.equal(shouldWarnBeforeUnloadForTab({ file: null, hasUnsavedAnnotations: true }), false);
  assert.equal(shouldWarnBeforeUnloadForTab({
    file: { id: 'cloud-doc' },
    hasUnsavedAnnotations: true,
  }), false);
});
