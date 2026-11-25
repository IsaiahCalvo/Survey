import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentEditBlocked, viewOnlyRefusal, VIEW_ONLY_SYNC_STATUS } from '../src/utils/viewOnlyRefusal.js';
import { getSyncStatusViewModel } from '../src/utils/syncStatusViewModel.js';

const blocked = { stage: 'blocked', healthy: false, error: null, reason: 'denied' };

test('a refused change from someone now a Viewer or Commenter reads view-only', () => {
  assert.equal(viewOnlyRefusal('denied', 'viewer'), true);
  assert.equal(viewOnlyRefusal('denied', 'commenter'), true);
  for (const role of ['editor', 'owner', null]) assert.equal(viewOnlyRefusal('denied', role), false);
  // Locked, archived or removed still say so, whatever the role.
  assert.equal(viewOnlyRefusal('locked', 'viewer'), false);
  assert.equal(viewOnlyRefusal('gone', 'viewer'), false);
});

test('the sync chip shows the cloud state, not "Not saved", for a Viewer', () => {
  const shown = presentEditBlocked({ editBlocked: 'denied', syncStatus: blocked, docRole: 'viewer' });
  assert.equal(shown.editBlocked, 'view-only');
  assert.equal(shown.syncStatus, VIEW_ONLY_SYNC_STATUS);
  assert.notEqual(getSyncStatusViewModel(shown.syncStatus, 0, false, { offline: false }).label, 'Not saved');
  // An editor whose change was refused still sees "Not saved".
  const editor = presentEditBlocked({ editBlocked: 'denied', syncStatus: blocked, docRole: 'editor' });
  assert.equal(editor.syncStatus, blocked);
  assert.equal(getSyncStatusViewModel(editor.syncStatus, 0, false, { offline: false }).label, 'Not saved');
});

test('the viewer keeps tools read-only but shows no lasting error for view-only', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /claimBodyReadOnly\('annotation-edit-blocked'\);\s*\/\/[^\n]*\n\s*if \(editBlockedReason === 'view-only'\) return release;/);
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  assert.match(hook, /presentEditBlocked\(\{ editBlocked, syncStatus, docRole \}\)/);
});
