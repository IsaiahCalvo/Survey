#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  assertBrowserUsesLeasedAccount,
  installLeasedBrowserAccount,
} from '../agent-cli/lib/leased-browser-session.mjs';
import { loadVerifiedTestAccounts } from './test-account-lease.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOGS_ROOT = path.join(REPO_ROOT, 'Logs');
const BASE_URL = process.env.FIX20_BASE_URL || 'http://localhost:5173/';
const CHROME_EXECUTABLE = process.env.FIX20_CHROME_EXECUTABLE || null;

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

function pgHexToBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string') throw new Error('Expected PostgreSQL bytea hex string');
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid PostgreSQL bytea hex');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

// Store v2 (2026-09-24): a mark is a nested Y.Map { p, o: Y.Map }.
const durableObject = (value) => {
  if (value && typeof value.toJSON === 'function' && typeof value.get === 'function') {
    return value.toJSON()?.o || null;
  }
  return value?.o || value;
};

function durableAnnotationId(key, value) {
  const object = durableObject(value);
  const id = object?.data?.id ?? object?.id ?? object?.annotationId ?? object?.pdfAnnotationId;
  return id == null ? String(key) : String(id);
}

function durableAnnotationAuthorId(value) {
  const object = durableObject(value);
  return object?.meta?.authorId
    ?? object?.data?.authorId
    ?? object?.data?.userId
    ?? object?.authorId
    ?? null;
}

async function loadDurableAnnotationState(supabase, documentId) {
  const snapshotResult = await supabase
    .from('annotation_snapshots')
    .select('snapshot, at_seq, encoding_version')
    .eq('document_id', documentId)
    .maybeSingle();
  if (snapshotResult.error) throw snapshotResult.error;

  const doc = new Y.Doc();
  const atSeq = Number(snapshotResult.data?.at_seq) || 0;
  if (snapshotResult.data?.snapshot) {
    let bytes = pgHexToBytes(snapshotResult.data.snapshot);
    if (Number(snapshotResult.data.encoding_version) === 2) {
      bytes = new Uint8Array(gunzipSync(bytes));
    }
    Y.applyUpdate(doc, bytes);
  }

  const updatesResult = await supabase
    .from('annotation_updates')
    .select('seq, data')
    .eq('document_id', documentId)
    .gt('seq', atSeq)
    .order('seq', { ascending: true });
  if (updatesResult.error) throw updatesResult.error;
  for (const row of updatesResult.data || []) {
    Y.applyUpdate(doc, pgHexToBytes(row.data));
  }

  const entries = [...doc.getMap('annotations').entries()].map(([key, value]) => ({
    key: String(key),
    annotationId: durableAnnotationId(key, value),
    authorId: durableAnnotationAuthorId(value),
    value,
  }));
  return {
    snapshotAtSeq: atSeq,
    updateCount: (updatesResult.data || []).length,
    entries,
  };
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
  if (insert.error) {
    const cleanup = await supabase.storage.from('documents').remove([filePath]);
    if (cleanup.error) {
      throw new Error(
        `Document row insert failed (${insert.error.message}); partial upload cleanup also failed (${cleanup.error.message})`,
      );
    }
    throw insert.error;
  }
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

async function openAsUser(browser, credentials, accountIndex, document, label, evidence) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const leasedAccount = await installLeasedBrowserAccount(context, { accountIndex });
  if (leasedAccount.userId !== credentials.userId || leasedAccount.email !== credentials.email) {
    throw new Error(`${label}: verified lease account changed before browser launch`);
  }
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
  await assertBrowserUsesLeasedAccount(page, { account: credentials, timeoutMs: 45_000 });
  const hasByteOverride = await page.evaluate(() => {
    try { return window.localStorage.getItem('__fix20DocumentOverride') != null; } catch { return false; }
  });
  if (hasByteOverride) throw new Error(`${label}: forbidden __fix20DocumentOverride is present`);
  await page.evaluate((documentId) => window.__fix20OpenDocumentById(documentId), document.id);
  await page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 60_000 });
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

