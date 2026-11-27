import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MARKETING_CSP } from '../functions/_lib/securityHeaders.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { buildAll, PAGES, BUY_PRODUCTS, APPS, SUITE } from '../scripts/build-suite-site.mjs';

const root = path.resolve(process.cwd());
const site = path.join(root, 'public', 'kal-voe');
const read = (rel) => fs.readFileSync(path.join(site, rel), 'utf8');
const pageFile = (p) => (p === '/' ? 'index.html' : `${p.slice(1)}/index.html`);

test('Kal Voe suite site files are up to date with scripts/build-suite-site.mjs', () => {
  for (const [rel, body] of Object.entries(buildAll())) {
    assert.equal(read(rel), body, `public/kal-voe/${rel} is stale: run node scripts/build-suite-site.mjs`);
  }
});

test('Every suite page has its own canonical URL, the Kal Voe icons and no inline script code', () => {
  for (const p of PAGES) {
    const html = read(pageFile(p));
    const canonical = p === '/' ? 'https://kalvoe.com/' : `https://kalvoe.com${p}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`), `${p} canonical`);
    assert.match(html, /<link rel="icon" href="\/kal-voe\/static\/kalvoe\.svg"/, `${p} tab icon`);
    assert.match(html, /\/kal-voe\/static\/apple-touch-icon\.png/, `${p} touch icon`);
    assert.match(html, /property="og:image" content="https:\/\/kalvoe\.com\/kal-voe\/static\/og\.png"/, `${p} og:image`);
    assert.ok(!/href="\/favicon\.svg"/.test(html), `${p} must not use the Survey favicon`);
    // Marketing CSP allows only 'self' scripts, so every executable script is external.
    for (const tag of html.match(/<script\b[^>]*>/g) || []) {
      assert.ok(/\bsrc="/.test(tag) || /type="application\/(?:ld\+)?json"/.test(tag), `${p} has inline script ${tag}`);
    }
  }
  for (const f of ['static/suite.css', 'static/suite.js', 'static/kalvoe.svg', 'static/og.png', 'static/favicon.ico', 'favicon.ico', 'apple-touch-icon.png']) {
    assert.ok(fs.existsSync(path.join(site, f)), `missing public/kal-voe/${f}`);
  }
});

test('Suite pages only link to pages that exist', () => {
  const known = new Set([...PAGES, '/privacy.html', '/terms.html']);
  for (const p of PAGES) {
    const html = read(pageFile(p));
    for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
      const clean = href.split('?')[0];
      if (clean.startsWith('/kal-voe/')) {
        assert.ok(fs.existsSync(path.join(root, 'public', clean)), `${p} links missing file ${clean}`);
        continue;
      }
      assert.ok(known.has(clean), `${p} links unknown page ${href}`);
    }
  }
});

