/**
 * quickStyleRow.test.mjs — the quick styles that open the tool-properties row.
 *
 * WHAT THE OWNER ASKED FOR (2026-09-17): "three or four default colors; to the
 * right or left of them the color swatch that opens the picker (color picker,
 * larger array of default colors, hex code, opacity — all already in
 * CompactColorPicker); three default line widths, next to them the input field
 * to type a width and the dropdown to select more; then the line type (solid,
 * dashed, …)."
 *
 * So this file guards four things:
 *   1. ONE list of quick styles, shared by the desktop bar and the phone strip.
 *   2. Pressing a dot hands back the colour it is showing; pressing a width
 *      hands back that width — and both rows wire that press to the real
 *      handlers, not to a copy of them.
 *   3. The row reads in the order the owner asked for, on both platforms.
 *   4. Nothing else in either row moved.
 *
 * Verified live as well, on 2026-09-17, in the Browser pane against the dev
 * server: at 1440x900 with Rectangle armed, pressing Blue drew a blue
 * rectangle and pressing "4" drew it 4 wide; selecting that rectangle and
 * pressing Red then "1" repainted it red at width 1; the swatch still opened
 * the picker and its hex field and opacity box still drove the same mark.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

import {
  QUICK_COLOURS,
  QUICK_WIDTHS,
  matchedQuickColour,
  normaliseQuickColour,
} from '../src/utils/quickStylePresets.js';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFile(path.join(repoRoot, relative), 'utf8');

const appShell = await read('src/AppShell.jsx');
const phoneChrome = await read('src/mobile/MobilePdfViewerChrome.jsx');
const controlsSource = await read('src/components/QuickStyleControls.jsx');
const controlsCss = await read('src/components/QuickStyleControls.css');

/* ---------------------------------------------------------------- 1. shared */

