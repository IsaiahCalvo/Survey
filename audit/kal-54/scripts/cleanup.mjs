// Tear down every disposable artifact the audit created:
//  - documents (rows + storage objects)
//  - projects
//  - document_collaborators (cascade with doc/user)
//  - user_subscriptions (cascade with user)
//  - auth.users
// At the end, list remaining survey-test-* users and report the count.
import { admin } from './admin-client.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const users = JSON.parse(
  readFileSync(new URL('../logs/area-02-users.json', import.meta.url), 'utf8')
).users;
const supa12 = JSON.parse(
  readFileSync(new URL('../logs/area-12-supabase.json', import.meta.url), 'utf8')
);

const out = { user_deletes: [], projects_deleted: [], docs_deleted: [], storage_removed: [] };

// 1. Find every project + document owned by any of our disposable users.
for (const u of users) {
  const docs = await admin.from('documents').select('id, file_path').eq('user_id', u.userId);
  for (const d of docs.data || []) {
    // Delete document_collaborators rows
    await admin.from('document_collaborators').delete().eq('document_id', d.id);
    // Delete storage object (best effort — may not exist)
    if (d.file_path) {
      const rm = await admin.storage.from('documents').remove([d.file_path]);
      out.storage_removed.push({ filePath: d.file_path, error: rm.error?.message });
    }
    const dd = await admin.from('documents').delete().eq('id', d.id);
    out.docs_deleted.push({ id: d.id, error: dd.error?.message });
  }
  const projs = await admin.from('projects').select('id').eq('user_id', u.userId);
  for (const p of projs.data || []) {
    const pd = await admin.from('projects').delete().eq('id', p.id);
    out.projects_deleted.push({ id: p.id, error: pd.error?.message });
  }
  // Delete user_subscriptions
  await admin.from('user_subscriptions').delete().eq('user_id', u.userId);
}

// 2. Delete the auth users
for (const u of users) {
  const r = await admin.auth.admin.deleteUser(u.userId);
  out.user_deletes.push({ userId: u.userId, email: u.email, error: r.error?.message });
}

// 3. List remaining survey-test-* users
const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const surveyTestRemaining = (list.data?.users || []).filter((u) => (u.email || '').startsWith('survey-test-'));
out.surveyTestRemaining = surveyTestRemaining.map((u) => ({
  id: u.id,
  email: u.email,
  created_at: u.created_at,
  audit: u.user_metadata?.audit || null
}));
out.surveyTestRemainingCount = surveyTestRemaining.length;

writeFileSync(new URL('../logs/cleanup.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
