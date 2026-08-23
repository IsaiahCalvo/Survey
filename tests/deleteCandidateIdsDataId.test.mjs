import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Counter Delete gap: candidateIds keyed on top-level id only missed
// counters that stamp data.id. After the fix, keyboard + context-menu
// Delete both use data.id || id. Hunt whether any other reachable create
// still omits top-level id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Delete candidateIds use data.id || id on keyboard and context-menu paths', () => {
  const interaction = read('src/hooks/useSVGInteraction.js');
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  const deleteStart = interaction.indexOf('const deleteSelected = useCallback');
  assert.ok(deleteStart > -1);
  const deleteBody = interaction.slice(deleteStart, deleteStart + 14000);
  assert.match(deleteBody, /snapshotObjects\.map\(\(o\) => o\?\.data\?\.id \|\| o\?\.id\)/);
  assert.match(deleteBody, /obj\.id != null \|\| obj\.data\?\.id != null/);
  assert.doesNotMatch(deleteBody, /candidateIds = snapshotObjects\.map\(\(o\) => o\?\.id\)/);

  assert.match(menu, /obj\?\.data\?\.id \|\| obj\?\.id/);
  assert.match(menu, /obj\.id == null && obj\.data\?\.id == null/);
});

test('reachable creates besides Counter stamp top-level id and data.id', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  const ink = read('src/utils/productionPaperInk.js');
  const viewer = read('src/PDFViewer.jsx');

  assert.match(commit, /type: 'Ellipse'[\s\S]*?id,\s*\n\s*data: \{ id \}/);
  assert.match(commit, /type: 'Rect'[\s\S]*?id,\s*\n\s*data: \{ id \}/);
  assert.match(commit, /type: 'Line'[\s\S]*?data: \(tool === 'arrow'/);
  assert.match(ink, /type: 'path',\s*\n\s*id,/);
  assert.match(ink, /data: \{ \.\.\.\(data \|\| \{\}\), id, tool: normalizedTool \}/);

  const stampAt = viewer.indexOf('counter.data.id = crypto.randomUUID()');
  assert.ok(stampAt > -1, 'Counter create stamps data.id');
  const counterSlice = viewer.slice(stampAt - 80, stampAt + 220);
  assert.match(counterSlice, /counter\.data\.id = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(counterSlice, /counter\.id\s*=/);
});
