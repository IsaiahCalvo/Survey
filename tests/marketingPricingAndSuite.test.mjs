import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Pricing page publishes the approved 4-tier Kal Voe pricing (#1678)', () => {
  const html = read('public/pricing/index.html');
  assert.match(html, /<h3>Free<\/h3>/);
  assert.match(html, /<h3>Single-App Pro<\/h3>/);
  assert.match(html, /<h3>Kal Voe Suite<\/h3>/);
  assert.match(html, /<h3>Enterprise<\/h3>/);

  // Exact approved prices across all 3 apps + bundle + enterprise
  for (const snippet of [
    '$0',
    '$9.99',
    '$12',
    '$25',
    '$29',
    '$290',
    '$45',
  ]) {
    assert.ok(html.includes(snippet), `Pricing page missing ${snippet}`);
  }
  assert.ok(!html.includes('$20 per user'), 'Old $20 Enterprise price must be gone');
});

test('Kal Voe Suite page covers Walkthru -> Plot -> Survey workflow, 4 tiers, 58 free PDF tools, SEO & OAuth disclosure (#1677, #1681, #1683, #1684)', () => {
  const html = read('public/kal-voe/index.html');
  assert.match(html, /Walk the site\. Draw the plan\. Verify the build\./);
  assert.match(html, /Walkthru/);
  assert.match(html, /Plot/);
  assert.match(html, /Survey/);
  assert.match(html, /https:\/\/walkthru\.tools/);
  assert.match(html, /Kal Voe Suite/);
  assert.match(html, /\$29/);
  assert.match(html, /free PDF tools/i);
  assert.match(html, /files never leave your device/i);
  assert.match(html, /href="\/tools"/);
  assert.match(html, /logo-512\.png/);
  assert.match(html, /Signing in with Google gives us your name/);
  assert.match(html, /<link rel="canonical" href="https:\/\/kalvoe\.com\/"/);
  assert.match(html, /property="og:url" content="https:\/\/kalvoe\.com\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:image"/);
});

test('Welcome page cross-links the Kal Voe Suite and keeps static SEO tags (#1677, #1683)', () => {
  const html = read('public/welcome/index.html');
  assert.match(html, /href="\/kal-voe"/);
  assert.match(html, /Walkthru.*Plot.*Survey/);
  assert.match(html, /<link rel="canonical" href="https:\/\/surveytool\.app\/welcome"/);
  assert.match(html, /property="og:title"/);
});