test('Each app page sells that app alone and in the suite', () => {
  for (const key of Object.keys(APPS)) {
    const html = read(pageFile(`/${key}`));
    assert.ok(html.includes(APPS[key].name), `${key} name`);
    assert.ok(html.includes(`/buy?app=${key}`), `${key} buy link`);
    assert.ok(html.includes('/buy?app=suite'), `${key} suite link`);
    assert.ok(html.includes(APPS[key].url), `${key} open link`);
    assert.match(html, /class="win demo/, `${key} has an animated demo`);
  }
  const pricing = read('pricing/index.html');
  assert.ok(pricing.includes(`$${SUITE.monthly}`));
  const buy = read('buy/index.html');
  const config = JSON.parse(buy.match(/<script type="application\/json" id="kv-config">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(Object.keys(config.products).sort(), Object.keys(BUY_PRODUCTS).sort());
  for (const [id, product] of Object.entries(config.products)) {
    const hasCheckout = Object.values(config.checkout[id] || {}).some(Boolean);
    assert.ok(hasCheckout || product.fallback || product.fallbackMail, `${id} needs a way to buy`);
  }
});

function assetsFor(files) {
  const seen = [];
  return {
    seen,
    env: {
      ASSETS: {
        fetch: async (request) => {
          const p = new URL(request.url).pathname;
          seen.push(p);
          if (files[p]) return new Response(files[p], { headers: { 'Content-Type': 'text/html' } });
          return new Response('nope', { status: 404 });
        },
      },
    },
  };
}

test('kalvoe.com serves each suite page from public/kal-voe at the root', async () => {
  const { env, seen } = assetsFor({ '/kal-voe/': 'home', '/kal-voe/pricing/': 'pricing', '/kal-voe/plot/': 'plot', '/kal-voe/robots.txt': 'robots', '/kal-voe/404.html': 'not found' });
  const next = async () => new Response('survey');
  const get = (u) => middleware({ request: new Request(u), env, next });

  for (const [url, body] of [['https://kalvoe.com/', 'home'], ['https://kalvoe.com/pricing', 'pricing'], ['https://kalvoe.com/plot?x=1', 'plot'], ['https://kalvoe.com/robots.txt', 'robots']]) {
    const res = await get(url);
    assert.equal(res.status, 200, url);
    assert.equal(await res.text(), body, url);
    assert.equal(res.headers.get('Content-Security-Policy'), MARKETING_CSP, url);
  }

  const missing = await get('https://kalvoe.com/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'not found');
  assert.ok(seen.includes('/kal-voe/does-not-exist/'));
});

test('kalvoe.com keeps one URL per page and moves old /kal-voe paths to the root', async () => {
  const next = async () => new Response('passthrough');
  const get = (u) => middleware({ request: new Request(u), env: {}, next });

  const slash = await get('https://kalvoe.com/pricing/?cycle=yearly');
  assert.equal(slash.status, 308);
  assert.equal(slash.headers.get('location'), 'https://kalvoe.com/pricing?cycle=yearly');

  const old = await get('https://kalvoe.com/kal-voe/survey/');
  assert.equal(old.status, 308);
  assert.equal(old.headers.get('location'), 'https://kalvoe.com/survey');

  for (const u of ['https://kalvoe.com/kal-voe/static/suite.css', 'https://kalvoe.com/kal-voe/logo-512.png', 'https://kalvoe.com/privacy.html', 'https://kalvoe.com/terms.html', 'https://kalvoe.com/api/analytics/track']) {
    const res = await get(u);
    assert.equal(await res.text(), 'passthrough', u);
  }
});

test('Suite pages on other hosts send visitors to kalvoe.com, matching vercel.json', async () => {
  const next = async () => new Response('survey');
  const res = await middleware({ request: new Request('https://surveytool.app/kal-voe/plot?ref=1'), env: {}, next });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://kalvoe.com/plot?ref=1');
  const bare = await middleware({ request: new Request('https://surveytool.app/kal-voe'), env: {}, next });
  assert.equal(bare.headers.get('location'), 'https://kalvoe.com/');
  const file = await middleware({ request: new Request('https://surveytool.app/kal-voe/static/suite.css'), env: {}, next });
  assert.equal(await file.text(), 'survey');

  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const redirects = Object.fromEntries(vercel.redirects.map((r) => [r.source, r]));
  assert.equal(redirects['/kal-voe'].destination, 'https://kalvoe.com/');
  assert.equal(redirects['/kal-voe/:path((?!static/)[^.]*)'].destination, 'https://kalvoe.com/:path');
  assert.ok(!vercel.rewrites.some((r) => r.source === '/kal-voe'), 'old /kal-voe rewrite removed');
});

test('App subdomains open each app', async () => {
  const get = (u) => middleware({ request: new Request(u), env: {}, next: async () => new Response('x') });
  for (const [host, target] of [['survey.kalvoe.com', 'https://surveytool.app'], ['walkthru.kalvoe.com', 'https://walkthru.tools'], ['plot.kalvoe.com', APPS.plot.url]]) {
    const res = await get(`https://${host}/projects?id=7`);
    assert.equal(res.status, 302, host);
    assert.equal(res.headers.get('location'), `${target}/projects?id=7`, host);
  }
});
