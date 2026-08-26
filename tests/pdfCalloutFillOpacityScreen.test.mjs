// Callout Fill Opacity below 8% must paint as-is.
// Live Color Fill Opacity already offers 0–100 (field min 0). View / spec /
// PAL used Math.max(..., 0.08) so a next-draw Fill of 0/1/2/3/4/5/6/7
// never reached the screen until Fill was touched again, while persist /
// export / flatten already honored the user-set 0–1 value. Distinct from
// leftover-18 and callout fillOpacity FreeText /ca export. Do not invent
// a floor of 0.08.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildCalloutRenderSpec } from '../src/utils/calloutEditAdapter.js';
import { resolveCalloutBoxFill } from '../src/utils/annotationStyleCatalog.js';
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
    id: `callout-fill-opacity-screen-${stylePatch.fillOpacity ?? 'default'}`,
    pageNumber: 1,
    arrowTip: { x: 0.55, y: 0.42 },
    knee: { x: 0.38, y: 0.30 },
    textBoxPosition: { x: 0.12, y: 0.16 },
    textBoxWidth: 0.22,
    textBoxHeight: 0.08,
    text: 'Y',
    style: {
      ...defaultCalloutStyle,
      fillColor: '#FFFF00',
      fillOpacity: 0.05,
      ...stylePatch,
    },
  };
}

function textBoxFillOpacity(callout) {
  const spec = buildCalloutRenderSpec(callout, 0, { width: 612, height: 792 }, stubConnection);
  const box = (function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.attrs?.['data-callout-part'] === 'textBox') return node;
    const children = node.children || [];
    for (const child of children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  }(spec));
  return box?.attrs?.fillOpacity;
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'callout-fill-opacity-screen-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
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
      documentId: 'callout-fill-opacity-screen',
      callouts: [callout],
    },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const freeText = dicts.find((dict) => {
    const subtype = dict.get(PDFName.of('Subtype'));
    const name = subtype?.decodeText ? subtype.decodeText() : String(subtype || '');
    return name === 'FreeText' || name === '/FreeText';
  });
  assert.ok(freeText, 'export must write a FreeText piece');
  const ap = freeText.get(PDFName.of('AP'));
  const nRef = ap?.get?.(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  const resources = stream?.dict?.lookup?.(PDFName.of('Resources')) || stream?.dict?.get?.(PDFName.of('Resources'));
  const ext = resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState'));
  let ca;
  if (ext && typeof ext.entries === 'function') {
    for (const [, ref] of ext.entries()) {
      const gs = doc.context.lookup(ref) || ref;
      const raw = gs.get?.(PDFName.of('ca'));
      if (raw != null) ca = raw.asNumber ? raw.asNumber() : Number(raw);
    }
  }
  return { ca, fillOpacity: callout.style.fillOpacity };
}

test('view / spec / PAL no longer floor Fill Opacity at 0.08', () => {
  const view = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(view, /Math\.max\(0, Math\.min\(1, Number\(callout\.style\?\.fillOpacity \?\? 0\.4\)\)\)/);
  assert.doesNotMatch(view, /fillOpacity = Math\.max\(0\.08/);

  const spec = read('src/utils/calloutEditAdapter.js');
  assert.match(spec, /Math\.max\(0, Math\.min\(1, Number\(callout\.style\?\.fillOpacity \?\? 0\.4\)\)\)/);
  assert.doesNotMatch(spec, /fillOpacity = Math\.max\(0\.08/);

  const pal = read('src/utils/annotationCanvasPainter.js');
  assert.match(pal, /Math\.max\(0, Math\.min\(1, toNumber\(callout\.style\?\.fillOpacity, 0\.4\)\)\)/);
  assert.doesNotMatch(pal, /fillOpacity = Math\.max\(0\.08/);
});

test('spec paints user-set Fill Opacity below 8%; missing still defaults to 0.4', () => {
  assert.equal(textBoxFillOpacity(makeCallout()), 0.05);
  assert.equal(textBoxFillOpacity(makeCallout({ fillOpacity: 0 })), 0);
  assert.equal(textBoxFillOpacity(makeCallout({ fillOpacity: 0.07 })), 0.07);
  assert.equal(textBoxFillOpacity(makeCallout({ fillOpacity: 1 })), 1);

  const missing = makeCallout();
  delete missing.style.fillOpacity;
  assert.equal(textBoxFillOpacity(missing), 0.4);

  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0.05 }).opacity, 0.05);
  assert.equal(resolveCalloutBoxFill({ fillColor: '#FFFF00', fillOpacity: 0 }).visible, false);
});

test('export still writes FreeText AP /ca 0.05 from user-set Fill', async () => {
  const exported = await exportCallout();
  assert.equal(exported.fillOpacity, 0.05);
  assert.ok(Math.abs(Number(exported.ca) - 0.05) < 0.001, `expected /ca 0.05, got ${exported.ca}`);
});

test('Color picker minOpacity stays 0; do not invent a floor of 0.08', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /minOpacity = 0/);
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function clampOpacityPercent\(raw, minOpacity = 0\)/);
});
