// PDFs served from Cloudflare R2 (docs/PDF-R2.md), with the stack's MinIO
// standing in for R2 (scripts/e2e-minio.mjs). Supabase still decides who may
// open each file: pdf-file-url signs an R2 link only after Storage, asked with
// the caller's own token, says yes, and only for the current version.
import { RUN, addDocument, makeUser, must, signInToken } from './accountFixtures.mjs';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { adminClient, expect, functionUrl, openSampleDocument, signIn, test } from './helpers.mjs';
import { headObject, r2KeyForDocument } from '../../supabase/functions/_shared/r2.js';
import { E2E_R2, configFor } from '../../scripts/e2e-minio.mjs';

const R2_ENDPOINT = () => E2E_R2.R2_ENDPOINT;
const minio = () => configFor(R2_ENDPOINT());
const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;

const askLink = (token, path) => fetch(functionUrl('pdf-file-url'), {
  method: 'POST',
  headers: { apikey: KEY(), ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
  body: JSON.stringify({ path }),
});

// The first ask starts the copy and answers 202; ask until the link is there.
async function linkWhenCopied(token, path) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const res = await askLink(token, path);
    const body = await res.json();
    if (res.status === 200) return body;
    expect(res.status, JSON.stringify(body)).toBe(202);
    if (Date.now() > deadline) throw new Error('R2 copy never became ready');
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function minioUp() {
  try {
    await headObject(minio(), 'documents/__probe__');
    return true;
  } catch {
    return false;
  }
}

const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer());

test.beforeEach(async () => {
  test.skip(!(await minioUp()), 'MinIO is not running (scripts/e2e-minio.mjs)');
});

test('R2 links: only for people Storage lets in, only for the current version, removed after delete', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await makeUser(admin, 'r2-owner');
  const stranger = await makeUser(admin, 'r2-stranger');
  const doc = await addDocument(admin, owner, { name: `R2 file ${RUN}` });
  const ownerToken = await signInToken(owner);

  expect((await askLink(null, doc.filePath)).status).toBe(401);
  expect((await askLink(ownerToken, '../etc/passwd')).status).toBe(400);
  const refused = await askLink(await signInToken(stranger), doc.filePath);
  expect(refused.status).toBe(404);
  expect(await headObject(minio(), r2KeyForDocument(doc.filePath)), 'a refused ask copies nothing').toEqual({ exists: false });

  const link = await linkWhenCopied(ownerToken, doc.filePath);
  expect(new URL(link.url).origin).toBe(R2_ENDPOINT());
  const stored = await must('stored bytes', admin.storage.from('documents').download(doc.filePath));
  const original = new Uint8Array(await stored.arrayBuffer());
  const fromR2 = await fetch(link.url);
  expect(fromR2.status).toBe(200);
  expect(await bytesOf(fromR2)).toEqual(original);
  // pdf.js streams with range requests.
  const range = await fetch(link.url, { headers: { Range: 'bytes=0-3' } });
  expect(range.status).toBe(206);
  expect(new TextDecoder().decode(await bytesOf(range))).toBe('%PDF');
  // The link is the whole permission: change one character and R2 refuses it.
  const forged = link.url.replace(/X-Amz-Signature=(.)/, (m, c) => `X-Amz-Signature=${c === 'a' ? 'b' : 'a'}`);
  expect((await fetch(forged)).status).toBe(403);

  // A page edit rewrites the PDF in place: no link to the old copy, then a fresh one.
  const edited = new Blob(['%PDF-1.7\n% edited\n%%EOF\n'], { type: 'application/pdf' });
  await must('rewrite', admin.storage.from('documents').upload(doc.filePath, edited, { upsert: true, contentType: 'application/pdf' }));
  expect((await askLink(ownerToken, doc.filePath)).status).toBe(202);
  const fresh = await linkWhenCopied(ownerToken, doc.filePath);
  expect(new TextDecoder().decode(await bytesOf(await fetch(fresh.url)))).toContain('% edited');

  // Delete: the path is queued, no more links, and the sweep removes the copy.
  await must('delete', admin.storage.from('documents').remove([doc.filePath]));
  const queued = await must('queue', admin.from('pdf_r2_deletes').select('path').eq('path', doc.filePath));
  expect(queued).toHaveLength(1);
  expect((await askLink(ownerToken, doc.filePath)).status).toBe(404);
  const sweep = await fetch(functionUrl('archive-purge-sweep'), {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.E2E_SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 1 }),
  });
  const swept = await sweep.json();
  expect(sweep.status, JSON.stringify(swept)).toBe(200);
  expect(swept.r2_copies_removed).toBeGreaterThanOrEqual(1);
  expect(await headObject(minio(), r2KeyForDocument(doc.filePath))).toEqual({ exists: false });
  const left = await must('queue after', admin.from('pdf_r2_deletes').select('path').eq('path', doc.filePath));
  expect(left).toHaveLength(0);

  await admin.from('documents').delete().eq('id', doc.id);
  for (const user of [owner, stranger]) await admin.auth.admin.deleteUser(user.id);
});

