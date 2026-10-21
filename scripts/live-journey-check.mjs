#!/usr/bin/env node
// scripts/live-journey-check.mjs — the signed-in path a real person takes,
// run against a live site by .github/workflows/live-journey-check.yml:
// sign in, upload a PDF, draw a rectangle, see it saved, export the marked-up
// PDF, then delete the document again.
//
//   JOURNEY_EMAIL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/live-journey-check.mjs [--base https://surveytool.app]
//
// It uses one dedicated account that must already exist; it never creates
// one. Sign-in goes through a one-time sign-in link made with the service key,
// because the live sign-in form sits behind a CAPTCHA. Every document that
// account owns is deleted before and after the run, so a failed run never
// piles up files. Exit 0 = healthy, 1 = a step failed (the reason is printed).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { dragPage, tool } from '../debug/scenarios/test-plan/tp-actions.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (flag('--base') || process.env.JOURNEY_BASE || 'https://surveytool.app').replace(/\/$/, '');
const { JOURNEY_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';
const FILE_NAME = 'clickable-link-test.pdf';
const RECT_HEX = Buffer.from('Rect').toString('hex');
const STEP_TIMEOUT_MS = 60_000;

if (!JOURNEY_EMAIL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set JOURNEY_EMAIL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserId() {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === JOURNEY_EMAIL.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 1000) return null;
  }
}

// Same order as the app's own delete: the row (its markups cascade), then the
// stored bytes, which no other row of this account can share once all are gone.
async function deleteEveryDocument(userId) {
  const { data: docs, error } = await admin.from('documents').select('id, file_path').eq('user_id', userId);
  if (error) throw new Error(`list documents: ${error.message}`);
  if (!docs.length) return 0;
  const { error: deleteError } = await admin.from('documents').delete().in('id', docs.map((doc) => doc.id));
  if (deleteError) throw new Error(`delete documents: ${deleteError.message}`);
  const paths = [...new Set(docs.map((doc) => doc.file_path).filter(Boolean))];
  if (paths.length) {
    const { error: storageError } = await admin.storage.from('documents').remove(paths);
    if (storageError) console.warn(`stored PDFs not removed: ${storageError.message}`);
  }
  return docs.length;
}

async function squareCount(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(0).node.Annots();
  if (!annots) return 0;
  return annots.asArray()
    .map((ref) => pdf.context.lookup(ref, PDFDict).get(PDFName.of('Subtype')))
    .filter((subtype) => subtype === PDFName.of('Square')).length;
}

async function waitFor(what, check, timeoutMs = STEP_TIMEOUT_MS) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error(`${what} (waited ${timeoutMs / 1000}s)`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function journey(page, userId) {
  const step = (name) => console.log(`- ${name}`);

  step('sign in');
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: JOURNEY_EMAIL, options: { redirectTo: `${BASE}/` },
  });
  if (linkError) throw new Error(`sign-in link: ${linkError.message}`);
  await page.goto(link.properties.action_link, { waitUntil: 'domcontentloaded' });
  const upload = page.getByRole('button', { name: 'Upload', exact: true });
  await upload.waitFor({ timeout: STEP_TIMEOUT_MS });

  step('upload a PDF');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), upload.click()]);
  await chooser.setFiles(FIXTURE);
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  await pageDiv.locator('canvas').first().waitFor({ timeout: STEP_TIMEOUT_MS });
  // The drag lands on the markup layer, which mounts after the page canvas.
  await page.locator('[data-svg-annotation-layer="1"]').first().waitFor({ timeout: STEP_TIMEOUT_MS });
  let documentId = null;
  await waitFor('the upload never reached the database', async () => {
    const { data } = await admin.from('documents').select('id').eq('user_id', userId).eq('name', FILE_NAME);
    documentId = data?.[0]?.id || null;
    return !!documentId;
  });

  step('draw a rectangle and see it saved');
  await tool(page, 'Shapes', 'Rectangle');
  await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
  await page.keyboard.press('Escape');
  await waitFor('the rectangle never saved', async () => {
    const { data } = await admin.from('annotation_updates').select('data').eq('document_id', documentId);
    return (data || []).some((row) => String(row.data).includes(RECT_HEX));
  });

  step('export the marked-up PDF');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: STEP_TIMEOUT_MS }),
    page.getByRole('button', { name: 'Export annotated PDF' }).first().click(),
  ]);
  const exported = readFileSync(await download.path());
  if (exported.subarray(0, 5).toString() !== '%PDF-') throw new Error('the export is not a PDF');
  const added = (await squareCount(exported)) - (await squareCount(readFileSync(FIXTURE)));
  if (added !== 1) throw new Error(`the export carries ${added} new rectangles, expected 1`);
}

const userId = await findUserId();
if (!userId) {
  console.error(`No account for the check exists on ${SUPABASE_URL}; it never creates one.`);
  process.exit(1);
}

let failure = null;
const browser = await chromium.launch(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
try {
  const left = await deleteEveryDocument(userId);
  if (left) console.log(`removed ${left} document(s) left by an earlier run`);
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await journey(page, userId);
  } catch (error) {
    failure = error.message;
    await page.screenshot({ path: 'live-journey-failure.png' }).catch(() => {});
  }
  if (!failure && errors.length) failure = `the page threw: ${errors.slice(0, 3).join(' | ')}`;
  await context.close();
} finally {
  await browser.close();
  try {
    await deleteEveryDocument(userId);
  } catch (error) {
    failure ||= `cleanup: ${error.message}`;
  }
}

if (failure) {
  console.error(`Live journey check failed on ${BASE}: ${failure}`);
  process.exit(1);
}
console.log(`Live journey check passed on ${BASE}`);
