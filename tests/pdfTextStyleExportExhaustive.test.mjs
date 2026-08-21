// Exhaustive export/print re-proof for every discrete color, offered font,
// and format combo. Builds on tests/pdfAnnotationTextStyleAndArrowExport.test.mjs
// (wave-1 color/bold/italic) by iterating the shared catalogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  colorPickerSolidPresets,
  FONT_FAMILIES,
  FONT_SIZE_PRESETS,
  TEXT_FORMAT_TOGGLES,
  TEXT_ALIGN_HORIZONTAL,
  TEXT_ALIGN_VERTICAL,
  pdfDefaultAppearanceFontName,
} from '../src/utils/annotationStyleCatalog.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

async function getAnnotationDicts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref));
}

const dictText = (dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
};

function hexToPdfRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const fmt = (c) => (c === 0 ? '0' : c === 1 ? '1' : String(c));
  return `${fmt(r)} ${fmt(g)} ${fmt(b)}`;
}

test('commit JSON stores every offered font, size, format toggle, and align cell', () => {
  for (const family of FONT_FAMILIES) {
    const json = buildNewTextCommitJSON({
      text: family,
      left: 0,
      top: 0,
      innerWrapWidth: 148,
      naturalInnerHeight: 21,
      style: { fontFamily: family },
    });
    assert.equal(json.fontFamily, family, `commit must keep ${family}`);
    assert.equal(json.fontFamily.includes(','), false);
  }

  for (const size of FONT_SIZE_PRESETS) {
    const json = buildNewTextCommitJSON({
      text: String(size),
      left: 0,
      top: 0,
      innerWrapWidth: 148,
      naturalInnerHeight: 21,
      style: { fontSize: size },
    });
    assert.equal(json.fontSize, size, `commit must keep size ${size}`);
  }

  const formatted = buildNewTextCommitJSON({
    text: 'styled',
    left: 0,
    top: 0,
    innerWrapWidth: 148,
    naturalInnerHeight: 21,
    style: {
      fontWeight: 'bold',
      fontStyle: 'italic',
      underline: true,
      linethrough: true,
    },
  });
  assert.equal(formatted.fontWeight, 'bold');
  assert.equal(formatted.fontStyle, 'italic');
  assert.equal(formatted.underline, true);
  assert.equal(formatted.linethrough, true);
  assert.ok(TEXT_FORMAT_TOGGLES.includes('bold'));

  for (const v of TEXT_ALIGN_VERTICAL) {
    for (const h of TEXT_ALIGN_HORIZONTAL) {
      const json = buildNewTextCommitJSON({
        text: `${v}-${h}`,
        left: 0,
        top: 0,
        innerWrapWidth: 148,
        naturalInnerHeight: 21,
        style: { textAlign: h, verticalAlign: v },
      });
      assert.equal(json.textAlign, h, `${v}-${h} horizontal`);
      assert.equal(json.verticalAlign, v, `${v}-${h} vertical`);
    }
  }

  const stacked = buildNewTextCommitJSON({
    text: 'stack',
    left: 0,
    top: 0,
    innerWrapWidth: 148,
    naturalInnerHeight: 21,
    style: { fontFamily: 'Helvetica, Arial, sans-serif' },
  });
  assert.equal(stacked.fontFamily, 'Helvetica');
});

test('exported FreeText /DA carries every solid picker swatch as glyph color', async () => {
  const pdfFile = await makePdfFile();
  const objects = colorPickerSolidPresets().map((hex, index) => ({
    id: `swatch-${hex.slice(1)}`,
    type: 'textbox',
    left: 10,
    top: 10 + index * 8,
    width: 80,
    height: 8,
    text: hex,
    fill: hex,
    fontSize: 8,
  }));
  const bytes = await savePDFWithAnnotationsPdfLib(
    pdfFile,
    { 1: { objects } },
    PAGE_SIZES,
    null,
    { returnBytes: true },
  );
  const dicts = await getAnnotationDicts(bytes);
  const freeTexts = dicts.filter((dict) => dictText(dict, 'Subtype') === 'FreeText');
  assert.equal(freeTexts.length, colorPickerSolidPresets().length);
  for (const hex of colorPickerSolidPresets()) {
    const expected = `${hexToPdfRgb(hex)} rg /Helv 8 Tf`;
    const match = freeTexts.find((dict) => dictText(dict, 'DA') === expected);
    assert.ok(match, `export /DA must include ${hex} → ${expected}`);
  }
});

