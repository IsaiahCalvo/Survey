/*
 * UX 2026-09-23 (owner: "Dragging this is laggy ... make sure this animation
 * across all color pickers, even any slider in general, is super smooth").
 *
 * CompactColorPicker's sliders move their thumb from the picker's own state on
 * every pointer event, but publish to the host at most once per animation
 * frame, tagged { phase: 'preview' }, and always deliver the value under the
 * pointer at release as { phase: 'commit' }. Clicks and keys publish at once
 * with no phase, exactly as before. These tests pin that contract.
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
    .replace(
      "from '../utils/quickStylePresets'",
      `from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'src/utils/quickStylePresets.js')).href)}`,
    );
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'compact-picker-drag-test-'));
  const modulePath = path.join(tempDir, 'CompactColorPicker.mjs');
  await writeFile(modulePath, executable);
  return { Picker: (await import(pathToFileURL(modulePath).href)).default, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

const pointerEvent = (window, type, { pointerId = 1, clientX, clientY = 206 }) => {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withPicker(props, run) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  // A hand-cranked frame clock, so "once per frame" is observable.
  const frames = [];
  const savedRaf = globalThis.requestAnimationFrame;
  const savedCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  globalThis.cancelAnimationFrame = (id) => { frames[id - 1] = null; };
  // A hand-cranked clock too (2026-09-23): the picker backs off when a frame
  // arrives long after its last publish, and in a busy full-suite run the
  // real clock made that gap look like a slow host, so the "one publish per
  // frame" check failed only under load. Time now advances exactly one 16ms
  // frame per flushFrame, which is what the drag sees in a real browser.
  const realNow = performance.now.bind(performance);
  let fakeNow = realNow();
  performance.now = () => fakeNow;
  const flushFrame = async () => {
    await sleep(2);
    fakeNow += 16;
    const due = frames.splice(0);
    await act(async () => { due.forEach((cb) => cb && cb(performance.now())); });
  };

  const { Picker, cleanup } = await loadPicker();
  const changes = [];
  const root = createRoot(document.getElementById('root'));
  const render = (extra = {}) => act(async () => root.render(React.createElement(Picker, {
    color: '#ff0000',
    opacity: 1,
    onChange: (...args) => changes.push(args),
    ...props,
    ...extra,
  })));
  try {
    await render();
    await run({ dom, changes, flushFrame, render, root });
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    globalThis.requestAnimationFrame = savedRaf;
    globalThis.cancelAnimationFrame = savedCaf;
    performance.now = realNow;
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}

// The desktop opacity track: 180px wide at x=30, thumb inset 6px, so the value
// at clientX is (clientX - 36) / 168 * 100.
const at = (percent) => 36 + (percent / 100) * 168;

test('an opacity drag moves the thumb every event but publishes once per frame, then commits the released value', async () => {
  await withPicker({}, async ({ dom, changes, flushFrame }) => {
    const alpha = document.querySelector('[data-color-picker-opacity="true"]');
    alpha.getBoundingClientRect = () => ({ left: 30, top: 200, width: 180, height: 16, right: 210, bottom: 216 });

    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: at(50) })); });
    // The press answers at once.
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].slice(1), [0.5, { phase: 'preview' }]);
    assert.equal(alpha.getAttribute('aria-valuenow'), '50');

    // Three moves inside one frame: the thumb follows each, the host hears none yet.
    for (const pct of [40, 30, 20]) {
      await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: at(pct) })); });
      assert.equal(alpha.getAttribute('aria-valuenow'), String(pct));
    }
    assert.equal(changes.length, 1, 'moves inside one frame are not published one by one');

    await flushFrame();
    assert.equal(changes.length, 2, 'one publish for the frame');
    assert.deepEqual(changes[1].slice(1), [0.2, { phase: 'preview' }], 'the frame publishes the newest value');

    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: at(70) })); });
    // Released before the next frame: the release still delivers 70, as the commit.
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointerup', { clientX: at(70) })); });
    const last = changes[changes.length - 1];
    assert.deepEqual(last.slice(1), [0.7, { phase: 'commit' }]);
    assert.equal(alpha.getAttribute('aria-valuenow'), '70');
    await flushFrame();
    assert.equal(changes[changes.length - 1], last, 'nothing is published after the commit');
  });
});

test('clicks and keys still publish at once with no drag phase', async () => {
  await withPicker({}, async ({ dom, changes }) => {
    const alpha = document.querySelector('[data-color-picker-opacity="true"]');
    alpha.focus();
    await act(async () => {
      alpha.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    assert.equal(changes.length, 1);
    assert.equal(changes[0][1], 0.99);
    assert.equal(changes[0][2], undefined);
    await act(async () => document.querySelector('button[aria-label="#0000FF"]').click());
    assert.equal(changes.length, 2);
    assert.equal(changes[1][0], '#0000FF');
    assert.equal(changes[1][2], undefined);
  });
});

test('a mid-drag echo of an older value from the host never pulls the thumb back', async () => {
  await withPicker({}, async ({ dom, changes, flushFrame, render }) => {
    const alpha = document.querySelector('[data-color-picker-opacity="true"]');
    alpha.getBoundingClientRect = () => ({ left: 30, top: 200, width: 180, height: 16, right: 210, bottom: 216 });
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: at(50) })); });
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: at(80) })); });
    // The host re-renders with the value it heard first (50%).
    await render({ opacity: 0.5 });
    assert.equal(alpha.getAttribute('aria-valuenow'), '80');
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointerup', { clientX: at(80) })); });
    assert.deepEqual(changes[changes.length - 1].slice(1), [0.8, { phase: 'commit' }]);
    await flushFrame();
  });
});

test('a hue drag commits the released colour, and unmounting mid-drag still commits', async () => {
  await withPicker({}, async ({ dom, changes, root }) => {
    await act(async () => document.querySelector('[aria-label="Color spectrum"]').click());
    const hue = document.querySelector('[data-color-picker-hue="true"]');
    hue.getBoundingClientRect = () => ({ left: 30, top: 200, width: 180, height: 16, right: 210, bottom: 216 });
    await act(async () => { hue.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: at(10), pointerId: 3 })); });
    await act(async () => { hue.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: at(75), pointerId: 3 })); });
    assert.equal(hue.getAttribute('aria-valuenow'), '270');
    const before = changes.length;
    await act(async () => root.render(React.createElement('div')));
    assert.equal(changes.length, before + 1);
    const [hex, alphaValue, meta] = changes[changes.length - 1];
    assert.equal(hex.toLowerCase(), '#8000ff');
    assert.equal(alphaValue, 1);
    assert.deepEqual(meta, { phase: 'commit' });
  });
});

test('another finger lifting does not end the drag; the drag\'s own release does, and so does leaving the window', async () => {
  await withPicker({}, async ({ dom, changes, flushFrame }) => {
    const alpha = document.querySelector('[data-color-picker-opacity="true"]');
    alpha.getBoundingClientRect = () => ({ left: 30, top: 200, width: 180, height: 16, right: 210, bottom: 216 });
    const windowPointer = (type, pointerId) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      return event;
    };
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: at(50), pointerId: 7 })); });
    // A second finger lifts somewhere else on the screen.
    await act(async () => { dom.window.dispatchEvent(windowPointer('pointerup', 9)); });
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: at(30), pointerId: 7 })); });
    assert.equal(changes.filter((c) => c[2]?.phase === 'commit').length, 0, 'the drag is still going');
    assert.equal(changes.filter((c) => c[2] === undefined).length, 0, 'no un-phased per-move writes');
    await flushFrame();
    assert.deepEqual(changes[changes.length - 1].slice(1), [0.3, { phase: 'preview' }]);
    // The drag's own pointer lifts outside the track.
    await act(async () => { dom.window.dispatchEvent(windowPointer('pointerup', 7)); });
    assert.deepEqual(changes[changes.length - 1].slice(1), [0.3, { phase: 'commit' }]);

    // A new drag, and the window loses focus before any release arrives.
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointerdown', { clientX: at(60), pointerId: 8 })); });
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('blur')); });
    assert.deepEqual(changes[changes.length - 1].slice(1), [0.6, { phase: 'commit' }]);
    const count = changes.length;
    // A stray move with the old pointer is not taken for a drag.
    await act(async () => { alpha.dispatchEvent(pointerEvent(dom.window, 'pointermove', { clientX: at(10), pointerId: 8 })); });
    assert.equal(changes.length, count);
    await flushFrame();
  });
});

test('text colour pickers can drop the Transparent cell (firstPreset "none")', async () => {
  await withPicker({ firstPreset: 'none', minOpacity: 0.05 }, async () => {
    assert.equal(document.querySelector('button[title="Transparent"]'), null);
    const alpha = document.querySelector('[data-color-picker-opacity="true"]');
    assert.notEqual(alpha.getAttribute('aria-disabled'), 'true');
  });
});
