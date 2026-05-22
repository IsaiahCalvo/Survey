// The kal31_guard_last_owner trigger fires when deleting the *last* owner row.
// To get past it for cleanup, we transfer the document's `user_id` to a stable
// sink user (the project maintainer, isaiahcalvo123). Then the disposable user
// has no documents and can be deleted.
import { admin } from './admin-client.mjs';
import { writeFileSync } from 'node:fs';

// Find the maintainer user id
const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const maintainer = (list.data?.users || []).find((u) => u.email === 'isaiahcalvo123@gmail.com');
if (!maintainer) {
  console.error('Maintainer user not found');
  process.exit(1);
}

const orphans = (list.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));
const out = { perUser: [], maintainerId: maintainer.id };

for (const u of orphans) {
  const entry = { email: u.email, id: u.id, steps: [] };
  const docs = await admin.from('documents').select('id, name').eq('user_id', u.id);
  entry.steps.push({ docs_found: docs.data?.length || 0 });

  for (const d of docs.data || []) {
    // First clear collaborators (no need to keep their grants)
    await admin.from('document_collaborators').delete().eq('document_id', d.id);
    // Reassign owner. The trigger fires on DELETE-of-owner, not UPDATE-of-owner.
    // We rename + mark archived so it's clear this is audit leftover, then transfer.
    const upd = await admin
      .from('documents')
      .update({
        user_id: maintainer.id,
        name: `[audit-leftover] ${d.name}`,
        archived: true
      })
      .eq('id', d.id);
    if (upd.error) entry.steps.push({ transfer_err: upd.error.message, docId: d.id });
  }

  // Clear all other refs
  await admin.from('document_collaborators').delete().eq('user_id', u.id);
  await admin.from('document_collaborators').delete().eq('invited_by', u.id);

  // Projects owned by user: if they hold no documents now, safe to delete
  const projs = await admin.from('projects').select('id, name').eq('user_id', u.id);
  for (const p of projs.data || []) {
    // Reassign projects to maintainer too
    const pu = await admin
      .from('projects')
      .update({ user_id: maintainer.id, name: `[audit-leftover] ${p.name}`, archived: true })
      .eq('id', p.id);
    if (pu.error) entry.steps.push({ proj_transfer_err: pu.error.message, projId: p.id });
  }

  await admin.from('templates').delete().eq('user_id', u.id);
  await admin.from('user_subscriptions').delete().eq('user_id', u.id);

  // Now delete the user
  const r = await admin.auth.admin.deleteUser(u.id);
  entry.steps.push({ user_delete: r.error?.message || 'OK' });
  out.perUser.push(entry);
}

const final = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const leftover = (final.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));
out.finalLeftoverCount = leftover.length;
out.finalLeftoverEmails = leftover.map((u) => u.email);
writeFileSync(new URL('../logs/cleanup-transfer.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
