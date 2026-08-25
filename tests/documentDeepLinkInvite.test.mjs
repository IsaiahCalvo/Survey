import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  findOwnedDeepLinkDocument,
  interpretInviteAcceptResult,
  inviteRowsToVoidOnRemove,
  resolveDeepLinkDocument,
} from '../src/home/documentDeepLink.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const DOC = { id: 'doc-shared', name: 'Shared.pdf' };
const INVITE = {
  id: 'inv-1',
  document_id: 'doc-shared',
  token: 'tok-link',
  target_email: null,
  accepted_by: 'bot-1',
  accepted_at: '2026-08-25T17:00:00.000Z',
  revoked_at: null,
  expires_at: '2026-09-01T17:00:00.000Z',
  intended_role: 'viewer',
};

test('intended: ?docId= opens from the owned list when the visitor already has the row', async () => {
  const resolved = await resolveDeepLinkDocument({
    documents: [DOC],
    documentId: 'doc-shared',
    loadInviteDocument: async () => {
      throw new Error('invite resolver must not run when the list already has the row');
    },
  });
  assert.equal(resolved.source, 'owned-list');
  assert.equal(resolved.document, DOC);
  assert.equal(findOwnedDeepLinkDocument([DOC], 'doc-shared'), DOC);
});

test('intended: ?docId= resolves the invite row when the visitor list is empty', async () => {
  const resolved = await resolveDeepLinkDocument({
    documents: [],
    documentId: 'doc-shared',
    loadInviteDocument: async (id) => (String(id) === 'doc-shared' ? DOC : null),
  });
  assert.equal(resolved.source, 'invite');
  assert.equal(resolved.document, DOC);
});

test('break: missing invite and empty list stay unresolved', async () => {
  const resolved = await resolveDeepLinkDocument({
    documents: [],
    documentId: 'doc-shared',
    loadInviteDocument: async () => null,
  });
  assert.equal(resolved.source, 'unresolved');
  assert.equal(resolved.document, null);
  assert.equal(findOwnedDeepLinkDocument([], 'doc-shared'), null);
  assert.equal(findOwnedDeepLinkDocument([DOC], ''), null);
});

test('edge: a second visitor on a reusable link is accepted, not already_accepted', () => {
  const secondVisitor = interpretInviteAcceptResult({
    rpcStatus: 'already_accepted',
    invite: INVITE,
    currentUserId: 'bot-2',
    hasActiveGrant: false,
  });
  assert.equal(secondVisitor.status, 'accepted');
  assert.equal(secondVisitor.action, 'grant-from-invite');

  const firstVisitorAgain = interpretInviteAcceptResult({
    rpcStatus: 'already_accepted',
    invite: INVITE,
    currentUserId: 'bot-1',
    hasActiveGrant: true,
  });
  assert.equal(firstVisitorAgain.status, 'already_accepted');
  assert.equal(firstVisitorAgain.action, 'open-existing');
});

test('edge: revoked / expired / email-bound already_accepted stay closed', () => {
  assert.equal(interpretInviteAcceptResult({
    rpcStatus: 'already_accepted',
    invite: { ...INVITE, revoked_at: '2026-08-25T18:00:00.000Z' },
    currentUserId: 'bot-2',
    hasActiveGrant: false,
  }).status, 'revoked');
  assert.equal(interpretInviteAcceptResult({
    rpcStatus: 'already_accepted',
    invite: { ...INVITE, expires_at: '2026-08-01T00:00:00.000Z' },
    currentUserId: 'bot-2',
    hasActiveGrant: false,
  }).status, 'expired');
  assert.equal(interpretInviteAcceptResult({
    rpcStatus: 'already_accepted',
    invite: { ...INVITE, target_email: 'only@example.test' },
    currentUserId: 'bot-2',
    hasActiveGrant: false,
  }).status, 'already_accepted');
  assert.equal(interpretInviteAcceptResult({ rpcStatus: 'accepted' }).status, 'accepted');
});

test('revoke voids accepted invite rows for the removed collaborator only', () => {
  const rows = inviteRowsToVoidOnRemove([
    INVITE,
    { ...INVITE, id: 'inv-2', accepted_by: 'bot-2' },
    { ...INVITE, id: 'inv-3', accepted_by: 'bot-1', revoked_at: '2026-08-25T18:00:00.000Z' },
    { ...INVITE, id: 'inv-4', document_id: 'other' },
  ], { documentId: 'doc-shared', userId: 'bot-1' });
  assert.deepEqual(rows.map((row) => row.id), ['inv-1']);
  assert.deepEqual(inviteRowsToVoidOnRemove([INVITE], { documentId: 'doc-shared' }), []);
});

test('product files wire invite resolve and revoke-void', () => {
  const appShell = read('src/AppShell.jsx');
  const accept = read('src/services/documentInviteService.js');
  const annotation = read('src/services/documentAnnotationService.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(appShell, /resolveDeepLinkDocument/);
  assert.match(appShell, /loadInviteDocument/);
  assert.match(appShell, /__documentDeepLinkE2EInvite/);
  assert.match(accept, /interpretInviteAcceptResult/);
  assert.match(accept, /grant-from-invite/);
  assert.match(annotation, /voidDocumentInvitesForRemovedCollaborator/);
  assert.match(annotation, /\.eq\('accepted_by', userId\)/);
  assert.match(dev, /documentDeepLinkInviteE2E/);
  assert.match(dev, /__documentDeepLinkE2EInvite/);
  assert.match(dev, /Do NOT set file\.id/);
});
