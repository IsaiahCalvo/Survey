// KAL-426 — the normalized Archive item contract every later ticket reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ARCHIVE_RETENTION_DAYS,
  DELETE_FOREVER_COPY,
  archiveConfirmCopy,
  buildArchiveItems,
  daysRemaining,
  expiryFromArchivedAt,
  isUserArchived,
  normalizeDocumentItem,
  normalizeProjectItem,
  normalizeTemplateItem,
} from '../src/services/archiveContract.js';
import { runArchiveBulk } from '../src/services/archiveBulk.js';
import { templateOutline, toHex6 } from '../src/services/templateConfigShape.js';

const readSrc = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const day = (n) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString();

const archivedDoc = (overrides = {}) => ({
  id: 'doc-1',
  user_id: 'owner-1',
  name: 'Site plan',
  project_id: null,
  user_archived_at: day(-1),
  user_archive_expires_at: day(29),
  archive_group_id: null,
  ...overrides,
});

test('retention is exactly 30 days and expiry derives from the archive moment', () => {
  assert.equal(ARCHIVE_RETENTION_DAYS, 30);
  assert.equal(
    expiryFromArchivedAt('2026-08-02T12:00:00.000Z'),
    '2026-09-01T12:00:00.000Z',
  );
  assert.equal(expiryFromArchivedAt(null), null);
});

test('days remaining rounds up, clamps at zero, and never goes negative', () => {
  assert.equal(daysRemaining(day(30), NOW), 30);
  assert.equal(daysRemaining(day(0.5), NOW), 1, 'a partial day still reads as a day left');
  assert.equal(daysRemaining(day(0), NOW), 0);
  assert.equal(daysRemaining(day(-5), NOW), 0, 'overdue rows wait for the purge job at 0');
  assert.equal(daysRemaining(null, NOW), 0);
});

test('the plan-limit archived flag never counts as user-archived', () => {
  // documents.archived is the Free-tier downgrade flag (20241226000002). Those
  // rows must never enter the Archive or be deleted after 30 days.
  assert.equal(isUserArchived({ archived: true, user_archived_at: null }), false);
  assert.equal(isUserArchived({ archived: false, user_archived_at: day(-1) }), true);
  assert.equal(isUserArchived(null), false);
});

test('a normalized document item carries its original project for restore', () => {
  const item = normalizeDocumentItem(
    archivedDoc({ project_id: 'proj-9' }),
    { projectName: 'Harbour works', now: NOW },
  );
  assert.equal(item.type, 'document');
  assert.equal(item.id, 'doc-1');
  assert.equal(item.name, 'Site plan');
  assert.equal(item.ownerId, 'owner-1');
  assert.equal(item.projectId, 'proj-9');
  assert.equal(item.projectName, 'Harbour works');
  assert.equal(item.daysRemaining, 29);
  assert.equal(item.childCount, 0);
});

test('an unnamed row still renders', () => {
  assert.equal(normalizeDocumentItem(archivedDoc({ name: null }), { now: NOW }).name, 'Untitled');
  assert.equal(normalizeTemplateItem({ id: 't', name: '' }, { now: NOW }).name, 'Untitled');
});

test('a project item exposes its children as descriptive rows only', () => {
  const item = normalizeProjectItem(
    { id: 'proj-1', user_id: 'owner-1', name: 'Harbour works', user_archived_at: day(-2), user_archive_expires_at: day(28), archive_group_id: 'grp-1' },
    [
      { id: 'doc-a', name: 'Level 1', project_id: 'proj-1', file_path: 'u1/a.pdf', archive_group_id: 'grp-1' },
      { id: 'doc-b', name: 'Level 2', project_id: 'proj-1', archive_group_id: 'grp-1' },
    ],
    { now: NOW },
  );
  assert.equal(item.type, 'project');
  assert.equal(item.childCount, 2);
  assert.deepEqual(item.children.map((c) => c.name), ['Level 1', 'Level 2']);
  // Children are display rows: they carry no expiry and no owner of their own,
  // because they can never be restored or deleted independently.
  assert.equal(item.children[0].archiveGroupId, 'grp-1');
  assert.equal(item.daysRemaining, 28);
  // ...but they DO carry file_path, which is what lets an expanded project's
  // rows render the same real page thumbnail the Documents ledger shows.
  assert.equal(item.children[0].filePath, 'u1/a.pdf');
  assert.equal(item.children[1].filePath, null);
});

/* ------------------------------------------------------------------------
   Template contents (2026-08-07 owner ask): "when I delete a template, I want
   the template to show information, like the entities that it has... the
   modules it has, with the individual categories underneath it as a tree".
   ------------------------------------------------------------------------ */

const templateRow = (config) => ({
  id: 'tpl-1',
  user_id: 'owner-1',
  name: 'Fire doors',
  config,
  user_archived_at: day(-3),
  user_archive_expires_at: day(27),
});