test('with the pdf-r2 flag on, the app opens the drawing from R2, not Supabase', async ({ page }) => {
  test.setTimeout(120_000);
  if (process.env.E2E_FUNCTIONS_URL) {
    await page.route('**/functions/v1/pdf-file-url', (route) => route.fallback({ url: functionUrl('pdf-file-url') }));
  }
  const account = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const row = await must('seed doc', admin.from('documents').select('file_path').eq('id', E2E_DOCUMENT.id).single());
  await linkWhenCopied(await signInToken(account), row.file_path);

  await page.addInitScript(() => window.localStorage.setItem('survey.flag.pdf-r2', '1'));
  const fromR2 = [];
  const fromSupabase = [];
  page.on('requestfinished', async (request) => {
    const url = new URL(request.url());
    const response = await request.response();
    if (url.origin === R2_ENDPOINT()) fromR2.push(response?.status());
    if (/\/storage\/v1\/object\/(sign|authenticated)\/documents\//.test(url.pathname) && !url.pathname.endsWith('.json')) {
      fromSupabase.push(url.pathname);
    }
  });

  await signIn(page, account);
  await openSampleDocument(page);
  await expect.poll(() => fromR2.length, { message: 'the PDF bytes came from R2' }).toBeGreaterThan(0);
  expect(fromR2.every((status) => status === 200 || status === 206), String(fromR2)).toBe(true);
  expect(fromSupabase, 'no PDF bytes or signed link from Supabase Storage').toEqual([]);
});

test('with the flag on but R2 down, the app still opens the drawing from Supabase', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/functions/v1/pdf-file-url', (route) => route.fulfill({
    status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"r2_unavailable"}',
  }));
  await page.addInitScript(() => window.localStorage.setItem('survey.flag.pdf-r2', '1'));
  const fromR2 = [];
  page.on('request', (request) => { if (new URL(request.url()).origin === R2_ENDPOINT()) fromR2.push(request.url()); });

  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  expect(fromR2).toEqual([]);
});

// Never past Cloudflare's free tier (migration 20261028090000): r2_reserve
// refuses at 80% of each allowance and the app reads from Supabase instead.
test('free-tier cap: nobody but the service role reaches the ledger; past the cap R2 is left alone', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await makeUser(admin, 'r2-cap');
  const ownerToken = await signInToken(owner);
  const asOwner = { apikey: KEY(), authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' };
  const api = process.env.E2E_SUPABASE_URL;
  const reserveAs = (headers) => fetch(`${api}/rest/v1/rpc/r2_reserve`, {
    method: 'POST', headers, body: JSON.stringify({ p_class_a: 0, p_class_b: 0 }),
  });
  for (const headers of [{ apikey: KEY(), 'content-type': 'application/json' }, asOwner]) {
    const res = await reserveAs(headers);
    expect(res.status, await res.text()).not.toBe(200);
  }
  const read = await fetch(`${api}/rest/v1/r2_usage_daily?select=*`, { headers: asOwner });
  expect(read.status === 200 ? await read.json() : [], 'usage is hidden').toEqual([]);

  const current = await addDocument(admin, owner, { name: `R2 cap current ${RUN}` });
  const fresh = await addDocument(admin, owner, { name: `R2 cap new ${RUN}` });
  await linkWhenCopied(ownerToken, current.filePath);

  const [{ max_bytes: maxBytes, max_class_b: maxClassB }] = await must('limits', admin.rpc('r2_limits'));
  // Storage full: an existing copy still gets links, a new one is not made.
  const filler = `__e2e_filler__/${RUN}.pdf`;
  await must('fill storage', admin.from('pdf_r2_copies').insert({ path: filler, size: maxBytes }));
  try {
    expect((await askLink(ownerToken, current.filePath)).status).toBe(200);
    const refused = await askLink(ownerToken, fresh.filePath);
    expect(await refused.json()).toEqual({ error: 'r2_budget' });
    expect(refused.status).toBe(503);
    expect(await headObject(minio(), r2KeyForDocument(fresh.filePath)), 'nothing copied past the cap').toEqual({ exists: false });
  } finally {
    await admin.from('pdf_r2_copies').delete().eq('path', filler);
  }

  // Reads used up (a day still inside the rolling 31): no link at all, and
  // the app opens the drawing from Supabase without touching R2.
  const day = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const before = await must('usage before', admin.from('r2_usage_daily').select('*').eq('day', day));
  await must('use up reads', admin.from('r2_usage_daily').upsert({ day, class_a: 0, class_b: maxClassB }));
  try {
    const capped = await askLink(ownerToken, current.filePath);
    expect(await capped.json()).toEqual({ error: 'r2_budget' });

    if (process.env.E2E_FUNCTIONS_URL) {
      await page.route('**/functions/v1/pdf-file-url', (route) => route.fallback({ url: functionUrl('pdf-file-url') }));
    }
    await page.addInitScript(() => window.localStorage.setItem('survey.flag.pdf-r2', '1'));
    const fromR2 = [];
    const linkAnswers = [];
    page.on('request', (request) => { if (new URL(request.url()).origin === R2_ENDPOINT()) fromR2.push(request.url()); });
    page.on('response', (response) => { if (new URL(response.url()).pathname.endsWith('/pdf-file-url')) linkAnswers.push(response.status()); });
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSampleDocument(page);
    expect(linkAnswers, 'the app asked and was told no').toContain(503);
    expect(fromR2).toEqual([]);
  } finally {
    if (before.length) await admin.from('r2_usage_daily').upsert(before[0]);
    else await admin.from('r2_usage_daily').delete().eq('day', day);
  }

  await must('remove', admin.storage.from('documents').remove([current.filePath, fresh.filePath]));
  await admin.from('documents').delete().in('id', [current.id, fresh.id]);
  await admin.auth.admin.deleteUser(owner.id);
});
