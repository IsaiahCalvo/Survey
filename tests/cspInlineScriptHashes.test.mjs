// vercel.json's CSP lists a sha256 for each inline <script> in index.html.
// Editing one of those scripts changes its hash, so the policy must change too.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

const policies = vercel.headers.flatMap((rule) => rule.headers)
  .filter((h) => /^Content-Security-Policy/i.test(h.key))
  .map((h) => h.value);

test('every inline script in index.html is allowed by hash in the CSP', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(inline.length > 0);
  const scriptSrc = policies.map((p) => p.split(';').find((d) => d.trim().startsWith('script-src'))).find(Boolean);
  assert.ok(scriptSrc, 'a CSP with script-src exists');
  for (const body of inline) {
    const hash = `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`;
    assert.ok(scriptSrc.includes(hash), `index.html inline script needs ${hash} in vercel.json script-src`);
  }
});


// Marketing pages have their own inline scripts (and /status calls GitHub), so
// the full app policy must skip every one of them or it blocks them.
test('the full app policy skips every marketing page', () => {
  const rule = vercel.headers.find((r) => r.headers.some((h) => h.key === 'Content-Security-Policy' && h.value.includes('script-src')));
  assert.ok(rule, 'the full policy is enforced');
  const appPaths = new RegExp(`^${rule.source.replace(/\(\.\*\)$/, '(.*)')}$`);
  const marketing = vercel.rewrites
    .map((r) => r.destination.match(/^\/([^/:]+)\/(?:[^/]+\/)?index\.html$/)?.[1])
    .filter(Boolean);
  assert.ok(marketing.includes('whats-new') && marketing.includes('status'));
  for (const page of [...marketing, 'privacy.html', 'terms.html', '404.html']) {
    assert.ok(!appPaths.test(`/${page}`), `/${page} must be left out of the app policy`);
  }
  for (const page of ['', 'app', 'agent-link', 'flags', 'kits']) {
    assert.ok(appPaths.test(`/${page}`), `/${page} must get the app policy`);
  }
});
