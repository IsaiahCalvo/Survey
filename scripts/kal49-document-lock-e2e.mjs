#!/usr/bin/env node
// KAL-49 — end-to-end verification of the document lock state.
//
// Standalone Node + Playwright (NOT the Playwright MCP — Node script per the
// standing rules for agent verifiers).
//
// Flow:
//   1. Provision three disposable accounts: owner, editor, viewer.
//   2. Owner uploads a tiny PDF document; collaborator rows are inserted.
//   3. Owner opens the document in browser context A → clicks the "Lock"
//      chip → screenshot A1 (owner sees locked banner with Unlock button).
//   4. Editor opens the same document in context B → banner visible, toolbar
//      dimmed via body[data-readonly] → screenshot B1.
//   5. Editor attempts to INSERT an annotation row via the Supabase JS client
//      directly in the page; RLS denies with 42501 → screenshot B2.
//   6. Viewer opens in context C → banner visible → screenshot C1.
//   7. Owner unlocks → editor reloads → banner gone, lock chip visible to
//      owner only → screenshot A2 / B3.
//   8. Editor INSERT succeeds (post-unlock) → screenshot B4.
//   9. Cleanup all rows + storage + accounts.
//
// All assets (screenshots, console logs, run summary) land in Logs/<stamp>_kal49/.

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOGS_ROOT = path.join(REPO_ROOT, 'Logs');
const BASE_URL = process.env.KAL49_BASE_URL || 'http://localhost:5360/';

