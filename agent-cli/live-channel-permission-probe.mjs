// agent-cli/live-channel-permission-probe.mjs — w31 (2026-09-24): checks the
// realtime.messages policies behind the live-preview channel
// (`anno-live:<document uuid>`, supabase/migrations/
// 20260924230000_live_preview_channel_policies.sql) against the REAL private
// channel, with the app's own signed-in Supabase client.
//
// Uploads a THROWAWAY copy of a small PDF, then from two separate browser
// profiles (a sender and a listener, both on raw channels in hub pages, so no
// open viewer shares the topic):
//   1. unlocked: both join; a send is delivered;
//   2. locked (owner lock RPC, then both rejoin): both still join (receive
//      stays allowed) and a send is NOT delivered;
//   3. a document id nobody can open, and a malformed topic: the join is
//      refused.
// Then unlocks and deletes the throwaway (row + stored file).
//
//   node agent-cli/live-channel-permission-probe.mjs [--port 5341] [--headed]
//
// Signs in with the dev server's own owner sign-in (dev auto-login; owner-
// approved for throwaway copies only). Never types credentials.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const PORT = opt('port', '5341');
const BASE = `http://localhost:${PORT}/`;
const SOURCE = opt('pdf', 'debug/fixtures/print-fidelity.pdf');
const tag = crypto.randomBytes(4).toString('hex');
const docName = `w31-live-perm-${tag}.pdf`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w31-'));
const tmpPdf = path.join(tmpDir, docName);
fs.writeFileSync(tmpPdf, Buffer.concat([fs.readFileSync(SOURCE), Buffer.from(`\n%w31-throwaway-${tag}\n`)]));

const log = (...parts) => console.log(`[perm ${new Date().toISOString().slice(11, 23)}]`, ...parts);
const results = [];
const check = (ok, label, detail = '') => {
  results.push({ ok, label });
  log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function waitForHub(page) {
  await page.getByRole('heading', { name: 'Documents', exact: true }).first()
    .waitFor({ state: 'visible', timeout: 90_000 });
}

async function openHub(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(page);
  // The signed-in client must hold a session before any channel work.
  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js');
    for (let tries = 0; tries < 60; tries += 1) {
      const { data } = await supabase.auth.getSession();
      if (data?.session) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('not signed in');
  });
}

// Join `topic` privately on the page's own client; resolves to the join
// status (SUBSCRIBED / CHANNEL_ERROR + message / TIMED_OUT). Received probe
// messages collect in window.__w31Received[topic].
function join(page, topic) {
  return page.evaluate(async (topic) => {
    const { supabase } = await import('/src/supabaseClient.js');
    window.__w31Channels ??= {};
    window.__w31Received ??= {};
    const old = window.__w31Channels[topic];
    if (old) { await supabase.removeChannel(old); delete window.__w31Channels[topic]; }
    window.__w31Received[topic] = [];
    const channel = supabase.channel(topic, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    channel.on('broadcast', { event: 'w31-probe' }, (message) => {
      window.__w31Received[topic].push(message?.payload);
    });
    window.__w31Channels[topic] = channel;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ status: 'NO-ANSWER-15s' }), 15_000);
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          resolve({ status, error: error ? String(error.message || error) : null });
        }
      });
    });
  }, topic);
}

function send(page, topic, nonce) {
  return page.evaluate(async ({ topic, nonce }) => {
    const channel = window.__w31Channels?.[topic];
    if (!channel) return 'no-channel';
    return channel.send({ type: 'broadcast', event: 'w31-probe', payload: { nonce } });
  }, { topic, nonce });
}

async function received(page, topic, nonce, waitMs = 3_000) {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const got = await page.evaluate(({ topic, nonce }) => (
      (window.__w31Received?.[topic] || []).some((payload) => payload?.nonce === nonce)
    ), { topic, nonce });
    if (got) return Date.now() - start;
    await page.waitForTimeout(50);
  }
  return null;
}

async function leaveAll(page) {
  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js');
    for (const channel of Object.values(window.__w31Channels || {})) {
      await supabase.removeChannel(channel).catch(() => {});
    }
    window.__w31Channels = {};
  }).catch(() => {});
}

async function rpc(page, name, params) {
  return page.evaluate(async ({ name, params }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw new Error(error.message);
    return { lockedAt: data?.locked_at ?? null };
  }, { name, params });
}

