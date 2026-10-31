#!/usr/bin/env node
// scripts/prod-smoke.mjs — signed-out smoke test of the live site, run by
// .github/workflows/monitor.yml after every production deploy.
//
//   node scripts/prod-smoke.mjs [--expect-commit <sha>] [--base https://surveytool.app]
//
// Signed out only: it never signs in, never types, never clicks anything that
// writes. It checks that each page answers 200, the app actually draws (the
// React root fills in), no uncaught error fires while it loads, and, with
// --expect-commit, that release.json names the revision that was just shipped.
// Exit 0 = healthy, 1 = a check failed (the reasons are printed).

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (flag('--base') || 'https://surveytool.app').replace(/\/$/, '');
const EXPECT_COMMIT = flag('--expect-commit');
// Pages the React app draws into #root. Signed out, `/` sends visitors to the
// static /welcome page instead, so it passes by landing there or by drawing.
const PAGES = ['/', '/app'];
const SIGNED_OUT_HOME = '/welcome';
// Generated static pages (scripts/build-marketing.mjs, build-free-tools.mjs).
// A broken vercel.json rewrite falls through to the app shell, whose title is
// just "Survey", so each must answer with its own title.
const STATIC_PAGES = [
  ['/welcome', /PDF markup/i],
  ['/pricing', /Pricing/i],
  ['/status', /Status/i],
  // Google Play's required account-deletion link points here.
  ['/delete-account', /Delete your account/i],
  ['/tools', /PDF tools/i],
  ['/tools/merge-pdf', /Merge/i],
];
const DRAW_TIMEOUT_MS = 30000;

const failures = [];

async function checkRelease() {
  const res = await fetch(`${BASE}/release.json?smoke=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return failures.push(`release.json answered ${res.status}`);
  const release = await res.json().catch(() => null);
  if (!release?.commit) return failures.push('release.json has no commit');
  console.log(`live commit ${release.commit}`);
  if (EXPECT_COMMIT && release.commit !== EXPECT_COMMIT) {
    failures.push(`release.json is ${release.commit}, expected ${EXPECT_COMMIT}`);
  }
}

async function checkPage(browser, path) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: DRAW_TIMEOUT_MS });
    if (!response || response.status() !== 200) {
      failures.push(`${path} answered ${response ? response.status() : 'nothing'}`);
      return;
    }
    const drew = await page.waitForFunction(
      (home) => (document.getElementById('root')?.childElementCount || 0) > 0
        || (location.pathname.replace(/\/$/, '') === home && !!document.querySelector('main, h1')),
      path === '/' ? SIGNED_OUT_HOME : null,
      { timeout: DRAW_TIMEOUT_MS },
    ).then(() => true, () => false);
    if (!drew) {
      failures.push(`${path} never drew (empty #root after ${DRAW_TIMEOUT_MS / 1000}s, at ${new URL(page.url()).pathname})`);
      return;
    }
    // Give late scripts a moment to throw before judging the page clean.
    await page.waitForTimeout(3000);
    for (const message of errors) failures.push(`${path} threw: ${message}`);
    console.log(`${path} ok${errors.length ? ` (${errors.length} errors)` : ''}`);
  } finally {
    await context.close();
  }
}

async function checkStaticPage(path, title) {
  const res = await fetch(`${BASE}${path}?smoke=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return failures.push(`${path} answered ${res.status}`);
  const found = (await res.text()).match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || '';
  if (!title.test(found)) return failures.push(`${path} served "${found}" (expected its own page; a rewrite may be broken)`);
  console.log(`${path} ok`);
}

await checkRelease().catch((error) => failures.push(`release.json: ${error.message}`));
for (const [path, title] of STATIC_PAGES) {
  await checkStaticPage(path, title).catch((error) => failures.push(`${path}: ${error.message}`));
}
const browser = await chromium.launch(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
try {
  for (const path of PAGES) {
    await checkPage(browser, path).catch((error) => failures.push(`${path}: ${error.message}`));
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Smoke test failed on ${BASE}:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Smoke test passed on ${BASE}`);