test('exported FreeText /DA uses the Standard-14 font for every offered family + weight/slant', async () => {
  const pdfFile = await makePdfFile();
  const combos = [];
  for (const family of FONT_FAMILIES) {
    for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
      combos.push({ family, bold, italic });
    }
  }
  const objects = combos.map((combo, index) => ({
    id: `font-${combo.family}-${combo.bold}-${combo.italic}`,
    type: 'textbox',
    left: 8,
    top: 8 + index * 6,
    width: 90,
    height: 6,
    text: combo.family,
    fill: '#000000',
    fontSize: 10,
    fontFamily: combo.family,
    fontWeight: combo.bold ? 'bold' : 'normal',
    fontStyle: combo.italic ? 'italic' : 'normal',
  }));
  const bytes = await savePDFWithAnnotationsPdfLib(
    pdfFile,
    { 1: { objects } },
    PAGE_SIZES,
    null,
    { returnBytes: true },
  );
  const dicts = await getAnnotationDicts(bytes);
  const das = dicts
    .filter((dict) => dictText(dict, 'Subtype') === 'FreeText')
    .map((dict) => dictText(dict, 'DA'));
  assert.equal(das.length, combos.length);
  for (const combo of combos) {
    const daFont = pdfDefaultAppearanceFontName(combo.family, {
      bold: combo.bold,
      italic: combo.italic,
    });
    const expected = `0 0 0 rg /${daFont} 10 Tf`;
    assert.ok(das.includes(expected), `missing /DA ${expected} for ${combo.family}`);
  }
});

test('print flatten embeds Times and Courier (not only Helvetica) for offered families', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {
    1: {
      objects: [
        {
          id: 'times-bold',
          type: 'textbox',
          left: 10,
          top: 10,
          width: 80,
          height: 16,
          text: 'Times',
          fill: '#0000FF',
          fontSize: 12,
          fontFamily: 'Times New Roman',
          fontWeight: 'bold',
        },
        {
          id: 'courier-italic',
          type: 'textbox',
          left: 10,
          top: 40,
          width: 80,
          height: 16,
          text: 'Courier',
          fill: '#FF0000',
          fontSize: 12,
          fontFamily: 'Courier New',
          fontStyle: 'italic',
        },
        {
          id: 'georgia-bi',
          type: 'textbox',
          left: 10,
          top: 70,
          width: 80,
          height: 16,
          text: 'Georgia',
          fill: '#00FF00',
          fontSize: 12,
          fontFamily: 'Georgia',
          fontWeight: 700,
          fontStyle: 'italic',
        },
      ],
    },
  }, PAGE_SIZES, { returnBytes: true });

  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const fontsDict = page.node.Resources()?.lookup(PDFName.of('Font'));
  const fontNames = [];
  if (fontsDict) {
    fontsDict.entries().forEach(([, ref]) => {
      const fontDict = doc.context.lookup(ref);
      const baseFont = fontDict?.get(PDFName.of('BaseFont'));
      if (baseFont) fontNames.push(baseFont.decodeText());
    });
  }
  assert.ok(
    fontNames.some((name) => name.includes('Times-Bold') && !name.includes('Italic')),
    `Times-Bold must be embedded (got ${JSON.stringify(fontNames)})`,
  );
  assert.ok(
    fontNames.some((name) => name.includes('Courier-Oblique') || name.includes('Courier-Italic')),
    `Courier italic must be embedded (got ${JSON.stringify(fontNames)})`,
  );
  assert.ok(
    fontNames.some((name) => name.includes('Times-BoldItalic')),
    `Georgia bold+italic maps to Times-BoldItalic (got ${JSON.stringify(fontNames)})`,
  );
});
