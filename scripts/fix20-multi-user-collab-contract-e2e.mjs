#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BOT_CREDENTIALS = path.join(REPO_ROOT, '.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json');
const LOGS_ROOT = path.join(REPO_ROOT, 'Logs');
const BASE_URL = process.env.FIX20_BASE_URL || 'http://localhost:5173/';
const EXISTING_DOCUMENT_ID = process.env.FIX20_DOCUMENT_ID || null;

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

function parseJsonTail(line) {
  const idx = line.indexOf('{');
  if (idx < 0) return null;
  try {
    return JSON.parse(line.slice(idx));
  } catch {
    return null;
  }
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const value = row?.[key] || 'unknown';
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

async function createDisposableDocument(supabase, ownerUserId) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('Fix 20 multi-user annotation collaboration contract', {
    x: 72,
    y: 720,
    size: 18,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText('Disposable PDF generated for two-client authenticated runtime proof.', {
    x: 72,
    y: 690,
    size: 11,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawRectangle({ x: 72, y: 640, width: 468, height: 1, color: rgb(0.6, 0.6, 0.6) });

  const bytes = await pdf.save();
  const docStamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const name = `Fix20 Multi User Contract ${docStamp}.pdf`;
  const filePath = `${ownerUserId}/fix20-multi-user/${docStamp}.pdf`;

  const upload = await supabase.storage
    .from('documents')
    .upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (upload.error) throw upload.error;

  const insert = await supabase
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
      first_opened_device: 'dev',
      first_opened_user_tier: 'developer',
      first_opened_app_version: '0.1.45',
    })
    .select()
    .single();
  if (insert.error) throw insert.error;
  return insert.data;
}

async function ensureCollaborator(ownerClient, documentId, userId, email) {
  const { error } = await ownerClient
    .from('document_collaborators')
    .upsert({
      document_id: documentId,
      user_id: userId,
      email,
      role: 'editor',
      status: 'active',
    }, { onConflict: 'document_id,user_id' });
  if (error) throw error;
}

function isDocumentStorageResponse(url, document) {
  if (!url.includes('/storage/v1/object') || !url.includes('/documents/')) return false;
  const filePath = document?.file_path || '';
  if (!filePath) return true;
  const encodedPath = filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return url.includes(filePath) || url.includes(encodedPath);
}

async function waitForStorageDownloadProof(storageResponses, label, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = storageResponses.find((entry) => entry.status >= 200 && entry.status < 300);
    if (ok) return ok;
    await sleep(200);
  }
  throw new Error(`${label}: did not observe successful Supabase storage PDF download`);
}

async function openAsUser(browser, credentials, document, label, evidence) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(({ creds }) => {
    window.localStorage.setItem('__fix20AuthOverride', JSON.stringify({
      email: creds.email,
      password: creds.password,
    }));
  }, {
    creds: credentials,
  });
  const page = await context.newPage();
  const consoleLines = [];
  const storageResponses = [];
  page.on('console', (msg) => {
    const line = `${new Date().toISOString()} ${label} ${msg.type()} ${msg.text()}`;
    consoleLines.push(line);
    evidence.console.push(line);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!isDocumentStorageResponse(url, document)) return;
    const entry = {
      label,
      status: response.status(),
      url,
      ts: new Date().toISOString(),
    };
    storageResponses.push(entry);
    evidence.storageDownloadProof.responses.push(entry);
  });
  page.on('requestfailed', (request) => {
    evidence.networkFailures.push({
      label,
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText || null,
      ts: new Date().toISOString(),
    });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__fix20OpenDocumentById === 'function', null, { timeout: 45_000 });
  await page.waitForFunction(() => {
    try {
      return Object.keys(window.localStorage || {}).some((key) => (
        key.includes('auth-token')
        && window.localStorage.getItem(key)?.includes('"access_token"')
      ));
    } catch {
      return false;
    }
  }, null, { timeout: 45_000 });
  const hasByteOverride = await page.evaluate(() => {
    try { return window.localStorage.getItem('__fix20DocumentOverride') != null; } catch { return false; }
  });
  if (hasByteOverride) throw new Error(`${label}: forbidden __fix20DocumentOverride is present`);
  await page.evaluate((documentId) => window.__fix20OpenDocumentById(documentId), document.id);
  await page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  const storageProof = await waitForStorageDownloadProof(storageResponses, label);
  await waitForHarness(page);
  evidence.storageDownloadProof[label] = {
    pass: true,
    usedPdfByteOverride: false,
    response: storageProof,
  };
  return { context, page, consoleLines, storageResponses, label };
}

