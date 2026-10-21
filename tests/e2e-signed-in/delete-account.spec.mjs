// Deleting an account (App Store / Play rule): the delete-account function
// removes every row and stored file the person owns, cuts off their agents,
// and leaves the people they shared with their own files and markup.
import crypto from 'node:crypto';
import { agentSignIn } from './agentAuth.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const API = () => process.env.E2E_SUPABASE_URL;
const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;
const RUN = crypto.randomBytes(3).toString('hex');
const PDF = new Blob(['%PDF-1.7\n%%EOF\n'], { type: 'application/pdf' });
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])], { type: 'image/jpeg' });

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function makeUser(admin, name) {
  const account = { email: `delete-${name}-${RUN}@example.test`, password: `Pw-${crypto.randomUUID()}` };
  const { user } = await must(`create ${name}`, admin.auth.admin.createUser({ ...account, email_confirm: true }));
  return { ...account, id: user.id };
}

async function signInToken(account) {
  const res = await fetch(`${API()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const body = await res.json();
  expect(body.access_token, JSON.stringify(body)).toBeTruthy();
  return body.access_token;
}

// The stack's edge runtime serves the function; E2E_FUNCTIONS_URL points at a
// hand-served copy where that runtime cannot start.
const FUNCTION_URL = () => process.env.E2E_FUNCTIONS_URL || `${API()}/functions/v1/delete-account`;
const deleteAccount = (token, body = { confirmation: 'DELETE' }) => fetch(FUNCTION_URL(), {
  method: 'POST',
  headers: { apikey: KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function addDocument(admin, owner, { projectId = null, name }) {
  const id = crypto.randomUUID();
  const filePath = `${owner.id}/${id}.pdf`;
  await must('upload pdf', admin.storage.from('documents').upload(filePath, PDF, { contentType: 'application/pdf' }));
  await must('document row', admin.from('documents').insert({
    id, user_id: owner.id, project_id: projectId, name, file_path: filePath, file_size: PDF.size, page_count: 1,
  }));
  return { id, filePath };
}

// Survey media is keyed by document, whoever took the photo.
async function addMedia(admin, documentId) {
  const path = `${documentId}/marker-${RUN}/${crypto.randomUUID()}.jpg`;
  await must('upload media', admin.storage.from('survey-media').upload(path, JPEG, { contentType: 'image/jpeg' }));
  return path;
}

async function addMarkup(admin, documentId, author) {
  const annotationId = `delete-${RUN}-${crypto.randomUUID()}`;
  await must('annotation', admin.from('document_annotations').insert({
    document_id: documentId, user_id: author.id, annotation_id: annotationId, annotation_type: 'survey-marker',
    page_number: 1, bounds: { x: 1, y: 1, width: 10, height: 10 }, annotation_data: { type: 'rect' },
  }));
  return annotationId;
}

async function exists(admin, bucket, path) {
  const slash = path.lastIndexOf('/');
  const { data } = await admin.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1) });
  return (data || []).some((o) => o.name === path.slice(slash + 1));
}

test('deleting an account removes everything the person owns, and only that', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const leaver = await makeUser(admin, 'leaver');
  const friend = await makeUser(admin, 'friend');

  // The leaver's own project, file, nested legacy file, media and markup.
  const project = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: project, user_id: leaver.id, name: `Leaver project ${RUN}` }));
  const own = await addDocument(admin, leaver, { projectId: project, name: `Leaver file ${RUN}` });
  const nested = `${leaver.id}/older/${crypto.randomUUID()}.pdf`;
  await must('nested pdf', admin.storage.from('documents').upload(nested, PDF, { contentType: 'application/pdf' }));
  const ownMedia = await addMedia(admin, own.id);
  const friendMediaOnOwn = await addMedia(admin, own.id);
  const ownMarkup = await addMarkup(admin, own.id, leaver);
  // The leaver shared their file with the friend.
  await must('share own', admin.from('document_collaborators').insert({
    document_id: own.id, user_id: friend.id, invited_by: leaver.id, role: 'editor', email: friend.email, status: 'active',
  }));

  // The friend's file the leaver worked on, and a friend file filed in the leaver's project.
  const shared = await addDocument(admin, friend, { name: `Friend file ${RUN}` });
  await must('share friend', admin.from('document_collaborators').insert({
    document_id: shared.id, user_id: leaver.id, invited_by: friend.id, role: 'editor', email: leaver.email, status: 'active',
  }));
  const leaverMarkupOnShared = await addMarkup(admin, shared.id, leaver);
  const leaverMediaOnShared = await addMedia(admin, shared.id);
  const friendInLeaverProject = await addDocument(admin, friend, { projectId: project, name: `Friend filed ${RUN}` });

  await must('email log', admin.from('email_send_events').insert({ user_id: leaver.id, template: 'invite', recipient: friend.email }));

  // An outside AI agent the leaver let in.
  const { clientId, tok } = await agentSignIn(page, leaver, `Leaver agent ${RUN}`);
  const token = await signInToken(leaver);

  // The function refuses the agent, and refuses without the typed confirmation.
  expect((await deleteAccount(tok.access_token)).status).toBe(403);
  expect((await deleteAccount(token, {})).status).toBe(400);

  const res = await deleteAccount(token);
  expect(res.status, await res.clone().text()).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });

  // The person, their rows and their files are gone.
  const { data: gone } = await admin.auth.admin.getUserById(leaver.id);
  expect(gone?.user ?? null).toBeNull();
  expect(await must('docs', admin.from('documents').select('id').eq('user_id', leaver.id))).toEqual([]);
  expect(await must('projects', admin.from('projects').select('id').eq('id', project))).toEqual([]);
  expect(await must('markup', admin.from('document_annotations').select('id').eq('annotation_id', ownMarkup))).toEqual([]);
  expect(await must('email log', admin.from('email_send_events').select('id').eq('user_id', leaver.id))).toEqual([]);
  expect(await must('shares', admin.from('document_collaborators').select('id').eq('document_id', own.id))).toEqual([]);
  for (const [bucket, path] of [['documents', own.filePath], ['documents', nested], ['survey-media', ownMedia], ['survey-media', friendMediaOnOwn]]) {
    expect(await exists(admin, bucket, path), `${bucket}/${path} removed`).toBe(false);
  }

  // The friend keeps their files, the leaver's markup and media on them, and
  // the file they had filed in the leaver's project.
  expect(await exists(admin, 'documents', shared.filePath)).toBe(true);
  expect(await exists(admin, 'documents', friendInLeaverProject.filePath)).toBe(true);
  expect(await exists(admin, 'survey-media', leaverMediaOnShared)).toBe(true);
  const markup = await must('kept markup', admin.from('document_annotations').select('user_id').eq('annotation_id', leaverMarkupOnShared));
  expect(markup).toEqual([{ user_id: friend.id }]);
  const filed = await must('filed doc', admin.from('documents').select('project_id').eq('id', friendInLeaverProject.id));
  expect(filed).toEqual([{ project_id: null }]);
  // Filing it in the leaver's project made the leaver its owner; the friend is now.
  const filedPeople = await must('filed people', admin.from('document_collaborators')
    .select('user_id, role').eq('document_id', friendInLeaverProject.id));
  expect(filedPeople).toEqual([{ user_id: friend.id, role: 'owner' }]);

  // The old session and the agent are both cut off.
  for (const bearer of [token, tok.access_token]) {
    const me = await fetch(`${API()}/auth/v1/user`, { headers: { apikey: KEY(), authorization: `Bearer ${bearer}` } });
    expect(me.status, 'token refused after deletion').toBeGreaterThanOrEqual(401);
  }
  const refresh = await fetch(`${API()}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { apikey: KEY(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }),
  });
  expect(refresh.ok, 'agent refresh refused').toBe(false);

  await admin.auth.admin.deleteUser(friend.id);
  await admin.storage.from('documents').remove([shared.filePath, friendInLeaverProject.filePath]);
  await admin.storage.from('survey-media').remove([leaverMediaOnShared]);
});
