import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  SHEET_CLOSE_MS,
  SHEET_SPRING_MS,
  useMobileSheetMotion,
} from '../useMobileSheetMotion.js';

function installDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

function touchAt(clientY, timeStamp = 0) {
  return { touches: [{ clientY }], timeStamp };
}

function Harness({ onClose, apiRef, isOpen = true }) {
  const api = useMobileSheetMotion(onClose, { isOpen });
  apiRef.current = api;
  return React.createElement('div', {
    'data-closing': api.closing ? 'true' : 'false',
    style: api.motionStyle,
  });
}

async function mount(t, onClose = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = installDom();
  const host = document.getElementById('root');
  const root = createRoot(host);
  const apiRef = { current: null };
  await act(async () => {
    root.render(React.createElement(Harness, { onClose, apiRef }));
  });
  return {
    apiRef,
    host,
    advance: async (ms) => {
      await act(async () => t.mock.timers.tick(ms));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

function sheetTransform(host) {
  return host.firstChild.style.transform || '';
}

test('touchcancel mid-drag below threshold springs home (translateY resets)', async (t) => {
  const closes = [];
  const { apiRef, host, advance, unmount } = await mount(t, () => closes.push('closed'));
  const { dragHandlers } = apiRef.current;

  assert.equal(typeof dragHandlers.onTouchCancel, 'function');
  assert.equal(typeof dragHandlers.onTouchEnd, 'function');

  await act(async () => dragHandlers.onTouchStart(touchAt(100, 0)));
  await act(async () => dragHandlers.onTouchMove(touchAt(130, 16)));
  assert.equal(sheetTransform(host), 'translateY(30px)');
  assert.equal(host.firstChild.style.transition, 'none');

  await act(async () => dragHandlers.onTouchCancel());
  assert.equal(sheetTransform(host), 'translateY(0)', 'settleDrag must clear stranded translateY');
  assert.match(host.firstChild.style.transition, new RegExp(`${SHEET_SPRING_MS}ms`));
  assert.equal(apiRef.current.closing, false);
  assert.deepEqual(closes, []);

  await advance(SHEET_SPRING_MS);
  assert.equal(sheetTransform(host), '');
  assert.deepEqual(closes, []);
  await unmount();
});

test('touchcancel mid-drag above dismiss threshold calls requestClose', async (t) => {
  const closes = [];
  const { apiRef, host, advance, unmount } = await mount(t, () => closes.push('closed'));
  const { dragHandlers } = apiRef.current;

  await act(async () => dragHandlers.onTouchStart(touchAt(100, 0)));
  await act(async () => dragHandlers.onTouchMove(touchAt(190, 16)));
  assert.equal(sheetTransform(host), 'translateY(90px)');

  await act(async () => dragHandlers.onTouchCancel());
  assert.equal(apiRef.current.closing, true);
  assert.match(sheetTransform(host), /translateY\(100%\)/);
  assert.deepEqual(closes, []);

  await advance(SHEET_CLOSE_MS);
  assert.deepEqual(closes, ['closed']);
  await unmount();
});

test('sheet hosts bind onTouchCancel to the same settle path as onTouchEnd', async () => {
  const pdfSidebar = await readFile(new URL('../../PDFSidebar.jsx', import.meta.url), 'utf8');
  const mobileChrome = await readFile(new URL('../MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  const surveyRail = await readFile(new URL('../../SurveySpacesRail.jsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../useMobileSheetMotion.js', import.meta.url), 'utf8');

  assert.match(
    hook,
    /const onTouchCancel = useCallback\(\(\) => \{\s*settleDrag\(\);/,
    'hook onTouchCancel must settle like onTouchEnd',
  );
  assert.match(hook, /dragHandlers: \{ onTouchStart, onTouchMove, onTouchEnd, onTouchCancel \}/);
  assert.match(hook, /requestClose/);
  assert.match(hook, /resetMotion/);
  assert.match(hook, /if \(token !== generation\) return/);

  assert.match(
    pdfSidebar,
    /onTouchEnd=\{mobileMode \? sheetDragHandlers\.onTouchEnd : undefined\}\s+onTouchCancel=\{mobileMode \? sheetDragHandlers\.onTouchCancel : undefined\}/,
  );
  assert.match(
    mobileChrome,
    /onTouchEnd=\{textSheetDragHandlers\.onTouchEnd\}\s+onTouchCancel=\{textSheetDragHandlers\.onTouchCancel\}/,
  );
  assert.match(
    mobileChrome,
    /onTouchEnd=\{usersSheetDragHandlers\.onTouchEnd\}\s+onTouchCancel=\{usersSheetDragHandlers\.onTouchCancel\}/,
  );
  assert.match(
    surveyRail,
    /onTouchEnd=\{mobileMode \? surveySheetDragHandlers\.onTouchEnd : undefined\}\s+onTouchCancel=\{mobileMode \? surveySheetDragHandlers\.onTouchCancel : undefined\}/,
  );
});