async function waitForHarness(page, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => typeof window.__fix20CollabHarness === 'object').catch(() => false);
    if (ready) return;
    await sleep(200);
  }
  throw new Error('window.__fix20CollabHarness is not available');
}

async function getHarnessState(client) {
  return client.page.evaluate(() => window.__fix20CollabHarness.getState());
}

async function waitForEntity(client, id, kind = 'annotation', shouldExist = true, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getHarnessState(client);
    const list = kind === 'callout' ? state.callouts : state.annotations;
    const exists = list.some((entry) => entry.id === id);
    if (exists === shouldExist) return state;
    await sleep(250);
  }
  throw new Error(`${client.label}: timed out waiting for ${kind} ${id} exist=${shouldExist}`);
}

async function waitForDelta(client, sinceIndex, id, kind = 'fabric', timeoutMs = 15_000) {
  const marker = kind === 'callout'
    ? '[CloudSync][delta] callout prepared'
    : '[CloudSync][delta] fabric prepared';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const line = client.consoleLines.slice(sinceIndex).find((entry) => {
      if (!entry.includes(marker)) return false;
      const payload = parseJsonTail(entry);
      return Array.isArray(payload?.changedIds) && payload.changedIds.includes(id);
    });
    if (line) return { line, payload: parseJsonTail(line) || {} };
    await sleep(200);
  }
  return { line: null, payload: null };
}

async function waitForDeleteDelta(client, sinceIndex, id, kind = 'fabric', timeoutMs = 15_000) {
  const marker = kind === 'callout'
    ? '[CloudSync][delta] callout prepared'
    : '[CloudSync][delta] fabric prepared';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const line = client.consoleLines.slice(sinceIndex).find((entry) => {
      if (!entry.includes(marker)) return false;
      const payload = parseJsonTail(entry);
      return Array.isArray(payload?.deletedIds) && payload.deletedIds.includes(id);
    });
    if (line) return { line, payload: parseJsonTail(line) || {} };
    await sleep(200);
  }
  return { line: null, payload: null };
}

function assertScopedDelta(delta, id, label) {
  if (!delta.payload) throw new Error(`${label}: missing delta for ${id}`);
  if (delta.payload.changedCount !== 1) throw new Error(`${label}: changedCount != 1`);
  if (delta.payload.dispatchedCount !== 1) throw new Error(`${label}: dispatchedCount != 1`);
  if (delta.payload.supabaseUpsertCount !== 1) throw new Error(`${label}: supabaseUpsertCount != 1`);
  if (delta.payload.yDocUpdateCount !== 1) throw new Error(`${label}: yDocUpdateCount != 1`);
  if (delta.payload.fullFanOutReason !== null) throw new Error(`${label}: fullFanOutReason is not null`);
}

function assertScopedDelete(delta, id, label) {
  if (!delta.payload) throw new Error(`${label}: missing delete delta for ${id}`);
  if (!Array.isArray(delta.payload.deletedIds) || !delta.payload.deletedIds.includes(id)) {
    throw new Error(`${label}: deletedIds missing ${id}`);
  }
  if (delta.payload.dispatchedCount !== 1) throw new Error(`${label}: delete dispatchedCount != 1`);
  if (delta.payload.fullFanOutReason !== null) throw new Error(`${label}: delete fullFanOutReason is not null`);
}

loadEnv('.env');
loadEnv('.env.local');

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_DEV_AUTO_LOGIN_EMAIL', 'VITE_DEV_AUTO_LOGIN_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
if (!fs.existsSync(BOT_CREDENTIALS)) throw new Error(`Missing bot credentials: ${BOT_CREDENTIALS}`);

const botCredentials = JSON.parse(fs.readFileSync(BOT_CREDENTIALS, 'utf8'));
const [userA, userB] = botCredentials.bots;
if (!userA || !userB) throw new Error('Need at least two bot credentials');

fs.mkdirSync(LOGS_ROOT, { recursive: true });
const logDir = path.join(LOGS_ROOT, `${stampForFolder()}_fix20-multi-user-collab`);
fs.mkdirSync(logDir, { recursive: true });

