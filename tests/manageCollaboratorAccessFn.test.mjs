import test from 'node:test';
import { deepStrictEqual, equal } from 'node:assert/strict';

import { handleManageCollaboratorAccess } from '../supabase/functions/manage-collaborator-access/handler.js';

test('manage-collaborator-access rejects an anonymous caller before database work', async () => {
  let touchedDatabase = false;
  const out = await handleManageCollaboratorAccess({
    method: 'POST',
    authHeader: null,
    body: {
      kind: 'document',
      resourceId: 'doc-1',
      targetUserId: 'user-2',
      action: 'remove',
    },
  }, {
    anonKey: 'public-anon-key',
    getUserFromToken: async () => null,
    selectCollaborator: async () => { touchedDatabase = true; },
  });

  equal(out.status, 401);
  equal(out.body.success, false);
  equal(touchedDatabase, false);
});

test('role change mutates under caller authority and derives the email from trusted records', async () => {
  const calls = { update: [], emailLookup: [], send: [] };
  const out = await handleManageCollaboratorAccess({
    method: 'POST',
    authHeader: 'Bearer signed-user-jwt',
    body: {
      kind: 'document',
      resourceId: 'doc-1',
      targetUserId: 'user-2',
      action: 'role',
      newRole: 'owner',
      // These fields are deliberately untrusted and must be ignored.
      to: 'attacker@example.com',
      subject: 'spoofed subject',
    },
  }, {
    anonKey: 'public-anon-key',
    getUserFromToken: async () => ({
      id: 'user-1',
      email: 'owner@example.com',
      user_metadata: { full_name: 'Isaiah' },
    }),
    selectCollaborator: async (kind, resourceId, targetUserId) => {
      deepStrictEqual([kind, resourceId, targetUserId], ['document', 'doc-1', 'user-2']);
      return { id: 'collab-1', user_id: 'user-2', role: 'editor' };
    },
    selectResource: async (kind, resourceId) => {
      deepStrictEqual([kind, resourceId], ['document', 'doc-1']);
      return { name: 'Floor Plan' };
    },
    updateRole: async (...args) => {
      calls.update.push(args);
      return [{ id: 'collab-1' }];
    },
    removeAccess: async () => { throw new Error('wrong mutation'); },
    getTargetEmail: async (userId) => {
      calls.emailLookup.push(userId);
      return 'member@example.com';
    },
    sendEmail: async (payload) => {
      calls.send.push(payload);
      return true;
    },
  });

  deepStrictEqual(out, { status: 200, body: { success: true, emailSent: true } });
  deepStrictEqual(calls.update, [['document', 'doc-1', 'user-2', 'owner']]);
  deepStrictEqual(calls.emailLookup, ['user-2']);
  deepStrictEqual(calls.send, [{
    to: 'member@example.com',
    subject: 'Your access to Floor Plan changed',
    template: 'permission-changed',
    data: {
      documentName: 'Floor Plan',
      changedByName: 'Isaiah',
      newRole: 'Owner',
      oldRole: 'Editor',
      documentUrl: 'https://surveytool.app',
      appUrl: 'https://surveytool.app',
    },
  }]);
});

test('removal stays successful when the trusted notification send fails', async () => {
  const sent = [];
  const out = await handleManageCollaboratorAccess({
    method: 'POST',
    authHeader: 'Bearer signed-user-jwt',
    body: {
      kind: 'project',
      resourceId: 'project-1',
      targetUserId: 'user-2',
      action: 'remove',
    },
  }, {
    anonKey: 'public-anon-key',
    getUserFromToken: async () => ({ id: 'user-1', email: 'owner@example.com' }),
    selectCollaborator: async () => ({ id: 'collab-1', user_id: 'user-2', role: 'viewer' }),
    selectResource: async () => ({ name: 'Tower A' }),
    updateRole: async () => { throw new Error('wrong mutation'); },
    removeAccess: async (...args) => {
      deepStrictEqual(args, ['project', 'project-1', 'user-2']);
      return [{ id: 'collab-1' }];
    },
    getTargetEmail: async () => 'member@example.com',
    sendEmail: async (payload) => {
      sent.push(payload);
      throw new Error('provider unavailable');
    },
  });

  deepStrictEqual(out, { status: 200, body: { success: true, emailSent: false } });
  deepStrictEqual(sent, [{
    to: 'member@example.com',
    subject: 'Your access to the project "Tower A" was removed',
    template: 'access-removed',
    data: {
      documentName: 'the project "Tower A"',
      removedByName: 'owner@example.com',
    },
  }]);
});

test('a no-op role request cannot be used to spam collaborator notifications', async () => {
  let mutationCalls = 0;
  let sendCalls = 0;
  const out = await handleManageCollaboratorAccess({
    method: 'POST',
    authHeader: 'Bearer signed-user-jwt',
    body: {
      kind: 'document',
      resourceId: 'doc-1',
      targetUserId: 'user-2',
      action: 'role',
      newRole: 'editor',
    },
  }, {
    anonKey: 'public-anon-key',
    getUserFromToken: async () => ({ id: 'user-1', email: 'owner@example.com' }),
    selectCollaborator: async () => ({ id: 'collab-1', user_id: 'user-2', role: 'editor' }),
    selectResource: async () => ({ name: 'Floor Plan' }),
    updateRole: async () => { mutationCalls += 1; return [{ id: 'collab-1' }]; },
    removeAccess: async () => [],
    getTargetEmail: async () => 'member@example.com',
    sendEmail: async () => { sendCalls += 1; return true; },
  });

  deepStrictEqual(out, { status: 409, body: { success: false, error: 'Role is unchanged' } });
  equal(mutationCalls, 0);
  equal(sendCalls, 0);
});

test('an intrinsic resource owner cannot receive a false removal notification', async () => {
  let mutationCalls = 0;
  let sendCalls = 0;
  const out = await handleManageCollaboratorAccess({
    method: 'POST',
    authHeader: 'Bearer signed-user-jwt',
    body: {
      kind: 'project',
      resourceId: 'project-1',
      targetUserId: 'creator-user',
      action: 'remove',
    },
  }, {
    anonKey: 'public-anon-key',
    getUserFromToken: async () => ({ id: 'co-owner', email: 'owner@example.com' }),
    selectCollaborator: async () => ({ id: 'creator-row', user_id: 'creator-user', role: 'owner' }),
    selectResource: async () => ({ name: 'Tower A', user_id: 'creator-user' }),
    updateRole: async () => [],
    removeAccess: async () => { mutationCalls += 1; return [{ id: 'creator-row' }]; },
    getTargetEmail: async () => 'creator@example.com',
    sendEmail: async () => { sendCalls += 1; return true; },
  });

  deepStrictEqual(out, {
    status: 409,
    body: { success: false, error: 'The resource creator cannot be changed' },
  });
  equal(mutationCalls, 0);
  equal(sendCalls, 0);
});
