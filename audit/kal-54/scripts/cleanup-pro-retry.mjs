// Retry the pro user delete by manually clearing any lingering FK references first.
import { admin } from './admin-client.mjs';
const userId = '80b5d007-c9d9-4937-b67b-8cb404c9d141';

const tables = [
  'document_annotations',
  'document_collaborators',
  'document_revisions',
  'document_invites',
  'survey_markers',
  'annotations',
  'documents',
  'projects',
  'templates',
  'user_subscriptions',
  'connected_services',
  'profiles'
];

for (const tbl of tables) {
  // Try user_id first
  let res = await admin.from(tbl).delete().eq('user_id', userId);
  if (res.error && !/column .* does not exist|relation .* does not exist/.test(res.error.message)) {
    console.log(tbl, 'user_id delete err:', res.error.message);
  }
  // Try owner_id
  res = await admin.from(tbl).delete().eq('owner_id', userId);
  if (res.error && !/column .* does not exist|relation .* does not exist/.test(res.error.message)) {
    console.log(tbl, 'owner_id delete err:', res.error.message);
  }
  // Try invited_by
  res = await admin.from(tbl).delete().eq('invited_by', userId);
  if (res.error && !/column .* does not exist|relation .* does not exist/.test(res.error.message)) {
    console.log(tbl, 'invited_by delete err:', res.error.message);
  }
}

// Try delete
const d = await admin.auth.admin.deleteUser(userId);
console.log('delete result:', d.error?.message || 'OK');

// Also try the 7 orphaned survey-test-owner-* leftovers from earlier audits
const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const orphans = (list.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));
console.log('\nremaining survey-test-* users:', orphans.length);
for (const o of orphans) {
  // Cascade clear
  for (const tbl of tables) {
    await admin.from(tbl).delete().eq('user_id', o.id);
    await admin.from(tbl).delete().eq('owner_id', o.id);
    await admin.from(tbl).delete().eq('invited_by', o.id);
  }
  const r = await admin.auth.admin.deleteUser(o.id);
  console.log(o.email, '->', r.error?.message || 'deleted');
}

// Final list
const final = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const leftover = (final.data?.users || []).filter((u) => /^survey-test-/.test(u.email || ''));
console.log('\nfinal survey-test-* count:', leftover.length);
console.log('leftover emails:', leftover.map((u) => u.email));
