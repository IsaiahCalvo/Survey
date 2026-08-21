// Exhaustive Node checks for the shared color / font / format catalogs.
// Wave 1 of recursive E2E — every discrete swatch, every offered font, every
// size preset, every format toggle, every align cell, plus hex + invalid hex.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_PICKER_PRESETS,
  FONT_FAMILIES,
  FONT_SIZE_PRESETS,
  TEXT_FORMAT_TOGGLES,
  TEXT_ALIGN_HORIZONTAL,
  TEXT_ALIGN_VERTICAL,
  colorPickerSolidPresets,
  normalizeHexColor,
  isValidHexColor,
  hexToHsv,
  hsvToHex,
  applySpectrumKey,
  applyHueKey,
  SPECTRUM_SV_KEYS,
  SPECTRUM_HUE_KEYS,
  applyColorPickerSelection,
  clampOpacityPercent,
  wrapFlattenedTextLines,
  FONT_FAMILY_PDF_SUBSTITUTES,
  pdfSafeFontFamilyNote,
  sanitizeOfferedFontFamily,
  isSingleNameFontFamily,
  pdfStandardFontGroup,
  pdfDefaultAppearanceFontName,
  clampFontSize,
  sanitizeTextAlign,
  sanitizeVerticalAlign,
} from '../src/utils/annotationStyleCatalog.js';

const INVALID_HEX = [
  '',
  '#',
  'red',
  'transparent',
  'gggggg',
  '#GG0000',
  '#FF00GG',
  '12345',
  '#12345',
  '#1234567',
  'not-a-color',
  'rgba(255,0,0,1)',
  'rgb(255, 0, 0)',
  '#FF00',
  '##FF0000',
  '#FF0000FF',
];

const VALID_HEX_CASES = [
  ['#FF0000', '#FF0000'],
  ['ff0000', '#FF0000'],
  ['Ff0000', '#FF0000'],
  ['#00ff00', '#00FF00'],
  ['000000', '#000000'],
  ['FFFFFF', '#FFFFFF'],
  ['#808080', '#808080'],
  ['#f00', '#FF0000'],
  ['0f0', '#00FF00'],
  ['#00F', '#0000FF'],
];

test('color picker exposes every discrete swatch (16 including transparent)', () => {
  assert.equal(COLOR_PICKER_PRESETS.length, 16);
  assert.equal(COLOR_PICKER_PRESETS[0], 'transparent');
  assert.equal(new Set(COLOR_PICKER_PRESETS).size, 16, 'swatches must be unique');
});

test('every solid swatch is a valid #RRGGBB and has a spectrum HSV', () => {
  const solids = colorPickerSolidPresets();
  assert.equal(solids.length, 15);
  for (const swatch of solids) {
    assert.equal(normalizeHexColor(swatch), swatch, `${swatch} must already be canonical`);
    assert.equal(isValidHexColor(swatch), true, `${swatch} must parse`);
    const hsv = hexToHsv(swatch);
    assert.ok(hsv, `${swatch} must convert to HSV`);
    assert.ok(hsv.h >= 0 && hsv.h <= 360, `${swatch} hue in range`);
    assert.ok(hsv.s >= 0 && hsv.s <= 100, `${swatch} sat in range`);
    assert.ok(hsv.v >= 0 && hsv.v <= 100, `${swatch} value in range`);
  }
});

test('valid hex inputs (6-digit, 3-digit, with/without #) normalize to #RRGGBB', () => {
  for (const [raw, expected] of VALID_HEX_CASES) {
    assert.equal(normalizeHexColor(raw), expected, `${raw} → ${expected}`);
  }
});

test('invalid hex inputs are rejected (no named colors, no rgba, no garbage)', () => {
  for (const raw of INVALID_HEX) {
    assert.equal(normalizeHexColor(raw), null, `${JSON.stringify(raw)} must be rejected`);
    assert.equal(isValidHexColor(raw), false, `${JSON.stringify(raw)} must be invalid`);
    assert.equal(hexToHsv(raw), null, `${JSON.stringify(raw)} must not produce HSV`);
  }
});

test('every offered fontFamily is a single name and never a CSS stack', () => {
  assert.deepEqual(
    [...FONT_FAMILIES],
    ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'],
  );
  for (const family of FONT_FAMILIES) {
    assert.equal(isSingleNameFontFamily(family), true, `${family} must be a single name`);
    assert.equal(family.includes(','), false, `${family} must not contain a comma`);
    assert.equal(sanitizeOfferedFontFamily(family), family);
  }
});

