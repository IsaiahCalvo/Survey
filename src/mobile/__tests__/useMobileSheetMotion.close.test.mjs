import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';

import {
  SHEET_CLOSE_MS,
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

function Harness({ onClose, apiRef, isOpen = true }) {
  const api = useMobileSheetMotion(onClose, { isOpen });
  apiRef.current = api;
  return React.createElement('div', {
    'data-closing': api.closing ? 'true' : 'false',
    style: api.motionStyle,
  });
}

function CallSiteHarness({ apiRef }) {
  const ignoreNextHideRef = useRef(false);
  const [open, setOpen] = React.useState(true);
  const hide = React.useCallback(() => {
    if (ignoreNextHideRef.current) {
      ignoreNextHideRef.current = false;
      return;
    }
    setOpen(false);
  }, []);
  const motion = useMobileSheetMotion(hide);
  const requestClose = () => {
    if (!open) return;
    ignoreNextHideRef.current = false;
    motion.requestClose();
  };
  const reopen = () => {
    if (motion.closing) ignoreNextHideRef.current = true;
    motion.resetMotion?.();
    setOpen(true);
  };
  apiRef.current = { ...motion, open, requestClose, reopen };
  return React.createElement('div', { 'data-open': open ? 'true' : 'false' });
}

async function mount(t, HarnessComponent, onClose = () => {}, extraProps = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = installDom();
  const host = document.getElementById('root');
  const root = createRoot(host);
  const apiRef = { current: null };
  const renderWith = async (props = {}) => {
    await act(async () => {
      root.render(React.createElement(HarnessComponent, { onClose, apiRef, ...extraProps, ...props }));
    });
  };
  await renderWith();
  return {
    apiRef,
    host,
    advance: async (ms) => {
      await act(async () => t.mock.timers.tick(ms));
    },
    rerender: renderWith,
    unmount: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test('requestClose keeps the sheet closing then fires onClose after SHEET_CLOSE_MS', async (t) => {
  const closes = [];
  const { apiRef, host, advance, unmount } = await mount(t, Harness, () => closes.push('closed'));

  assert.equal(apiRef.current.closing, false);
  await act(async () => apiRef.current.requestClose());
  assert.equal(apiRef.current.closing, true);
  assert.equal(host.firstChild.getAttribute('data-closing'), 'true');
  assert.match(host.firstChild.getAttribute('style') || host.firstChild.style.transform, /translateY\(100%\)/);
  assert.deepEqual(closes, []);

  await advance(SHEET_CLOSE_MS - 1);
  assert.deepEqual(closes, []);
  assert.equal(apiRef.current.closing, true);

  await advance(1);
  assert.deepEqual(closes, ['closed']);
  assert.equal(apiRef.current.closing, false);
  await unmount();
});

test('already-closing requestClose is a no-op (does not double-fire onClose)', async (t) => {
  const closes = [];
  const { apiRef, advance, unmount } = await mount(t, Harness, () => closes.push('closed'));

  await act(async () => apiRef.current.requestClose());
  await act(async () => apiRef.current.requestClose());
  await act(async () => apiRef.current.requestClose());
  await advance(SHEET_CLOSE_MS);
  assert.deepEqual(closes, ['closed']);
  await unmount();
});

test('already-closed call-site requestClose is a no-op', async (t) => {
  const { apiRef, advance, unmount } = await mount(t, CallSiteHarness);
  await act(async () => apiRef.current.requestClose());
  await advance(SHEET_CLOSE_MS);
  assert.equal(apiRef.current.open, false);
  await act(async () => apiRef.current.requestClose());
  await advance(SHEET_CLOSE_MS);
  assert.equal(apiRef.current.open, false);
  await unmount();
});

test('rapid reopen during close ignores the stale hide timer', async (t) => {
  const { apiRef, advance, unmount } = await mount(t, CallSiteHarness);
  await act(async () => apiRef.current.requestClose());
  assert.equal(apiRef.current.closing, true);
  await act(async () => apiRef.current.reopen());
  assert.equal(apiRef.current.open, true);
  await advance(SHEET_CLOSE_MS);
  assert.equal(apiRef.current.open, true, 'stale onClose must not collapse a reopened sheet');
  await unmount();
});

test('resetMotion cancels a pending close so onClose does not fire', async (t) => {
  const closes = [];
  const { apiRef, advance, unmount } = await mount(t, Harness, () => closes.push('closed'));

  assert.equal(typeof apiRef.current.resetMotion, 'function');
  await act(async () => apiRef.current.requestClose());
  assert.equal(apiRef.current.closing, true);
  await act(async () => apiRef.current.resetMotion());
  assert.equal(apiRef.current.closing, false);
  await advance(SHEET_CLOSE_MS);
  assert.deepEqual(closes, []);
  await unmount();
});

test('unmount mid-close cancels the timer and does not fire onClose', async (t) => {
  const closes = [];
  const { apiRef, unmount } = await mount(t, Harness, () => closes.push('closed'));
  await act(async () => apiRef.current.requestClose());
  await unmount();
  await act(async () => t.mock.timers.tick(SHEET_CLOSE_MS));
  assert.deepEqual(closes, [], 'generation-guarded unmount must cancel the pending hide');
});

test('isOpen rising to true cancels a pending close', async (t) => {
  const closes = [];
  const { apiRef, advance, rerender, unmount } = await mount(t, Harness, () => closes.push('closed'), { isOpen: true });

  await act(async () => apiRef.current.requestClose());
  assert.equal(apiRef.current.closing, true);

  await rerender({ isOpen: false });
  assert.equal(apiRef.current.closing, true);

  await rerender({ isOpen: true });
  assert.equal(apiRef.current.closing, false);
  await advance(SHEET_CLOSE_MS);
  assert.deepEqual(closes, []);
  await unmount();
});
