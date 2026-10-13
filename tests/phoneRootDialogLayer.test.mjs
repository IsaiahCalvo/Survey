// The phone's page frame rule gives every direct <div> child of #root the full
// screen height. AppShell renders the tab strip's dialog layer as a <div>
// sibling BEFORE the App frame, so that rule made the empty dialog layer 844px
// tall on a 390x844 phone and pushed the open document (header, page, tools)
// one full screen below the visible area: the phone showed a blank page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = ['../src/home/hub.css', '../src/mobile/mobilePdfViewer.css']
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
const APP_SHELL = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('the dialog layer is a direct #root child that the phone frame rule leaves alone', () => {
  assert.match(APP_SHELL, /<div data-tab-strip-dialogs=""/);
  // Every full-height rule on #root's child divs: the phone web frame, the
  // Expo frame, and the open-viewer pin.
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector, body]) => /#root[^,{]*>\s*div/.test(selector) && /height:\s*100(%|dvh)/.test(body));
  assert.ok(rules.length >= 3, `found ${rules.length} frame rules`);
  for (const [, selector] of rules) {
    for (const part of selector.split(',').map((s) => s.trim()).filter((s) => /#root[^>]*>\s*div/.test(s))) {
      assert.match(part, /:not\(\[data-tab-strip-dialogs\]\)/, `${part} must not stretch the dialog layer`);
    }
  }
});
