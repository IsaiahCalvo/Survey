// Page delete and revision restore run at once and offer an Undo toast instead
// of a confirm dialog (video-audit: "undo beats are-you-sure").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('page delete: no confirm, the viewer enqueues an Undo toast wired to the timeline Undo', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  assert.doesNotMatch(panel, /Delete page \$\{/);
  assert.doesNotMatch(panel, /You can restore (it|them) with Undo/);
  const viewer = read('src/PDFViewer.jsx');
  assert.doesNotMatch(viewer, /askPageDelete/);
  const start = viewer.indexOf('const deletePageWithUndo = useCallback');
  assert.ok(start > 0);
  const body = viewer.slice(start, viewer.indexOf('}, [handleDeletePage, enqueueUndoToast]);', start));
  assert.match(body, /await handleDeletePage\(page\)/);
  assert.match(body, /enqueueUndoToast\(\{[\s\S]*onUndo: \(\) => \{ handleUndoRef\.current\?\.\(\); \}/);
  assert.match(viewer, /onDeletePage: deletePageWithUndo,/);
  assert.match(viewer, /delete: deletePageWithUndo,/);
});

test('revision restore: no confirm, Undo restores the auto revision saved first', () => {
  const src = read('src/components/revisions/RevisionsPanel.jsx');
  const start = src.indexOf('const handleRestore = useCallback');
  const body = src.slice(start, src.indexOf('const clearPageMarks', start));
  assert.doesNotMatch(body, /window\.confirm\(/);
  assert.match(body, /const pre = await restoreRevision\(rev\.id\)/);
  assert.match(body, /enqueueRestoreUndo\(\{[\s\S]*onUndo:[\s\S]*\{ id: pre\.id, revisionNumber: pre\.revision_number \}, \{ isUndo: true \}/);
  assert.match(src, /<UndoToast toast=\{restoreUndoToast\} onDismiss=\{dismissRestoreUndo\} \/>/);
});