async function createCircleThroughProductionUi(client, timeoutMs = 20_000) {
  const before = await getHarnessState(client);
  const existingIds = new Set(before.annotations.map((entry) => entry.id));

  await client.page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await client.page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  const page = client.page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await page.waitFor({ state: 'visible', timeout: 20_000 });
  const box = await page.boundingBox();
  if (!box) throw new Error('Production PDF page has no drawable geometry');

  await client.page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.34);
  await client.page.mouse.down();
  await client.page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.48, { steps: 8 });
  await client.page.mouse.up();

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getHarnessState(client);
    const created = state.annotations.find((entry) => !existingIds.has(entry.id));
    if (created) return created;
    await sleep(200);
  }
  throw new Error('Production Ellipse tool did not commit a new annotation');
}

loadEnv('.env');
loadEnv('.env.local');

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const [userA, userB] = loadVerifiedTestAccounts({ minimumAccounts: 2 });

fs.mkdirSync(LOGS_ROOT, { recursive: true });
const logDir = path.join(LOGS_ROOT, `${stampForFolder()}_fix20-multi-user-collab`);
fs.mkdirSync(logDir, { recursive: true });

const evidence = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  logDir,
  document: null,
  users: {
    A: { id: userA.userId, email: userA.email },
    B: { id: userB.userId, email: userB.email },
  },
  createdIds: { A: {}, B: {} },
  liveVisibilityProof: {},
  exactlyOnceProof: {},
  ownershipBlockProof: {},
  ownerDeleteIsolationProof: {},
  reloadProof: {},
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

const ownerClient = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
const ownerId = userA.userId;
if (process.env.FIX20_DOCUMENT_ID) {
  throw new Error('FIX20_DOCUMENT_ID is forbidden; this harness only uses disposable leased-owner documents');
}

let document;
let browser;
let clientA;
let clientB;
let runError = null;

