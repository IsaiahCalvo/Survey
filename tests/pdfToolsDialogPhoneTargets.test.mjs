import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// PdfToolsDialog on a phone (<=640px): the header's Back and the rotate tool's
// "Turn every page" must be 44px to a finger (both measured short on iPhone SE).
const css = fs.readFileSync(new URL('../src/components/PdfToolsDialog.css', import.meta.url), 'utf8');
const phone = css.slice(css.indexOf('@media (max-width:640px)'));

test('phone sheet pads the header icon buttons to 44px', () => {
  assert.match(phone, /\.pdft-head \.dialog-touch-pad::after\{inset:-10px\}/);
});

test('phone sheet makes Turn every page 44px tall', () => {
  assert.match(phone, /\.pdft-all\{min-height:44px\}/);
});

test('phone sheet footer buttons are at least 44px wide (Run measured 39)', () => {
  assert.match(phone, /\.pdft-foot \.hub-btn\{min-width:44px\}/);
});

test('phone sheet keeps safe-area padding on header and footer', () => {
  assert.match(phone, /\.pdft-head\{padding-top:max\(12px,env\(safe-area-inset-top\)\)\}/);
  assert.match(phone, /\.pdft-foot\{padding-bottom:max\(12px,env\(safe-area-inset-bottom\)\)\}/);
});
