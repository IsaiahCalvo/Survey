// Guest links (Nightly, flag 'guest-links'): the database side, probed with
// real sessions on the local stack. A guest is an anonymous session that
// redeemed a link: it reaches that one document as viewer or editor while
// the link lives, and nothing else. See supabase/migrations/
// 20261028070000_guest_links.sql and the security review in project files.
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

async function guestClient() {
  const client = await apiClientFor(null);
  const { error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in: ${error.message}`);
  return client;
}

const yUpdate = (id) => {
  const doc = new Y.Doc();
  doc.getMap('marks').set(id, new Y.Map());
  return bytesToPgHex(Y.encodeStateAsUpdate(doc));
};

test('guest links: one document, its role, only while the link lives, nothing else', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const editor = await apiClientFor(E2E_ACCOUNTS.editor);
  const ownerId = (await owner.auth.getUser()).data.user.id;

  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = Buffer.from(await pdf.save());
  const docId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const path = `${ownerId}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  for (const [id, name] of [[docId, `Guest sheet ${RUN}.pdf`], [otherId, `Not shared ${RUN}.pdf`]]) {
    await must('row', admin.from('documents').insert({
      id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: id === docId ? path : `${ownerId}/${otherId}.pdf`, file_size: bytes.length, page_count: 1,
    }));
  }

  try {
    // Only the owner makes links; a team editor, or nonsense, cannot.
    expect((await editor.rpc('create_guest_link', { p_document_id: docId, p_role: 'editor', p_expires_in: '1 day' })).error?.message).toContain('Document not found');
    expect((await owner.rpc('create_guest_link', { p_document_id: docId, p_role: 'owner', p_expires_in: '1 day' })).error).toBeTruthy();
    expect((await owner.rpc('create_guest_link', { p_document_id: docId, p_role: 'viewer', p_expires_in: '10 years' })).error).toBeTruthy();
    const [editLink] = await must('editor link', owner.rpc('create_guest_link', { p_document_id: docId, p_role: 'editor', p_expires_in: '1 day' }));
    const [viewLink] = await must('viewer link', owner.rpc('create_guest_link', { p_document_id: docId, p_role: 'viewer', p_expires_in: '4 hours' }));
    expect(editLink.token).toMatch(/^[0-9a-f]{64}$/);
    // The secret is never readable back, not even by the owner.
    expect((await owner.from('document_guest_links').select('token_hash').eq('id', editLink.id)).error).toBeTruthy();
    const listed = await must('owner list', owner.from('document_guest_links').select('id, role').eq('document_id', docId));
    expect(listed.map((l) => l.role).sort()).toEqual(['editor', 'viewer']);
    expect(await must('editor list', editor.from('document_guest_links').select('id').eq('document_id', docId))).toEqual([]);

    // A guest comes in with a name; a wrong secret says nothing useful.
    const guest = await guestClient();
    const guestId = (await guest.auth.getUser()).data.user.id;
    expect((await guest.from('documents').select('id').eq('id', docId)).data).toEqual([]);
    expect((await guest.rpc('redeem_guest_link', { p_token: 'f'.repeat(64), p_name: 'Gus' })).error?.message).toContain('ended or was turned off');
    expect((await guest.rpc('redeem_guest_link', { p_token: editLink.token, p_name: '   ' })).error).toBeTruthy();
    const [came] = await must('redeem', guest.rpc('redeem_guest_link', { p_token: editLink.token, p_name: 'Gus Guest' }));
    expect(came).toMatchObject({ document_id: docId, role: 'editor' });

    // It reaches this document, its file, and can mark it up and comment.
    expect((await must('doc', guest.from('documents').select('id').eq('id', docId)))).toHaveLength(1);
    expect((await guest.from('documents').select('id').eq('id', otherId)).data).toEqual([]);
    const file = await guest.storage.from('documents').download(path);
    expect(file.error).toBeNull();
    await must('guest markup', guest.rpc('append_annotation_update', { p_document_id: docId, p_client_id: `guest-${RUN}`, p_client_seq: 1, p_data: yUpdate('g1') }));
    const comment = await must('guest comment', guest.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'From a guest', p_mentions: [ownerId] }));
    expect(comment.mentions).toEqual([ownerId]);

    // No email addresses for a guest; guests show by the name they typed.
    const people = await must('people', guest.rpc('mark_comment_people', { p_document_id: docId }));
    expect(people.every((p) => p.email === null)).toBe(true);
    expect(people.find((p) => p.user_id === guestId)).toMatchObject({ name: 'Gus Guest', guest: true });
    const ownerSees = await must('owner people', owner.rpc('mark_comment_people', { p_document_id: docId }));
    expect(ownerSees.find((p) => p.user_id === ownerId).email).toBe(E2E_ACCOUNTS.owner.email);
    const [ownerProfile] = await must('owner profile', guest.rpc('get_document_owner_profile', { doc_id: docId }));
    expect(ownerProfile.email).toBeNull();
    for (const row of await must('collaborators', guest.from('document_collaborators').select('user_id, email').eq('document_id', docId))) {
      expect(row.user_id).toBe(guestId);
    }
    expect((await guest.rpc('check_collaborator_by_email', { email_address: E2E_ACCOUNTS.owner.email })).error).toBeTruthy();

    // It makes nothing of its own and manages nothing.
    expect((await guest.from('documents').insert({ id: crypto.randomUUID(), user_id: guestId, name: 'x.pdf', file_path: `${guestId}/x.pdf`, file_size: 1 })).error).toBeTruthy();
    expect((await guest.from('projects').insert({ user_id: guestId, name: 'Mine' })).error).toBeTruthy();
    expect((await guest.from('mark_library_items').insert({ library: 'personal', name: 'Mine', payload: { type: 'rect' } })).error).toBeTruthy();
    expect((await guest.rpc('create_organization', { p_name: 'Guest Co' })).error?.message).toContain('Guests cannot do that');
    expect((await guest.storage.from('documents').upload(`${guestId}/x.pdf`, new Blob([bytes]), { contentType: 'application/pdf' })).error).toBeTruthy();
    expect((await guest.storage.from('survey-media').upload(`${docId}/m/x.png`, new Blob([new Uint8Array(8)]), { contentType: 'image/png' })).error).toBeTruthy();
    expect((await guest.from('documents').update({ name: 'renamed' }).eq('id', docId).select()).data ?? []).toEqual([]);
    expect((await guest.rpc('create_guest_link', { p_document_id: docId, p_role: 'editor', p_expires_in: '1 day' })).error).toBeTruthy();
    expect((await guest.rpc('revoke_guest_link', { p_link_id: editLink.id })).error).toBeTruthy();
    expect((await guest.from('document_guest_links').select('id').eq('document_id', docId)).data).toEqual([]);
    expect(await must('claim', guest.rpc('claim_document_templates', { p_document_id: docId }))).toBe(0);
    expect((await guest.rpc('approve_agent_link', { p_user_code: 'ABCD-EFGH' })).error).toBeTruthy();
    expect(await must('nightly', guest.rpc('can_use_nightly'))).toBe(true);

    // A viewer link lets a second guest read, not write.
    const viewer = await guestClient();
    await must('redeem view', viewer.rpc('redeem_guest_link', { p_token: viewLink.token, p_name: 'Vic' }));
    expect(await must('view doc', viewer.from('documents').select('id').eq('id', docId))).toHaveLength(1);
    expect((await viewer.rpc('append_annotation_update', { p_document_id: docId, p_client_id: `view-${RUN}`, p_client_seq: 1, p_data: yUpdate('v1') })).error).toBeTruthy();
    expect((await viewer.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'hi' })).error).toBeTruthy();
    // Guests see only their own guest row.
    expect((await must('guest rows', viewer.from('document_guests').select('user_id').eq('document_id', docId))).map((r) => r.user_id)).toEqual([(await viewer.auth.getUser()).data.user.id]);
    expect((await must('owner sees guests', owner.from('document_guests').select('display_name').eq('document_id', docId))).map((r) => r.display_name).sort()).toEqual(['Gus Guest', 'Vic']);

    // Turning the link off cuts the guest off at once; so does expiry.
    expect(await must('revoke', owner.rpc('revoke_guest_link', { p_link_id: editLink.id }))).toBe(true);
    expect((await guest.from('documents').select('id').eq('id', docId)).data).toEqual([]);
    expect((await guest.storage.from('documents').download(path)).error).toBeTruthy();
    expect((await guest.rpc('append_annotation_update', { p_document_id: docId, p_client_id: `guest-${RUN}`, p_client_seq: 2, p_data: yUpdate('g2') })).error).toBeTruthy();
    expect(await must('nightly after', guest.rpc('can_use_nightly'))).toBe(false);
    expect((await guest.rpc('redeem_guest_link', { p_token: editLink.token, p_name: 'Gus again' })).error).toBeTruthy();
    await must('expire', admin.from('document_guest_links').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', viewLink.id));
    expect((await viewer.from('documents').select('id').eq('id', docId)).data).toEqual([]);
  } finally {
    await admin.from('documents').delete().in('id', [docId, otherId]);
    await admin.storage.from('documents').remove([path]);
  }
});
