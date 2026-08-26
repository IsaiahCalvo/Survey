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

const LOCKED_ICON_HASHES = {
  'text-highlight.svg': 'bec73bf6a22f160f84be3ffb0b9ca690204d6c6ba3e40044b18e3b88a35774fb',
  'text-underline.svg': '50bd6023c5e7b643125591178074aa18be9b4d2745b292397b7b93c6c04d5e3e',
  'text-squiggle.svg': 'a34b3a2e94e1da54b235cae8558e2154b46a095258c886009a60f69dcc94e73f',
  'text-strikethrough.svg': 'e2cb9f2a468708a423d5a803bf55e800acb4daf73186875363e300fe626adf3a',
  'text-hyperlink.svg': '718065400f7b6d76eb2bb7b714a8b4e680fbfea852a8e79a6f3fbe9c9d946ed5',
  'text-redact.svg': '6ac08792f31d89e479d91c603dbded96e383215de9a9bb1b7aa736dce1f6f4ac',
};

test('shared text markup icons stay byte-exact to the locked handoff assets', async () => {
  for (const [fileName, expectedHash] of Object.entries(LOCKED_ICON_HASHES)) {
    const bytes = await readFile(path.join(repoRoot, 'src/assets/icons', fileName));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, fileName);
  }
});

async function loadActionBar() {
  const componentPath = path.join(repoRoot, 'src/components/TextSelectionActionBar.jsx');
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source.replace(
    "import Icon from '../Icons';",
    "const Icon = ({ name, color, style }) => <span data-icon-name={name} data-icon-color={color} style={style} />;",
  );
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'text-action-bar-test-'));
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
        highlight: { color: '#f5c229', opacity: 30 }, underline: { color: '#ef3029', opacity: 100 },
        squiggly: { color: '#f0f1f4', opacity: 100 }, strikeout: { color: '#3d63dc', opacity: 100 },
      },
      linkEditorOpen: linkOpen,
      linkMode: mode,
      linkValue: value,
      onAction: (action) => {
        actions.push(action);
        if (action === 'link') return setLinkOpen((open) => !open);
        setActive((current) => current.includes(action) ? current.filter((type) => type !== action) : [...current, action]);
      },
      onFocusPaint: (mark) => { focused.push(mark); setFocus(mark); },
      onLinkModeChange: setMode,
      onLinkValueChange: setValue,
      onLinkSubmit: () => setLinkOpen(false),
      onLinkCancel: () => setLinkOpen(false),
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Text markup toolbar"]');
    assert.ok(toolbar);
    assert.equal(toolbar.style.gap, 'clamp(2px, 0.7vw, 16px)');
    assert.equal(toolbar.style.overflowX, 'auto');
    assert.equal(toolbar.style.justifyContent, 'safe center');
    assert.equal(document.querySelector('[data-text-mark-control="highlight"]').style.padding, '0px');
    assert.equal(document.querySelector('button[aria-label="Set Highlight color"]').style.width, '32px');
    for (const [label, iconName] of [['Remove Highlight', 'formatHighlight'], ['Apply Underline', 'formatUnderline'], ['Apply Squiggle', 'formatSquiggle'], ['Remove Strike Through', 'formatStrikethrough'], ['Add Hyperlink', 'formatHyperlink'], ['Apply Redact', 'formatRedact']]) {
      assert.equal(document.querySelector(`button[aria-label="${label}"] [data-icon-name]`)?.getAttribute('data-icon-name'), iconName);
    }
    assert.equal(document.querySelector('button[aria-label="Remove Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e5ad18');
    assert.equal(document.querySelector('button[aria-label="Apply Underline"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e8e2d4');
    const underline = document.querySelector('button[aria-label="Apply Underline"]');
    await act(async () => underline.click());
    assert.deepEqual(actions, ['underline']);
    assert.equal(document.querySelector('button[aria-label="Remove Underline"]').getAttribute('aria-pressed'), 'true');
    await act(async () => document.querySelector('button[aria-label="Set Underline color"]').click());
    assert.deepEqual(focused, ['underline']);
    assert.equal(document.querySelector('[data-text-mark-control="underline"]').style.borderColor, 'rgb(229, 173, 24)');
    await act(async () => document.querySelector('button[aria-label="Add Hyperlink"]').click());
    const linkForm = document.querySelector('form[aria-label="Hyperlink controls"]');
    assert.ok(linkForm);
    assert.equal(linkForm.style.flexWrap, 'wrap');
    assert.equal(document.querySelector('input[aria-label="Web address"]').style.flex, '1 1 220px');
    assert.ok(document.querySelector('[data-text-link-actions="true"]'));
    await act(async () => document.querySelector('form[aria-label="Hyperlink controls"] button[aria-pressed="false"]').click());
    assert.equal(document.querySelector('input[aria-label="Page number"]')?.getAttribute('inputmode'), 'numeric');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});
