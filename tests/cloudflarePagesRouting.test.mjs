import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPagesRouting } from '../scripts/write-cloudflare-pages-routing.mjs';
import { headersForPath, APP_CSP, MARKETING_CSP } from '../functions/_lib/securityHeaders.js';

function makeDist(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-dist-'));
  for (const f of files) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
  return dir;
}

function parseHeaders(text) {
  const rules = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      current = {};
      rules.set(line, current);
    } else {
      const i = line.indexOf(':');
      current[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

const dist = makeDist([
  'index.html', '404.html', 'privacy.html', 'favicon.svg', 'paintWorker.js',
  'robots.txt', 'sitemap.xml', 'favicon.ico', 'kal-voe/static/suite.css',
  'assets/app-1.js', 'assets/app-1.css', 'ocr/eng.traineddata',
  'welcome/index.html', 'welcome/hero.png', 'tools/redact/index.html',
  '.well-known/assetlinks.json',
]);

test('static files skip the middleware; pages, routes and well-known do not', async () => {
  const { routes } = await buildPagesRouting(dist);
  assert.deepEqual(routes.include, ['/*']);
  assert.ok(routes.exclude.includes('/assets/*'));
  assert.ok(routes.exclude.includes('/ocr/*'));
  assert.ok(routes.exclude.includes('/favicon.svg'));
  assert.ok(routes.exclude.includes('/paintWorker.js'));
  assert.ok(routes.exclude.includes('/welcome/hero.png'));
  for (const kept of ['/index.html', '/404.html', '/privacy.html', '/welcome/index.html', '/tools/redact/index.html']) {
    assert.ok(!routes.exclude.includes(kept), `${kept} must still run the middleware`);
  }
  assert.ok(!routes.exclude.some((r) => r.includes('.well-known')));
  // kalvoe.com serves its own robots.txt, sitemap and favicon through the middleware.
  for (const perHost of ['/robots.txt', '/sitemap.xml', '/favicon.ico']) {
    assert.ok(!routes.exclude.includes(perHost), `${perHost} must still run the middleware`);
  }
  assert.ok(routes.exclude.includes('/kal-voe/static/suite.css'));
  assert.ok(routes.include.length + routes.exclude.length <= 100);
  assert.ok(routes.exclude.every((r) => r.length <= 100));
});

test('each skipped path gets exactly the headers the middleware would set', async () => {
  const { routes, headersFile } = await buildPagesRouting(dist);
  const rules = parseHeaders(headersFile);
  assert.deepEqual([...rules.keys()], routes.exclude);
  assert.deepEqual(rules.get('/assets/*'), headersForPath('/assets/x'));
  assert.equal(rules.get('/assets/*')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(rules.get('/favicon.svg')['Content-Security-Policy'], APP_CSP);
  assert.equal(rules.get('/welcome/hero.png')['Content-Security-Policy'], MARKETING_CSP);
  for (const line of headersFile.split('\n')) assert.ok(line.length <= 2000);
});

test('caps the rule count at Cloudflare\'s limit of 100', async () => {
  const many = makeDist(Array.from({ length: 150 }, (_, i) => `img/p${i}.png`));
  const { routes } = await buildPagesRouting(many);
  assert.equal(routes.include.length + routes.exclude.length, 100);
});
