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
  // CHANGED 2026-09-21. Was ['#FF0000', '#0000FF', '#00FF00', '#000000'].
  // RULING (owner, pass 7, boards 1-12): "Quick colours: red #FF0000, blue
  // #0000FF, black #000000 + ONE custom swatch." Green left because four
  // presets plus the rainbow custom disc is five 22px buttons, which no longer
  // fits the 375px phone strip beside the width and line-style pills. Green is
  // still one press away in the picker's own presets row.
  assert.deepEqual([...QUICK_COLOURS], ['#FF0000', '#0000FF', '#000000']);
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
      /from '\.{1,2}\/components\/QuickStyleControls'/,
      `${name} must import the shared controls`,
    );
  }
  /*
   * RULED CHANGE 2026-09-21 (pass 7, owner: "Width is a dropdown ONLY (no preset
   * chips): stroke sample + '2 pt' + chevron. Never a bare line").
   *
   * The ruling has no platform in it, and neither do the boards: boards 1-7 draw
   * one 72px width pill on the phone strip and boards 8-14 draw one 92px width
   * pill on the desktop bar. Neither draws a chip. So the three quick WIDTH chips
   * come off BOTH bars. The two passes each removed them from the bar they owned
   * and each expected the other bar to keep them; the ruling says otherwise, so
   * this asserts what the boards show.
   *
   * Nothing became unreachable: the dropdown lists the very same preset widths
   * the chips held, and a width the presets do not hold is typed in the tool's
   * own sheet. <QuickWidthPresets> stays in the shared component, unrendered, so
   * the one shared list still has one home.
   */
  assert.doesNotMatch(appShell, /QuickWidthPresets/, 'width is a dropdown only on the desktop bar');
  assert.doesNotMatch(phoneChrome, /QuickWidthPresets/, 'width is a dropdown only on the phone strip');

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

test('no preset disc is ringed when the current colour is not one of the three', async () => {
  await withDom(async ({ QuickColourDots }, root) => {
    await act(async () => root.render(React.createElement(QuickColourDots, {
      value: '#7c3aed',
      onPick: () => {},
    })));
    const ringed = [...document.querySelectorAll('[data-quick-colour-preset]')]
      .filter((dot) => dot.className.includes('is-current'));
    assert.equal(ringed.length, 0, 'the mark belongs on the custom disc then');
  });
});

/* ------------------------------ 2b. the custom disc and combined swatch ---- */

