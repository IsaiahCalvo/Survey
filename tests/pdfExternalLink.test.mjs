import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  isAllowedPdfExternalUrl,
  openPdfExternalUrl,
  PDF_EXTERNAL_LINK_PROTOCOLS,
} from '../src/utils/pdfExternalLink.js';
import { buildLinkClusterPdf, LINK_CLUSTER } from './helpers/buildLinkClusterPdf.mjs';

test('pdf external link allowlist matches Electron http/https/mailto', () => {
  assert.deepEqual([...PDF_EXTERNAL_LINK_PROTOCOLS], ['http:', 'https:', 'mailto:']);
  assert.equal(isAllowedPdfExternalUrl('https://claude.com/'), true);
  assert.equal(isAllowedPdfExternalUrl('http://example.com/safe'), true);
  assert.equal(isAllowedPdfExternalUrl('mailto:isaiah@example.test'), true);
  assert.equal(isAllowedPdfExternalUrl('  HTTPS://EXAMPLE.COM  '), true);
});

test('pdf external link rejects javascript/data/file/ftp and junk', () => {
  assert.equal(isAllowedPdfExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedPdfExternalUrl('JAVASCRIPT:alert(1)'), false);
  assert.equal(isAllowedPdfExternalUrl('\tjavascript:alert(1)'), false);
  assert.equal(isAllowedPdfExternalUrl('data:text/html,pwned'), false);
  assert.equal(isAllowedPdfExternalUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedPdfExternalUrl('ftp://files.example.com/x'), false);
  assert.equal(isAllowedPdfExternalUrl('blob:https://example.com/uuid'), false);
  assert.equal(isAllowedPdfExternalUrl('about:blank'), false);
  assert.equal(isAllowedPdfExternalUrl('//evil.com'), false);
  assert.equal(isAllowedPdfExternalUrl('/relative'), false);
  assert.equal(isAllowedPdfExternalUrl(''), false);
  assert.equal(isAllowedPdfExternalUrl(null), false);
  assert.equal(isAllowedPdfExternalUrl(undefined), false);
});

test('openPdfExternalUrl no-ops disallowed and opens allowed via the window fallback', async () => {
  const opened = [];
  const electron = [];
  const denied = await openPdfExternalUrl('javascript:alert(1)', {
    openExternal: (url) => electron.push(url),
    openWindow: (url) => opened.push(url),
  });
  assert.deepEqual(denied, { opened: false, reason: 'disallowed' });
  assert.deepEqual(opened, []);
  assert.deepEqual(electron, []);

  const ftp = await openPdfExternalUrl('ftp://files.example.com/x', {
    openWindow: (url) => opened.push(url),
  });
  assert.deepEqual(ftp, { opened: false, reason: 'disallowed' });

  const ok = await openPdfExternalUrl('https://example.com/safe', {
    openWindow: (url) => opened.push(url),
  });
  assert.deepEqual(ok, { opened: true, via: 'window' });
  assert.deepEqual(opened, ['https://example.com/safe']);

  const viaElectron = await openPdfExternalUrl('mailto:isaiah@example.test', {
    openExternal: async (url) => { electron.push(url); },
    openWindow: (url) => opened.push(url),
  });
  assert.deepEqual(viaElectron, { opened: true, via: 'electron' });
  assert.deepEqual(electron, ['mailto:isaiah@example.test']);
  assert.deepEqual(opened, ['https://example.com/safe']);
});

test('pdf.js exposes ftp as url and hostile schemes only as unsafeUrl', async () => {
  const bytes = await buildLinkClusterPdf();
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    verbosity: 0,
  }).promise;
  const page = await pdf.getPage(1);
  const annots = await page.getAnnotations({ intent: 'display' });
  const rows = annots
    .filter((a) => a.subtype === 'Link')
    .map((a) => ({ url: a.url ?? null, dest: a.dest != null, unsafeUrl: a.unsafeUrl ?? null }));

  assert.ok(rows.some((row) => row.url === LINK_CLUSTER.https));
  assert.ok(rows.some((row) => row.url === LINK_CLUSTER.mailto));
  assert.ok(rows.some((row) => row.url === LINK_CLUSTER.ftp), 'ftp is the live hole pdf.js still promotes');
  assert.ok(rows.some((row) => row.dest === true && row.url == null));
  for (const raw of [LINK_CLUSTER.javascript, LINK_CLUSTER.data, LINK_CLUSTER.file]) {
    const row = rows.find((item) => item.unsafeUrl === raw);
    assert.ok(row, `pdf.js should keep ${raw} on unsafeUrl`);
    assert.equal(row.url, null);
  }
});

test('PdfjsLinkLayer never reads unsafeUrl and gates url through the allowlist', () => {
  const src = readFileSync('src/components/PdfjsLinkLayer.jsx', 'utf8');
  assert.match(src, /isAllowedPdfExternalUrl/);
  assert.match(src, /openPdfExternalUrl/);
  assert.doesNotMatch(src, /a\.unsafeUrl/);
  const electronMain = readFileSync('src/electron-main.js', 'utf8');
  assert.match(electronMain, /allowedProtocols = \['http:', 'https:', 'mailto:'\]/);
});