test('CSS fallback stacks collapse to the first single name', () => {
  assert.equal(sanitizeOfferedFontFamily('Helvetica, Arial, sans-serif'), 'Helvetica');
  assert.equal(sanitizeOfferedFontFamily('"Times New Roman", Times, serif'), 'Times New Roman');
  assert.equal(sanitizeOfferedFontFamily(''), 'Arial');
  assert.equal(sanitizeOfferedFontFamily(null), 'Arial');
  assert.equal(isSingleNameFontFamily('-apple-system, BlinkMacSystemFont, Arial'), false);
  assert.equal(isSingleNameFontFamily('Helvetica, Arial, sans-serif'), false);
});

test('every offered font size preset is a finite number in the clamp range', () => {
  assert.deepEqual(
    [...FONT_SIZE_PRESETS],
    [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72],
  );
  for (const size of FONT_SIZE_PRESETS) {
    assert.equal(clampFontSize(size), size, `${size} must pass through`);
  }
  assert.equal(clampFontSize(1), 6);
  assert.equal(clampFontSize(999), 200);
  assert.equal(clampFontSize('nope'), 16);
});

test('every format toggle and 3×3 align cell is listed', () => {
  assert.deepEqual([...TEXT_FORMAT_TOGGLES], ['bold', 'italic', 'underline', 'strike']);
  assert.deepEqual([...TEXT_ALIGN_HORIZONTAL], ['left', 'center', 'right']);
  assert.deepEqual([...TEXT_ALIGN_VERTICAL], ['top', 'middle', 'bottom']);
  for (const h of TEXT_ALIGN_HORIZONTAL) assert.equal(sanitizeTextAlign(h), h);
  for (const v of TEXT_ALIGN_VERTICAL) assert.equal(sanitizeVerticalAlign(v), v);
  assert.equal(sanitizeTextAlign('justify'), 'justify');
  assert.equal(sanitizeTextAlign('diagonal'), 'left');
  assert.equal(sanitizeVerticalAlign('baseline'), 'top');
});

test('every offered font maps to a PDF Standard-14 /DA name', () => {
  const expectedGroup = {
    Arial: 'helvetica',
    Helvetica: 'helvetica',
    Verdana: 'helvetica',
    'Times New Roman': 'times',
    Georgia: 'times',
    'Courier New': 'courier',
  };
  for (const family of FONT_FAMILIES) {
    assert.equal(pdfStandardFontGroup(family), expectedGroup[family], family);
    assert.equal(pdfDefaultAppearanceFontName(family), {
      helvetica: 'Helv',
      times: 'Times-Roman',
      courier: 'Courier',
    }[expectedGroup[family]]);
    assert.equal(
      pdfDefaultAppearanceFontName(family, { bold: true }),
      { helvetica: 'Helvetica-Bold', times: 'Times-Bold', courier: 'Courier-Bold' }[expectedGroup[family]],
    );
    assert.equal(
      pdfDefaultAppearanceFontName(family, { italic: true }),
      { helvetica: 'Helvetica-Oblique', times: 'Times-Italic', courier: 'Courier-Oblique' }[expectedGroup[family]],
    );
    assert.equal(
      pdfDefaultAppearanceFontName(family, { bold: true, italic: true }),
      {
        helvetica: 'Helvetica-BoldOblique',
        times: 'Times-BoldItalic',
        courier: 'Courier-BoldOblique',
      }[expectedGroup[family]],
    );
  }
  assert.equal(pdfDefaultAppearanceFontName(undefined, { bold: true }), 'Helvetica-Bold');
});

test('Georgia and Verdana stay offered but map to Standard-14 substitutes', () => {
  assert.equal(FONT_FAMILIES.includes('Georgia'), true);
  assert.equal(FONT_FAMILIES.includes('Verdana'), true);
  assert.equal(FONT_FAMILY_PDF_SUBSTITUTES.Georgia, 'Times-Roman');
  assert.equal(FONT_FAMILY_PDF_SUBSTITUTES.Verdana, 'Helvetica');
  assert.equal(pdfSafeFontFamilyNote('Georgia').group, 'times');
  assert.equal(pdfSafeFontFamilyNote('Georgia').daName, 'Times-Roman');
  assert.equal(pdfSafeFontFamilyNote('Verdana').group, 'helvetica');
  assert.equal(pdfSafeFontFamilyNote('Verdana').daName, 'Helv');
});

