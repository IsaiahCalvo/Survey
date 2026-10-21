import test from 'node:test';
import assert from 'node:assert/strict';
import { deepLinkRoute, installNativeDeepLinks } from '../src/mobile/nativeDeepLinks.js';

test('invite links map to the in-app invite route', () => {
  assert.equal(deepLinkRoute('https://surveytool.app/invite/abc123'), '/invite/abc123');
  assert.equal(deepLinkRoute('https://www.surveytool.app/invite/abc?mobile=1#x'), '/invite/abc?mobile=1#x');
});

test('other hosts, schemes and paths are ignored', () => {
  assert.equal(deepLinkRoute('https://evil.example/invite/abc'), null);
  assert.equal(deepLinkRoute('http://surveytool.app/invite/abc'), null);
  assert.equal(deepLinkRoute('https://surveytool.app/pricing'), null);
  assert.equal(deepLinkRoute('https://surveytool.app/invite/'), null);
  assert.equal(deepLinkRoute('not a url'), null);
});

test('install is a no-op off native', () => {
  assert.equal(installNativeDeepLinks(null), false);
  assert.equal(installNativeDeepLinks({}), false);
});
