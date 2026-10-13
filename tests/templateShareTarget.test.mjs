// A template's Share invites by the template ROW id (uuid), never the editor's
// config id ("t_…"), which Postgres refused (22P02) on the real backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { templateShareTarget } from '../src/home/templateShareTarget.js';

const ROW = '3f0b6a52-6a0e-4a39-9d55-2c1f7b0e9a10';

test('editor working copy (config id only) resolves to the hub row id', () => {
  const editorCopy = { id: 't_muyb19t6_0', name: 'RC2', modules: [] };
  const hub = [{ id: 't_muyb19t6_0', supabaseId: ROW, name: 'RC2' }];
  const target = templateShareTarget(editorCopy, hub);
  assert.equal(target.id, ROW);
  assert.equal(target.name, 'RC2');
});

test('a template that already carries supabaseId keeps it', () => {
  assert.equal(templateShareTarget({ id: 't_x', supabaseId: ROW }, []).id, ROW);
});

test('an unsaved template has no row: id null (the dialog then explains)', () => {
  assert.equal(templateShareTarget({ id: 't_new', name: 'New' }, [{ id: 't_other', supabaseId: ROW }]).id, null);
  assert.equal(templateShareTarget(null, []), null);
});

test('SurveyHub hands the Share dialog the resolved template', () => {
  const src = readFileSync(new URL('../src/home/SurveyHub.jsx', import.meta.url), 'utf8');
  assert.match(src, /item: templateShareTarget\(template, templates\)/);
});