function loadEnv(file) {
  const p = path.join(REPO_ROOT, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function stampForFolder(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

loadEnv('.env');
loadEnv('.env.local');

if (
  process.env.SURVEY_COORDINATOR_DISPOSABLE_TEST_USERS
    !== 'I_AM_THE_TEST_ACCOUNT_COORDINATOR'
) {
  throw new Error('Exact coordinator authorization is required before creating KAL-49 users');
}

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

fs.mkdirSync(LOGS_ROOT, { recursive: true });
const logDir = path.join(LOGS_ROOT, `${stampForFolder()}_kal49`);
fs.mkdirSync(logDir, { recursive: true });

console.log(`[kal49] log dir: ${logDir}`);

const TS = Date.now();
const ROLE_DEFS = [
  { role: 'owner', email: `survey-test-owner-${TS}@example.com`, password: `Pw_owner_${TS}!` },
  { role: 'editor', email: `survey-test-editor-${TS}@example.com`, password: `Pw_editor_${TS}!` },
  { role: 'viewer', email: `survey-test-viewer-${TS}@example.com`, password: `Pw_viewer_${TS}!` },
];

const accounts = {};
async function provisionAccount(def) {
  const { data, error } = await service.auth.admin.createUser({
    email: def.email,
    password: def.password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${def.role}): ${error.message}`);
  accounts[def.role] = { ...def, userId: data.user.id };
  console.log(`[kal49] provisioned ${def.role}: ${data.user.id}`);
}

async function cleanupAccounts() {
  for (const r of Object.values(accounts)) {
    try {
      await service.auth.admin.deleteUser(r.userId);
      console.log(`[kal49] deleted user ${r.role}`);
    } catch (err) {
      console.warn(`[kal49] cleanup user ${r.role} failed:`, err?.message);
    }
  }
}

async function ensureSubscriptionPro(userId) {
  // The documents INSERT policy needs a non-free tier. Insert/upsert a pro
  // user_subscriptions row so the owner can upload.
  const { error } = await service.from('user_subscriptions').upsert({
    user_id: userId,
    tier: 'pro',
    status: 'active',
    storage_used_bytes: 0,
  }, { onConflict: 'user_id' });
  if (error) {
    // Some envs may not have a check constraint or column shape; log and continue.
    console.warn(`[kal49] subscription upsert (${userId}) warn:`, error.message);
  }
}

async function createDocument(ownerUserId) {
  // Build a tiny 1-page PDF.
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('KAL-49 document lock state verifier', {
    x: 72,
    y: 720,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  });
  const bytes = await pdf.save();

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const name = `KAL49 Lock Verifier ${stamp}.pdf`;
  const filePath = `${ownerUserId}/kal49-lock/${stamp}.pdf`;

  const up = await service.storage
    .from('documents')
    .upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (up.error) throw up.error;

  const ins = await service
    .from('documents')
    .insert({
      user_id: ownerUserId,
      name,
      file_path: filePath,
      file_size: bytes.length,
      page_count: 1,
      is_survey_mode: false,
      current_page: 1,
      zoom_level: 100,
      tool_preferences: {},
      archived: false,
      first_opened_device: 'kal49-verify',
      first_opened_user_tier: 'pro',
      first_opened_app_version: '0.0.0-kal49',
    })
    .select()
    .single();
  if (ins.error) throw ins.error;
  return ins.data;
}

async function attachCollaborator(documentId, userId, email, role) {
  const { error } = await service
    .from('document_collaborators')
    .upsert({
      document_id: documentId,
      user_id: userId,
      email,
      role,
      status: 'active',
    }, { onConflict: 'document_id,user_id' });
  if (error) throw error;
}

async function cleanupDocument(documentId, filePath) {
  try {
    await service.from('document_annotations').delete().eq('document_id', documentId);
    await service.from('document_collaborators').delete().eq('document_id', documentId);
    await service.from('documents').delete().eq('id', documentId);
    if (filePath) {
      await service.storage.from('documents').remove([filePath]);
    }
    console.log('[kal49] document + storage cleaned');
  } catch (err) {
    console.warn('[kal49] cleanup document warn:', err?.message);
  }
}

async function startDevServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd: REPO_ROOT,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    const out = (chunk) => {
      const txt = chunk.toString();
      fs.appendFileSync(path.join(logDir, 'dev-server.log'), txt);
      if (!ready && /Local:\s+http/.test(txt)) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`vite exited early (${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error('vite did not announce readiness within 60s'));
    }, 60_000);
  });
}

async function openAs(browser, account, doc, label) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(({ creds }) => {
    window.localStorage.setItem('__fix20AuthOverride', JSON.stringify({
      email: creds.email,
      password: creds.password,
    }));
  }, { creds: { email: account.email, password: account.password } });
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (msg) => {
    const line = `[${label}] ${msg.type()} ${msg.text()}`;
    consoleLines.push(line);
  });
  page.on('pageerror', (err) => consoleLines.push(`[${label}] pageerror ${err.message}`));
  page.on('response', async (resp) => {
    try {
      if (resp.status() >= 400 && resp.url().includes('supabase.co')) {
        let body = '';
        try { body = await resp.text(); } catch { /* ignore */ }
        consoleLines.push(`[${label}] http ${resp.status()} ${resp.url()} :: ${body.slice(0, 500)}`);
      }
    } catch { /* ignore */ }
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__fix20OpenDocumentById === 'function', null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    try {
      return Object.keys(window.localStorage || {}).some((k) =>
        k.includes('auth-token') && window.localStorage.getItem(k)?.includes('"access_token"'),
      );
    } catch { return false; }
  }, null, { timeout: 60_000 });
  try {
    await page.evaluate((id) => window.__fix20OpenDocumentById(id), doc.id);
  } catch (err) {
    const msg = err?.message || String(err);
    const cleanedErr = await page.evaluate(async (id) => {
      try {
        const r = await window.__fix20OpenDocumentById(id);
        return { ok: true, r };
      } catch (e) {
        return { ok: false, error: { message: e?.message || String(e), name: e?.name, stack: e?.stack } };
      }
    }, doc.id);
    fs.writeFileSync(path.join(logDir, `${label}-console.log`), consoleLines.join('\n'));
    throw new Error(`openAs ${label}: ${msg} :: in-page: ${JSON.stringify(cleanedErr)}`);
  }
  await page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  // Allow YDocProvider + DocumentLockBanner to mount + fetch lock state.
  await sleep(2000);

  return { context, page, consoleLines, label };
}

