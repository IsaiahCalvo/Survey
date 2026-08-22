import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FONT_FAMILIES,
  FONT_SIZE_PRESETS,
  TEXT_ALIGN_HORIZONTAL,
  TEXT_ALIGN_VERTICAL,
  TEXT_FORMAT_TOGGLES,
  clampFontSize,
  isSingleNameFontFamily,
  sanitizeOfferedFontFamily,
  sanitizeTextAlign,
  sanitizeVerticalAlign,
} from '../src/utils/annotationStyleCatalog.js';
import { defaultCalloutStyle } from '../src/components/Callout/types.js';

// Source contracts for Callout remaining formatting (font / size / align + B/I/U/S).
// Live proof: debug/scenarios/e2e-callout-formatting.spec.mjs
// Distinct from pickers-every-swatch (Text target) and Callout Fill/dash/Width.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Callout catalogs are six single-name fonts, 18 sizes, 3x3, and B/I/U/S', () => {
  assert.deepEqual([...FONT_FAMILIES], [
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
  ]);
  assert.deepEqual([...FONT_SIZE_PRESETS], [
    8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72,
  ]);
  assert.deepEqual([...TEXT_ALIGN_HORIZONTAL], ['left', 'center', 'right']);
  assert.deepEqual([...TEXT_ALIGN_VERTICAL], ['top', 'middle', 'bottom']);
  assert.deepEqual([...TEXT_FORMAT_TOGGLES], ['bold', 'italic', 'underline', 'strike']);
  for (const family of FONT_FAMILIES) {
    assert.equal(isSingleNameFontFamily(family), true, family);
    assert.equal(family.includes(','), false, family);
  }
  assert.equal(isSingleNameFontFamily(defaultCalloutStyle.fontFamily), true);
  assert.equal(defaultCalloutStyle.fontFamily, 'Arial');
  assert.equal(defaultCalloutStyle.fontSize, 14);
  assert.equal(defaultCalloutStyle.textAlign, 'left');
  assert.equal(defaultCalloutStyle.bold, false);

  assert.equal(clampFontSize(1), 6);
  assert.equal(clampFontSize(0), 6);
  assert.equal(clampFontSize(999), 200);
  assert.equal(clampFontSize('abc'), 16);
  assert.equal(sanitizeTextAlign('justify'), 'justify');
  assert.equal(sanitizeTextAlign('nope'), 'left');
  assert.equal(sanitizeVerticalAlign('middle'), 'middle');
  assert.equal(sanitizeVerticalAlign('justify'), 'top');
  assert.equal(sanitizeOfferedFontFamily('Georgia, serif'), 'Georgia');
  assert.equal(sanitizeOfferedFontFamily('Comic Sans MS, cursive'), 'Comic Sans MS');
});

test('Callout edit overlay maps font/size/align/B/I/U/S and rejects CSS stacks', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /case 'fontFamily': return \{ fontFamily: val \}/);
  assert.match(overlay, /case 'fontSize': return \{ fontSize: Number\(val\) \|\| 12 \}/);
  assert.match(overlay, /case 'textAlign': return \{ textAlign: val \}/);
  assert.match(overlay, /case 'verticalAlign': return \{ verticalAlign: val \}/);
  assert.match(overlay, /case 'fontWeight': return \{ bold: val === 'bold' \}/);
  assert.match(overlay, /case 'fontStyle': return \{ italic: val === 'italic' \}/);
  assert.match(overlay, /case 'underline': return \{ underline: !!val \}/);
  assert.match(overlay, /case 'linethrough': return \{ strikethrough: !!val \}/);
  assert.match(
    overlay,
    /setFontFamily: \(f\) => applyStyle\('fontFamily', typeof f === 'string' && f\.length > 0 && !f\.includes\(','\) \? f : 'Arial'\)/,
  );
  assert.match(
    overlay,
    /setFontSize: \(n\) => applyStyle\('fontSize', Math\.max\(6, Math\.min\(200, Math\.round\(Number\(n\) \|\| 16\)\)\)\)/,
  );
  assert.match(
    overlay,
    /setTextAlign: \(a\) => applyStyle\('textAlign', \['left', 'center', 'right', 'justify'\]\.includes\(a\) \? a : 'left'\)/,
  );

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /options=\{FONT_FAMILIES\.map/);
  assert.match(shell, /FONT_SIZE_PRESETS\.includes\(currentSize\)/);
  assert.match(shell, /aria-label=\{\`\$\{v\} \$\{h\}\`\}/);
  assert.match(shell, /toggleBold/);
  assert.match(shell, /toggleStrike/);
  assert.doesNotMatch(shell, /label: 'Justify'|name: 'justify'/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /options=\{FONT_FAMILIES\.map/);
  assert.match(mobile, /aria-label="Font size"/);
  assert.match(mobile, /label: `\$\{vertical\} \$\{horizontal\}`/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /source: 'callout:style', action: 'callout-text-style'/);
  assert.match(viewer, /\.\.\.\(mobileMode \? \{/);
  assert.match(viewer, /fontFamily: textStyleDefaults\.fontFamily/);

  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /const safeFontFamily = sanitizeFontFamily\(callout\.style\?\.fontFamily\)/);
  assert.match(renderers, /fontWeight: callout\.style\?\.bold \? 'bold' : 'normal'/);
  assert.match(renderers, /fontStyle: callout\.style\?\.italic \? 'italic' : 'normal'/);
  assert.match(renderers, /underline: !!callout\.style\?\.underline/);
  assert.match(renderers, /linethrough: !!callout\.style\?\.strikethrough/);
});

test('live Callout formatting spec covers every font / size / align + break + edge', () => {
  const spec = read('debug/scenarios/e2e-callout-formatting.spec.mjs');
  assert.match(spec, /FONT_FAMILIES/);
  assert.match(spec, /FONT_SIZE_PRESETS/);
  assert.match(spec, /ALIGN_CELLS/);
  assert.match(spec, /createCalloutKeepEdit/);
  assert.match(spec, /Pen-armed/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /Justify not offered/);
  assert.match(spec, /must not be a CSS stack/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  for (const family of FONT_FAMILIES) {
    assert.match(spec, new RegExp(family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const size of FONT_SIZE_PRESETS) {
    assert.match(spec, new RegExp(`\\b${size}\\b`));
  }
  for (const cell of ['top left', 'middle center', 'bottom right']) {
    assert.match(spec, new RegExp(cell));
  }
  for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
    assert.match(spec, new RegExp(name));
  }
});