test('the quick styles are one shared list, not a copy on each platform', async () => {
  assert.deepEqual([...QUICK_COLOURS], ['#FF0000', '#0000FF', '#00FF00', '#000000']);
  assert.deepEqual([...QUICK_WIDTHS], [1, 2, 4]);

  // The controls read the list from the shared module...
  assert.match(controlsSource, /from '\.\.\/utils\/quickStylePresets'/);
  // ...and both chrome files render those same controls rather than rolling
  // their own row of dots.
  for (const [name, source] of [['desktop', appShell], ['phone', phoneChrome]]) {
    assert.match(
      source,
      /QuickColourDots/,
      `${name} must render the shared quick colour dots`,
    );
    assert.match(
      source,
      /QuickWidthPresets/,
      `${name} must render the shared quick width presets`,
    );
    assert.match(
      source,
      /from '\.{1,2}\/components\/QuickStyleControls'/,
      `${name} must import the shared controls`,
    );
  }

  // The list is declared in exactly one place in the whole tree. Neither
  // chrome file even names it: they render the shared controls, which read it.
  const declarations = [];
  const walk = async (dir, prefix = '') => {
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(path.join(repoRoot, 'src', dir), { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (/\.(jsx?|mjs)$/.test(entry.name)) {
        const text = await read(path.join('src', dir, entry.name));
        if (/(?:const|let|var)\s+QUICK_(?:COLOURS|WIDTHS)\s*=/.test(text)) declarations.push(rel);
      }
    }
  };
  await walk('.');
  assert.deepEqual(
    declarations.sort(),
    ['utils/quickStylePresets.js'],
    'the quick styles must be declared once, in the shared module, and imported '
    + 'from there — a second declaration is how the two platforms drift',
  );
  for (const [name, source] of [['desktop', appShell], ['phone', phoneChrome]]) {
    assert.ok(
      !/QUICK_(COLOURS|WIDTHS)/.test(source),
      `${name} reaches past the shared controls to the raw list; render `
      + '<QuickColourDots> / <QuickWidthPresets> instead',
    );
  }
});

test('quick colours are the picker cells they look like, so a dot and the grid agree', async () => {
  const picker = await read('src/components/CompactColorPicker.jsx');
  const presetBlock = picker.slice(picker.indexOf('const PRESET_COLORS'), picker.indexOf('const clamp'));
  for (const colour of QUICK_COLOURS) {
    assert.ok(
      presetBlock.includes(colour),
      `${colour} is offered as a quick colour but is not a cell of the shared `
      + "picker's own grid, so pressing the dot and picking the cell that looks "
      + 'identical would set two different values',
    );
  }
});

test('colour matching ignores case and alpha, because the chrome writes both', () => {
  assert.equal(normaliseQuickColour('#F00'), '#ff0000');
  assert.equal(normaliseQuickColour('#ff0000ff'), '#ff0000');
  assert.equal(matchedQuickColour('#ff0000'), '#FF0000');
  assert.equal(matchedQuickColour('#123456'), null);
});

/* ------------------------------------------------------------ 2a. behaviour */

async function loadControls() {
  const componentPath = path.join(repoRoot, 'src/components/QuickStyleControls.jsx');
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  // Harness plumbing, not an assertion: the tooltip binding needs the whole
  // viewer tree to be real, and it contributes nothing to what a press does.
  source = source.replace(
    "import { useTooltip } from './Tooltip';",
    'const useTooltip = () => () => ({});',
  );
  source = source.replace("import './QuickStyleControls.css';", '');
  source = source.replace(
    "from '../utils/quickStylePresets'",
    `from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'src/utils/quickStylePresets.js')).href)}`,
  );
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'quick-style-test-'));
  const modulePath = path.join(tempDir, 'QuickStyleControls.mjs');
  await writeFile(modulePath, executable);
  return {
    module: await import(pathToFileURL(modulePath).href),
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const withDom = async (run) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { module, cleanup } = await loadControls();
  const root = createRoot(document.getElementById('root'));
  try {
    await run(module, root);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
};

test('pressing a quick colour dot hands back the colour it is showing', async () => {
  await withDom(async ({ QuickColourDots }, root) => {
    const picked = [];
    await act(async () => root.render(React.createElement(QuickColourDots, {
      value: '#ff0000',
      onPick: (hex) => picked.push(hex),
    })));

    const dots = [...document.querySelectorAll('[data-quick-colours] button')];
    assert.equal(dots.length, QUICK_COLOURS.length, 'every quick colour gets a dot');

    // The gold ring sits on the dot that matches the current colour, and on
    // exactly one dot.
    const ringed = dots.filter((dot) => dot.className.includes('is-current'));
    assert.equal(ringed.length, 1);
    assert.equal(ringed[0].getAttribute('aria-label'), 'Red');
    assert.equal(ringed[0].getAttribute('aria-pressed'), 'true');

    for (const dot of dots) {
      await act(async () => { dot.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    }
    assert.deepEqual(picked, [...QUICK_COLOURS]);
  });
});

test('no dot is ringed when the current colour is not one of the four', async () => {
  await withDom(async ({ QuickColourDots }, root) => {
    await act(async () => root.render(React.createElement(QuickColourDots, {
      value: '#7c3aed',
      onPick: () => {},
    })));
    const ringed = [...document.querySelectorAll('[data-quick-colours] button')]
      .filter((dot) => dot.className.includes('is-current'));
    assert.equal(ringed.length, 0, 'the ring belongs on the swatch then, not on a dot');
  });
});

test('pressing a quick width hands back that width, as a number', async () => {
  await withDom(async ({ QuickWidthPresets }, root) => {
    const picked = [];
    await act(async () => root.render(React.createElement(QuickWidthPresets, {
      value: '2',
      onPick: (width) => picked.push(width),
    })));

    const chips = [...document.querySelectorAll('[data-quick-widths] button')];
    assert.equal(chips.length, QUICK_WIDTHS.length);
    assert.deepEqual(chips.map((chip) => chip.getAttribute('aria-label')), ['Line width 1', 'Line width 2', 'Line width 4']);

    const current = chips.filter((chip) => chip.className.includes('is-current'));
    assert.equal(current.length, 1);
    assert.equal(current[0].getAttribute('aria-label'), 'Line width 2', 'a committed "2" is the preset 2');

    // Each chip draws the weight it applies, so the row shows the difference
    // rather than naming it.
    assert.deepEqual(
      chips.map((chip) => chip.firstElementChild.getAttribute('style')),
      QUICK_WIDTHS.map((width) => `--quick-style-width: ${width}px;`),
    );

    for (const chip of chips) {
      await act(async () => { chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    }
    assert.deepEqual(picked, [...QUICK_WIDTHS]);
  });
});

/* --------------------------------------------------------------- 2b. wiring */

test('the desktop row wires a press to the same handlers the picker and the field use', () => {
  // Colour: through the shared paint, so a dot writes exactly what the
  // picker's write would write.
  assert.match(
    appShell,
    /onPick=\{\(hex\) => annotationPaint\.quick\.apply\(hex, annotationPaint\.quick\.opacity\)\}/,
    'a quick colour must go through the resolved annotation paint, not its own write',
  );
  assert.match(appShell, /const annotationPaint = resolveAnnotationPaint\(bottomToolbarApi, colorPickerTab\)/);
  assert.match(appShell, /apply: picker\.apply/, 'the picker must take its write from the same resolver');

  // Width: the field's own draft-then-commit pair, so a press and a typed
  // number land identically.
  const widthBlock = appShell.slice(appShell.indexOf('<QuickWidthPresets'), appShell.indexOf('<AnnotationSizeControl'));
  assert.match(widthBlock, /bottomToolbarApi\.handleStrokeWidthInputChange\?\.\(\{ target: \{ value \} \}\)/);
  assert.match(widthBlock, /bottomToolbarApi\.handleStrokeWidthInputBlur\?\.\(\{ currentTarget: \{ value \} \}\)/);
});

test('the phone row wires a press to the same handlers its sheet uses', () => {
  assert.match(phoneChrome, /onPick=\{applyQuickColour\}/);
  assert.match(phoneChrome, /if \(tool === 'counter'\) api\.handleFillColorChange\?\.\(hex\);\s*\n\s*else api\.handleStrokeColorChange\?\.\(hex\);/);
  const widthBlock = phoneChrome.slice(phoneChrome.indexOf('<QuickWidthPresets'), phoneChrome.indexOf('<AnnotationSizeControl'));
  assert.match(widthBlock, /handleSizeDraft\(value\)/);
  assert.match(widthBlock, /handleSizeCommit\(value\)/);
});

test('a quick dot changes the paint you can see, never a transparent one', () => {
  // A new rectangle's fill is white at 0% opacity while its border is red, and
  // the picker's tab defaults to Fill. Routing the dots by that tab would have
  // made every dot press invisible on a fresh shape. The dots take the stroke
  // side for every tool but the counter, whose colour IS its fill.
  assert.match(
    appShell,
    /const quick = tool === 'counter' && isShape \? channel\(true\) : channel\(false\)/,
  );
  assert.match(
    phoneChrome,
    /const quickColourValue = tool === 'counter'/,
  );
});

/* ------------------------------------------------------------------ 3. order */

const orderOf = (source, markers, label) => {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.notEqual(index, -1, `${label}: expected to find ${marker}`);
    assert.ok(
      index > previous,
      `${label}: ${marker} is out of order — the row reads `
      + `[quick colours] [swatch] [quick widths] [width field] [line style]`,
    );
    previous = index;
  }
};

test('the desktop row reads colours, swatch, widths, width field, line style', () => {
  const row = appShell.slice(
    appShell.indexOf("{/* 2026-05-26: Tool properties (divider + color swatch + width +"),
    appShell.indexOf('id="chrome-left-host"'),
  );
  assert.ok(row.length > 1000, 'the tool-properties row must still be where this test reads it');
  orderOf(row, [
    '<QuickColourDots',
    'data-annotation-color-trigger',
    '<QuickWidthPresets',
    '<AnnotationSizeControl',
    'label="Style"',
  ], 'desktop');
});

test('the phone strip reads colours, swatch, widths, width field, line style', () => {
  const row = phoneChrome.slice(
    phoneChrome.indexOf('<div className="mobile-pdf-properties" data-mobile-tool-properties="true"'),
    phoneChrome.indexOf('{textDefaultsOpen &&'),
  );
  assert.ok(row.length > 1000, 'the phone tool-properties strip must still be where this test reads it');
  orderOf(row, [
    '<QuickColourDots',
    'mobile-pdf-properties__swatch',
    '<QuickWidthPresets',
    '<AnnotationSizeControl',
    'ariaLabel="Border style"',
  ], 'phone');
});

test('nothing else in either row moved', () => {
  const desktopRow = appShell.slice(
    appShell.indexOf("{/* 2026-05-26: Tool properties (divider + color swatch + width +"),
    appShell.indexOf('id="chrome-left-host"'),
  );
  orderOf(desktopRow, [
    'data-annotation-color-trigger',
    '<AnnotationSizeControl',
    'label="Style"',
    'label="Arrowhead"',
    'aria-label="Arrowhead on both ends"',
    'aria-label="Edit text"',
  ], 'desktop tail');

  const phoneRow = phoneChrome.slice(
    phoneChrome.indexOf('<div className="mobile-pdf-properties" data-mobile-tool-properties="true"'),
    phoneChrome.indexOf('{textDefaultsOpen &&'),
  );
  orderOf(phoneRow, [
    'mobile-pdf-properties__swatch',
    '<AnnotationSizeControl',
    'ariaLabel="Border style"',
    'ariaLabel="Arrowhead style"',
    'aria-label="Arrowhead on both ends"',
    'aria-label="Text formatting"',
  ], 'phone tail');
});

/* ------------------------------------------------------------------ 4. size */

test('a dot is 20px of colour inside a 24px target, and a width chip is 28x24', () => {
  const rule = (selector) => {
    const index = controlsCss.indexOf(`\n${selector} {`);
    assert.notEqual(index, -1, `expected a "${selector}" rule`);
    const open = controlsCss.indexOf('{', index);
    return controlsCss.slice(open + 1, controlsCss.indexOf('}', open));
  };

  const dot = rule('.quick-style__dot');
  assert.match(dot, /width:\s*20px/);
  assert.match(dot, /height:\s*20px/);
  // The finger / pointer target is the shared 24px value-chip size: the 20px
  // dot plus 2px into each half of the 4px gutter.
  assert.match(rule('.quick-style__dot::after'), /inset:\s*-2px/);
  assert.match(rule('.quick-style--colours'), /gap:\s*var\(--chrome-gap, 4px\)/);

  const chip = rule('.quick-style__width');
  assert.match(chip, /width:\s*28px/);
  assert.match(chip, /height:\s*var\(--chrome-field-h, 24px\)/);
  assert.match(rule('.quick-style__width-line'), /width:\s*22px/);
  assert.match(rule('.quick-style__width-line'), /height:\s*var\(--quick-style-width/);
});

test('the quick controls draw no inline icon, so they cannot fight the house stroke', async () => {
  const { offHouseWeight, stripComments } = await import('./helpers/inlineIconStrokes.mjs');
  assert.deepEqual(offHouseWeight(controlsSource, 'src/components/QuickStyleControls.jsx'), []);
  assert.ok(
    !/<svg/.test(stripComments(controlsSource)),
    'a width chip has to show its real weight, which the one-weight shared icon '
    + 'set cannot do — it draws a plain rule, not an <svg> glyph',
  );
});
