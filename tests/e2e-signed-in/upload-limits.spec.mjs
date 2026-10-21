// Upload abuse limits: each bucket refuses the wrong file types and oversized
// files, and a free account cannot go past its 100 MB plan quota.
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

const MB = 1024 * 1024;
const pdfBytes = (size) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  return new Blob([bytes], { type: 'application/pdf' });
};

async function signedIn(account) {
  const client = await apiClientFor(account);
  const { data } = await client.auth.getUser();
  return { client, userId: data.user.id };
}

async function clearFolder(admin, bucket, prefix) {
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  const names = (data || []).filter((o) => o.name.startsWith('upload-limits-')).map((o) => `${prefix}/${o.name}`);
  if (names.length) await admin.storage.from(bucket).remove(names);
}

test('the documents bucket takes PDFs only, up to 50 MB', async () => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const { client, userId } = await signedIn(E2E_ACCOUNTS.pro);
  const docs = client.storage.from('documents');
  try {
    const html = await docs.upload(`${userId}/upload-limits-${randomUUID()}.pdf`,
      new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), { contentType: 'text/html' });
    expect(html.error, 'HTML refused').toBeTruthy();
    const json = await docs.upload(`${userId}/upload-limits-${randomUUID()}.json`,
      new Blob(['{}'], { type: 'application/json' }), { contentType: 'application/json' });
    expect(json.error, 'JSON refused').toBeTruthy();
    const big = await docs.upload(`${userId}/upload-limits-${randomUUID()}.pdf`, pdfBytes(51 * MB), { contentType: 'application/pdf' });
    expect(big.error, 'over 50 MB refused').toBeTruthy();
    const ok = await docs.upload(`${userId}/upload-limits-${randomUUID()}.pdf`, pdfBytes(MB), { contentType: 'application/pdf' });
    expect(ok.error).toBeNull();
    const elsewhere = await docs.upload(`${randomUUID()}/upload-limits-${randomUUID()}.pdf`, pdfBytes(MB), { contentType: 'application/pdf' });
    expect(elsewhere.error, 'someone else\'s folder refused').toBeTruthy();
  } finally {
    await clearFolder(admin, 'documents', userId);
  }
});

test('a free account stops at its 100 MB quota', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const { client, userId } = await signedIn(E2E_ACCOUNTS.free);
  const docs = client.storage.from('documents');
  try {
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      const { error } = await docs.upload(`${userId}/upload-limits-${randomUUID()}.pdf`, pdfBytes(40 * MB), { contentType: 'application/pdf' });
      results.push(error ? 'refused' : 'stored');
    }
    expect(results).toEqual(['stored', 'stored', 'refused']);
  } finally {
    await clearFolder(admin, 'documents', userId);
  }
});

test('survey media takes photos, video and audio only, and only on documents you can edit', async () => {
  const { client } = await signedIn(E2E_ACCOUNTS.pro);
  const media = client.storage.from('survey-media');
  const path = `${randomUUID()}/item/${randomUUID()}.pdf`;
  const pdf = await media.upload(path, pdfBytes(MB), { contentType: 'application/pdf' });
  expect(pdf.error, 'PDF refused').toBeTruthy();
  const photo = await media.upload(`${randomUUID()}/item/${randomUUID()}.jpg`,
    new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
  expect(photo.error, 'photo on a document you cannot edit refused').toBeTruthy();
});

test('nobody signed in can write to the public brand bucket', async () => {
  const { client } = await signedIn(E2E_ACCOUNTS.pro);
  const { error } = await client.storage.from('brand').upload(`upload-limits-${randomUUID()}.svg`,
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), { contentType: 'image/svg+xml' });
  expect(error).toBeTruthy();
});
