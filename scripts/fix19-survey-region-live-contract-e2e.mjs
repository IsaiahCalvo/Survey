#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import { loadVerifiedTestAccounts } from './test-account-lease.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOGS_ROOT = path.join(REPO_ROOT, 'Logs');
const BASE_URL = process.env.FIX19_BASE_URL || 'http://localhost:5173/';

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

async function createDisposableDocument(supabase, userId) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('Fix 19 survey/region live contract proof', {
    x: 72,
    y: 720,
    size: 18,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText('Disposable authenticated PDF for scoped annotation verification.', {
    x: 72,
    y: 690,
    size: 11,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawRectangle({ x: 72, y: 640, width: 468, height: 1, color: rgb(0.6, 0.6, 0.6) });

  const bytes = await pdf.save();
  const docStamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const name = `Fix19 Survey Region Contract ${docStamp}.pdf`;
  const filePath = `${userId}/fix19-survey-region/${docStamp}.pdf`;

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
      user_id: userId,
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

async function waitForCloudDeltaForId(consoleLines, sinceIndex, id, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matchingLine = consoleLines.slice(sinceIndex).find((line) => {
      if (!line.includes('[CloudSync][delta] fabric prepared')) return false;
      const payload = parseJsonTail(line);
      return Array.isArray(payload?.changedIds) && payload.changedIds.includes(id);
    });
    if (matchingLine) {
      return { line: matchingLine, payload: parseJsonTail(matchingLine) || {} };
    }
    await sleep(150);
  }
  return { line: null, payload: null };
}

async function waitForHook(page, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => typeof window.__fix19SurveyRegionHarness === 'object').catch(() => false);
    if (ready) return;
    await sleep(200);
  }
  throw new Error('window.__fix19SurveyRegionHarness is not available');
}

async function captureVisibility(page, label) {
  await sleep(450);
  return page.evaluate((contextLabel) => {
    const ids = {
      regular: 'fix19-regular-annotation',
      survey: 'fix19-survey-annotation',
      region: 'fix19-region-annotation',
      surveyRegion: 'fix19-survey-region-annotation',
      surveyHighlight: 'fix19-survey-highlight',
    };
    const visibleAnnotation = (id) => !!document.querySelector(`svg[data-svg-annotation-layer] [data-anno-id="${CSS.escape(id)}"]`);
    const visibleHighlight = (id) => !!document.querySelector(`svg[data-svg-annotation-layer] [data-shape-id="${CSS.escape(id)}"]`);
    return {
      label: contextLabel,
      context: {
        selectedModuleId: window.__diagState?.selectedModuleId || null,
        showSurveyPanel: window.__diagState?.showSurveyPanel === true,
        selectedSpaceId: window.__diagState?.annotationSpaceId || null,
        activeSpaceId: window.__diagState?.activeSpaceId || null,
        activeRegionId: window.__diagState?.activeRegionId || null,
      },
      visible: {
        regular: visibleAnnotation(ids.regular),
        survey: visibleAnnotation(ids.survey),
        region: visibleAnnotation(ids.region),
        surveyRegion: visibleAnnotation(ids.surveyRegion),
        surveyHighlight: visibleHighlight(ids.surveyHighlight),
      },
      selectedCount: document.querySelectorAll('.svg-selection-overlay, [data-selected="true"], [data-selection-overlay]').length,
      svgFilterStats: window.__diagSVGFilterStats?.[1] || null,
      surveyHighlightStats: window.__diagSurveyHighlightVisibilityStats?.[1] || null,
    };
  }, label);
}

function assertVisibility(snapshot, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (snapshot.visible[key] !== value) {
      throw new Error(`${snapshot.label}: expected ${key} visible=${value}, got ${snapshot.visible[key]}`);
    }
  }
}

loadEnv('.env');
loadEnv('.env.local');

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const [leasedAccount] = loadVerifiedTestAccounts();

