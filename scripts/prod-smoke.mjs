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
const PAGES = ['/', '/welcome'];
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
    await page.waitForFunction(
      () => (document.getElementById('root')?.childElementCount || 0) > 0,
      null,
      { timeout: DRAW_TIMEOUT_MS },
    ).catch(() => failures.push(`${path} never drew (empty #root after ${DRAW_TIMEOUT_MS / 1000}s)`));
    // Give late scripts a moment to throw before judging the page clean.
    await page.waitForTimeout(3000);
    for (const message of errors) failures.push(`${path} threw: ${message}`);
    console.log(`${path} ok${errors.length ? ` (${errors.length} errors)` : ''}`);
  } finally {
    await context.close();
  }
}

await checkRelease().catch((error) => failures.push(`release.json: ${error.message}`));
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