async function deleteThrowaway(page, id, expectedName) {
  return page.evaluate(async ({ id, expectedName }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { purgeAnnotationDoc } = await import('/src/services/annotationDocSync.js');
    const { data: row, error: readError } = await supabase
      .from('documents').select('id,name,file_path,locked_at').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return { status: 'already-gone' };
    if (row.name !== expectedName || !/^w31-live-perm-/.test(row.name)) {
      throw new Error(`refusing to delete ${row.name}`);
    }
    if (row.locked_at) await supabase.rpc('kal49_unlock_document', { doc_id: id });
    const { error: deleteError } = await supabase.from('documents').delete().eq('id', id);
    if (deleteError) throw new Error(deleteError.message);
    const { data: sharer } = await supabase.from('documents').select('id')
      .eq('file_path', row.file_path).limit(1).maybeSingle();
    let storage = 'kept (shared)';
    if (!sharer) {
      const { error: storageError } = await supabase.storage.from('documents').remove([row.file_path]);
      storage = storageError ? `error ${storageError.message}` : 'removed';
    }
    try { await purgeAnnotationDoc(id); } catch { /* local copy only */ }
    const { data: remaining } = await supabase.from('documents').select('id').eq('id', id).maybeSingle();
    return { status: remaining ? 'STILL-PRESENT' : 'deleted', storage, filePath: row.file_path };
  }, { id, expectedName });
}

const browser = await chromium.launch({ headless: !args.includes('--headed') });
const ctxS = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxL = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const pageS = await ctxS.newPage();
let documentId = null;
pageS.on('request', (request) => {
  const match = request.url().match(/annotation_updates\?.*document_id=eq\.([0-9a-f-]{36})/);
  if (match && !documentId) documentId = match[1];
});
let exitCode = 0;
try {
  log(`upload ${docName}`);
  await openHub(pageS);
  await pageS.waitForTimeout(3_000);
  const chooser = pageS.waitForEvent('filechooser', { timeout: 15_000 });
  await pageS.getByRole('button', { name: 'Upload', exact: true }).first().click();
  await (await chooser).setFiles(tmpPdf);
  await pageS.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 90_000 });
  for (let tries = 0; tries < 40 && !documentId; tries += 1) await pageS.waitForTimeout(250);
  if (!documentId) throw new Error('no document id seen');
  log('documentId', documentId);
  await pageS.waitForTimeout(4_000); // let the open-time writes land
  await openHub(pageS); // leave the viewer: no app channel on the topic in this page
  const pageL = await ctxL.newPage();
  await openHub(pageL);
  const topic = `anno-live:${documentId}`;

  // 1. Unlocked.
  let joinS = await join(pageS, topic);
  let joinL = await join(pageL, topic);
  check(joinS.status === 'SUBSCRIBED', 'unlocked: sender joins the private channel', JSON.stringify(joinS));
  check(joinL.status === 'SUBSCRIBED', 'unlocked: listener joins the private channel', JSON.stringify(joinL));
  let nonce = crypto.randomUUID();
  let ack = await send(pageS, topic, nonce);
  let ms = await received(pageL, topic, nonce);
  check(ms != null, 'unlocked: a send is delivered', `ack=${ack}, arrived after ${ms} ms of polling`);

  // 2. Locked: policies are checked at join, so both rejoin after the lock.
  const locked = await rpc(pageS, 'kal49_lock_document', { doc_id: documentId, label: 'w31 probe' });
  log('locked at', locked.lockedAt);
  await leaveAll(pageS);
  await leaveAll(pageL);
  joinS = await join(pageS, topic);
  joinL = await join(pageL, topic);
  check(joinL.status === 'SUBSCRIBED', 'locked: a reader can still join (receive allowed)', JSON.stringify(joinL));
  log('locked: sender join', JSON.stringify(joinS));
  nonce = crypto.randomUUID();
  ack = await send(pageS, topic, nonce);
  ms = await received(pageL, topic, nonce, 4_000);
  check(ms == null, 'locked: a send is NOT delivered', `ack=${ack}${ms != null ? `, arrived after ${ms} ms` : ''}`);

  // 2b. Unlock and rejoin: sending works again (proves 2 was the lock).
  await rpc(pageS, 'kal49_unlock_document', { doc_id: documentId });
  await leaveAll(pageS);
  await leaveAll(pageL);
  joinS = await join(pageS, topic);
  joinL = await join(pageL, topic);
  nonce = crypto.randomUUID();
  ack = await send(pageS, topic, nonce);
  ms = await received(pageL, topic, nonce);
  check(ms != null, 'unlocked again: a send is delivered', `ack=${ack}`);
  await leaveAll(pageS);
  await leaveAll(pageL);

  // 3. Topics nobody here may open.
  const foreign = await join(pageL, `anno-live:${crypto.randomUUID()}`);
  check(foreign.status !== 'SUBSCRIBED', 'a document nobody can open: join refused', JSON.stringify(foreign));
  const malformed = await join(pageL, 'anno-live:not-a-uuid');
  check(malformed.status !== 'SUBSCRIBED', 'a malformed topic: join refused', JSON.stringify(malformed));
  await leaveAll(pageL);
} catch (error) {
  exitCode = 2;
  log('ERROR', error?.stack || error?.message);
} finally {
  if (documentId) {
    try {
      await openHub(pageS);
      log('cleanup:', JSON.stringify(await deleteThrowaway(pageS, documentId, docName)));
    } catch (error) {
      exitCode = 2;
      log('CLEANUP FAILED — delete by hand:', documentId, docName, error?.message);
    }
  }
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(exitCode || (failed.length ? 1 : 0));
