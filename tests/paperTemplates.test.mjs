// Home > New > Notebook paper and Other templates (flag home-templates).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAPER_TEMPLATES, TEMPLATE_GROUPS, templateMarks, templatePreviewPaths, templateLabel, NOTEBOOK_PAGES,
} from '../src/home/paperTemplates.js';
import { blankPageBox, buildBlankPdf, paperMarks } from '../src/utils/blankPdf.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const LETTER = blankPageBox('letter');
const inside = (m, box) => [m.x1, m.x2].every((x) => x >= -0.01 && x <= box.width + 0.01)
  && [m.y1, m.y2].every((y) => y >= -0.01 && y <= box.height + 0.01);

test('Drawboard\'s three groups and their templates', () => {
  assert.deepEqual(TEMPLATE_GROUPS.map((g) => g.label), ['Notetaking', 'Grids and graphs', 'Music']);
  const of = (g) => PAPER_TEMPLATES.filter((t) => t.group === g).map((t) => t.label);
  assert.deepEqual(of('notes'), ['Blank page', 'Notebook paper', 'Gregg ruled', 'Pitman ruled', 'Cornell notes']);
  assert.deepEqual(of('music'), ['Blank stave', '6 line tab', 'Double stave']);
  assert.equal(of('grids').length, 8);
  assert.equal(NOTEBOOK_PAGES, 10);
  assert.equal(templateLabel('nope'), 'Blank page');
});

test('every template draws inside the page, on Letter and ARCH D landscape', () => {
  for (const box of [LETTER, blankPageBox('arch-d', 'landscape')]) {
    for (const t of PAPER_TEMPLATES) {
      const marks = templateMarks(t.id, box);
      if (t.id === 'blank') { assert.equal(marks.length, 0); continue; }
      assert.ok(marks.length > 0, t.id);
      for (const m of marks) assert.ok(inside(m, box), `${t.id} ${JSON.stringify(m)}`);
    }
  }
});

test('notebook paper: college ruled lines and one red margin', () => {
  const marks = templateMarks('notebook', LETTER);
  const margins = marks.filter((m) => m.tone === 'margin');
  assert.equal(margins.length, 1);
  assert.equal(margins[0].x1, 90);
  const rules = marks.filter((m) => m.tone === 'rule').map((m) => m.y1);
  assert.ok(Math.abs((rules[0] - rules[1]) - 20.25) < 1e-9);
});

test('grids: 1 mm has a major line every centimetre; isometric has three directions', () => {
  const mm = templateMarks('graph-1mm', LETTER);
  const majors = mm.filter((m) => m.tone === 'major' && m.x1 === m.x2);
  assert.ok(Math.abs((majors[1].x1 - majors[0].x1) - 72 / 2.54) < 1e-6);
  const iso = templateMarks('isometric', LETTER);
  const slopes = new Set(iso.map((m) => (Math.abs(m.x2 - m.x1) < 1e-9 ? 'v' : Math.sign((m.y2 - m.y1) / (m.x2 - m.x1)))));
  assert.deepEqual([...slopes].sort(), [-1, 1, 'v'].sort());
});

test('music: staves of 5 lines, tab of 6, double staves joined', () => {
  const ys = (id) => templateMarks(id, LETTER).filter((m) => m.y1 === m.y2).map((m) => m.y1);
  assert.equal(ys('stave').length % 5, 0);
  assert.equal(ys('tab').length % 6, 0);
  assert.equal(ys('double-stave').length % 10, 0);
});

test('preview paths use the page box with y flipped', () => {
  const paths = templatePreviewPaths('cornell', LETTER);
  assert.deepEqual(Object.keys(paths).sort(), ['major', 'margin', 'rule']);
  assert.equal(paths.margin, 'M180 648L180 72'); // bottom (summary line) to top (header)
});

test('the PDF: basic papers unchanged, templates drawn once and shared by every page', async () => {
  assert.equal(paperMarks('lined', LETTER).length > 0, true);
  const bytes = await buildBlankPdf({ title: 'Notebook paper', paper: 'notebook', pages: 10 });
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 10);
  assert.equal(doc.getTitle(), 'Notebook paper');
  assert.ok(bytes.length < 12_000, `${bytes.length}`);
  const hex = await buildBlankPdf({ paper: 'hex', pages: 50 });
  assert.ok(hex.length < 60_000, `${hex.length}`);
});

test('flag is a Nightly beta with an off row', () => {
  assert.equal(FEATURE_FLAGS['home-templates']?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110174000_home_templates.sql', import.meta.url), 'utf8');
  assert.match(sql, /\('home-templates', 'off'/);
});
