// Phone: the survey rail sits inside the survey sheet (z 6500). Its confirm
// dialog (z 1300) rendered inline there was hidden behind the sheet, so a
// long-press "Delete" on a category could never be confirmed (and the Smart
// fill matches it should clear stayed). On the phone it portals to <body>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');

test('phone confirm dialog is portaled to body above the sheet', () => {
  assert.match(rail, /import \{[^}]*\bcreatePortal\b[^}]*\} from 'react-dom'/);
  const m = rail.match(/\{mobileMode && typeof document !== 'undefined'\s*\? createPortal\(<div style=\{\{ position: 'relative', zIndex: (\d+) \}\}>\{confirmDialogElement\}<\/div>, document\.body\)\s*: confirmDialogElement\}/);
  assert.ok(m, 'mobile confirm is portaled');
  const sheetZ = 6500;
  assert.ok(Number(m[1]) > sheetZ, 'wrapper stacks above the survey sheet');
});