fs.mkdirSync(LOGS_ROOT, { recursive: true });
const logDir = path.join(LOGS_ROOT, `${stampForFolder()}_fix19-survey-region-live`);
fs.mkdirSync(logDir, { recursive: true });

const consoleLines = [];
const network = [];
const failures = [];
const evidence = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  logDir,
  document: null,
  fixture: null,
  syncProof: {},
  visibilityProof: [],
  selectionClearProof: null,
  finalRowsByType: {},
  networkFailedRequestCount: 0,
  networkFailedSupabaseWriteCount: 0,
  consoleErrorCount: 0,
  wholePageFanOut: false,
};

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const signIn = await supabase.auth.signInWithPassword({
  email: leasedAccount.email,
  password: leasedAccount.password,
});
if (signIn.error) throw signIn.error;
const userId = signIn.data.user.id;
if (userId !== leasedAccount.userId) {
  throw new Error(`Leased account identity mismatch for ${leasedAccount.email}`);
}
const document = await createDisposableDocument(supabase, userId);
evidence.document = {
  id: document.id,
  name: document.name,
  filePath: document.file_path,
  fileSize: document.file_size,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const projectRef = new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
await page.addInitScript(({ key, session, account }) => {
  window.localStorage.setItem(key, JSON.stringify(session));
  window.localStorage.setItem('__fix20AuthOverride', JSON.stringify(account));
}, {
  key: `sb-${projectRef}-auth-token`,
  session: signIn.data.session,
  account: { email: leasedAccount.email, password: leasedAccount.password },
});

page.on('console', (msg) => {
  consoleLines.push(`${new Date().toISOString()} ${msg.type()} ${msg.text()}`);
});
page.on('request', (request) => {
  network.push({ event: 'request', method: request.method(), url: request.url(), ts: new Date().toISOString() });
});
page.on('response', (response) => {
  network.push({ event: 'response', status: response.status(), ok: response.ok(), url: response.url(), ts: new Date().toISOString() });
});
page.on('requestfailed', (request) => {
  const row = {
    event: 'requestfailed',
    method: request.method(),
    url: request.url(),
    failure: request.failure()?.errorText || null,
    ts: new Date().toISOString(),
  };
  failures.push(row);
  network.push(row);
});

let runError = null;
try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(4_000);
  const browserUserId = await page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      try { return JSON.parse(window.localStorage.getItem(key))?.user?.id || null; } catch {}
    }
    return null;
  });
  if (browserUserId !== leasedAccount.userId) {
    throw new Error(`Browser session does not match leased account ${leasedAccount.email}`);
  }
  await page.getByText(document.name, { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  await waitForHook(page);
  await sleep(2_000);

  evidence.fixture = await page.evaluate(() => window.__fix19SurveyRegionHarness.setup());
  await sleep(800);

  const scopedCreates = [
    ['regular', 'fix19-regular-annotation'],
    ['survey', 'fix19-survey-annotation'],
    ['region', 'fix19-region-annotation'],
    ['survey-region', 'fix19-survey-region-annotation'],
  ];

  for (const [scope, id] of scopedCreates) {
    const startIndex = consoleLines.length;
    await page.evaluate(({ scope, id }) => window.__fix19SurveyRegionHarness.createAnnotation({ scope, id }), { scope, id });
    const delta = await waitForCloudDeltaForId(consoleLines, startIndex, id, 12_000);
    evidence.syncProof[scope] = {
      id,
      changedCount: delta.payload?.changedCount ?? null,
      supabaseUpsertCount: delta.payload?.supabaseUpsertCount ?? null,
      yDocUpdateCount: delta.payload?.yDocUpdateCount ?? null,
      fullFanOutReason: delta.payload?.fullFanOutReason ?? null,
      line: delta.line,
      pass: delta.payload?.changedCount === 1
        && delta.payload?.supabaseUpsertCount === 1
        && delta.payload?.yDocUpdateCount === 1
        && delta.payload?.fullFanOutReason === null,
    };
  }

  const highlightResult = await page.evaluate(() =>
    window.__fix19SurveyRegionHarness.createSurveyHighlight({ id: 'fix19-survey-highlight' })
  );
  evidence.syncProof.surveyHighlight = {
    id: 'fix19-survey-highlight',
    changedCount: highlightResult.sync.changedCount,
    supabaseUpsertCount: highlightResult.sync.supabaseUpsertCount,
    yDocUpdateCount: highlightResult.sync.yDocUpdateCount,
    fullFanOutReason: highlightResult.sync.fullFanOutReason,
    pass: highlightResult.sync.success
      && highlightResult.sync.changedCount === 1
      && highlightResult.sync.supabaseUpsertCount === 1
      && highlightResult.sync.yDocUpdateCount === null
      && highlightResult.sync.fullFanOutReason === null,
  };

  const setContext = async (context) => {
    await page.evaluate((nextContext) => window.__fix19SurveyRegionHarness.setContext(nextContext), context);
    await sleep(700);
  };

  await setContext({ showSurveyPanel: false, moduleId: null, selectedSpaceId: null, activeSpaceId: null, activeRegionId: null });
  const normal = await captureVisibility(page, 'normal mode');
  assertVisibility(normal, { regular: true, survey: false, region: false, surveyRegion: false, surveyHighlight: false });
  evidence.visibilityProof.push(normal);

  await page.evaluate(() => window.__fix19SelectAnnotation?.('fix19-regular-annotation'));
  await sleep(500);
  const selectedBeforeSwitch = await captureVisibility(page, 'selected before mode switch');

  await setContext({ showSurveyPanel: true, moduleId: 'fix19-module-a', selectedSpaceId: null, activeSpaceId: null, activeRegionId: null });
  const survey = await captureVisibility(page, 'correct survey module');
  assertVisibility(survey, { regular: false, survey: true, region: false, surveyRegion: false, surveyHighlight: true });
  evidence.visibilityProof.push(survey);
  evidence.selectionClearProof = {
    selectedBeforeSwitch: selectedBeforeSwitch.selectedCount,
    selectedAfterSwitch: survey.selectedCount,
    pass: selectedBeforeSwitch.selectedCount > 0 && survey.selectedCount === 0,
  };

  await setContext({ showSurveyPanel: true, moduleId: 'fix19-module-b', selectedSpaceId: null, activeSpaceId: null, activeRegionId: null });
  const wrongSurvey = await captureVisibility(page, 'wrong survey module');
  assertVisibility(wrongSurvey, { survey: false, surveyHighlight: false, surveyRegion: false });
  evidence.visibilityProof.push(wrongSurvey);

  await setContext({ showSurveyPanel: false, moduleId: null, selectedSpaceId: 'fix19-space-a', activeSpaceId: 'fix19-space-a', activeRegionId: 'fix19-region-a' });
  const region = await captureVisibility(page, 'correct region');
  assertVisibility(region, { region: true, surveyRegion: false, survey: false, surveyHighlight: false });
  evidence.visibilityProof.push(region);

  await setContext({ showSurveyPanel: false, moduleId: null, selectedSpaceId: 'fix19-space-b', activeSpaceId: 'fix19-space-b', activeRegionId: 'fix19-region-b' });
  const wrongRegion = await captureVisibility(page, 'wrong region');
  assertVisibility(wrongRegion, { region: false, surveyRegion: false });
  evidence.visibilityProof.push(wrongRegion);

  await setContext({ showSurveyPanel: true, moduleId: 'fix19-module-a', selectedSpaceId: 'fix19-space-a', activeSpaceId: 'fix19-space-a', activeRegionId: 'fix19-region-a' });
  const surveyRegion = await captureVisibility(page, 'correct survey and region');
  assertVisibility(surveyRegion, { survey: true, region: true, surveyRegion: true, surveyHighlight: true });
  evidence.visibilityProof.push(surveyRegion);

  await setContext({ showSurveyPanel: true, moduleId: 'fix19-module-b', selectedSpaceId: 'fix19-space-a', activeSpaceId: 'fix19-space-a', activeRegionId: 'fix19-region-a' });
  const wrongSurveyRightRegion = await captureVisibility(page, 'wrong survey with correct region');
  assertVisibility(wrongSurveyRightRegion, { survey: false, surveyRegion: false, surveyHighlight: false });
  evidence.visibilityProof.push(wrongSurveyRightRegion);

  const rowQuery = await supabase
    .from('document_annotations')
    .select('highlight_id, annotation_type, page_number, module_id, space_id, annotation_data')
    .eq('document_id', document.id);
  if (rowQuery.error) throw rowQuery.error;
  evidence.finalRowsByType = countBy(rowQuery.data || [], 'annotation_type');
  evidence.finalRows = rowQuery.data || [];
} catch (err) {
  runError = err;
  evidence.error = err?.stack || err?.message || String(err);
} finally {
  await browser.close().catch(() => {});
}

evidence.endedAt = new Date().toISOString();
evidence.networkFailedRequestCount = failures.length;
evidence.networkFailedSupabaseWriteCount = failures.filter((row) =>
  ['POST', 'PATCH', 'PUT', 'DELETE'].includes(String(row.method || '').toUpperCase())
  && /supabase/i.test(row.url || '')
  && /document_annotations|doc_yjs_updates|doc_yjs_state/i.test(row.url || '')
).length;
evidence.consoleErrorCount = consoleLines.filter((line) =>
  /\bconsole\.error\b|\bUncaught\b|\bTypeError\b|\bReferenceError\b|^.* error /i.test(line)
).length;
evidence.wholePageFanOut = consoleLines.some((line) =>
  line.includes('[CloudSync][delta]') && !line.includes('"fullFanOutReason":null')
);
evidence.pass = !runError
  && Object.values(evidence.syncProof).every((proof) => proof?.pass)
  && evidence.selectionClearProof?.pass === true
  && evidence.networkFailedSupabaseWriteCount === 0
  && evidence.consoleErrorCount === 0
  && !evidence.wholePageFanOut;

fs.writeFileSync(path.join(logDir, 'console.log'), `${consoleLines.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(logDir, 'network.json'), JSON.stringify(network, null, 2), 'utf8');
fs.writeFileSync(path.join(logDir, 'fix19-survey-region-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
fs.writeFileSync(path.join(logDir, 'summary.json'), JSON.stringify({
  url: BASE_URL,
  document: evidence.document,
  networkFailedRequestCount: evidence.networkFailedRequestCount,
  networkFailedSupabaseWriteCount: evidence.networkFailedSupabaseWriteCount,
  consoleErrorCount: evidence.consoleErrorCount,
  wholePageFanOut: evidence.wholePageFanOut,
  pass: evidence.pass,
  savedAtIso: new Date().toISOString(),
  snapshotName: path.basename(logDir),
}, null, 2), 'utf8');

console.log(JSON.stringify({
  pass: evidence.pass,
  logDir,
  document: evidence.document,
  syncProof: Object.fromEntries(Object.entries(evidence.syncProof).map(([key, proof]) => [key, {
    pass: proof.pass,
    changedCount: proof.changedCount,
    supabaseUpsertCount: proof.supabaseUpsertCount,
    yDocUpdateCount: proof.yDocUpdateCount,
    fullFanOutReason: proof.fullFanOutReason,
  }])),
  visibilityProof: evidence.visibilityProof.map((snapshot) => ({
    label: snapshot.label,
    visible: snapshot.visible,
    selectedCount: snapshot.selectedCount,
  })),
  selectionClearProof: evidence.selectionClearProof,
  finalRowsByType: evidence.finalRowsByType,
  networkFailedSupabaseWriteCount: evidence.networkFailedSupabaseWriteCount,
  consoleErrorCount: evidence.consoleErrorCount,
  wholePageFanOut: evidence.wholePageFanOut,
  error: evidence.error || null,
}, null, 2));

if (runError) process.exit(1);
if (!evidence.pass) process.exit(2);