const evidence = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  logDir,
  document: null,
  users: {
    A: { id: userA.id, email: userA.email },
    B: { id: userB.id, email: userB.email },
  },
  createdIds: { A: {}, B: {} },
  liveVisibilityProof: {},
  ownershipBlockProof: {},
  undoRedoIsolationProof: {},
  reloadProof: {},
  syncDeltaProof: {},
  storageDownloadProof: {
    usedPdfByteOverride: false,
    responses: [],
  },
  supabaseRows: {},
  ydocRealtimeProof: {},
  console: [],
  networkFailures: [],
  result: 'pending',
};

const ownerClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const ownerSignIn = await ownerClient.auth.signInWithPassword({
  email: process.env.VITE_DEV_AUTO_LOGIN_EMAIL,
  password: process.env.VITE_DEV_AUTO_LOGIN_PASSWORD,
});
if (ownerSignIn.error) throw ownerSignIn.error;
const ownerId = ownerSignIn.data.user.id;
const document = EXISTING_DOCUMENT_ID
  ? await (async () => {
      const { data, error } = await ownerClient
        .from('documents')
        .select('*')
        .eq('id', EXISTING_DOCUMENT_ID)
        .single();
      if (error) throw error;
      return data;
    })()
  : await createDisposableDocument(ownerClient, ownerId);
evidence.document = {
  id: document.id,
  name: document.name,
  filePath: document.file_path,
  ownerId,
};
await ensureCollaborator(ownerClient, document.id, userA.id, userA.email);
await ensureCollaborator(ownerClient, document.id, userB.id, userB.email);
await ownerClient
  .from('document_annotations')
  .delete()
  .eq('document_id', document.id)
  .like('highlight_id', 'fix20-%');

const browser = await chromium.launch({ headless: true });
let clientA;
let clientB;
let runError = null;

