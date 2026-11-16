// KAL-369 (Sharing): collaborator rows are written by the server, not the
// browser. Against the real local stack (every migration replayed):
//   - an owner cannot insert a collaborator row directly (any plan, any role);
//   - an owner cannot move a grant to someone else or flip its status, but can
//     still change the role and remove the person;
//   - an email invite to an existing account grants access through
//     grant_document_invite_to_account, with a Free account capped to viewer;
//   - a Free owner, an editor and a stranger cannot use that call.
import crypto from 'node:crypto';
import { RUN, addDocument, makeUser, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

const WEEK = 7 * 864e5;

async function setTier(admin, userId, tier) {
  await must(`tier ${tier}`, admin.from('user_subscriptions')
    .upsert({ user_id: userId, tier, status: 'active' }, { onConflict: 'user_id' }));
}

async function invite(admin, documentId, createdBy, email, role) {
  const [row] = await must('invite', admin.from('document_invites').insert({
    document_id: documentId, token: crypto.randomBytes(16).toString('hex'), role, intended_role: role,
    target_email: email, created_by: createdBy, expires_at: new Date(Date.now() + WEEK).toISOString(),
  }).select('id'));
  return row.id;
}

async function rowsFor(admin, documentId) {
  const rows = await must('rows', admin.from('document_collaborators')
    .select('user_id, role, status, email, invited_by').eq('document_id', documentId).order('user_id'));
  return rows;
}

test.describe.configure({ mode: 'serial' });

test('collaborator rows: no direct inserts, role-only updates, server grant with plan rules', async () => {
  const admin = adminClient();
  const owner = await makeUser(admin, 'cw-owner');
  const paidFriend = await makeUser(admin, 'cw-paid');
  const freeFriend = await makeUser(admin, 'cw-free');
  const stranger = await makeUser(admin, 'cw-stranger');
  const freeOwner = await makeUser(admin, 'cw-free-owner');
  await setTier(admin, owner.id, 'pro');
  await setTier(admin, paidFriend.id, 'pro');
  await setTier(admin, freeFriend.id, 'free');
  await setTier(admin, stranger.id, 'pro');
  await setTier(admin, freeOwner.id, 'free');

  const doc = await addDocument(admin, owner, { name: `Collaborator writes ${RUN}` });
  const freeDoc = await addDocument(admin, freeOwner, { name: `Free owner ${RUN}` });
  const ownerClient = await apiClientFor(owner);

  try {
    // 1. Direct insert: refused for the owner, whatever the role.
    for (const role of ['viewer', 'editor', 'owner']) {
      const { error } = await ownerClient.from('document_collaborators').insert({
        document_id: doc.id, user_id: freeFriend.id, role, email: freeFriend.email, status: 'active', invited_by: owner.id,
      });
      expect(error, `owner inserted a ${role} row directly`).not.toBeNull();
    }
    const freeOwnerClient = await apiClientFor(freeOwner);
    const { error: freeInsert } = await freeOwnerClient.from('document_collaborators').insert({
      document_id: freeDoc.id, user_id: paidFriend.id, role: 'viewer', email: paidFriend.email, status: 'active',
    });
    expect(freeInsert, 'free owner inserted a row directly').not.toBeNull();
    expect(await rowsFor(admin, doc.id)).toEqual([]);
    expect(await rowsFor(admin, freeDoc.id)).toEqual([]);

    // 2. Server grant for an email invite to an existing account.
    const paidInvite = await invite(admin, doc.id, owner.id, paidFriend.email, 'editor');
    const { data: paidGrant, error: paidError } = await ownerClient.rpc('grant_document_invite_to_account', { p_invite_id: paidInvite });
    expect(paidError).toBeNull();
    expect(paidGrant).toEqual({ granted: true, user_id: paidFriend.id, role: 'editor' });

    const freeInvite = await invite(admin, doc.id, owner.id, freeFriend.email, 'editor');
    const { data: freeGrant } = await ownerClient.rpc('grant_document_invite_to_account', { p_invite_id: freeInvite });
    expect(freeGrant, 'a Free account joins as viewer').toEqual({ granted: true, user_id: freeFriend.id, role: 'viewer' });

    const nobodyInvite = await invite(admin, doc.id, owner.id, `nobody-${RUN}@example.test`, 'viewer');
    const { data: nobody } = await ownerClient.rpc('grant_document_invite_to_account', { p_invite_id: nobodyInvite });
    expect(nobody).toEqual({ granted: false });

    const rows = await rowsFor(admin, doc.id);
    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(byUser[paidFriend.id]).toMatchObject({ role: 'editor', status: 'active', invited_by: owner.id, email: paidFriend.email });
    expect(byUser[freeFriend.id]).toMatchObject({ role: 'viewer', status: 'active', invited_by: owner.id });
    expect(rows).toHaveLength(2);

    // The call is the owner's alone, needs a paid plan and an open invite.
    const strangerClient = await apiClientFor(stranger);
    const strangerInvite = await invite(admin, doc.id, owner.id, stranger.email, 'viewer');
    const { error: strangerError } = await strangerClient.rpc('grant_document_invite_to_account', { p_invite_id: strangerInvite });
    expect(strangerError, 'a stranger used the owner\'s invite').not.toBeNull();
    const paidClient = await apiClientFor(paidFriend);
    const { error: editorError } = await paidClient.rpc('grant_document_invite_to_account', { p_invite_id: strangerInvite });
    expect(editorError, 'an editor granted access').not.toBeNull();
    const freeOwnerInvite = await invite(admin, freeDoc.id, freeOwner.id, paidFriend.email, 'viewer');
    const { error: freePlanError } = await freeOwnerClient.rpc('grant_document_invite_to_account', { p_invite_id: freeOwnerInvite });
    expect(freePlanError?.message || '').toMatch(/paid plan/);
    await must('revoke', admin.from('document_invites').update({ revoked_at: new Date().toISOString() }).eq('id', strangerInvite));
    const { error: revokedError } = await ownerClient.rpc('grant_document_invite_to_account', { p_invite_id: strangerInvite });
    expect(revokedError?.message || '').toMatch(/no longer open/);
    expect(await rowsFor(admin, freeDoc.id)).toEqual([]);
    expect((await rowsFor(admin, doc.id)).map((r) => r.user_id)).not.toContain(stranger.id);

    // 3. Updates: only the role. Moving the grant or flipping status is refused.
    const before = await rowsFor(admin, doc.id);
    for (const patch of [
      { user_id: stranger.id },
      { document_id: freeDoc.id },
      { status: 'pending' },
      { email: stranger.email },
      { invited_by: stranger.id },
      { role: 'viewer', user_id: stranger.id },
    ]) {
      const { error } = await ownerClient.from('document_collaborators').update(patch)
        .eq('document_id', doc.id).eq('user_id', paidFriend.id);
      expect(error, `owner changed ${Object.keys(patch).join('+')}`).not.toBeNull();
    }
    expect(await rowsFor(admin, doc.id)).toEqual(before);

    const { data: demoted, error: roleError } = await ownerClient.from('document_collaborators').update({ role: 'viewer' })
      .eq('document_id', doc.id).eq('user_id', paidFriend.id).select('role');
    expect(roleError).toBeNull();
    expect(demoted).toEqual([{ role: 'viewer' }]);

    // A collaborator cannot change roles, even their own.
    const { data: selfPromote } = await paidClient.from('document_collaborators').update({ role: 'owner' })
      .eq('document_id', doc.id).eq('user_id', paidFriend.id).select('role');
    expect(selfPromote ?? []).toEqual([]);

    // 4. Removing someone still works for the owner.
    const { data: removed, error: removeError } = await ownerClient.from('document_collaborators').delete()
      .eq('document_id', doc.id).eq('user_id', freeFriend.id).select('user_id');
    expect(removeError).toBeNull();
    expect(removed).toEqual([{ user_id: freeFriend.id }]);
  } finally {
    await admin.from('document_collaborators').delete().in('document_id', [doc.id, freeDoc.id]);
    await admin.from('document_invites').delete().in('document_id', [doc.id, freeDoc.id]);
    await admin.from('documents').delete().in('id', [doc.id, freeDoc.id]);
    await admin.storage.from('documents').remove([doc.filePath, freeDoc.filePath]);
    for (const user of [owner, paidFriend, freeFriend, stranger, freeOwner]) await admin.auth.admin.deleteUser(user.id);
  }
});
