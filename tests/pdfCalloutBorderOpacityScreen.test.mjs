// Callout Border Opacity below 20% must paint as-is.
// Live Color Border Opacity already offers 0–100 (field min 0). View / spec /
// PAL used Math.max(..., 0.2) so a next-draw Border of 0–19 never reached
// the screen until Border was touched again, while persist / export /
// flatten already honored the user-set 0–1 value. Distinct from leftover-18
// and callout borderOpacity Line /CA export. Do not invent a floor of 0.2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildCalloutRenderSpec } from '../src/utils/calloutEditAdapter.js';
import { resolveCalloutBorder } from '../src/utils/annotationStyleCatalog.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const PAGE_SIZES = { 1: { width: 200, height: 200 } };

const stubConnection = (tbX, tbY, tbW, tbH, knee) => ({
  line1Start: { x: tbX + tbW / 2, y: tbY + tbH / 2 },
  effectiveKnee: { x: knee.x, y: knee.y },
  line2Start: { x: knee.x, y: knee.y },
  shouldHideLine1: false,
});

function makeCallout(stylePatch = {}) {
  return {
    id: `callout-border-opacity-screen-${stylePatch.borderOpacity ?? 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.55, y: 0.42 },
    knee: { x: 0.38, y: 0.30 },
    textBoxPosition: { x: 0.12, y: 0.16 },
    textBoxWidth: 0.22,
    textBoxHeight: 0.08,
    text: 'Y',
    style: {
      ...defaultCalloutStyle,
      borderColor: '#FF0000',
      borderOpacity: 0.10,
      ...stylePatch,
    },
  };
}

function groupOpacity(callout) {
  const spec = buildCalloutRenderSpec(callout, 0, { width: 612, height: 792 }, stubConnection);
  return spec?.attrs?.opacity;
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'callout-border-opacity-screen-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictText(dict, key) {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

async function exportCallout(stylePatch = {}) {
  const callout = makeCallout(stylePatch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {},
    PAGE_SIZES,
    null,
    {
      returnBytes: true,
      actionType: 'pdf-export',
      documentId: 'callout-border-opacity-screen',
      callouts: [callout],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const lines = dicts.filter((dict) => dictText(dict, 'Subtype') === 'Line');
  const cas = lines.map((dict) => dictNumber(dict, 'CA'));
  return { cas, borderOpacity: callout.style.borderOpacity };
}

test('view / spec / PAL no longer floor Border Opacity at 0.2', () => {
  const view = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(view, /Math\.max\(0, Math\.min\(1, Number\(callout\.style\?\.borderOpacity \?\? 1\)\)\)/);
  assert.doesNotMatch(view, /borderOpacity = Math\.max\(0\.2/);

  const spec = read('src/utils/calloutEditAdapter.js');
  assert.match(spec, /Math\.max\(0, Math\.min\(1, Number\(callout\.style\?\.borderOpacity \?\? 1\)\)\)/);
  assert.doesNotMatch(spec, /borderOpacity = Math\.max\(0\.2/);

  const pal = read('src/utils/annotationCanvasPainter.js');
  assert.match(pal, /Math\.max\(0, Math\.min\(1, toNumber\(callout\.style\?\.borderOpacity, 1\)\)\)/);
  assert.doesNotMatch(pal, /borderOpacity = Math\.max\(0\.2/);
});

test('spec paints user-set Border Opacity below 20%; missing still defaults to 1', () => {
  assert.equal(groupOpacity(makeCallout()), 0.10);
  assert.equal(groupOpacity(makeCallout({ borderOpacity: 0 })), 0);
  assert.equal(groupOpacity(makeCallout({ borderOpacity: 0.19 })), 0.19);
  assert.equal(groupOpacity(makeCallout({ borderOpacity: 1 })), 1);

  const missing = makeCallout();
  delete missing.style.borderOpacity;
  assert.equal(groupOpacity(missing), 1);

  assert.equal(resolveCalloutBorder({ borderColor: '#FF0000', borderOpacity: 0.10 }).opacity, 0.10);
  assert.equal(resolveCalloutBorder({ borderColor: '#FF0000', borderOpacity: 0 }).visible, false);
});

test('export still writes Line /CA 0.10 from user-set Border', async () => {
  const exported = await exportCallout();
  assert.equal(exported.borderOpacity, 0.10);
  assert.equal(exported.cas.length, 2, 'callout must export two Line pieces');
  exported.cas.forEach((ca) => {
    assert.ok(Math.abs(Number(ca) - 0.10) < 0.001, `expected Line /CA 0.10, got ${ca}`);
  });
});

test('Color picker minOpacity stays 0; do not invent a floor of 0.2', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /minOpacity = 0/);
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function clampOpacityPercent\(raw, minOpacity = 0\)/);
});