test('a normalized template carries its modules, nested categories and entities', () => {
  const item = normalizeTemplateItem(templateRow({
    modules: [
      {
        id: 'm1',
        name: 'Egress',
        categories: [
          { id: 'c1', name: 'Doors', checklist: [{ id: 'i1', text: 'Latch' }, { id: 'i2', text: 'Closer' }] },
          { id: 'c2', name: 'Signage', checklist: [] },
        ],
      },
      { id: 'm2', name: 'Fire stopping', categories: [] },
    ],
    entities: [
      { id: 'e1', name: 'Contractor', color: '#e07a5e' },
      { id: 'e2', name: 'Client', color: 'rgba(122,183,230,0.35)' },
    ],
  }), { now: NOW });

  assert.equal(item.type, 'template');
  assert.deepEqual(item.modules.map((m) => m.name), ['Egress', 'Fire stopping']);
  assert.deepEqual(item.modules[0].categories.map((c) => c.name), ['Doors', 'Signage']);
  // Checklist lines are COUNTED, not listed — the preview answers "is this the
  // template I meant?", and a full checklist would bury that.
  assert.deepEqual(item.modules[0].categories.map((c) => c.itemCount), [2, 0]);
  assert.deepEqual(item.modules[1].categories, []);
  assert.deepEqual(item.entities.map((e) => e.name), ['Contractor', 'Client']);
  // An rgba entity colour normalizes to the hex the swatch needs.
  assert.equal(item.entities[1].color, '#7ab7e6');
  // No "Match fill" refinement: the border falls back to the fill colour.
  assert.equal(item.entities[0].borderColor, '#e07a5e');
});

test('the template outline tolerates every legacy shape the editor tolerates', () => {
  // Structure under a legacy `spaces` key, categories under `cats`, checklist
  // under `items`, entities as `role` — all shapes TemplatesEditor reads.
  const legacy = templateOutline({
    spaces: [{ name: 'Old module', cats: [{ name: 'Old category', items: ['One', 'Two', ''] }] }],
    entities: [{ role: 'Surveyor', color: '#abc' }],
  });
  assert.equal(legacy.modules[0].name, 'Old module');
  assert.equal(legacy.modules[0].categories[0].name, 'Old category');
  assert.equal(legacy.modules[0].categories[0].itemCount, 2, 'blank lines are not counted');
  assert.equal(legacy.entities[0].name, 'Surveyor');
  assert.equal(legacy.entities[0].color, '#aabbcc');
  // Legacy rows with no ids still get stable React keys.
  assert.equal(legacy.modules[0].id, 'm0');
  assert.equal(legacy.modules[0].categories[0].id, 'm0c0');
  assert.equal(legacy.entities[0].id, 'e0');

  // Unnamed rows degrade to a positional label rather than rendering blank.
  const unnamed = templateOutline({ modules: [{ categories: [{}] }], entities: [{}] });
  assert.equal(unnamed.modules[0].name, 'Module 1');
  assert.equal(unnamed.modules[0].categories[0].name, 'Category 1');
  assert.equal(unnamed.entities[0].name, 'Entity 1');

  // "Match fill" collapses the border onto the fill, exactly as the editor's
  // entitySwatch() does.
  const matched = templateOutline({ entities: [{ name: 'A', color: '#111111', borderColor: '#999999', matchFill: true }] });
  assert.equal(matched.entities[0].borderColor, '#111111');
  const unmatched = templateOutline({ entities: [{ name: 'A', color: '#111111', borderColor: '#999999' }] });
  assert.equal(unmatched.entities[0].borderColor, '#999999');

  assert.equal(toHex6(null), '#8c8c8a', 'a missing colour still renders a swatch');
});

test('a template with no structure at all still normalizes to empty lists', () => {
  // The screen reads item.modules / item.entities unconditionally, so these
  // must never be undefined — including when the query forgot to select config.
  const bare = normalizeTemplateItem({ id: 't', name: 'Bare', user_archived_at: day(-1) }, { now: NOW });
  assert.deepEqual(bare.modules, []);
  assert.deepEqual(bare.entities, []);
});

test('both template queries select config, or the preview silently shows nothing', () => {
  // archiveService.js keeps its own duplicated column list; the two must match.
  const service = readSrc('../src/services/archiveService.js');
  const templateService = readSrc('../src/services/templateArchiveService.js');
  assert.match(service, /\.from\('templates'\)[\s\S]*?\.select\('[^']*\bconfig\b[^']*'\)/);
  assert.match(templateService, /const TEMPLATE_ARCHIVE_COLUMNS =\s*\n?\s*'[^']*\bconfig\b[^']*'/);
  // The editor and the Archive preview read the same converters — no second
  // derivation of the persisted shape.
  const contract = readSrc('../src/services/archiveContract.js');
  const editor = readSrc('../src/home/TemplatesEditor.jsx');
  assert.match(contract, /import \{ templateOutline \} from '\.\/templateConfigShape\.js'/);
  assert.match(editor, /from '\.\.\/services\/templateConfigShape'/);
  assert.doesNotMatch(editor, /^const modulesOf =/m, 'the editor must not keep a private copy of the readers');
});

