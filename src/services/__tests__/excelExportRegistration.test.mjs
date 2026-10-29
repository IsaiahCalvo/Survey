import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EXPORT_REGISTRATION, resolveExportRegistration } from '../excelExportRegistration.js';

const fresh = { workbookId: 'wb_new', syncToken: 'st_new' };
const existing = { workbookId: 'wb_old', syncToken: 'st_old' };
const refuse = async () => { throw new Error('kal307: owner-only'); };

test('a plain download (browser / phone) never registers, so it cannot retire the live workbook', async () => {
  let called = false;
  const out = await resolveExportRegistration({
    isDesktop: false, isLinkedPush: false, canRegister: true,
    register: async () => { called = true; return fresh; },
  });
  assert.equal(out.kind, EXPORT_REGISTRATION.NONE);
  assert.equal(called, false);
});

test('a desktop export registers as before', async () => {
  const out = await resolveExportRegistration({ isDesktop: true, isLinkedPush: false, canRegister: true, register: async () => fresh });
  assert.deepEqual(out, { kind: EXPORT_REGISTRATION.NEW, ...fresh });
});

test('an owner push gets a fresh registration and never reads the old file', async () => {
  let read = false;
  const out = await resolveExportRegistration({
    isDesktop: true, isLinkedPush: true, canRegister: true,
    register: async () => fresh, readLinkedRegistration: async () => { read = true; return existing; },
  });
  assert.equal(out.kind, EXPORT_REGISTRATION.NEW);
  assert.equal(read, false);
});

test('an editor push keeps the linked workbook\'s own link instead of writing blank cells', async () => {
  const out = await resolveExportRegistration({
    isDesktop: true, isLinkedPush: true, canRegister: true, register: refuse, readLinkedRegistration: async () => existing,
  });
  assert.deepEqual(out, { kind: EXPORT_REGISTRATION.KEPT, ...existing });
});

test('a push is stopped when the linked file has a link we cannot read back', async () => {
  const out = await resolveExportRegistration({
    isDesktop: true, isLinkedPush: true, canRegister: true, register: refuse,
    readLinkedRegistration: async () => { throw new Error('network'); },
  });
  assert.equal(out.kind, EXPORT_REGISTRATION.BLOCK);
});

test('a push over a linked file with no link goes ahead unregistered, as before', async () => {
  const out = await resolveExportRegistration({
    isDesktop: true, isLinkedPush: true, canRegister: true, register: refuse,
    readLinkedRegistration: async () => ({ workbookId: null, syncToken: null }),
  });
  assert.equal(out.kind, EXPORT_REGISTRATION.NONE);
});

test('a fresh desktop export the server refuses is a plain copy (never reads anything)', async () => {
  const out = await resolveExportRegistration({ isDesktop: true, isLinkedPush: false, canRegister: true, register: refuse });
  assert.equal(out.kind, EXPORT_REGISTRATION.NONE);
});

test('a local-only document never registers', async () => {
  const out = await resolveExportRegistration({ isDesktop: true, isLinkedPush: true, canRegister: false, register: async () => fresh });
  assert.equal(out.kind, EXPORT_REGISTRATION.NONE);
});

test('a malformed server answer is treated as a refusal', async () => {
  const out = await resolveExportRegistration({
    isDesktop: true, isLinkedPush: true, canRegister: true,
    register: async () => ({ workbookId: 'x', syncToken: '' }), readLinkedRegistration: async () => existing,
  });
  assert.equal(out.kind, EXPORT_REGISTRATION.KEPT);
});
