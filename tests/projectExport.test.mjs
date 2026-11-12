// Export project (Nightly flag project-export, Drawboard Projects parity
// EX-10 / EX-12 / EX-17): zip names and folders, the Number - Name -
// Revision pattern, every revision, comments paths and the flag row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  commentsPathFor, exportFileBase, exportProgressText, projectExportPlan, projectZipName, safeZipName, uniqueZipPath,
} from '../src/home/projectExport.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const sql = readFileSync(new URL('../supabase/migrations/20261112131000_project_export_flag.sql', import.meta.url), 'utf8');

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['project-export']?.stage, 'beta');
  assert.match(sql, /'project-export', 'off'/);
});

test('names: Number - Name - Revision, no repeated number, safe characters', () => {
  assert.equal(exportFileBase({ name: 'Ground floor.pdf', sheet_number: 'A101', sheet_revision: 'B' }), 'A-101 - Ground floor - B');
  assert.equal(exportFileBase({ name: 'A-101 Ground floor.pdf', sheet_number: 'A101', sheet_revision: 'B' }), 'A-101 Ground floor - B');
  assert.equal(exportFileBase({ name: 'Spec: v1?.pdf' }), 'Spec v1');
  assert.equal(exportFileBase({ name: 'Spec.pdf' }, { isCurrent: false, versionNumber: 2 }), 'Spec - v2');
  assert.equal(safeZipName('  a/b\\c  '), 'a b c');
  assert.equal(safeZipName(''), 'File');
});

test('paths stay unique', () => {
  const taken = new Set();
  assert.equal(uniqueZipPath(taken, 'Drawings/x.pdf'), 'Drawings/x.pdf');
  assert.equal(uniqueZipPath(taken, 'Drawings/x.pdf'), 'Drawings/x (2).pdf');
  assert.equal(uniqueZipPath(taken, 'Drawings/x.pdf'), 'Drawings/x (3).pdf');
  assert.equal(commentsPathFor(taken, 'Drawings/x.pdf'), 'Comments/x comments.csv');
});

test('the plan: drawings by number first, documents after, older copies when asked, local-only files skipped', () => {
  const documents = [
    { id: 'spec', name: 'Spec.pdf', file_path: 'u/spec.pdf' },
    { id: 's2', name: 'Framing.pdf', file_path: 'u/s2.pdf', sheet_number: 'S201', sheet_revision: '1' },
    { id: 'a1', name: 'Plan.pdf', file_path: 'u/a1.pdf', sheet_number: 'A101', sheet_revision: 'C' },
    { id: 'local', name: 'Phone only.pdf', file_path: null },
  ];
  const versions = {
    a1: [
      { id: 'a1-v1', name: 'Plan.pdf', file_path: 'u/a1v1.pdf', sheet_number: 'A101', sheet_revision: 'A', versionNumber: 1, isCurrent: false },
      { id: 'a1-v2', name: 'Plan.pdf', file_path: 'u/a1v2.pdf', sheet_number: 'A101', sheet_revision: 'B', versionNumber: 2, isCurrent: false },
      { id: 'a1', isCurrent: true },
    ],
    spec: [{ id: 'spec-v1', name: 'Spec.pdf', file_path: 'u/specv1.pdf', versionNumber: 1, isCurrent: false }],
  };
  const current = projectExportPlan({ documents, versions });
  assert.deepEqual(current.files.map((f) => f.path), ['Drawings/A-101 - Plan - C.pdf', 'Drawings/S-201 - Framing - 1.pdf', 'Documents/Spec.pdf']);
  assert.deepEqual(current.skipped, ['Phone only']);
  const all = projectExportPlan({ documents, versions, allRevisions: true });
  assert.deepEqual(all.files.map((f) => [f.path, f.documentId, f.isCurrent]), [
    ['Drawings/A-101 - Plan - C.pdf', 'a1', true],
    ['Drawings/A-101 - Plan - B.pdf', 'a1-v2', false],
    ['Drawings/A-101 - Plan - A.pdf', 'a1-v1', false],
    ['Drawings/S-201 - Framing - 1.pdf', 's2', true],
    ['Documents/Spec.pdf', 'spec', true],
    ['Documents/Spec - v1.pdf', 'spec-v1', false],
  ]);
});

test('zip name and progress words', () => {
  assert.equal(projectZipName('Tower: Block A', 5), 'Tower Block A (5 items).zip');
  assert.equal(projectZipName('', 1), 'Project (1 item).zip');
  assert.equal(exportProgressText({ done: 0, total: 3 }), 'Adding file 1 of 3…');
  assert.equal(exportProgressText({ phase: 'zip' }), 'Packing the zip…');
});