try {
  const ownerLookup = await ownerClient.auth.admin.getUserById(userA.userId);
  if (ownerLookup.error) throw ownerLookup.error;
  if (
    ownerLookup.data.user?.id !== userA.userId
    || ownerLookup.data.user?.email?.toLowerCase() !== userA.email.toLowerCase()
  ) {
    throw new Error('Service-role setup did not resolve the exact leased owner account');
  }
  document = await createDisposableDocument(ownerClient, ownerId);
  evidence.document = {
    id: document.id,
    name: document.name,
    filePath: document.file_path,
    ownerId,
  };
  await ensureCollaborator(ownerClient, document.id, userA.userId, userA.email);
  await ensureCollaborator(ownerClient, document.id, userB.userId, userB.email);
  const preflightCleanup = await ownerClient
    .from('document_annotations')
    .delete()
    .eq('document_id', document.id)
    .like('annotation_id', 'fix20-%');
  if (preflightCleanup.error) throw preflightCleanup.error;

  browser = await chromium.launch({
    headless: true,
    ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
  });
  clientA = await openAsUser(browser, userA, 0, document, 'A', evidence);
  clientB = await openAsUser(browser, userB, 1, document, 'B', evidence);

  const ids = {
    aCircle: null,
    bCircle: null,
    aRect: `fix20-a-rect-${Date.now()}`,
    aCallout: `fix20-a-callout-${Date.now()}`,
    bCounter: `fix20-b-counter-${Date.now()}`,
  };
  const createdCircle = await createCircleThroughProductionUi(clientA);
  ids.aCircle = createdCircle.id;
  evidence.createdIds.A.circle = ids.aCircle;
  const bSawACircle = await waitForEntity(clientB, ids.aCircle);
  evidence.liveVisibilityProof.userBSeesUserACircleExactlyOnce = {
    pass: bSawACircle.annotations.filter(
      (entry) => entry.id === ids.aCircle && entry.authorId === userA.userId,
    ).length === 1,
    state: bSawACircle,
  };
  const createdCollaboratorCircle = await createCircleThroughProductionUi(clientB);
  ids.bCircle = createdCollaboratorCircle.id;
  evidence.createdIds.B.circle = ids.bCircle;
  const aSawBCircle = await waitForEntity(clientA, ids.bCircle);
  evidence.liveVisibilityProof.userASeesUserBCircleExactlyOnce = {
    pass: aSawBCircle.annotations.filter(
      (entry) => entry.id === ids.bCircle && entry.authorId === userB.userId,
    ).length === 1,
    state: aSawBCircle,
  };
  evidence.createdIds.A.rectangle = ids.aRect;
  evidence.createdIds.A.callout = ids.aCallout;
  evidence.createdIds.B.counter = ids.bCounter;

  await clientA.page.evaluate((id) => window.__fix20CollabHarness.createRectangle(id), ids.aRect);
  const bSawARect = await waitForEntity(clientB, ids.aRect);
  evidence.liveVisibilityProof.userBSeesUserARectangle = {
    pass: bSawARect.annotations.some((entry) => entry.id === ids.aRect && entry.authorId === userA.userId),
    state: bSawARect,
  };

  const blockedMove = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryMove(id), ids.aRect);
  const blockedDelete = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryDelete(id), ids.aRect);
  await sleep(1200);
  const afterBlocked = await getHarnessState(clientB);
  evidence.ownershipBlockProof.userBCannotEditDeleteUserA = {
    blockedMove,
    blockedDelete,
    stillPresent: afterBlocked.annotations.some((entry) => entry.id === ids.aRect && entry.authorId === userA.userId),
    pass: blockedMove.allowed === false && blockedDelete.allowed === false
      && afterBlocked.annotations.some((entry) => entry.id === ids.aRect && entry.authorId === userA.userId),
  };

  await clientA.page.evaluate((id) => window.__fix20CollabHarness.createCallout(id), ids.aCallout);
  const bSawACallout = await waitForEntity(clientB, ids.aCallout, 'callout');
  evidence.liveVisibilityProof.userBSeesUserACallout = {
    pass: bSawACallout.callouts.some((entry) => entry.id === ids.aCallout && entry.authorId === userA.userId),
    state: bSawACallout,
  };
  const blockedCalloutMove = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryMove(id, 'callout'), ids.aCallout);
  const blockedCalloutDelete = await clientB.page.evaluate((id) => window.__fix20CollabHarness.tryDelete(id, 'callout'), ids.aCallout);
  evidence.ownershipBlockProof.userBCannotEditDeleteUserACallout = {
    blockedCalloutMove,
    blockedCalloutDelete,
    pass: blockedCalloutMove.allowed === false && blockedCalloutDelete.allowed === false,
  };

  await clientB.page.evaluate((id) => window.__fix20CollabHarness.createCounter(id), ids.bCounter);
  const aSawBCounter = await waitForEntity(clientA, ids.bCounter);
  evidence.liveVisibilityProof.userASeesUserBCounter = {
    pass: aSawBCounter.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.userId),
    state: aSawBCounter,
  };

  const aDeleteCallout = await clientA.page.evaluate(
    (id) => window.__fix20CollabHarness.tryDelete(id, 'callout'),
    ids.aCallout,
  );
  await waitForEntity(clientA, ids.aCallout, 'callout', false);
  await waitForEntity(clientB, ids.aCallout, 'callout', false);
  const bCounterAfterADeleteCallout = await waitForEntity(clientA, ids.bCounter);
  evidence.ownerDeleteIsolationProof.userADeletesOwnCalloutOnly = {
    result: aDeleteCallout,
    bCounterStillPresent: bCounterAfterADeleteCallout.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.userId),
    pass: aDeleteCallout.allowed === true
      && bCounterAfterADeleteCallout.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.userId),
  };

  const aDeleteRect = await clientA.page.evaluate(
    (id) => window.__fix20CollabHarness.tryDelete(id),
    ids.aRect,
  );
  await waitForEntity(clientA, ids.aRect, 'annotation', false);
  await waitForEntity(clientB, ids.aRect, 'annotation', false);
  const bCounterAfterADeleteRect = await waitForEntity(clientB, ids.bCounter);
  evidence.ownerDeleteIsolationProof.userADeletesOwnRectangleOnly = {
    result: aDeleteRect,
    bCounterStillPresent: bCounterAfterADeleteRect.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.userId),
    pass: aDeleteRect.allowed === true
      && bCounterAfterADeleteRect.annotations.some((entry) => entry.id === ids.bCounter && entry.authorId === userB.userId),
  };

  const bDeleteCounter = await clientB.page.evaluate(
    (id) => window.__fix20CollabHarness.tryDelete(id),
    ids.bCounter,
  );
  await waitForEntity(clientA, ids.bCounter, 'annotation', false);
  await waitForEntity(clientB, ids.bCounter, 'annotation', false);
  evidence.ownerDeleteIsolationProof.userBDeletesOwnCounterOnly = {
    result: bDeleteCounter,
    pass: bDeleteCounter.allowed === true,
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
  await clientA.page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 60_000 });
  await clientB.page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 60_000 });
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
    circlesExactlyOnce: [ids.aCircle, ids.bCircle].every(
      (id) => reloadA.annotations.filter((entry) => entry.id === id).length === 1
        && reloadB.annotations.filter((entry) => entry.id === id).length === 1,
    ),
    pass: [ids.aRect, ids.aCallout, ids.bCounter].every((id) => !finalIdsA.has(id) && !finalIdsB.has(id))
      && reloadA.annotations.filter(
        (entry) => entry.id === ids.aCircle && entry.authorId === userA.userId,
      ).length === 1
      && reloadB.annotations.filter(
        (entry) => entry.id === ids.aCircle && entry.authorId === userA.userId,
      ).length === 1
      && reloadA.annotations.filter(
        (entry) => entry.id === ids.bCircle && entry.authorId === userB.userId,
      ).length === 1
      && reloadB.annotations.filter(
        (entry) => entry.id === ids.bCircle && entry.authorId === userB.userId,
      ).length === 1,
  };

  const durableState = await loadDurableAnnotationState(ownerClient, document.id);
  const durableCreatedRows = durableState.entries.filter((entry) => (
    [ids.aCircle, ids.bCircle, ids.aRect, ids.aCallout, ids.bCounter].includes(entry.annotationId)
  ));
  const durableACircle = durableCreatedRows.filter(
    (entry) => entry.annotationId === ids.aCircle && entry.authorId === userA.userId,
  );
  const durableBCircle = durableCreatedRows.filter(
    (entry) => entry.annotationId === ids.bCircle && entry.authorId === userB.userId,
  );
  evidence.supabaseRows = {
    durableSnapshotAtSeq: durableState.snapshotAtSeq,
    durableUpdateCount: durableState.updateCount,
    finalRowsForCreatedIds: durableCreatedRows,
    pass: durableCreatedRows.length === 2
      && durableACircle.length === 1
      && durableBCircle.length === 1,
  };
  evidence.exactlyOnceProof = {
    ownerLiveReplicaCount: bSawACircle.annotations.filter((entry) => entry.id === ids.aCircle).length,
    collaboratorLiveReplicaCount: aSawBCircle.annotations.filter((entry) => entry.id === ids.bCircle).length,
    ownerShapeOwnerReloadCount: reloadA.annotations.filter((entry) => entry.id === ids.aCircle).length,
    ownerShapeCollaboratorReloadCount: reloadB.annotations.filter((entry) => entry.id === ids.aCircle).length,
    collaboratorShapeOwnerReloadCount: reloadA.annotations.filter((entry) => entry.id === ids.bCircle).length,
    collaboratorShapeCollaboratorReloadCount: reloadB.annotations.filter((entry) => entry.id === ids.bCircle).length,
    ownerShapeDurableBackendCount: durableCreatedRows.filter(
      (entry) => entry.annotationId === ids.aCircle,
    ).length,
    collaboratorShapeDurableBackendCount: durableCreatedRows.filter(
      (entry) => entry.annotationId === ids.bCircle,
    ).length,
  };
  evidence.exactlyOnceProof.pass = Object.values(evidence.exactlyOnceProof)
    .filter((value) => typeof value === 'number')
    .every((value) => value === 1);

  const circleDelete = await clientA.page.evaluate(
    (id) => window.__fix20CollabHarness.tryDelete(id),
    ids.aCircle,
  );
  await waitForEntity(clientA, ids.aCircle, 'annotation', false);
  await waitForEntity(clientB, ids.aCircle, 'annotation', false);
  const collaboratorCircleDelete = await clientB.page.evaluate(
    (id) => window.__fix20CollabHarness.tryDelete(id),
    ids.bCircle,
  );
  await waitForEntity(clientA, ids.bCircle, 'annotation', false);
  await waitForEntity(clientB, ids.bCircle, 'annotation', false);
  const durableStateAfterDelete = await loadDurableAnnotationState(ownerClient, document.id);
  const circleRowsAfterDelete = durableStateAfterDelete.entries.filter(
    (entry) => [ids.aCircle, ids.bCircle].includes(entry.annotationId),
  );
  evidence.productionCircleCleanup = {
    circleDelete,
    collaboratorCircleDelete,
    remainingRows: circleRowsAfterDelete,
    pass: circleDelete.allowed === true
      && collaboratorCircleDelete.allowed === true
      && circleRowsAfterDelete.length === 0,
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
    evidence.liveVisibilityProof.userBSeesUserACircleExactlyOnce?.pass,
    evidence.liveVisibilityProof.userASeesUserBCircleExactlyOnce?.pass,
    evidence.liveVisibilityProof.userBSeesUserARectangle?.pass,
    evidence.liveVisibilityProof.userBSeesUserACallout?.pass,
    evidence.liveVisibilityProof.userASeesUserBCounter?.pass,
    evidence.ownershipBlockProof.userBCannotEditDeleteUserA?.pass,
    evidence.ownershipBlockProof.userBCannotEditDeleteUserACallout?.pass,
    evidence.ownerDeleteIsolationProof.userADeletesOwnCalloutOnly?.pass,
    evidence.ownerDeleteIsolationProof.userADeletesOwnRectangleOnly?.pass,
    evidence.ownerDeleteIsolationProof.userBDeletesOwnCounterOnly?.pass,
    evidence.reloadProof.pass,
    evidence.supabaseRows.pass,
    evidence.exactlyOnceProof.pass,
    evidence.productionCircleCleanup.pass,
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
  try { await browser?.close(); } catch {}
  if (document) {
    const storageCleanup = await ownerClient.storage.from('documents').remove([document.file_path]);
    const documentCleanup = await ownerClient.from('documents').delete().eq('id', document.id);
    evidence.disposableCleanup = {
      documentId: document.id,
      filePath: document.file_path,
      documentRemoved: !documentCleanup.error,
      storageRemoved: !storageCleanup.error,
      pass: !documentCleanup.error && !storageCleanup.error,
      errors: [storageCleanup.error?.message, documentCleanup.error?.message].filter(Boolean),
    };
  } else {
    evidence.disposableCleanup = {
      documentId: null,
      filePath: null,
      documentRemoved: true,
      storageRemoved: true,
      pass: true,
      errors: [],
    };
  }
  if (!evidence.disposableCleanup.pass && !runError) {
    runError = new Error(`Disposable cleanup failed: ${evidence.disposableCleanup.errors.join('; ')}`);
    evidence.result = 'fail';
    evidence.error = runError.message;
  }
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
