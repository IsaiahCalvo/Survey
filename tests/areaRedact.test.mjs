import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectPendingRedactions } from '../src/utils/permanentPdfRedaction.js';
import { createTextMarkupAnnotation } from '../src/utils/pdfTextMarkup.js';
import { buildTextMarkupGroupCreateTransaction } from '../src/utils/textMarkupGroupTransactions.js';
import { resolveToolBarGroup } from '../src/utils/toolbarRows.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const boxQuad = ({ left, top, right, bottom }) => ({ x1: left, y1: top, x2: right, y2: top, x3: left, y3: bottom, x4: right, y4: bottom });

test('a dragged box becomes a one-quad redaction the Apply redactions path picks up', () => {
  const box = { left: 40, top: 100, right: 220, bottom: 130 };
  const mark = createTextMarkupAnnotation({ id: 'r1', pageNumber: 1, selectionGroupId: 'g1', markupType: 'redact', selectedText: '', quads: [boxQuad(box)] });
  assert.ok(mark, 'a redaction with no words under it is still a mark');
  assert.equal(mark.data.markupType, 'redact');
  assert.deepEqual([mark.left, mark.top, mark.width, mark.height], [40, 100, 180, 30]);
  const tx = buildTextMarkupGroupCreateTransaction({ 1: { objects: [] } }, [mark]);
  assert.equal(tx.created.length, 1);
  const { count, byPage } = collectPendingRedactions(tx.nextByPage);
  assert.equal(count, 1);
  assert.equal(byPage[1][0].data.quads[0].x2, 220);
});

test('the host maps the box through the page layer and wires into the Text row', () => {
  const host = src('components/AreaRedactHost.jsx');
  assert.match(host, /getScreenCTM/);
  assert.match(host, /pointerMayUseTool\(event\.pointerType\)/, 'a finger still pans');
  assert.match(host, /export const boxQuad = /);
  const viewer = src('PDFViewer.jsx');
  assert.match(viewer, /areaRedactEnabled \? \[\{ id: 'area-redact', label: 'Redact area', iconName: 'areaRedactTool' \}\]/);
  assert.match(viewer, /queuePermanentRedactionConfirmation\(buildTextMarkupGroupCreateTransaction\(annotationsByPageRef\.current \|\| \{\}, \[scoped\]\)\)/);
  assert.match(src('featureFlags.js'), /'area-redact': Object\.freeze\(\{[^}]*stage: 'beta'/);
  assert.equal(resolveToolBarGroup({ activeTool: 'area-redact' }), 'review');
  const migration = readFileSync(new URL('../supabase/migrations/20261114041000_area_redact_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'area-redact', 'off'/);
});