async function screenshot(client, name) {
  const file = path.join(logDir, `${client.label}-${name}.png`);
  await client.page.screenshot({ path: file, fullPage: false });
  console.log(`[kal49] saved ${file}`);
  return file;
}

async function expectLockBanner(client, present) {
  const visible = await client.page.evaluate(() => !!document.querySelector('[data-testid="kal49-lock-banner"]'));
  if (visible !== present) {
    throw new Error(`${client.label}: lock banner present=${visible}, expected ${present}`);
  }
  return visible;
}

async function attemptAnnotationInsert(client, documentId) {
  // The app exposes `window.__kal49Harness.insertAnnotationProbe` in DEV mode
  // (App.jsx, alongside __fix20OpenDocumentById). That harness uses the same
  // imported supabase client the app uses for every other write, so the RLS
  // session context is identical to a real user action.
  return client.page.evaluate(async ({ documentId }) => {
    if (!window.__kal49Harness) {
      return { error: { message: 'kal49 harness not exposed' }, data: null };
    }
    return window.__kal49Harness.insertAnnotationProbe(documentId);
  }, { documentId });
}

const summary = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  logDir,
  accounts: {},
  document: null,
  screenshots: [],
  steps: [],
  failures: [],
  verdict: 'PENDING',
};

let devServer = null;
let browser = null;
let doc = null;

async function step(name, fn) {
  console.log(`[kal49] step: ${name}`);
  try {
    const out = await fn();
    summary.steps.push({ name, ok: true, out: out ?? null });
    return out;
  } catch (err) {
    console.error(`[kal49] step FAILED: ${name}: ${err?.message}`);
    summary.steps.push({ name, ok: false, error: err?.message });
    summary.failures.push({ name, error: err?.message });
    throw err;
  }
}

