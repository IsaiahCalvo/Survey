import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Pricing page shows the tier ladder and the approved prices from scripts/pricing.mjs', () => {
  const html = read('public/pricing/index.html');
  // Free with no sign-up, then a free account, then Pro and the suite.
  const order = ['<h3>No sign-up</h3>', '<h3>Free</h3>', '<h3>Survey Pro</h3>', '<h3>Kal Voe Suite</h3>'].map((h) => html.indexOf(h));
  order.forEach((i, n) => assert.ok(i > -1, `Pricing page missing tier ${n + 1}`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Tiers appear in ladder order');
  assert.match(html, /Continue without an account/);
  assert.match(html, /Enterprise is \$35 per user a month/);

  for (const snippet of ['$0', '$12', '$120', '$24', '$240', '$35', '$36', '7-day free trial']) {
    assert.ok(html.includes(snippet), `Pricing page missing ${snippet}`);
  }
  assert.match(html, /href="https:\/\/kalvoe\.com\/buy\?app=survey"/);
  assert.match(html, /href="https:\/\/kalvoe\.com\/buy\?app=suite"/);
});

test('No old prices remain on the marketing sites', () => {
  const files = ['landing/index.html', 'public/llms.txt'];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(html|txt|json|xml)$/.test(e.name)) files.push(rel);
    }
  };
  for (const dir of ['public/pricing', 'public/faq', 'public/welcome', 'public/compare', 'public/features', 'public/kal-voe']) walk(dir);
  for (const rel of files) {
    const text = read(rel);
    for (const old of [/\$9\.99/, /\$99\b/, /\$25\b/, /\$29\b/, /\$290\b/, /\$45\b/, /\$58\b/, /no yearly/i]) {
      assert.ok(!old.test(text), `${rel} still shows ${old}`);
    }
  }
});

test('Kal Voe Suite page covers Walkthru -> Plot -> Survey workflow, 4 tiers, 58 free PDF tools, SEO & OAuth disclosure (#1677, #1681, #1683, #1684)', () => {
  const html = read('public/kal-voe/index.html');
  assert.match(html, /Walk the site\. Draw the plan\.(?:\s|<br \/>)+Verify the build\./);
  assert.match(html, /Walkthru/);
  assert.match(html, /Plot/);
  assert.match(html, /Survey/);
  assert.match(html, /https:\/\/walkthru\.tools/);
  assert.match(html, /Kal Voe Suite/);
  assert.match(html, /\$24/);
  assert.match(html, /free PDF tools/i);
  assert.match(html, /files never leave your device/i);
  assert.match(html, /href="https:\/\/surveytool\.app\/tools"/);
  assert.match(html, /\/kal-voe\/static\/kalvoe\.svg/);
  assert.match(html, /href="\/privacy\.html"/);
  assert.match(html, /href="\/terms\.html"/);
  assert.match(html, /Signing in with Google gives us your name/);
  assert.match(html, /<link rel="canonical" href="https:\/\/kalvoe\.com\/"/);
  assert.match(html, /property="og:url" content="https:\/\/kalvoe\.com\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:image"/);
});

test('Welcome page cross-links the Kal Voe Suite and keeps static SEO tags (#1677, #1683)', () => {
  const html = read('public/welcome/index.html');
  assert.match(html, /href="https:\/\/kalvoe\.com\/"/);
  assert.match(html, /Walkthru.*Plot.*Survey/);
  assert.match(html, /<link rel="canonical" href="https:\/\/surveytool\.app\/welcome"/);
  assert.match(html, /property="og:title"/);
});
