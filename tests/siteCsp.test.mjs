// Launch polish 2026-11-02: the website and the free PDF tool pages get a full
// content security policy of their own (vercel.json), like the app has. These
// pages are static HTML made by scripts/build-marketing.mjs and
// scripts/build-free-tools.mjs; the policy allows their few inline scripts by
// hash, so editing one of those scripts must update the hash here too.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const cspRules = vercel.headers.filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy' && h.value.includes('script-src')));
const ruleRegex = (rule) => new RegExp(`^${rule.source}$`);
const appRule = cspRules.find((r) => r.source.startsWith('/((?!'));
const siteRule = cspRules.find((r) => r !== appRule);
const policy = (rule) => rule.headers.find((h) => h.key === 'Content-Security-Policy').value;
const directive = (rule, name) => policy(rule).split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '';

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(p));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

// Every page the site policy covers, with the URL path it is served at.
const SITE_PAGES = [
  ...htmlFiles(path.join(root, 'public')).filter((p) => !p.includes(`${path.sep}nightly${path.sep}`)),
  ...htmlFiles(path.join(root, 'tools')),
]
  .map((file) => {
    const rel = path.relative(root, file).split(path.sep).join('/').replace(/^public\//, '');
    return { file, url: `/${rel.replace(/(^|\/)index\.html$/, '$1').replace(/\/$/, '')}` };
  })
  .filter(({ url }) => url !== '/' && !/^\/google[0-9a-f]+\.html$/.test(url));

test('there are two full policies: the app one and the site one', () => {
  assert.ok(appRule, 'app policy');
  assert.ok(siteRule, 'site policy');
  assert.ok(SITE_PAGES.length > 70, `found ${SITE_PAGES.length} site pages`);
});

test('every site and tool page gets the site policy and not the app one', () => {
  for (const { url } of SITE_PAGES) {
    assert.ok(ruleRegex(siteRule).test(url), `${url} must get the site policy`);
    assert.ok(!ruleRegex(appRule).test(url), `${url} must not get the app policy`);
  }
  // Rewrites also serve these with a trailing slash.
  for (const url of ['/welcome/', '/tools/merge-pdf/', '/use-cases/punch-lists/']) {
    assert.ok(ruleRegex(siteRule).test(url), url);
  }
});

test('app paths and look-alikes never get the site policy', () => {
  for (const url of ['/', '/app', '/flags', '/kits', '/agent-link', '/toolsx', '/welcome-anything', '/privacy.htmlx', '/assets/x.js']) {
    assert.ok(!ruleRegex(siteRule).test(url), `${url} is the app`);
    assert.ok(ruleRegex(appRule).test(url), `${url} keeps the app policy`);
  }
});

test('every inline script on a site page is allowed by hash; no inline handlers', () => {
  const scriptSrc = directive(siteRule, 'script-src');
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'no unsafe-inline scripts');
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), 'no unsafe-eval');
  for (const { file, url } of SITE_PAGES) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/application\/ld\+json/.test(m[1])) continue; // data, never run
      const hash = `'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`;
      assert.ok(scriptSrc.includes(hash), `${url}: inline script needs ${hash} in the site policy`);
    }
    const handler = html.match(/<[^>]+\son[a-z]+\s*=\s*["']/i);
    assert.equal(handler, null, `${url}: inline event handler ${handler?.[0]} is blocked by the policy; move it into a script file`);
  }
});

test('the site policy only reaches what the pages use', () => {
  assert.match(directive(siteRule, 'connect-src'), /https:\/\/api\.github\.com/, '/status reads alert issues from GitHub');
  assert.ok(!/supabase|r2\.cloudflarestorage|microsoft/.test(policy(siteRule)), 'the site pages never call the backend');
  for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
    assert.ok(policy(siteRule).includes(d), d);
  }
  // The OCR and password tools run WebAssembly; tesseract starts a blob: worker.
  assert.ok(directive(siteRule, 'script-src').includes("'wasm-unsafe-eval'"));
  assert.ok(directive(siteRule, 'worker-src').includes('blob:'));
});