try {
  // Provision accounts
  for (const def of ROLE_DEFS) await provisionAccount(def);
  summary.accounts = accounts;
  await ensureSubscriptionPro(accounts.owner.userId);

  // Editor/viewer must also have pro subscriptions to be added as collaborators
  // (project enforces tier eligibility).
  await ensureSubscriptionPro(accounts.editor.userId);
  await ensureSubscriptionPro(accounts.viewer.userId);

  doc = await createDocument(accounts.owner.userId);
  summary.document = { id: doc.id, filePath: doc.file_path, name: doc.name };
  await attachCollaborator(doc.id, accounts.editor.userId, accounts.editor.email, 'editor');
  await attachCollaborator(doc.id, accounts.viewer.userId, accounts.viewer.email, 'viewer');
  console.log(`[kal49] doc id ${doc.id}`);

  const port = Number(new URL(BASE_URL).port) || 5360;
  devServer = await startDevServer(port);
  console.log(`[kal49] vite running on ${port}`);

  browser = await chromium.launch({ headless: true });

  // 1. Owner opens, sees the lock CHIP (not locked yet).
  const owner = await openAs(browser, accounts.owner, doc, 'owner');
  await step('owner sees lock chip', async () => {
    const chip = await owner.page.locator('[data-testid="kal49-lock-button"]').first();
    await chip.waitFor({ state: 'visible', timeout: 15_000 });
    summary.screenshots.push(await screenshot(owner, '1-pre-lock-chip'));
  });

  // 2. Owner accepts the prompt with empty label → lock.
  owner.page.once('dialog', async (d) => {
    // The dialog is the optional-label prompt — accept with a label.
    await d.accept('Verifier label');
  });
  await step('owner clicks lock', async () => {
    await owner.page.click('[data-testid="kal49-lock-button"]');
    await owner.page.waitForSelector('[data-testid="kal49-lock-banner"]', { timeout: 15_000 });
    await sleep(1000);
    summary.screenshots.push(await screenshot(owner, '2-post-lock-banner'));
  });

  // 3. Editor opens — should see banner.
  const editor = await openAs(browser, accounts.editor, doc, 'editor');
  await step('editor sees lock banner', async () => {
    await expectLockBanner(editor, true);
    const dimmed = await editor.page.evaluate(() => document.body.getAttribute('data-readonly') === 'true');
    if (!dimmed) throw new Error('editor: body[data-readonly] not set');
    summary.screenshots.push(await screenshot(editor, '3-editor-banner-dimmed'));
  });

  // 4. Editor attempts an annotation insert → RLS denies.
  await step('editor INSERT blocked by RLS while locked', async () => {
    const result = await attemptAnnotationInsert(editor, doc.id);
    summary.editorBlockedInsert = result;
    if (!result.error) {
      throw new Error(`editor insert was NOT blocked while locked: ${JSON.stringify(result)}`);
    }
    // 42501 = RLS row-level security violation.
    if (result.error.code !== '42501' && !/row-level security/i.test(result.error.message || '')) {
      throw new Error(`editor insert error was not RLS: ${JSON.stringify(result.error)}`);
    }
    console.log('[kal49] editor RLS deny confirmed:', JSON.stringify(result.error));
    summary.screenshots.push(await screenshot(editor, '4-editor-rls-blocked'));
  });

  // 5. Viewer opens — banner visible.
  const viewer = await openAs(browser, accounts.viewer, doc, 'viewer');
  await step('viewer sees lock banner', async () => {
    await expectLockBanner(viewer, true);
    summary.screenshots.push(await screenshot(viewer, '5-viewer-banner'));
  });

  // 6. Owner unlocks.
  owner.page.once('dialog', async (d) => d.accept());
  await step('owner unlocks', async () => {
    await owner.page.click('[data-testid="kal49-unlock-button"]');
    await owner.page.waitForSelector('[data-testid="kal49-lock-button"]', { timeout: 15_000 });
    await sleep(1000);
    summary.screenshots.push(await screenshot(owner, '6-post-unlock-chip'));
  });

  // 7. Editor reloads → banner gone.
  await step('editor reload — banner gone', async () => {
    await editor.page.reload({ waitUntil: 'domcontentloaded' });
    await editor.page.waitForFunction(() => typeof window.__fix20OpenDocumentById === 'function', null, { timeout: 60_000 });
    await editor.page.evaluate((id) => window.__fix20OpenDocumentById(id), doc.id);
    await editor.page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
    await sleep(2000);
    await expectLockBanner(editor, false);
    summary.screenshots.push(await screenshot(editor, '7-editor-post-unlock'));
  });

  // 8. Editor INSERT now succeeds.
  await step('editor INSERT succeeds post-unlock', async () => {
    const result = await attemptAnnotationInsert(editor, doc.id);
    summary.editorUnlockedInsert = result;
    if (result.error) {
      throw new Error(`editor insert FAILED post-unlock: ${JSON.stringify(result.error)}`);
    }
    summary.screenshots.push(await screenshot(editor, '8-editor-write-restored'));
  });

  summary.verdict = 'PASS';
} catch (err) {
  console.error('[kal49] run failed:', err?.message);
  console.error('[kal49] stack:', err?.stack);
  summary.verdict = summary.failures.length > 0 ? 'PARTIAL' : 'BLOCKED';
  summary.fatal = err?.message || String(err);
  summary.fatalStack = err?.stack || null;
} finally {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
  }
  if (devServer) {
    try { devServer.kill(); } catch { /* ignore */ }
  }
  if (doc) await cleanupDocument(doc.id, doc.file_path);
  await cleanupAccounts();
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(logDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`[kal49] verdict=${summary.verdict} screenshots=${summary.screenshots.length}`);
  console.log(`[kal49] summary written to ${path.join(logDir, 'summary.json')}`);
}
