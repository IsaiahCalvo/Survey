import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFailureMessage, isModuleLoadFailure } from '../src/utils/exportFailureMessage.js';

const chunkErr = new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:5199/src/utils/annotationBundle/runAnnotationBundleExport.js');

test('a failed code load offline says so and shows no URL', () => {
  const msg = exportFailureMessage(chunkErr, { offline: true });
  assert.match(msg, /offline/);
  assert.doesNotMatch(msg, /https?:|\/src\//);
});

test('a failed code load online asks for a reload', () => {
  const msg = exportFailureMessage(chunkErr, { offline: false });
  assert.match(msg, /Reload/);
  assert.doesNotMatch(msg, /https?:/);
});

test('Safari and Firefox load errors are caught too', () => {
  assert.ok(isModuleLoadFailure(new TypeError('Importing a module script failed.')));
  assert.ok(isModuleLoadFailure(new TypeError('error loading dynamically imported module')));
  assert.ok(!isModuleLoadFailure(new Error('No pages to export')));
});

test('other errors keep their words, minus any URL', () => {
  assert.equal(exportFailureMessage(new Error('No pages to export'), { offline: false }), 'Export failed: No pages to export');
  assert.equal(exportFailureMessage(new Error('Bad file at https://x.test/a.pdf'), { offline: false }), 'Export failed: Bad file at');
  assert.equal(exportFailureMessage(null, { offline: false }), 'Export failed.');
});
