// "Download my data": the export-account function hands back every row the
// person owns plus short links to their stored files, and Account settings
// zips them into one download.
import crypto from 'node:crypto';
import JSZip from 'jszip';
import {
  RUN, addDocument, addMarkup, addMedia, makeUser, must, signInToken,
} from './accountFixtures.mjs';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { agentSignIn } from './agentAuth.mjs';
import { adminClient, expect, functionUrl, profileChip, signIn, test } from './helpers.mjs';

const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;
const exportAccount = (token) => fetch(functionUrl('export-account'), {
  method: 'POST',
  headers: { apikey: KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: '{}',
});

test('the export holds the person\'s rows and files, and nobody else\'s', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const person = await makeUser(admin, 'export-person');
  const friend = await makeUser(admin, 'export-friend');

  const project = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: project, user_id: person.id, name: `Export project ${RUN}` }));
  const own = await addDocument(admin, person, { projectId: project, name: `Export file ${RUN}` });
  const ownMedia = await addMedia(admin, own.id);
  const ownMarkup = await addMarkup(admin, own.id, person);
  // The friend's file the person drew on: their markup comes along, the file does not.
  const shared = await addDocument(admin, friend, { name: `Friend file ${RUN}` });
  await must('share', admin.from('document_collaborators').insert({
    document_id: shared.id, user_id: person.id, invited_by: friend.id, role: 'editor', email: person.email, status: 'active',
  }));
  const markupOnShared = await addMarkup(admin, shared.id, person);
  const friendMarkupOnShared = await addMarkup(admin, shared.id, friend);
  const friendMedia = await addMedia(admin, shared.id);

  const { tok } = await agentSignIn(page, person, `Export agent ${RUN}`);
  expect((await exportAccount(tok.access_token)).status, 'agents cannot export').toBe(403);
  expect((await exportAccount('not-a-token')).status).toBe(401);

  const res = await exportAccount(await signInToken(person));
  expect(res.status, await res.clone().text()).toBe(200);
  const body = await res.json();
  expect(body.format).toBe(1);
  expect(body.account).toMatchObject({ id: person.id, email: person.email });
  expect(body.tables.projects.map((p) => p.id)).toEqual([project]);
  expect(body.tables.documents.map((d) => d.id)).toEqual([own.id]);
  const markupIds = body.tables.document_annotations.map((a) => a.annotation_id).sort();
  expect(markupIds).toEqual([ownMarkup, markupOnShared].sort());
  expect(markupIds).not.toContain(friendMarkupOnShared);
  expect(body.tables.document_collaborators.some((c) => c.document_id === shared.id)).toBe(true);
  // No sign-in secrets ride along.
  expect(JSON.stringify(body.tables.connected_services)).not.toMatch(/token/i);

  const files = body.files.map((f) => `${f.bucket}/${f.path}`).sort();
  expect(files).toEqual([`documents/${own.filePath}`, `survey-media/${ownMedia}`].sort());
  expect(files).not.toContain(`documents/${shared.filePath}`);
  expect(files).not.toContain(`survey-media/${friendMedia}`);
  const pdf = body.files.find((f) => f.path === own.filePath);
  const download = await fetch(pdf.url);
  expect(download.ok).toBe(true);
  expect((await download.text()).startsWith('%PDF')).toBe(true);

  for (const user of [person, friend]) await admin.auth.admin.deleteUser(user.id);
  await admin.storage.from('documents').remove([own.filePath, shared.filePath]);
  await admin.storage.from('survey-media').remove([ownMedia, friendMedia]);
});

test('Download my data in Account settings saves one ZIP', async ({ page }) => {
  test.setTimeout(120_000);
  // Where the stack's edge runtime is off, send the app's call to the hand-served function.
  if (process.env.E2E_FUNCTIONS_URL) {
    await page.route('**/functions/v1/export-account', (route) => route.fallback({ url: functionUrl('export-account') }));
  }
  const account = E2E_ACCOUNTS.owner;
  await signIn(page, account);
  await profileChip(page, account).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^Survey data \d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText('Your data was saved as a ZIP file.')).toBeVisible();

  const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile(await file.path()));
  const data = JSON.parse(await zip.file('data.json').async('string'));
  expect(data.account.email).toBe(account.email);
  expect(data.documents.map((d) => d.id)).toContain(E2E_DOCUMENT.id);
  expect(zip.file('README.txt')).toBeTruthy();
  expect(zip.file('errors.txt')).toBeNull();
  const pdf = await zip.file(`Documents/${E2E_PROJECT.name}/${E2E_DOCUMENT.name}`).async('uint8array');
  expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
});