test('the custom disc appears only where the host can open the picker, and opens it', async () => {
  await withDom(async ({ QuickColourDots }, root) => {
    // No onOpenPicker: three preset discs and nothing else.
    await act(async () => root.render(React.createElement(QuickColourDots, {
      value: '#FF0000',
      onPick: () => {},
    })));
    assert.equal(document.querySelectorAll('[data-quick-colours] button').length, 3);
    assert.equal(document.querySelectorAll('[data-quick-colour-custom]').length, 0);

    const opened = [];
    await act(async () => root.render(React.createElement(QuickColourDots, {
      value: '#FF0000',
      onPick: () => {},
      onOpenPicker: () => opened.push(true),
    })));
    const buttons = [...document.querySelectorAll('[data-quick-colours] button')];
    assert.equal(buttons.length, 4, 'three presets plus the rainbow custom disc');
    const custom = document.querySelector('[data-quick-colour-custom]');
    assert.equal(custom.getAttribute('aria-label'), 'Custom color');
    // Red is current, so the custom disc is not marked.
    assert.equal(custom.getAttribute('aria-pressed'), 'false');
    await act(async () => { custom.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.deepEqual(opened, [true]);
  });
});

test('the custom disc wears the chosen mark when the colour is not a preset', async () => {
  await withDom(async ({ QuickColourDots }, root) => {
    await act(async () => root.render(React.createElement(QuickColourDots, {
      value: '#7c3aed',
      onPick: () => {},
      onOpenPicker: () => {},
    })));
    const custom = document.querySelector('[data-quick-colour-custom]');
    assert.equal(custom.getAttribute('aria-pressed'), 'true');
    assert.ok(custom.className.includes('is-current'));
    // And the ring it wears is the CURRENT colour, never gold.
    assert.equal(custom.style.getPropertyValue('--quick-style-ring'), '#7c3aed');
    assert.equal(
      [...document.querySelectorAll('[data-quick-colour-preset]')]
        .filter((dot) => dot.className.includes('is-current')).length,
      0,
      'exactly one thing in the cluster is ever marked',
    );
  });
});

test('a multi-colour tool gets ONE combined swatch that opens the picker', async () => {
  await withDom(async ({ QuickPaintSwatch }, root) => {
    const opened = [];
    await act(async () => root.render(React.createElement(QuickPaintSwatch, {
      ring: '#FF0000',
      center: '#ffffff',
      onOpen: () => opened.push(true),
    })));
    const swatch = document.querySelector('[data-quick-paint-swatch]');
    assert.equal(swatch.getAttribute('data-quick-paint-swatch'), 'shape');
    assert.equal(swatch.getAttribute('aria-label'), 'Border and fill colors');
    const disc = swatch.querySelector('.quick-style__swatch-disc');
    assert.equal(disc.style.getPropertyValue('--quick-style-fill'), '#ffffff');
    assert.equal(disc.style.getPropertyValue('--quick-style-border'), '#FF0000');
    // No preset discs come with it.
    assert.equal(document.querySelectorAll('[data-quick-colour-preset]').length, 0);
    await act(async () => { swatch.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.deepEqual(opened, [true]);

    // `border` / `fill` are accepted as aliases so either chrome file can call it.
    await act(async () => root.render(React.createElement(QuickPaintSwatch, {
      border: '#0000FF', fill: '#eeeeee', onOpen: () => {},
    })));
    const aliased = document.querySelector('.quick-style__swatch-disc');
    assert.equal(aliased.style.getPropertyValue('--quick-style-border'), '#0000FF');
    assert.equal(aliased.style.getPropertyValue('--quick-style-fill'), '#eeeeee');
  });
});

test('the counter swatch is the pin with its number, not a circle', async () => {
  await withDom(async ({ QuickPaintSwatch }, root) => {
    await act(async () => root.render(React.createElement(QuickPaintSwatch, {
      variant: 'counter',
      ring: '#FF0000',
      center: '#ffffff',
      count: 7,
      onOpen: () => {},
    })));
    const swatch = document.querySelector('[data-quick-paint-swatch="counter"]');
    assert.equal(swatch.getAttribute('aria-label'), 'Pin and number colors');
    const svg = swatch.querySelector('svg');
    assert.equal(svg.querySelectorAll('circle').length, 0, 'the owner ruled out a circle');
    assert.equal(svg.querySelector('path').getAttribute('fill'), '#FF0000');
    assert.equal(svg.querySelector('text').getAttribute('fill'), '#ffffff');
    assert.equal(svg.querySelector('text').textContent, '7');
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
  // Width: the same draft-then-commit pair the field always used, now reached
  // from the pill's own list instead of from three chips beside it, so a pressed
  // row and a typed number still land identically.
  const widthBlock = appShell.slice(appShell.indexOf('<AnnotationSizeControl'), appShell.indexOf('variant="pill"'));
  assert.match(widthBlock, /handler = bottomToolbarApi\.activeTool === 'eraser'\s*\?\s*bottomToolbarApi\.handleEraserSizeInputChange\s*:\s*bottomToolbarApi\.handleStrokeWidthInputChange/);
  assert.match(widthBlock, /handler\?\.\(\{ target: \{ value \} \}\)/);
  assert.match(widthBlock, /handler\?\.\(\{ currentTarget: \{ value \} \}\)/);
});

test('the phone row wires a press to the same handlers its sheet uses', () => {
  assert.match(phoneChrome, /onPick=\{applyQuickColour\}/);
  assert.match(phoneChrome, /if \(tool === 'counter'\) api\.handleFillColorChange\?\.\(hex\);\s*\n\s*else api\.handleStrokeColorChange\?\.\(hex\);/);
  // Pass 7: the phone's width control is the dropdown, and picking a width out of
  // it still goes through the field's own draft-then-commit pair, so a pick and a
  // number typed into the sheet land identically. Same contract, one control.
  const widthBlock = phoneChrome.slice(
    phoneChrome.indexOf('ariaLabel="Line width"'),
    phoneChrome.indexOf('ariaLabel="Eraser size"'),
  );
  assert.match(widthBlock, /handleSizeDraft\(width\)/);
  assert.match(widthBlock, /handleSizeCommit\(width\)/);
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
  // Pass 7: the quick width chips left this row (see above); the width pill IS
  // the AnnotationSizeControl now.
  orderOf(row, [
    '<QuickColourDots',
    'data-annotation-color-trigger',
    '<AnnotationSizeControl',
    'label="Style"',
  ], 'desktop');
});

/*
 * ADDED at the pass-7 integration (board 12). The desktop text-formatting bar
 * showed the colour cluster AND a separate round font-colour swatch next to it -
 * five circles, two of them meaning the same thing - because the cluster had no
 * way to open a picker when that bar was built. The rainbow custom disc is that
 * way, so board 12's four circles are what the bar draws, and the cluster is the
 * only colour control on it.
 */
test('the desktop text bar shows the colour cluster and nothing else for colour', () => {
  const bar = appShell.slice(
    appShell.indexOf('<div data-rich-text-toolbar'),
    appShell.indexOf('Font family — custom dropdown'),
  );
  assert.ok(bar.length > 400, 'the text-formatting bar must still be where this test reads it');
  assert.match(bar, /<QuickColourDots/, 'the cluster is the colour control');
  assert.match(bar, /onOpenPicker=\{\(\) => setShowFontColorPicker/, 'its custom disc opens the picker');
  assert.doesNotMatch(bar, /aria-label="Font color"/, 'the second swatch is gone');
  assert.doesNotMatch(bar, /ctx-color-swatch/, 'and so is its swatch styling');
  // The picker it opens is still the one shared picker, anchored under the cluster.
  assert.match(bar, /<CompactColorPicker/);
});

/*
 * RULED CHANGE 2026-09-21 (pass 7, boards 1-7). The phone strip's order is the
 * boards' order now, and it is shorter because the boards are: colour (three
 * preset discs plus a rainbow custom one for a single-colour tool, or ONE
 * combined swatch for a multi-colour one), then the width dropdown, then the line
 * style. The quick width chips are off the row (width is a dropdown only) and the
 * typed width field moved into the tool's own sheet, so neither is in this list.
 * "Border style" is "Line style" - the label the boards and the desktop use.
 */
test('the phone strip reads colour, width, line style', () => {
  const row = phoneChrome.slice(
    phoneChrome.indexOf('<div className="mobile-pdf-properties" data-mobile-tool-properties="true" role="toolbar"'),
    phoneChrome.indexOf('BOARD 16'),
  );
  assert.ok(row.length > 1000, 'the phone tool-properties strip must still be where this test reads it');
  orderOf(row, [
    '<QuickColourDots',
    // The combined swatch a multi-colour tool gets. The phone pass drew it with a
    // local MobilePaintSwatch while the picker pass was landing the shared
    // QuickPaintSwatch beside it; at the merge the local copy went and this is the
    // shared control, as that comment said it would be.
    '<QuickPaintSwatch',
    'ariaLabel="Line width"',
    'ariaLabel="Line style"',
  ], 'phone');
});

test('nothing else in either row moved', () => {
  const desktopRow = appShell.slice(
    appShell.indexOf("{/* 2026-05-26: Tool properties (divider + color swatch + width +"),
    appShell.indexOf('id="chrome-left-host"'),
  );
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner-approved board 10):
  // the "both ends" on/off button is now the Arrow ends dropdown (End / Both /
  // None), in the same place in the row.
  orderOf(desktopRow, [
    'data-annotation-color-trigger',
    '<AnnotationSizeControl',
    'label="Style"',
    'label="Arrowhead"',
    'label="Arrow ends"',
    'aria-label="Edit text"',
  ], 'desktop tail');

  // Pass 7: the phone tail is shorter, because the arrowhead and the arrow ends
  // moved off the strip and into the tool's "..." sheet (board 16), and the old
  // "Arrowhead on both ends" text toggle is that sheet's Arrow-ends dropdown now.
  const phoneRow = phoneChrome.slice(
    phoneChrome.indexOf('<div className="mobile-pdf-properties" data-mobile-tool-properties="true" role="toolbar"'),
    phoneChrome.indexOf('BOARD 16'),
  );
  orderOf(phoneRow, [
    '<QuickPaintSwatch',
    'ariaLabel="Line width"',
    'ariaLabel="Line style"',
    'aria-label="Text formatting"',
    'More ${TOOL_LABELS[tool]',
  ], 'phone tail');
  const phoneSheet = phoneChrome.slice(phoneChrome.indexOf('BOARD 16'));
  orderOf(phoneSheet, [
    'ariaLabel="Arrowhead"',
    'ariaLabel="Arrow ends"',
  ], 'phone "..." sheet');
});

/* ------------------------------------------------------------------ 4. size */

/*
 * CHANGED 2026-09-21, both tests below.
 *
 * RULING (owner, pass 7, boards 1-12): every colour control is 22px with a 16px
 * disc inside it, and a multi-colour tool shows ONE combined 22px swatch instead
 * of preset discs. So:
 *   - the dot was 20px of colour in a 24px target on a var(--chrome-gap) gutter;
 *     it is now 16px of colour in a 22px button on the boards' flat 4px gap,
 *     with the hit box bleeding 3px rather than 2px;
 *   - the colour cluster now draws three small state glyphs, so "no inline icon
 *     at all" is no longer the rule. The rule is that each one is either at the
 *     house weight or is a documented small state glyph at the board's weight.
 */
test('a disc is 16px of colour inside a 22px button, and a width chip is 28x24', () => {
  const rule = (selector) => {
    const index = controlsCss.indexOf(`\n${selector} {`);
    assert.notEqual(index, -1, `expected a "${selector}" rule`);
    const open = controlsCss.indexOf('{', index);
    return controlsCss.slice(open + 1, controlsCss.indexOf('}', open));
  };

  // The button and the combined swatch share the 22px box.
  const box = rule('.quick-style__dot,\n.quick-style__swatch');
  assert.match(box, /width:\s*22px/);
  assert.match(box, /height:\s*22px/);

  const fill = rule('.quick-style__dot-fill');
  assert.match(fill, /width:\s*16px/);
  assert.match(fill, /height:\s*16px/);

  // The pointer / finger target bleeds 3px past the button into each half of
  // the 4px gap, so two neighbouring targets stop 1px short of each other.
  assert.match(
    rule('.quick-style__dot::after,\n.quick-style__swatch::after'),
    /inset:\s*var\(--quick-style-hit-inset, -3px\)/,
  );
  assert.match(rule('.quick-style--colours'), /gap:\s*4px/);

  // The combined swatch and the rainbow custom disc both draw their 16px area
  // as a 3px inset of the 22px button.
  assert.match(rule('.quick-style__swatch-disc'), /inset:\s*3px/);
  assert.match(rule('.quick-style__rainbow'), /inset:\s*3px/);

  const chip = rule('.quick-style__width');
  assert.match(chip, /width:\s*28px/);
  assert.match(chip, /height:\s*var\(--chrome-field-h, 24px\)/);
  assert.match(rule('.quick-style__width-line'), /width:\s*22px/);
  assert.match(rule('.quick-style__width-line'), /height:\s*var\(--quick-style-width/);
});

test('the chosen disc is ringed in its own colour and never in gold', () => {
  assert.ok(
    !/var\(--accent/.test(controlsCss.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\.quick-style__width\.is-current \{[^}]*\}/, '')),
    'only the width chip may turn gold (it is a glyph, not a colour). A colour '
    + "disc's chosen mark is a ring in its OWN colour plus a check.",
  );
  assert.match(controlsCss, /--quick-style-ring/);
  assert.match(controlsCss, /0 0 0 1\.5px var\(--quick-style-gap, var\(--surface-1\)\)/);
  // The gold ring that used to sit on the swatch beside the discs is gone.
  assert.ok(
    !/is-current-color\s*\{/.test(controlsCss),
    'the .is-current-color gold rings were reversed by the owner on 2026-09-21',
  );
});

test('the only inline glyphs in the colour cluster are the three the boards draw', async () => {
  const { offHouseWeight, stripComments } = await import('./helpers/inlineIconStrokes.mjs');
  const clean = stripComments(controlsSource);

  // The counter pin IS at the house weight: 67 units inside scale(0.0224).
  assert.match(clean, /strokeWidth="67"/);
  assert.match(clean, /scale\(0\.0224\)/);

  // The chosen check and the custom disc's plus are small STATE glyphs drawn at
  // the boards' own weights, which DESIGN-SYSTEM.md allows in as many words
  // ("use inline SVG for small state glyphs"; "1.5px strokes ... unless the
  // source icon needs another weight"). A 1.5 stroke inside a 10px check paints
  // at half a device pixel and disappears.
  // Anchored to BOTH the path and its board weight, so a chrome glyph cannot
  // hide behind the allowance.
  const STATE_GLYPHS = [
    { d: 'M5 12.5L9.5 17L19 7.5', weight: 2.6 },
    { d: 'M12 6V18', weight: 1.8 },
    { d: 'M6 12H18', weight: 1.8 },
  ];
  const unexplained = offHouseWeight(controlsSource, 'src/components/QuickStyleControls.jsx')
    .filter((offender) => !STATE_GLYPHS.some(({ d, weight }) => (
      clean.includes(d) && offender.includes(`strokes ${weight} on a`)
    )));
  assert.deepEqual(
    unexplained,
    [],
    'a glyph in the colour cluster that is neither the house weight nor one of '
    + 'the three the boards draw:\n  ' + unexplained.join('\n  '),
  );

  // And the width chip still draws a plain rule, not an icon: it has to show
  // its real weight, which the one-weight shared icon set cannot do.
  const chipBlock = clean.slice(clean.indexOf('export function QuickWidthPresets'));
  assert.ok(!/<svg/.test(chipBlock), 'the width chip must stay a plain rule');
});
