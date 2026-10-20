import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeDownloadShim } from '../src/mobile/nativeDownloadShim.js';

function fakeWindow(native) {
  const calls = [];
  class A {
    constructor(attrs) { this.attrs = attrs; this.href = attrs.href; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  }
  A.prototype.click = function () { calls.push(this.href); };
  return { calls, A, win: { HTMLAnchorElement: A, Capacitor: { isNativePlatform: () => native } } };
}

test('web build keeps the normal anchor click', () => {
  const { win, A, calls } = fakeWindow(false);
  assert.equal(installNativeDownloadShim(win), false);
  new A({ href: 'blob:x', download: 'a.pdf' }).click();
  assert.deepEqual(calls, ['blob:x']);
});

test('native build leaves plain links alone and installs once', () => {
  const { win, A, calls } = fakeWindow(true);
  assert.equal(installNativeDownloadShim(win), true);
  assert.equal(installNativeDownloadShim(win), false);
  new A({ href: 'https://surveytool.app/' }).click();
  new A({ href: 'https://x/y.pdf', download: 'y.pdf' }).click();
  assert.deepEqual(calls, ['https://surveytool.app/', 'https://x/y.pdf']);
});

test('native build takes over blob downloads', () => {
  const { win, A, calls } = fakeWindow(true);
  installNativeDownloadShim(win);
  const orig = console.warn; console.warn = () => {};
  try { new A({ href: 'blob:nope', download: 'r.zip' }).click(); } finally { setTimeout(() => { console.warn = orig; }, 50); }
  assert.deepEqual(calls, []);
});
