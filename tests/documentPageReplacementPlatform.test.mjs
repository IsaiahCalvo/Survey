import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentPageReplacementTransport }
  from '../src/services/documentPageReplacementPlatform.js';

const call = transport => transport({ accessToken: 'token', body: { version: 1 },
  signal: new AbortController().signal });
const windowAt = (href, extra = {}) => ({ location: { href }, ...extra });

test('an injected host transport wins without reading platform or fetch accessors', () => {
  const injectedTransport = async () => Response.json({});
  const options = { injectedTransport };
  Object.defineProperty(options, 'window', { enumerable: true,
    get() { throw new Error('window must not be read'); } });
  Object.defineProperty(options, 'fetch', { enumerable: true,
    get() { throw new Error('fetch must not be read'); } });
  assert.equal(resolveDocumentPageReplacementTransport(options), injectedTransport);
});

test('web and loopback development scopes use the same-origin route', async () => {
  for (const window of [
    windowAt('https://surveytool.app/document/1'),
    windowAt('https://www.surveytool.app/document/1'),
    windowAt('http://localhost:5173/?testPdf=fixture.pdf'),
    windowAt('https://127.0.0.1:5199/document/1'),
    windowAt('http://[::1]:4173/document/1'),
    windowAt('http://localhost:5173/', { electronAPI: {} }),
  ]) {
    const urls = [];
    const transport = resolveDocumentPageReplacementTransport({ window,
      fetch: async url => { urls.push(url); return Response.json({}); } });
    assert.equal(typeof transport, 'function');
    await call(transport);
    assert.deepEqual(urls, ['/api/document-replacement']);
  }
});

test('packaged Electron and local Capacitor shells use only the fixed trusted app host', async () => {
  for (const window of [
    windowAt('file:///Applications/Survey.app/index.html', { electronAPI: {} }),
    windowAt('capacitor://localhost/document/1', {
      Capacitor: { isNativePlatform: () => true },
    }),
    windowAt('https://localhost/document/1', {
      Capacitor: { isNativePlatform: () => true },
    }),
    windowAt('http://localhost/document/1', {
      Capacitor: { isNativePlatform: () => true },
    }),
  ]) {
    const urls = [];
    const transport = resolveDocumentPageReplacementTransport({ window,
      fetch: async url => { urls.push(url); return Response.json({}); } });
    assert.equal(typeof transport, 'function');
    await call(transport);
    assert.deepEqual(urls, ['https://surveytool.app/api/document-replacement']);
  }
});

test('unknown, untrusted, and malformed scopes fail closed without a request', () => {
  let fetches = 0;
  const fetch = async () => { fetches += 1; return Response.json({}); };
  for (const window of [
    undefined,
    windowAt('https://evil.example/document/1'),
    windowAt('file:///tmp/index.html'),
    windowAt('https://192.168.1.20:5173/', {
      Capacitor: { isNativePlatform: () => true },
    }),
    windowAt('https://surveytool.app.evil.example/document/1'),
    windowAt('not a URL'),
  ]) assert.equal(resolveDocumentPageReplacementTransport({ window, fetch }), null);
  assert.equal(resolveDocumentPageReplacementTransport({
    window: windowAt('https://surveytool.app/'), fetch, endpoint: 'https://evil.example',
  }), null);
  assert.equal(fetches, 0);
});

test('hostile platform accessors and throwing native signals fail closed', () => {
  let fetches = 0;
  const fetch = async () => { fetches += 1; return Response.json({}); };
  const accessorWindow = {};
  Object.defineProperty(accessorWindow, 'location', { get() { throw new Error('private'); } });
  assert.equal(resolveDocumentPageReplacementTransport({ window: accessorWindow, fetch }), null);
  assert.equal(resolveDocumentPageReplacementTransport({
    window: windowAt('capacitor://localhost/', {
      Capacitor: { isNativePlatform() { throw new Error('private'); } },
    }), fetch,
  }), null);
  assert.equal(fetches, 0);
});
