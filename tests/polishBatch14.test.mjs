import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeLedgerColumns } from '../src/home/homeLibrary.js';

const ledger = readFileSync(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');
const thumb = readFileSync(new URL('../src/home/PdfPageThumb.jsx', import.meta.url), 'utf8');

const sum = (template) => template.split(/ (?![^(]*\))/).reduce((n, col) => n + (parseFloat(col.replace(/^minmax\(/, '')) || 0), 0);

// 1440 desktop with the preview open: the list is 861 px. The grid used to
// come out 882 px (thumbnail column counted as 30, drawn as 54, plus the
// row's 2 px edge), so the row's More button hid under the preview.
test('Documents columns never run wider than the list', () => {
  for (const thumbPx of [18, 30, 46]) {
    for (const width of [520, 640, 751, 861, 1000, 1191, 1400]) {
      const cols = homeLedgerColumns({ width, opened: true, created: true, tags: true, thumb: thumbPx });
      assert.ok(sum(cols.template) + 2 <= width || cols.keys.length === 0, `${width}px, thumb ${thumbPx}: ${cols.template}`);
    }
  }
});

test('preview pane shows the page at its own shape, with no backdrop bands', () => {
  assert.match(thumb, /fit\s*\n?\s*\? \{ width: '100%', aspectRatio: String\(aspect\)/);
  assert.match(thumb, /data-preview-page=""/);
  assert.match(ledger, /variant="preview"\n\s*fit\n/);
  assert.match(ledger, /maxHeight: 360, flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column'/);
  const archive = readFileSync(new URL('../src/home/ArchiveScreen.jsx', import.meta.url), 'utf8');
  assert.match(archive, /variant="preview"\n\s*fit\n/);
});

test('a wide sheet thumbnail stays inside its column', () => {
  assert.match(ledger, /height=\{densityRow\.thumb\}\n\s*maxWidth=\{densityRow\.thumb \+ 16\}/);
  assert.match(ledger, /height=\{30\}\n\s*maxWidth=\{46\}/);
});
