// Owner 2026-10-26 ("there's an order that we usually follow ... I don't think
// we follow that order throughout the entire app"): every select mode reads
//
//   Select/Done, All/None, Duplicate, Move, Copy, Share, Delete
//
// skipping the ones a list does not offer but never reordering them. The
// actions' order lives in SELECT_MODE_ACTIONS; this pins that each header puts
// its Select/Done toggle FIRST, before the shared row, never after it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the shared row keeps All, Duplicate, Move, Copy, Share, Delete in order', () => {
  const component = read('src/components/SectionIconButton.jsx');
  const keys = [...component.slice(component.indexOf('export const SELECT_MODE_ACTIONS'))
    .matchAll(/\{ key: '(\w+)'/g)].slice(0, 5).map((m) => m[1]);
  assert.deepEqual(keys, ['duplicate', 'move', 'copy', 'share', 'delete']);
  const body = component.slice(component.indexOf('export function SelectModeButtons'));
  assert.ok(body.indexOf("action=\"all\"") < body.indexOf('SELECT_MODE_ACTIONS.map'), 'All/None comes before the actions');
});

// The "Edit modules" dialog has no Select toggle: it is a modal whose footer
// ends with the dialog's own Done button, like every modal footer.
const MODAL_FOOTERS = new Set(['src/home/TemplatesEditor.jsx#templates-module-edit-actions']);

test('every Select/Done toggle sits before its select-mode row', () => {
  const files = ['src/home/TemplatesEditor.jsx', 'src/home/ProjectsFolderTree.jsx', 'src/home/DocumentsLedger.jsx', 'src/SurveySpacesRail.jsx'];
  let rows = 0;
  for (const file of files) {
    const source = read(file);
    let from = 0;
    for (;;) {
      const at = source.indexOf('<SelectModeButtons', from);
      if (at < 0) break;
      rows += 1;
      const before = source.slice(Math.max(0, at - 2500), at);
      const footer = before.lastIndexOf('templates-module-edit-actions') > before.lastIndexOf('action="select"');
      if (footer) {
        assert.ok(MODAL_FOOTERS.has(`${file}#templates-module-edit-actions`));
      } else {
        assert.match(before, /action="select"[\s\S]*?(label=\{[^}]*'Done'|label="Done")/, `${file}: a Select/Done toggle precedes the row at ${at}`);
        const end = source.indexOf('/>', at);
        const after = source.slice(end, end + 600);
        const close = after.search(/<\/(div|span|SectionIconActions)>|\) : \(/);
        assert.doesNotMatch(after.slice(0, close < 0 ? after.length : close), /action="select"/, `${file}: no Done after the row at ${at}`);
      }
      from = at + 1;
    }
  }
  assert.ok(rows >= 14, `found ${rows} select-mode rows`);
});