test('hsvToHex covers every 60° hue × sat/val corner and every discrete SV/hue key', () => {
  const hues = [0, 60, 120, 180, 240, 300, 360];
  const percents = [0, 50, 100];
  let count = 0;
  for (const h of hues) {
    for (const s of percents) {
      for (const v of percents) {
        const hex = hsvToHex(h, s, v);
        assert.match(hex, /^#[0-9A-F]{6}$/, `${h},${s},${v}`);
        count += 1;
      }
    }
  }
  assert.equal(count, 63);

  const svStarts = [
    { key: 'ArrowLeft', s: 50, v: 50, out: { saturation: 49, value: 50 } },
    { key: 'ArrowRight', s: 50, v: 50, out: { saturation: 51, value: 50 } },
    { key: 'ArrowUp', s: 50, v: 50, out: { saturation: 50, value: 51 } },
    { key: 'ArrowDown', s: 50, v: 50, out: { saturation: 50, value: 49 } },
    { key: 'PageUp', s: 50, v: 50, out: { saturation: 50, value: 60 } },
    { key: 'PageDown', s: 50, v: 50, out: { saturation: 50, value: 40 } },
    { key: 'Home', s: 50, v: 50, out: { saturation: 0, value: 50 } },
    { key: 'End', s: 50, v: 50, out: { saturation: 100, value: 50 } },
    { key: 'ArrowLeft', s: 0, v: 0, out: { saturation: 0, value: 0 } },
    { key: 'ArrowRight', s: 100, v: 100, out: { saturation: 100, value: 100 } },
    { key: 'PageUp', s: 0, v: 95, out: { saturation: 0, value: 100 } },
    { key: 'PageDown', s: 0, v: 5, out: { saturation: 0, value: 0 } },
  ];
  for (const row of svStarts) {
    assert.deepEqual(applySpectrumKey(row.key, row.s, row.v), row.out, row.key);
  }
  assert.equal(applySpectrumKey('Escape', 50, 50), null);
  assert.deepEqual(SPECTRUM_SV_KEYS, SPECTRUM_HUE_KEYS);

  const hueStarts = [
    { key: 'ArrowLeft', hue: 10, out: 9 },
    { key: 'ArrowDown', hue: 10, out: 9 },
    { key: 'ArrowRight', hue: 10, out: 11 },
    { key: 'ArrowUp', hue: 10, out: 11 },
    { key: 'PageDown', hue: 10, out: 0 },
    { key: 'PageUp', hue: 10, out: 20 },
    { key: 'Home', hue: 180, out: 0 },
    { key: 'End', hue: 180, out: 360 },
    { key: 'ArrowLeft', hue: 0, out: 0 },
    { key: 'ArrowRight', hue: 360, out: 360 },
  ];
  for (const row of hueStarts) {
    assert.equal(applyHueKey(row.key, row.hue), row.out, row.key);
  }
  assert.equal(applyHueKey('Tab', 90), null);
});

test('applyColorPickerSelection covers transparent, Match Fill, minOpacity, and invalid hex', () => {
  const transparent = applyColorPickerSelection({
    input: 'transparent',
    currentHex: '#FF0000',
    rememberedOpacityPct: 40,
  });
  assert.equal(transparent.kind, 'transparent');
  assert.equal(transparent.opacity, 0);
  assert.equal(transparent.hex, '#FF0000');
  assert.equal(transparent.rememberedOpacityPct, 40);

  const match = applyColorPickerSelection({
    input: '__match__',
    matchFillColor: '#00ff80',
    matchFillOpacity: 0.35,
    minOpacity: 1,
  });
  assert.equal(match.kind, 'match');
  assert.equal(match.hex, '#00FF80');
  assert.equal(match.opacity, 0.35);
  assert.equal(match.transparentMode, false);

  const hex = applyColorPickerSelection({
    input: '#f00',
    rememberedOpacityPct: 0,
    minOpacity: 1,
  });
  assert.equal(hex.kind, 'hex');
  assert.equal(hex.hex, '#FF0000');
  assert.equal(hex.opacity, 1);

  const invalid = applyColorPickerSelection({ input: 'gggggg', currentHex: '#111111' });
  assert.equal(invalid.kind, 'invalid');

  assert.equal(clampOpacityPercent(-10, 0), 0);
  assert.equal(clampOpacityPercent(150, 0), 100);
  assert.equal(clampOpacityPercent(0, 1), 100);
  assert.equal(clampOpacityPercent('50', 0), 50);
  assert.equal(clampOpacityPercent('nope', 0.25), 25);
});

test('wrapFlattenedTextLines splits explicit newlines and wraps long words', () => {
  const measure = (s) => String(s).length * 10;
  assert.deepEqual(
    wrapFlattenedTextLines('Line1\nLine2\nLine3', { measure, maxWidth: 200 }),
    ['Line1', 'Line2', 'Line3'],
  );
  assert.deepEqual(
    wrapFlattenedTextLines('hello world', { measure, maxWidth: 60 }),
    ['hello ', 'world'],
  );
  assert.deepEqual(wrapFlattenedTextLines('', { measure, maxWidth: 80 }), ['']);
});
