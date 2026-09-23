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

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function loadPicker() {
  const componentPath = path.join(repoRoot, 'src/components/CompactColorPicker.jsx');
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source
    .replace("import { useState, useEffect, useMemo, useRef } from 'react';", `import { useState, useEffect, useMemo, useRef } from ${JSON.stringify(reactUrl)};`)
    .replace("import DismissBarrier from './DismissBarrier';", 'const DismissBarrier = () => null;')
    // Harness plumbing, not an assertion: the shared chosen-mark helpers are a
    // plain ESM module, so point the import at it on disk.
    .replace(
      "from '../utils/quickStylePresets'",
      `from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'src/utils/quickStylePresets.js')).href)}`,
    );
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'compact-picker-test-'));
  const modulePath = path.join(tempDir, 'CompactColorPicker.mjs');
  await writeFile(modulePath, executable);
  return { Picker: (await import(pathToFileURL(modulePath).href)).default, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

const pointerEvent = (window, type, { pointerId = 1, clientX, clientY }) => {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
};

test('mounted CompactColorPicker follows pointer-captured spectrum and hue drags', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;

  const { Picker, cleanup } = await loadPicker();
  const changes = [];
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Picker, {
      color: '#ff0000',
      onChange: (...args) => changes.push(args),
    })));
    await act(async () => document.querySelector('[aria-label="Color spectrum"]').click());

    const spectrum = document.querySelector('[data-color-picker-spectrum="true"]');
    const hue = document.querySelector('[data-color-picker-hue="true"]');
    spectrum.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120 });
    hue.getBoundingClientRect = () => ({ left: 30, top: 200, width: 180, height: 12, right: 210, bottom: 212 });

    await act(async () => {
      spectrum.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: 30, clientY: 110 }));
      spectrum.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: 170, clientY: 40 }));
      spectrum.dispatchEvent(pointerEvent(dom.window, 'pointerup', { clientX: 170, clientY: 40 }));
    });
    // CHANGED 2026-09-21. Was an exact `style.left === '80%'` on the handle.
    // RULING (pass-7 picker boards, "nothing may spill, collide or clip"): the
    // handle's travel is now inset by half its own width so it cannot hang
    // outside the panel at full saturation, which makes its `left` a calc()
    // rather than a bare percentage. What the test is really about — the drag
    // followed the pointer — is read off the slider's own value instead, which
    // is stronger than a style string.
    assert.equal(spectrum.getAttribute('aria-valuenow'), '80');
    assert.match(spectrum.getAttribute('aria-valuetext'), /Saturation 80%, brightness 80%/);
    assert.match(spectrum.firstElementChild.style.left, /^calc\(8px \+ 0\.8 \* \(100% - 16px\)\)$/);

    await act(async () => {
      hue.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: 48, clientY: 206, pointerId: 2 }));
      // RULED 2026-09-23: the value is read on the thumb's inner run (10px in
      // from each end), so 75% of a 180px track is 30 + 10 + 0.75 * 160 = 160.
      hue.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: 160, clientY: 206, pointerId: 2 }));
      hue.dispatchEvent(pointerEvent(dom.window, 'pointerup', { clientX: 160, clientY: 206, pointerId: 2 }));
    });
    // CHANGED with the same ruling: the thumb's travel is inset by half the
    // thumb, so 75% of the track reads as 75 degrees of hue on the slider.
    assert.equal(hue.getAttribute('aria-valuenow'), '270');
    // RULED 2026-09-23 (owner: micka_design sliders): the thumb is 16px and
    // travels inset 10px from each round end, so the calc is 10px / 20px. The
    // point of the assertion — a drag to 75% lands the thumb at 75% — is kept.
    assert.match(hue.firstElementChild.style.left, /^calc\(10px \+ 0\.75 \* \(100% - 20px\)\)$/);
    assert.ok(changes.length >= 4);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('mounted CompactColorPicker exposes and operates spectrum and hue sliders from the keyboard', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { Picker, cleanup } = await loadPicker();
  const changes = [];
  const root = createRoot(document.getElementById('root'));
  const press = async (node, key) => act(async () => {
    node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  try {
    await act(async () => root.render(React.createElement(Picker, {
      color: '#ff0000',
      onChange: (...args) => changes.push(args),
    })));
    await act(async () => document.querySelector('[aria-label="Color spectrum"]').click());

    const spectrum = document.querySelector('[data-color-picker-spectrum="true"]');
    const hue = document.querySelector('[data-color-picker-hue="true"]');
    assert.equal(spectrum.getAttribute('role'), 'slider');
    assert.equal(spectrum.tabIndex, 0);
    assert.equal(spectrum.getAttribute('aria-valuemin'), '0');
    assert.equal(spectrum.getAttribute('aria-valuemax'), '100');
    assert.match(spectrum.getAttribute('aria-valuetext'), /Saturation 100%, brightness 100%/);

    spectrum.focus();
    assert.equal(document.activeElement, spectrum);
    await press(spectrum, 'ArrowLeft');
    assert.equal(spectrum.getAttribute('aria-valuenow'), '99');
    await press(spectrum, 'ArrowRight');
    assert.equal(spectrum.getAttribute('aria-valuenow'), '100');
    await press(spectrum, 'ArrowDown');
    assert.match(spectrum.getAttribute('aria-valuetext'), /Saturation 100%, brightness 99%/);
    await press(spectrum, 'ArrowUp');
    assert.match(spectrum.getAttribute('aria-valuetext'), /Saturation 100%, brightness 100%/);
    await press(spectrum, 'ArrowLeft');
    await press(spectrum, 'PageDown');
    assert.match(spectrum.getAttribute('aria-valuetext'), /Saturation 99%, brightness 90%/);
    await press(spectrum, 'Home');
    assert.equal(spectrum.getAttribute('aria-valuenow'), '0');
    await press(spectrum, 'End');
    assert.equal(spectrum.getAttribute('aria-valuenow'), '100');

    assert.equal(hue.getAttribute('role'), 'slider');
    assert.equal(hue.getAttribute('aria-valuemin'), '0');
    assert.equal(hue.getAttribute('aria-valuemax'), '360');
    hue.focus();
    assert.equal(document.activeElement, hue);
    await press(hue, 'ArrowRight');
    assert.equal(hue.getAttribute('aria-valuenow'), '1');
    await press(hue, 'ArrowLeft');
    assert.equal(hue.getAttribute('aria-valuenow'), '0');
    await press(hue, 'PageUp');
    assert.equal(hue.getAttribute('aria-valuenow'), '10');
    assert.equal(hue.getAttribute('aria-valuetext'), '10 degrees');
    await press(hue, 'End');
    assert.equal(hue.getAttribute('aria-valuenow'), '360');
    await press(hue, 'Home');
    assert.equal(hue.getAttribute('aria-valuenow'), '0');
    assert.ok(changes.length >= 7, 'each keyboard adjustment should publish the selected color');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
