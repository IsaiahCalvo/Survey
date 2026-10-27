// Design review 2026-10-27: the app had two toast looks. The Undo toast
// (collab/UndoToast.css) and the app toast (ToastHost.css) keep their own
// clocks and places, but they must wear the same card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} exists`);
  return css.slice(at, css.indexOf('}', at));
};
const prop = (body, name) => body.match(new RegExp(`\\n\\s*${name}:\\s*([^;]+);`))?.[1]?.trim();

test('the Undo toast and the app toast share one card', () => {
  const app = rule(read('src/components/ToastHost.css'), '.app-toast');
  const undo = rule(read('src/components/collab/UndoToast.css'), '.undo-toast');
  for (const name of ['background', 'border', 'border-radius', 'box-shadow', 'padding', 'font-family']) {
    assert.equal(prop(undo, name), prop(app, name), `${name} matches`);
  }
});

test('the Undo toast words match the app toast words', () => {
  const app = rule(read('src/components/ToastHost.css'), '.app-toast');
  const msg = rule(read('src/components/collab/UndoToast.css'), '.undo-toast__message');
  for (const name of ['font-size', 'font-weight', 'line-height']) {
    assert.equal(prop(msg, name), prop(app, name), `${name} matches`);
  }
});

test('the Undo link draws its ring for the keyboard only', () => {
  const css = read('src/components/collab/UndoToast.css');
  assert.match(css, /\.undo-toast__action:focus-visible \{/);
  assert.doesNotMatch(css, /\.undo-toast__action:focus \{/);
});