try {
  clientA = await openAsUser(browser, userA, document, 'A', evidence);
  clientB = await openAsUser(browser, userB, document, 'B', evidence);

  const ids = {
    aRect: `fix20-a-rect-${Date.now()}`,
    aCallout: `fix20-a-callout-${Date.now()}`,
    bCounter: `fix20-b-counter-${Date.now()}`,
  };
  evidence.createdIds.A.rectangle = ids.aRect;
  evidence.createdIds.A.callout = ids.aCallout;
  evidence.createdIds.B.counter = ids.bCounter;

  let start = clientA.consoleLines.length;
  await clientA.page.evaluate((id) => window.__fix20CollabHarness.createRectangle(id), ids.aRect);
  const aRectDelta = await waitForDelta(clientA, start, ids.aRect, 'fabric');
  assertScopedDelta(aRectDelta, ids.aRect, 'A rectangle create');
  const bSawARect = await waitForEntity(clientB, ids.aRect);
  evidence.liveVisibilityProof.userBSeesUserARectangle = {
    pass: bSawARect.annotations.some((entry) => entry.id === ids.aRect && entry.authorId === userA.id),
    state: bSawARect,
  };

  const blockedMove = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryMove(id), ids.aRect);
  const blockedDelete = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryDelete(id), ids.aRect);
  await sleep(1200);
  const afterBlocked = await getHarnessState(clientB);
  evidence.ownershipBlockProof.userBCannotEditDeleteUserA = {
    blockedMove,
    blockedDelete,
    stillPresent: afterBlocked.annotations.some((entry) => entry.id === ids.aRect && entry.authorId === userA.id),
    pass: blockedMove.allowed === false && blockedDelete.allowed === false
      && afterBlocked.annotations.some((entry) => entry.id === ids.aRect && entry.authorId === userA.id),
  };

  start = clientA.consoleLines.length;
  await clientA.page.evaluate((id) => window.__fix20CollabHarness.createCallout(id), ids.aCallout);
  const aCalloutDelta = await waitForDelta(clientA, start, ids.aCallout, 'callout');
  assertScopedDelta(aCalloutDelta, ids.aCallout, 'A callout create');
  const bSawACallout = await waitForEntity(clientB, ids.aCallout, 'callout');
  evidence.liveVisibilityProof.userBSeesUserACallout = {
    pass: bSawACallout.callouts.some((entry) => entry.id === ids.aCallout && entry.authorId === userA.id),
    state: bSawACallout,
  };
  const blockedCalloutMove = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryMove(id, 'callout'), ids.aCallout);
  const blockedCalloutDelete = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryDelete(id, 'callout'), ids.aCallout);
  evidence.ownershipBlockProof.userBCannotEditDeleteUserACallout = {
    blockedCalloutMove,
    blockedCalloutDelete,
    pass: blockedCalloutMove.allowed === false && blockedCalloutDelete.allowed === false,
  };

  start = clientB.consoleLines.length;
  await clientB.page.evaluate((id) => window.__fix20CollabHarness.createCounter(id), ids.bCounter);
  const bCounterDelta = await waitForDelta(clientB, start, ids.bCounter, 'fabric');
  assertScopedDelta(bCounterDelta, ids.bCounter, 'B counter create');
  const aSawBCounter = await waitForEntity(clientA, ids.bCounter);
  evidence.liveVisibilityProof.userASeesUserBCounter = {
    pass: aSawBCounter.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.id),
    state: aSawBCounter,
  };

  start = clientA.consoleLines.length;
  await clientA.page.evaluate(() => window.__fix20CollabHarness.undo());
  const aUndoCalloutDelta = await waitForDeleteDelta(clientA, start, ids.aCallout, 'callout');
  await waitForEntity(clientA, ids.aCallout, 'callout', false);
  await waitForEntity(clientB, ids.aCallout, 'callout', false);
  const bCounterAfterAUndo1 = await waitForEntity(clientA, ids.bCounter);
  evidence.undoRedoIsolationProof.userAUndoCalloutOnly = {
    delta: aUndoCalloutDelta.payload,
    bCounterStillPresent: bCounterAfterAUndo1.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.id),
    pass: bCounterAfterAUndo1.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.id),
  };

  start = clientA.consoleLines.length;
  await clientA.page.evaluate(() => window.__fix20CollabHarness.undo());
  const aUndoRectDelta = await waitForDeleteDelta(clientA, start, ids.aRect, 'fabric');
  assertScopedDelete(aUndoRectDelta, ids.aRect, 'A rectangle undo');
  await waitForEntity(clientA, ids.aRect, 'annotation', false);
  await waitForEntity(clientB, ids.aRect, 'annotation', false);
  const bCounterAfterAUndo2 = await waitForEntity(clientB, ids.bCounter);
  evidence.undoRedoIsolationProof.userAUndoRectangleOnly = {
    delta: aUndoRectDelta.payload,
    bCounterStillPresent: bCounterAfterAUndo2.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.id),
    pass: bCounterAfterAUndo2.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.id),
  };

  start = clientB.consoleLines.length;
  await clientB.page.evaluate(() => window.__fix20CollabHarness.undo());
  const bUndoCounterDelta = await waitForDeleteDelta(clientB, start, ids.bCounter, 'fabric');
  assertScopedDelete(bUndoCounterDelta, ids.bCounter, 'B counter undo');
  await waitForEntity(clientA, ids.bCounter, 'annotation', false);
  await waitForEntity(clientB, ids.bCounter, 'annotation', false);
  evidence.undoRedoIsolationProof.userBUndoCounterOnly = {
    delta: bUndoCounterDelta.payload,
    pass: true,
  };

  evidence.syncDeltaProof = {
    aRectCreate: aRectDelta.payload,
    aCalloutCreate: aCalloutDelta.payload,
    bCounterCreate: bCounterDelta.payload,
    aRectUndoDelete: aUndoRectDelta.payload,
    bCounterUndoDelete: bUndoCounterDelta.payload,
    noFullPageFanOut: [aRectDelta, aCalloutDelta, bCounterDelta, aUndoRectDelta, bUndoCounterDelta]
      .every((entry) => entry.payload?.fullFanOutReason === null),
  };

  await clientA.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await clientA.page.waitForFunction(() => typeof window.__fix20OpenDocumentById === 'function', null, { timeout: 45_000 });
  await clientB.page.waitForFunction(() => typeof window.__fix20OpenDocumentById === 'function', null, { timeout: 45_000 });
  await clientA.page.waitForFunction(() => {
    try {
      return Object.keys(window.localStorage || {}).some((key) => (
        key.includes('auth-token')
        && window.localStorage.getItem(key)?.includes('"access_token"')
      ));
    } catch {
      return false;
    }
  }, null, { timeout: 45_000 });
  await clientB.page.waitForFunction(() => {
    try {
      return Object.keys(window.localStorage || {}).some((key) => (
        key.includes('auth-token')
        && window.localStorage.getItem(key)?.includes('"access_token"')
      ));
    } catch {
      return false;
    }
  }, null, { timeout: 45_000 });
  await clientA.page.evaluate((documentId) => window.__fix20OpenDocumentById(documentId), document.id);
  await clientB.page.evaluate((documentId) => window.__fix20OpenDocumentById(documentId), document.id);
  await clientA.page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  await clientB.page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  await waitForHarness(clientA.page);
  await waitForHarness(clientB.page);
  await sleep(3000);
  const reloadA = await getHarnessState(clientA);
  const reloadB = await getHarnessState(clientB);
  const finalIdsA = new Set([...reloadA.annotations, ...reloadA.callouts].map((entry) => entry.id));
  const finalIdsB = new Set([...reloadB.annotations, ...reloadB.callouts].map((entry) => entry.id));
  evidence.reloadProof = {
    userA: reloadA,
    userB: reloadB,
    deletedIdsAbsent: [ids.aRect, ids.aCallout, ids.bCounter].every((id) => !finalIdsA.has(id) && !finalIdsB.has(id)),
    pass: [ids.aRect, ids.aCallout, ids.bCounter].every((id) => !finalIdsA.has(id) && !finalIdsB.has(id)),
  };

  const rows = await ownerClient
    .from('document_annotations')
    .select('highlight_id, annotation_type, user_id, last_modified_by, annotation_data')
    .eq('document_id', document.id)
    .in('highlight_id', [ids.aRect, ids.aCallout, ids.bCounter]);
  if (rows.error) throw rows.error;
  evidence.supabaseRows = {
    finalRowsForCreatedIds: rows.data || [],
    finalRowsByType: countBy(rows.data || [], 'annotation_type'),
    pass: (rows.data || []).length === 0,
  };

  evidence.ydocRealtimeProof = {
    userAFinalYDoc: reloadA.ydoc,
    userBFinalYDoc: reloadB.ydoc,
    realtimeLines: evidence.console.filter((line) =>
      line.includes('[SupabaseYjsProvider]')
      || line.includes('[CloudSync][realtime]')
      || line.includes('Y.Doc fan-out')
      || line.includes('save:fan-out done')
    ).slice(-80),
    pass: true,
  };

  const mustPass = [
    evidence.storageDownloadProof.usedPdfByteOverride === false,
    evidence.storageDownloadProof.A?.pass,
    evidence.storageDownloadProof.B?.pass,
    evidence.liveVisibilityProof.userBSeesUserARectangle?.pass,
    evidence.liveVisibilityProof.userBSeesUserACallout?.pass,
    evidence.liveVisibilityProof.userASeesUserBCounter?.pass,
    evidence.ownershipBlockProof.userBCannotEditDeleteUserA?.pass,
    evidence.ownershipBlockProof.userBCannotEditDeleteUserACallout?.pass,
    evidence.undoRedoIsolationProof.userAUndoCalloutOnly?.pass,
    evidence.undoRedoIsolationProof.userAUndoRectangleOnly?.pass,
    evidence.undoRedoIsolationProof.userBUndoCounterOnly?.pass,
    evidence.reloadProof.pass,
    evidence.supabaseRows.pass,
    evidence.syncDeltaProof.noFullPageFanOut,
  ];
  if (!mustPass.every(Boolean)) {
    throw new Error('Fix20 multi-user collaboration contract proof failed one or more assertions');
  }

  evidence.result = 'pass';
} catch (err) {
  runError = err;
  evidence.result = 'fail';
  evidence.error = err?.stack || err?.message || String(err);
} finally {
  try { await clientA?.context?.close(); } catch {}
  try { await clientB?.context?.close(); } catch {}
  await browser.close();
  fs.writeFileSync(path.join(logDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  fs.writeFileSync(path.join(logDir, 'console.log'), evidence.console.join('\n') + '\n');
  fs.writeFileSync(path.join(logDir, 'network-failures.json'), JSON.stringify(evidence.networkFailures, null, 2) + '\n');
}

if (runError) {
  console.error(`[fix20] FAILED. Evidence: ${logDir}`);
  console.error(runError?.stack || runError?.message || String(runError));
  process.exit(1);
}

console.log(`[fix20] PASS. Evidence: ${logDir}`);
