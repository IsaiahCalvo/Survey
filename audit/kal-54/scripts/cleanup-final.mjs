// Last-mile cleanup: the kal31_guard_last_owner trigger fires when we try to
// delete a project whose document still has an owner. We need to delete the
// documents and their collaborators *first*, then the projects, then the user.
// The trigger only fires when removing the last owner of a doc — so we just
// have to delete the doc rows entirely instead of trying to demote ownership.
import { admin } from './admin-client.mjs';

const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const orphans = (list.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));

const out = { perUser: [] };

for (const u of orphans) {
  const entry = { email: u.email, id: u.id, steps: [] };

  // Find documents owned by this user (we already deleted in prior pass; double-check)
  const docs = await admin.from('documents').select('id, name, file_path').eq('user_id', u.id);
  entry.steps.push({ docs_owned: docs.data?.length || 0 });
  for (const d of docs.data || []) {
    // Drop all rows referencing this document first
    for (const tbl of ['document_collaborators', 'document_annotations', 'document_revisions', 'document_invites', 'survey_markers', 'annotations']) {
      await admin.from(tbl).delete().eq('document_id', d.id);
    }
    if (d.file_path) {
      await admin.storage.from('documents').remove([d.file_path]);
    }
    const dd = await admin.from('documents').delete().eq('id', d.id);
    if (dd.error) entry.steps.push({ doc_del_err: dd.error.message, docId: d.id });
  }

  // Documents where this user is a *collaborator* (not owner) — leaves the doc intact for the owner
  await admin.from('document_collaborators').delete().eq('user_id', u.id);
  await admin.from('document_collaborators').delete().eq('invited_by', u.id);

  // Projects owned by this user
  const projs = await admin.from('projects').select('id').eq('user_id', u.id);
  for (const p of projs.data || []) {
    const pd = await admin.from('projects').delete().eq('id', p.id);
    if (pd.error) entry.steps.push({ proj_del_err: pd.error.message, projId: p.id });
  }

  // Templates
  await admin.from('templates').delete().eq('user_id', u.id);
  // Subscriptions
  await admin.from('user_subscriptions').delete().eq('user_id', u.id);
  // Connected services
  await admin.from('connected_services').delete().eq('user_id', u.id).then(() => null, () => null);

  // Final: delete the user
  const r = await admin.auth.admin.deleteUser(u.id);
  entry.steps.push({ user_delete: r.error?.message || 'OK' });
  out.perUser.push(entry);
}

// Final count
const final = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const leftover = (final.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));
out.finalLeftoverCount = leftover.length;
out.finalLeftoverEmails = leftover.map((u) => u.email);
console.log(JSON.stringify(out, null, 2));
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../logs/cleanup-final.json', import.meta.url), JSON.stringify(out, null, 2));
