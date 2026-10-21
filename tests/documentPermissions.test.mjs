import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageDocument, manageSelectionBlock } from '../src/home/documentPermissions.js';

const mine = { user_id: 'u1' };
const sharedOwner = { user_id: 'u2', my_role: 'owner' };
const sharedEditor = { user_id: 'u2', my_role: 'editor' };
const sharedViewer = { user_id: 'u2', my_role: 'viewer' };

test('uploader and owner can manage; editor and viewer cannot', () => {
  assert.equal(canManageDocument(mine, 'u1'), true);
  assert.equal(canManageDocument(sharedOwner, 'u1'), true);
  assert.equal(canManageDocument(sharedEditor, 'u1'), false);
  assert.equal(canManageDocument(sharedViewer, 'u1'), false);
  assert.equal(canManageDocument(null, 'u1'), false);
  assert.equal(canManageDocument({ user_id: undefined }, undefined), false);
});

test('a selection is blocked when any document is not manageable', () => {
  assert.equal(manageSelectionBlock([mine, sharedOwner], 'u1', 'delete'), null);
  assert.equal(manageSelectionBlock([mine, sharedViewer], 'u1', 'delete'), 'Only the owner can delete some of these');
  assert.equal(manageSelectionBlock([sharedEditor], 'u1', 'share'), 'Only the owner can share this');
});

test('desktop bulk pane shows the block reason on greyed Share / Delete', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');
  for (const verb of ['share', 'delete']) {
    assert.ok(
      src.includes(`disabled={Boolean(selectionBlock('${verb}'))} {...tip(selectionBlock('${verb}') || '', 'above')}`),
      `bulk pane ${verb} button carries the reason tooltip`,
    );
  }
});
