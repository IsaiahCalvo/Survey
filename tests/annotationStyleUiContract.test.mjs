// Source-contract: live UI surfaces consume the shared style catalog and
// reject CSS font stacks / invalid hex at the editor bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLOR_PICKER_PRESETS,
  FONT_FAMILIES,
  FONT_SIZE_PRESETS,
} from '../src/utils/annotationStyleCatalog.js';

const picker = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const overlay = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
const exportLib = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');

test('CompactColorPicker uses the shared preset catalog and rejects invalid hex', () => {
  assert.match(picker, /COLOR_PICKER_PRESETS/);
  assert.match(picker, /normalizeHexColor/);
  assert.match(picker, /applyColorPickerSelection/);
  assert.match(picker, /hsvToHex/);
  assert.match(picker, /applySpectrumKey/);
  assert.match(picker, /applyHueKey/);
  assert.match(picker, /clampOpacityPercent/);
  assert.match(picker, /if \(normalized\) applyHex\(normalized\)/);
  assert.match(picker, /if \(next\.kind === 'invalid'\) return;/);
  assert.equal(COLOR_PICKER_PRESETS.includes('#FF0000'), true);
  assert.equal(COLOR_PICKER_PRESETS[0], 'transparent');
});

test('desktop and mobile font menus use the shared FONT_FAMILIES / FONT_SIZE_PRESETS', () => {
  assert.match(appShell, /FONT_FAMILIES, FONT_SIZE_PRESETS/);
  assert.match(appShell, /options=\{FONT_FAMILIES\.map/);
  assert.match(appShell, /FONT_SIZE_PRESETS\.includes\(currentSize\)/);
  assert.match(mobile, /FONT_FAMILIES/);
  assert.match(mobile, /options=\{FONT_FAMILIES\.map/);
  assert.equal(FONT_FAMILIES.length, 6);
  assert.equal(FONT_SIZE_PRESETS.length, 18);
});

test('TextEditOverlay font/color APIs reject CSS stacks and non-#rrggbb colors', () => {
  assert.match(
    overlay,
    /setFontFamily: \(f\) => applyStyle\('fontFamily', typeof f === 'string' && f\.length > 0 && !f\.includes\(','\) \? f : 'Arial'\)/,
  );
  assert.match(
    overlay,
    /setFontColor: \(c\) => applyStyle\('fill', typeof c === 'string' && \/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(c\) \? c : '#000000'\)/,
  );
  assert.match(overlay, /toggleBold:/);
  assert.match(overlay, /toggleItalic:/);
  assert.match(overlay, /toggleUnderline:/);
  assert.match(overlay, /toggleStrike:/);
  assert.match(overlay, /setTextAlign:/);
  assert.match(overlay, /setVerticalAlign:/);
  assert.match(overlay, /setFontSize:/);
});

test('pdf-lib export/print consume the catalog font mapper', () => {
  assert.match(exportLib, /pdfDefaultAppearanceFontName/);
  assert.match(exportLib, /pdfStandardFontGroup/);
  assert.match(exportLib, /wrapFlattenedTextLines/);
  assert.match(exportLib, /StandardFonts\.TimesRoman/);
  assert.match(exportLib, /StandardFonts\.Courier/);
});

test('live CompactColorPicker sites are AppShell, mobile, templates, and legacy PAL', () => {
  const templates = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');
  const pal = readFileSync(new URL('../src/PageAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(appShell, /firstPreset="none"/);
  assert.match(appShell, /showOpacity=\{false\}/);
  assert.match(appShell, /firstPreset=\{\(shapeOneVisibleRule && !onFillTab\)/);
  assert.match(appShell, /minOpacity=\{0\}/);
  assert.match(mobile, /firstPreset: \{ kind: 'match'/);
  assert.match(mobile, /minOpacity: 0/);
  assert.match(mobile, /minOpacity=\{colorPickerConfig\.minOpacity\}/);
  assert.match(templates, /<CompactColorPicker/);
  assert.match(pal, /<CompactColorPicker/);
});
