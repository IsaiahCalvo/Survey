import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.navigator) globalThis.navigator = dom.window.navigator;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: useResponsiveToolbar } = await import('../src/hooks/useResponsiveToolbar.js');

// Count forced-layout reads on the toolbar host.
let hostReads = 0;
const realRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
dom.window.HTMLElement.prototype.getBoundingClientRect = function rect() {
  if (this.hasAttribute?.('data-test-host')) hostReads += 1;
  return realRect.call(this);
};

function Toolbar({ tick, label }) {
  const hostRef = React.useRef(null);
  const formatRowRef = React.useRef(null);
  const overflowSlotsRef = React.useRef(null);
  useResponsiveToolbar({ hostRef, formatRowRef, enabled: true, overflowSlotsRef });
  return React.createElement('div', { ref: hostRef, 'data-test-host': 'true', 'data-tick': undefined },
    React.createElement('div', { 'data-tool-toolbar': 'true' }, label),
    React.createElement('div', { ref: formatRowRef }),
    React.createElement('span', null, String(tick % 1 === 0 ? '' : tick)));
}

test('a shell re-render that leaves the toolbar DOM alone does not re-measure; a DOM change does', async () => {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Toolbar, { tick: 0, label: 'A' })); });
  const afterMount = hostReads;
  assert.ok(afterMount >= 1, 'measures on mount');

  // Re-renders with identical output (as during a pan: page number changes elsewhere).
  for (let i = 1; i <= 5; i += 1) {
    await act(async () => { root.render(React.createElement(Toolbar, { tick: i, label: 'A' })); });
  }
  assert.equal(hostReads, afterMount, 'no layout reads without a toolbar DOM change');

  await act(async () => { root.render(React.createElement(Toolbar, { tick: 6, label: 'B' })); });
  assert.ok(hostReads > afterMount, 're-measures after the toolbar DOM changed');
  await act(async () => { root.unmount(); });
});