test('buildArchiveItems folds project children in and keeps standalone docs top level', () => {
  const items = buildArchiveItems({
    documents: [
      archivedDoc({ id: 'doc-child', name: 'Level 1', project_id: 'proj-1', archive_group_id: 'grp-1' }),
      archivedDoc({ id: 'doc-solo', name: 'Site plan', project_id: 'proj-2' }),
      // A Free-tier downgrade row must be ignored entirely.
      { id: 'doc-plan', user_id: 'owner-1', name: 'Old survey', archived: true, user_archived_at: null },
    ],
    projects: [
      { id: 'proj-1', user_id: 'owner-1', name: 'Harbour works', user_archived_at: day(-2), user_archive_expires_at: day(28), archive_group_id: 'grp-1' },
    ],
    templates: [
      { id: 'tpl-1', user_id: 'owner-1', name: 'Fire doors', user_archived_at: day(-3), user_archive_expires_at: day(27) },
    ],
    projectNamesById: { 'proj-2': 'Depot' },
    now: NOW,
  });

  assert.equal(items.length, 3, 'project + standalone document + template');
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  assert.equal(byId['proj-1'].childCount, 1);
  assert.equal(byId['proj-1'].children[0].id, 'doc-child');
  assert.ok(!byId['doc-child'], 'a project child never also appears at top level');
  assert.equal(byId['doc-solo'].projectName, 'Depot');
  assert.equal(byId['tpl-1'].type, 'template');
  assert.ok(!byId['doc-plan'], 'plan-limit archived rows stay out of the Archive');
});

test('a document whose group has no archived project stays top level', () => {
  // Defensive: a stale group id must not make an item disappear from the screen.
  const items = buildArchiveItems({
    documents: [archivedDoc({ archive_group_id: 'grp-orphan' })],
    projects: [],
    now: NOW,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'document');
});

test('confirmation copy matches the locked KAL-280 wording', () => {
  const project = archiveConfirmCopy({ type: 'project', name: 'Harbour works', childCount: 3 });
  assert.equal(project.title, 'Archive this project?');
  assert.equal(project.confirmLabel, 'Archive project');
  assert.match(project.message, /Harbour works and its 3 documents will move to Archive and remain recoverable for 30 days\./);

  const single = archiveConfirmCopy({ type: 'project', name: 'Depot', childCount: 1 });
  assert.match(single.message, /its 1 document will/, 'singular is not pluralized');

  const doc = archiveConfirmCopy({ type: 'document', name: 'Site plan' });
  assert.equal(doc.title, 'Archive this document?');
  assert.equal(doc.confirmLabel, 'Archive document');

  const tpl = archiveConfirmCopy({ type: 'template', name: 'Fire doors' });
  assert.equal(tpl.title, 'Archive this template?');
  assert.equal(tpl.confirmLabel, 'Archive template');

  assert.equal(DELETE_FOREVER_COPY.title, 'Delete forever?');
  assert.equal(DELETE_FOREVER_COPY.confirmLabel, 'Delete forever');
  assert.match(DELETE_FOREVER_COPY.message, /^This cannot be undone\./);
});

test('bulk fan-out attempts every item and reports each outcome', async () => {
  const calls = [];
  const dispatch = {
    document: async (id) => { calls.push(id); return { success: true }; },
    project: async (id) => { calls.push(id); return { success: false, error: 'Only the owner of this project can do that.' }; },
    template: async (id) => { calls.push(id); throw new Error('network down'); },
  };

  const result = await runArchiveBulk(
    [
      { type: 'document', id: 'doc-1', name: 'Site plan' },
      { type: 'project', id: 'proj-1', name: 'Harbour works' },
      { type: 'template', id: 'tpl-1', name: 'Fire doors' },
    ],
    dispatch,
    'restored',
  );

  assert.deepEqual(calls, ['doc-1', 'proj-1', 'tpl-1'], 'a failure does not stop the rest');
  assert.deepEqual(result.succeeded.map((i) => i.id), ['doc-1']);
  assert.equal(result.failed.length, 2);
  assert.equal(result.failed[0].error, 'Only the owner of this project can do that.');
  assert.equal(result.failed[1].error, 'network down');
});

test('bulk fan-out rejects an unknown item type instead of throwing', async () => {
  const result = await runArchiveBulk([{ type: 'mystery', id: 'x', name: 'Thing' }], {}, 'restored');
  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failed[0].error, 'Thing cannot be restored.');
});

test('bulk fan-out tolerates an empty or missing selection', async () => {
  assert.deepEqual(await runArchiveBulk([], {}, 'restored'), { succeeded: [], failed: [] });
  assert.deepEqual(await runArchiveBulk(null, {}, 'restored'), { succeeded: [], failed: [] });
});
