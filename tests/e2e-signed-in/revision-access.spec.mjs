// Document history (migration 20261023140000_revisions_use_shared_document_access)
// follows the same "who can open this document" rule as the document's
// markups: project members and people it is shared with may read it, nobody
// but the owner once it is in the trash, and a signed-off document cannot be
// rolled back until it is unlocked.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { RUN, addDocument, addMarkup, makeUser, must, signInToken } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const asUser = async (account) => createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${await signInToken(account)}` } },
});

const isDenied = (error) => error?.code === '42501';

test('document history follows the document\'s own access rule', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await makeUser(admin, 'rev-owner');
  const friend = await makeUser(admin, 'rev-friend');
  const member = await makeUser(admin, 'rev-member');
  const stranger = await makeUser(admin, 'rev-stranger');
  const project = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: project, user_id: owner.id, name: `Revisions ${RUN}` }));
  const doc = await addDocument(admin, owner, { projectId: project, name: `Revisions file ${RUN}` });
  await must('share document', admin.from('document_collaborators').insert({
    document_id: doc.id, user_id: friend.id, invited_by: owner.id, role: 'viewer', email: friend.email, status: 'active',
  }));
  await must('share project', admin.from('project_collaborators').insert({
    project_id: project, user_id: member.id, role: 'editor', email: member.email, status: 'active',
  }));
  const markup = await addMarkup(admin, doc.id, owner);
  const [revision] = await must('revision', admin.from('document_revisions')
    .insert({ document_id: doc.id, revision_number: 1, snapshot_json: {} }).select('id'));

  const clients = Object.fromEntries(await Promise.all(
    Object.entries({ owner, friend, member, stranger }).map(async ([k, a]) => [k, await asUser(a)]),
  ));
  const list = (who) => clients[who].rpc('kal48_list_revisions', { p_document_id: doc.id });
  const rows = async (who) => (await clients[who].from('document_revisions').select('id').eq('document_id', doc.id)).data || [];

  try {
    // Open document: the same people who can read its markups can read its history.
    for (const who of ['owner', 'friend', 'member']) {
      const { data, error } = await list(who);
      expect(error, `${who}: ${JSON.stringify(error)}`).toBeNull();
      expect(data.map((r) => r.id), who).toEqual([revision.id]);
      expect((await rows(who)).length, who).toBe(1);
      const markups = await clients[who].from('document_annotations').select('id').eq('document_id', doc.id);
      expect(markups.data.length, `${who} markups`).toBe(1);
    }
    expect(isDenied((await list('stranger')).error)).toBe(true);
    expect(await rows('stranger')).toEqual([]);
    // Only the owner may roll back.
    for (const who of ['friend', 'stranger']) {
      const { error } = await clients[who].rpc('kal48_restore_revision', { p_revision_id: revision.id });
      expect(isDenied(error), `${who}: ${JSON.stringify(error)}`).toBe(true);
    }

    // Signed off: nobody, the owner included, can roll it back until it is unlocked.
    await must('lock', admin.from('documents').update({ locked_at: new Date().toISOString(), locked_by: owner.id }).eq('id', doc.id));
    const locked = await clients.owner.rpc('kal48_restore_revision', { p_revision_id: revision.id });
    expect(isDenied(locked.error), JSON.stringify(locked.error)).toBe(true);
    const kept = await admin.from('document_annotations').select('annotation_id').eq('document_id', doc.id);
    expect(kept.data.map((a) => a.annotation_id)).toEqual([markup]);
    await must('unlock', admin.from('documents').update({ locked_at: null, locked_by: null }).eq('id', doc.id));
    const restored = await clients.owner.rpc('kal48_restore_revision', { p_revision_id: revision.id });
    expect(restored.error, JSON.stringify(restored.error)).toBeNull();

    // In the trash: the history is the owner's alone, like the document.
    await must('archive', admin.from('documents').update({ user_archived_at: new Date().toISOString() }).eq('id', doc.id));
    for (const who of ['friend', 'member', 'stranger']) {
      expect(isDenied((await list(who)).error), who).toBe(true);
      expect(await rows(who), who).toEqual([]);
    }
    expect((await list('owner')).error).toBeNull();
    expect((await rows('owner')).length).toBeGreaterThan(0);
  } finally {
    for (const user of [owner, friend, member, stranger]) await admin.auth.admin.deleteUser(user.id);
    await admin.storage.from('documents').remove([doc.filePath]);
  }
});
