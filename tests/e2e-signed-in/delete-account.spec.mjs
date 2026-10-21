// Deleting an account (App Store / Play rule): the delete-account function
// removes every row and stored file the person owns, cuts off their agents,
// and leaves the people they shared with their own files and markup.
import crypto from 'node:crypto';
import {
  PDF, RUN, addDocument, addMarkup, addMedia, exists, makeUser, must, signInToken,
} from './accountFixtures.mjs';
import { agentSignIn } from './agentAuth.mjs';
import { adminClient, expect, functionUrl, test } from './helpers.mjs';

const API = () => process.env.E2E_SUPABASE_URL;
const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;

const deleteAccount = (token, body = { confirmation: 'DELETE' }) => fetch(functionUrl('delete-account'), {
  method: 'POST',
  headers: { apikey: KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('deleting an account removes everything the person owns, and only that', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const leaver = await makeUser(admin, 'delete-leaver');
  const friend = await makeUser(admin, 'delete-friend');

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
  // The same PDF the friend also keeps outside any project (one copy per
  // project per user is enforced, so it must not land next to this one).
  const sha = crypto.createHash('sha256').update(RUN).digest('hex');
  const friendLoose = await addDocument(admin, friend, { name: `Friend loose ${RUN}`, sha });
  const friendInLeaverProject = await addDocument(admin, friend, { projectId: project, name: `Friend filed ${RUN}`, sha });

  // Survey JSON sidecars live at <project>/<document>_data.json.
  const sidecar = (projectId, documentId) => `${projectId}/${documentId}_data.json`;
  // The bucket only takes PDF and Excel types, so stand one in; the path is
  // what deletion keys on.
  for (const docId of [own.id, friendInLeaverProject.id]) {
    await must('sidecar', admin.storage.from('documents').upload(sidecar(project, docId), PDF, { contentType: 'application/pdf' }));
  }

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
  for (const [bucket, path] of [['documents', own.filePath], ['documents', nested], ['documents', sidecar(project, own.id)],
    ['documents', sidecar(project, friendInLeaverProject.id)], ['survey-media', ownMedia], ['survey-media', friendMediaOnOwn]]) {
    expect(await exists(admin, bucket, path), `${bucket}/${path} removed`).toBe(false);
  }

  // The friend keeps their files, the leaver's markup and media on them, and
  // the file they had filed in the leaver's project.
  expect(await exists(admin, 'documents', shared.filePath)).toBe(true);
  expect(await exists(admin, 'documents', friendInLeaverProject.filePath)).toBe(true);
  expect(await exists(admin, 'survey-media', leaverMediaOnShared)).toBe(true);
  const markup = await must('kept markup', admin.from('document_annotations').select('user_id').eq('annotation_id', leaverMarkupOnShared));
  expect(markup).toEqual([{ user_id: friend.id }]);
  const [filed] = await must('filed doc', admin.from('documents').select('project_id').eq('id', friendInLeaverProject.id));
  const newProject = await must('new project', admin.from('projects').select('user_id, name').eq('id', filed.project_id));
  expect(newProject).toEqual([{ user_id: friend.id, name: `Leaver project ${RUN}` }]);
  expect(await exists(admin, 'documents', friendLoose.filePath)).toBe(true);
  expect(await exists(admin, 'documents', sidecar(filed.project_id, friendInLeaverProject.id)), 'friend survey data moved').toBe(true);
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
  await admin.storage.from('documents').remove([shared.filePath, friendInLeaverProject.filePath, friendLoose.filePath,
    sidecar(filed.project_id, friendInLeaverProject.id)]);
  await admin.storage.from('survey-media').remove([leaverMediaOnShared]);
});

test('a retry after the rows went still moves a shared file\'s survey data', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const leaver = await makeUser(admin, 'delete-retry-leaver');
  const friend = await makeUser(admin, 'delete-retry-friend');
  const project = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: project, user_id: leaver.id, name: `Retry project ${RUN}` }));
  const filed = await addDocument(admin, friend, { projectId: project, name: `Retry filed ${RUN}` });
  const oldSidecar = `${project}/${filed.id}_data.json`;
  await must('sidecar', admin.storage.from('documents').upload(oldSidecar, PDF, { contentType: 'application/pdf' }));

  // A first attempt that committed the rows and then failed on storage.
  await must('rows only', admin.rpc('delete_account_owned_rows', { target_user_id: leaver.id }));

  const res = await deleteAccount(await signInToken(leaver));
  expect(res.status, await res.clone().text()).toBe(200);
  const [row] = await must('filed doc', admin.from('documents').select('project_id').eq('id', filed.id));
  expect(row.project_id).not.toBe(project);
  expect(await exists(admin, 'documents', `${row.project_id}/${filed.id}_data.json`), 'survey data followed the file').toBe(true);
  expect(await exists(admin, 'documents', oldSidecar)).toBe(false);

  await admin.auth.admin.deleteUser(friend.id);
  await admin.storage.from('documents').remove([filed.filePath, `${row.project_id}/${filed.id}_data.json`]);
});
