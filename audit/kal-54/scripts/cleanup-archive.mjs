// Best-effort: archive the leftover docs/projects so they don't pollute
// any active listing UI. The kal31_guard_last_owner trigger blocks delete;
// archive is owner-only and safe.
import { admin } from './admin-client.mjs';
import { writeFileSync } from 'node:fs';

const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const orphans = (list.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));
const out = { archived: [] };

for (const u of orphans) {
  const docs = await admin.from('documents').select('id, name, file_path').eq('user_id', u.id).eq('archived', false);
  for (const d of docs.data || []) {
    // Remove storage object — that's safe and trigger-free
    if (d.file_path) {
      const rm = await admin.storage.from('documents').remove([d.file_path]);
      out.archived.push({ docId: d.id, storage_remove_err: rm.error?.message });
    }
    const upd = await admin.from('documents').update({ archived: true, name: `[audit-leftover-${u.email}] ${d.name}` }).eq('id', d.id);
    out.archived.push({ docId: d.id, archive_err: upd.error?.message });
  }
  const projs = await admin.from('projects').select('id, name').eq('user_id', u.id).eq('archived', false);
  for (const p of projs.data || []) {
    const upd = await admin.from('projects').update({ archived: true, name: `[audit-leftover-${u.email}] ${p.name}` }).eq('id', p.id);
    out.archived.push({ projId: p.id, archive_err: upd.error?.message });
  }
}
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL('../logs/cleanup-archive.json', import.meta.url), JSON.stringify(out, null, 2));
