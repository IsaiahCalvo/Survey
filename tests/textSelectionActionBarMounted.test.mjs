import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const ACCEPTED_ICON_HASHES = {
  'pan-hand-closed.svg': 'fad3b440787ce0d89d718c2a849fb102ec48a584bc4392d04f8e221065f0a00e',
  'text-highlight.svg': 'bfe4a937890f2bd90e59aa3eb8d2f9e3e0224bd77c9c7a2f3e75919f21e6e932',
  // DELIBERATE ASSERTION CHANGE (2026-09-17, phone header pass): the underline
  // and strikethrough hashes were re-taken after both assets were normalised
  // onto the house 24 grid. Owner ruling, testing the phone build: "Bold,
  // italics, underline and strikethrough don't look centred in their buttons."
  // They were not - each of the four letterforms carried its own off-square
  // viewBox with the ink sitting wherever the tracing left it, which the module
  // papered over with a per-icon width factor. Measured in the pane at 375x812
  // their ink came out 12.05, 9.89, 11.35 and 10.95px tall at one requested
  // glyph size, none of them on the button's centre line.
  // WHAT CHANGED IN EACH FILE: the root viewBox, so the ink is centred on the
  // grid and exactly 20 units tall; and, on the strikethrough only, the strike
  // BAR is narrowed to the same overhang the underline's rule already uses
  // (1.25x the letter's width, where it was 1.58x) so the mark fits the shared
  // square envelope instead of forcing the whole glyph to render 18% short.
  // The letterforms themselves are untouched. A sha256 pin is here to stop an
  // asset drifting silently, which this is not.
  // Geometry is now asserted directly, not just pinned:
  // tests/mobileHeaderGeometry.test.mjs.
  'text-underline.svg': 'd2b8f32e48729139c09c5325a3cf48d8e0d6a581cf748b567cc9472d0a587f26',
  'text-squiggle.svg': '5d758e7ceef171af4c6a20d10844dec95860144d93e6fa6a0225c95ba9fa6c40',
  'text-strikethrough.svg': 'c2d5c43ec3c9804c8f60a9ca892389b93682dd5045d9916ba7ea86d198f9593a',
  // DELIBERATE ASSERTION CHANGE (2026-09-16, desktop sweep): the hyperlink and
  // redact hashes were both re-taken after their stroke weights came onto the
  // house 1.5 — hyperlink from 2.375, redact from 1.75. Those two were the last
  // glyphs in this row off the house weight, and at 2.375 against 1.5 the row
  // carried a 58% weight spread. Owner ruling of this pass: ONE stroke weight
  // across the set, and a sha256 pin is not a reason to stay off it — the pin is
  // here to stop an asset drifting silently, which this is not. Nothing else in
  // either file changed; the geometry each test guards is untouched.
  'text-hyperlink.svg': '280e7f2bbee751b53c1f9cc8f36a33f996cfac5abe8ee7c82f6e68a7abe744a8',
  'text-redact.svg': '6401406a0fe104977cbf9f991628095e9ff65ac150575a91898e63498f7b0484',
};

test('shared accepted icons stay byte-exact to the accepted icon lineup', async () => {
  for (const [fileName, expectedHash] of Object.entries(ACCEPTED_ICON_HASHES)) {
    const bytes = await readFile(path.join(repoRoot, 'src/assets/icons', fileName));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, fileName);
  }
});

