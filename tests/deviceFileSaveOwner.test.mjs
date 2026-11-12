import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../src/home/deviceFileActions.js', import.meta.url), 'utf8');

// Save to my account (device-files): the upload File already carries its id,
// so handleDocumentClick's "attach metadata when the File has no id" branch
// skips it. The owner must be set before the cloud copy reopens, or the
// owner's own document opens under collaborator rules.
test('the cloud copy that replaces a device tab opens as the owner\'s', () => {
  const save = dashboard.slice(dashboard.indexOf('const saveDeviceFile = async'));
  const reopen = save.slice(0, save.indexOf('void handleDocumentClick('));
  assert.match(reopen, /uploaded\.user_id = user\.id;/);
  assert.match(reopen, /uploaded\.id = result\.documentId;/);
});

// A device copy that can't be removed after the marks went across is a
// saved document with a leftover, never a failed save (a retry would upload
// a second copy).
test('a failed device-copy removal still reports the save', () => {
  assert.match(actions, /await deviceFiles\(\)\.remove\(row\.id\)\.catch\(\(\) => false\)/);
  assert.match(actions, /deviceCopyLeft: removed === false/);
  assert.match(actions, /if \(!accepted\) return \{ ok: false, reason: 'marks'/);
});