test('pan icon uses the approved closed-wrist asset at its full requested size', async () => {
  const iconsSource = await readFile(path.join(repoRoot, 'src/Icons.jsx'), 'utf8');
  assert.match(iconsSource, /import panHandUrl from '.\/assets\/icons\/pan-hand-closed\.svg'/);
  assert.doesNotMatch(iconsSource, /import panHandUrl from '.\/assets\/icons\/pan-hand\.svg'/);
  assert.match(
    iconsSource,
    /formatPan:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(panHandUrl, size, color, style, className\)/,
  );
  assert.doesNotMatch(iconsSource, /renderMaskIcon\(panHandUrl,[^\n]*size \* 0\.88/);
});

async function loadActionBar() {
  const componentPath = path.join(repoRoot, 'src/components/TextSelectionActionBar.jsx');
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source.replace(
    "import Icon from '../Icons';",
    "const Icon = ({ name, color, size, style }) => <span data-icon-name={name} data-icon-color={color} data-icon-size={size} style={style} />;",
  );
  source = source.replace("import './TextSelectionActionBar.css';", '');
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  let executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'text-action-bar-test-'));
  // Load the real shared tooltip dependency from the temporary JSX harness.
  const tooltipPath = path.join(repoRoot, 'src/components/Tooltip.jsx');
  let tooltipSource = await readFile(tooltipPath, 'utf8');
  for (const specifier of ['react', 'react-dom']) tooltipSource = tooltipSource.replace(`from '${specifier}'`, `from '${pathToFileURL(require.resolve(specifier)).href}'`);
  // Harness plumbing, not an assertion: every relative import the real
  // Tooltip.jsx makes has to be rewritten to an absolute URL, because the
  // transpiled copy is written to a temp directory where '../utils/…' means
  // nothing. Add new Tooltip.jsx dependencies here.
  for (const specifier of ['../viewerShared.js', '../utils/floatingUiGeometry.js', '../utils/toolShortcuts.js']) tooltipSource = tooltipSource.replace(`from '${specifier}'`, `from '${pathToFileURL(path.resolve(path.dirname(tooltipPath), specifier)).href}'`);
  const tooltipCode = (await transformWithOxc(tooltipSource, tooltipPath, { lang: 'jsx' })).code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  await writeFile(path.join(tempDir, 'Tooltip.mjs'), tooltipCode);
  executable = executable.replace('"./Tooltip"', '"./Tooltip.mjs"');
  const modulePath = path.join(tempDir, 'TextSelectionActionBar.mjs');
  await writeFile(modulePath, executable);
  return { ActionBar: (await import(pathToFileURL(modulePath).href)).default, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

test('mounted text markup strip stacks marks, focuses paint, and opens both link modes', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const { ActionBar, cleanup } = await loadActionBar();
  const actions = [];
  const focused = [];
  const openedLinks = [];
  const removedLinks = [];
  const root = createRoot(document.getElementById('root'));
  function Harness() {
    const [active, setActive] = useState(['highlight', 'strikeout']);
    const [focus, setFocus] = useState('highlight');
    const [linkOpen, setLinkOpen] = useState(false);
    const [mode, setMode] = useState('web');
    const [value, setValue] = useState('');
    return React.createElement(ActionBar, {
      selection: { pages: [{ pageNumber: 1 }] },
      activeMarkupTypes: active,
      focusedPaintMark: focus,
      paintByMark: {
        highlight: { color: '#f5c229', opacity: 40 }, underline: { color: '#ef3029', opacity: 100 },
        squiggly: { color: '#15803d', opacity: 100 }, strikeout: { color: '#3d63dc', opacity: 100 },
      },
      linkEditorOpen: linkOpen,
      linkMode: mode,
      linkValue: value,
      onAction: (action) => {
        actions.push(action);
        if (action === 'link') {
          setActive((current) => current.includes('link') ? current : [...current, 'link']);
          return setLinkOpen((open) => !open);
        }
        setActive((current) => current.includes(action) ? current.filter((type) => type !== action) : [...current, action]);
      },
      onFocusPaint: (mark) => { focused.push(mark); setFocus(mark); },
      onLinkModeChange: setMode,
      onLinkValueChange: setValue,
      onLinkSubmit: () => setLinkOpen(false),
      onLinkOpen: () => openedLinks.push('open'),
      onLinkRemove: () => removedLinks.push('remove'),
      onLinkCancel: () => setLinkOpen(false),
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Text markup toolbar"]');
    assert.ok(toolbar);
    assert.equal(toolbar.className, 'text-selection-action-bar__toolbar');
    assert.equal(toolbar.getAttribute('aria-orientation'), 'horizontal');
    assert.equal(toolbar.querySelector('.text-selection-action-bar__tools')?.children.length, 6);
    assert.equal(toolbar.querySelector('button[aria-label="Copy"]'), null);
    const highlightControl = document.querySelector('[data-text-mark-control="highlight"]');
    assert.equal(highlightControl.className, 'text-selection-action-bar__mark');
    assert.equal(highlightControl.getAttribute('data-focused'), 'true');
    assert.ok(document.querySelector('button[aria-label="Set Highlight color"]').classList.contains('text-selection-action-bar__button'));
    for (const [label, iconName] of [['Remove Highlight', 'formatHighlight'], ['Apply Underline', 'formatUnderline'], ['Apply Squiggle', 'formatSquiggle'], ['Remove Strike Through', 'formatStrikethrough'], ['Add Hyperlink', 'formatHyperlink'], ['Apply Redact', 'formatRedact']]) {
      assert.equal(document.querySelector(`button[aria-label="${label}"] [data-icon-name]`)?.getAttribute('data-icon-name'), iconName);
    }
    const highlightSwatch = document.querySelector('button[aria-label="Set Highlight color"] span');
    assert.equal(highlightSwatch.style.background, 'rgb(245, 194, 41)');
    assert.equal(highlightSwatch.style.opacity, '1');
    assert.deepEqual(actions, []);
    assert.equal(document.querySelector('button[aria-label="Remove Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e5ad18');
    assert.equal(document.querySelector('button[aria-label="Apply Underline"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e8e2d4');
    assert.equal(document.querySelector('button[aria-label="Apply Underline"] [data-icon-name]')?.style.opacity, '1');
    await act(async () => document.querySelector('button[aria-label="Remove Highlight"]').click());
    assert.equal(document.querySelector('button[aria-label="Apply Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e8e2d4');
    await act(async () => document.querySelector('button[aria-label="Apply Highlight"]').click());
    assert.equal(document.querySelector('button[aria-label="Remove Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e5ad18');
    // 2026-09-07 polish pass (A5): Redact used to render at 21 in a row of 18s,
    // which made it the widest glyph there and, with its old solid slab, read
    // about half again as heavy as its neighbours. The row now has ONE size.
    for (const icon of document.querySelectorAll('[data-icon-name]')) {
      assert.equal(icon.getAttribute('data-icon-size'), '18');
    }
    assert.equal(document.querySelector('button[aria-label*="redaction"][aria-label*="permanently"]'), null);
    const underline = document.querySelector('button[aria-label="Apply Underline"]');
    await act(async () => underline.click());
    assert.deepEqual(actions, ['highlight', 'highlight', 'underline']);
    assert.equal(document.querySelector('button[aria-label="Remove Underline"]').getAttribute('aria-pressed'), 'true');
    const squiggleTouch = new dom.window.Event('touchend', { bubbles: true, cancelable: true });
    await act(async () => document.querySelector('button[aria-label="Apply Squiggle"]').dispatchEvent(squiggleTouch));
    assert.equal(squiggleTouch.defaultPrevented, true);
    assert.deepEqual(actions, ['highlight', 'highlight', 'underline', 'squiggly']);
    assert.equal(document.querySelector('button[aria-label="Remove Squiggle"]').getAttribute('aria-pressed'), 'true');
    const squigglePaintTouch = new dom.window.Event('touchend', { bubbles: true, cancelable: true });
    await act(async () => document.querySelector('button[aria-label="Set Squiggle color"]').dispatchEvent(squigglePaintTouch));
    assert.equal(squigglePaintTouch.defaultPrevented, true);
    assert.deepEqual(focused, ['squiggly']);
    await act(async () => document.querySelector('button[aria-label="Set Underline color"]').click());
    assert.deepEqual(focused, ['squiggly', 'underline']);
    assert.equal(document.querySelector('[data-text-mark-control="underline"]').getAttribute('data-focused'), 'true');
    const firstToolbarButton = document.querySelector('button[aria-label="Remove Highlight"]');
    firstToolbarButton.focus();
    await act(async () => toolbar.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Set Highlight color');
    await act(async () => document.querySelector('button[aria-label="Add Hyperlink"]').click());
    const linkForm = document.querySelector('form[aria-label="Hyperlink controls"]');
    assert.ok(linkForm);
    assert.equal(linkForm.className, 'text-selection-action-bar__link-form');
    assert.equal(document.querySelector('input[aria-label="Web address"]').className, 'text-selection-action-bar__link-input');
    assert.ok(document.querySelector('[data-text-link-actions="true"]'));
    assert.ok(document.querySelector('button[aria-label="Open link"]'));
    assert.ok(document.querySelector('button[aria-label="Remove link"]'));
    await act(async () => document.querySelector('button[aria-label="Open link"]').click());
    await act(async () => document.querySelector('button[aria-label="Remove link"]').click());
    assert.deepEqual(openedLinks, ['open']);
    assert.deepEqual(removedLinks, ['remove']);
    await act(async () => document.querySelector('form[aria-label="Hyperlink controls"] button[aria-pressed="false"]').click());
    assert.equal(document.querySelector('input[aria-label="Page number"]')?.getAttribute('inputmode'), 'numeric');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});

test('the text markup strip is hidden after text selection is dismissed and has no separate Apply Redactions button', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const { ActionBar, cleanup } = await loadActionBar();
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(ActionBar, {
      selection: null,
      pendingRedactionCount: 1,
      onApplyRedactions: () => {},
    })));
    assert.equal(document.querySelector('[data-text-selection-action-bar="true"]'), null);
    assert.equal(document.querySelector('button[aria-label*="redaction"][aria-label*="permanently"]'), null);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});

test('mounted link editor shows its existing address and cancel does not submit it', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const { ActionBar, cleanup } = await loadActionBar();
  const calls = [];
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(ActionBar, {
      selection: { pages: [{ pageNumber: 1 }] },
      activeMarkupTypes: ['link'],
      linkEditorOpen: true,
      linkMode: 'web',
      linkValue: 'https://example.com/docs',
      onLinkSubmit: () => calls.push('submit'),
      onLinkCancel: () => calls.push('cancel'),
      onAction: () => {},
      onFocusPaint: () => {},
    })));
    assert.equal(document.querySelector('input[aria-label="Web address"]').value, 'https://example.com/docs');
    await act(async () => document.querySelector('button[aria-label="Cancel hyperlink"]').click());
    assert.deepEqual(calls, ['cancel']);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});
