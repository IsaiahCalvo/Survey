// Mark library rules (src/markLibrary/markLibraryModel.js): what a saved item
// keeps, how a placement lands, tokens, find/sort/group, export/import and
// who may change an item.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_EXPORT_FORMAT,
  buildLibraryExportFile,
  canChangeLibraryItem,
  cleanLibraryTags,
  defaultLibraryItemName,
  filterLibraryItems,
  formatLibraryDate,
  groupLibraryItemsByTag,
  libraryCopyName,
  libraryItemFromRow,
  libraryPayloadFromClipboard,
  libraryRowFromItem,
  parseLibraryImportFile,
  payloadHasTokens,
  planBulkTagChange,
  planLibraryPlacement,
  resolveLibraryTokens,
  sanitizeLibraryPayload,
  sortLibraryItems,
  summarizeLibraryKinds,
} from '../src/markLibrary/markLibraryModel.js';

const rect = (over = {}) => ({
  type: 'rect', left: 100, top: 200, width: 50, height: 30, stroke: '#e11d48',
  layerId: 'layer-2', regionId: 'region-9', moduleId: 'mod-1', lockedBy: 'u1',
  data: { id: 'r1', lockedBy: 'u1' }, ...over,
});
const text = (value) => ({ type: 'textbox', left: 160, top: 200, width: 80, height: 20, text: value, data: { id: 't1' } });
const callout = { id: 'callout-1', pageNumber: 3, text: 'Checked by {{author.initials}}', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.2, y: 0.2 }, lockedBy: 'u1' };
const clipboard = {
  items: [
    { kind: 'mark', object: rect() },
    { kind: 'mark', object: { type: 'path', data: { type: 'text-markup', quads: [] } } },
    { kind: 'mark', object: text('Approved {{date}}') },
    { kind: 'callout', callout },
    { kind: 'marker', entry: { bounds: { x: 120, y: 210, width: 10, height: 10 }, categoryId: 'c1', regionId: 'r', entityColor: '#2563eb' }, categoryName: 'Door', sourceModuleId: 'mod-1' },
  ],
  pageWidth: 612,
  pageHeight: 792,
  origin: { left: 100, top: 200 },
  extent: { left: 100, top: 200, width: 140, height: 30 },
  sourcePageNumber: 3,
};

test('a saved item keeps the marks but nothing tied to where they were copied from', () => {
  const payload = libraryPayloadFromClipboard(clipboard);
  assert.equal(payload.version, 1);
  assert.equal(payload.items.length, 4, 'the text highlight is left out');
  const saved = payload.items[0].object;
  for (const key of ['layerId', 'regionId', 'moduleId', 'lockedBy']) assert.equal(saved[key], undefined, key);
  assert.equal(saved.data.lockedBy, undefined);
  assert.equal(payload.items[2].callout.pageNumber, undefined);
  assert.equal(payload.items[2].callout.lockedBy, undefined);
  assert.equal(payload.items[3].entry.regionId, undefined);
  assert.equal(payload.items[3].categoryName, 'Door');
  assert.deepEqual(payload.extent, { left: 100, top: 200, width: 140, height: 30 });
  // The source clipboard is untouched.
  assert.equal(clipboard.items[0].object.layerId, 'layer-2');
  assert.deepEqual(summarizeLibraryKinds(payload), ['shape', 'text', 'callout', 'marker']);
  assert.equal(payloadHasTokens(payload), true);
});

test('only text highlights gives nothing to save', () => {
  assert.equal(libraryPayloadFromClipboard({ items: [clipboard.items[1]] }), null);
  assert.equal(libraryPayloadFromClipboard(null), null);
});

test('a placement centres the item on the point and keeps it on the page', () => {
  const payload = libraryPayloadFromClipboard(clipboard);
  const plan = planLibraryPlacement(payload, { point: { x: 300, y: 400 }, pageWidth: 612, pageHeight: 792 });
  assert.equal(plan.dx, 300 - (100 + 70));
  assert.equal(plan.dy, 400 - (200 + 15));
  const edge = planLibraryPlacement(payload, { point: { x: 5, y: 790 }, pageWidth: 612, pageHeight: 792 });
  assert.equal(100 + edge.dx, 0, 'slides in from the left edge');
  assert.equal(200 + edge.dy + 30, 792, 'slides up from the bottom edge');
  const centred = planLibraryPlacement(payload, { pageWidth: 600, pageHeight: 800 });
  assert.equal(100 + centred.dx + 70, 300);
  assert.equal(centred.clipboard.mode, 'copy');
  assert.equal(planLibraryPlacement({ items: [] }), null);
});

test('a placement fills tokens and puts measurements on the landing page scale', () => {
  const measure = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, left: 0, top: 0, width: 10, height: 0, data: { id: 'm', measure: { kind: 'length', scale: { ptPerUnit: 1, unit: 'in' } } } };
  const payload = libraryPayloadFromClipboard({ ...clipboard, items: [...clipboard.items, { kind: 'mark', object: measure }] });
  const landingScale = { ptPerUnit: 18, unit: 'ft', label: '1/4" = 1\'' };
  const plan = planLibraryPlacement(payload, {
    point: { x: 300, y: 300 },
    pageNumber: 4,
    landingScale,
    tokens: { authorName: 'Ada Lovelace', now: new Date(2026, 9, 27, 14, 5) },
  });
  const textItem = plan.clipboard.items.find((it) => it.object?.type === 'textbox');
  assert.equal(textItem.object.text, 'Approved Oct 27, 2026');
  assert.equal(plan.clipboard.items.find((it) => it.kind === 'callout').callout.text, 'Checked by AL');
  assert.deepEqual(plan.clipboard.items.find((it) => it.object?.data?.measure).object.data.measure.scale, landingScale);
  // The saved payload keeps its tokens for the next placement.
  assert.equal(payload.items[1].object.text, 'Approved {{date}}');
});

test('tokens: every name, dates your way, unknown ones stay as typed', () => {
  const ctx = {
    authorName: 'Grace Brewster Hopper', authorEmail: 'grace@example.com', documentName: 'A-201 Plan.pdf',
    projectName: 'Tower B', pageNumber: 7, now: new Date(2026, 0, 5, 9, 3),
  };
  assert.equal(resolveLibraryTokens('{{author.name}}|{{author.first_name}}|{{author.last_name}}|{{author.initials}}|{{author.email}}', ctx),
    'Grace Brewster Hopper|Grace|Hopper|GBH|grace@example.com');
  assert.equal(resolveLibraryTokens('{{document.name}} / {{project.name}} p{{page.number}}', ctx), 'A-201 Plan / Tower B p7');
  assert.equal(resolveLibraryTokens('{{ date | formatDate: "ddd, DD MMM, YYYY" }} {{time}}', ctx), 'Mon, 05 Jan, 2026 9:03 AM');
  assert.equal(resolveLibraryTokens('{{nope}} {{project.name}}', { ...ctx, projectName: '' }), '{{nope}} {{project.name}}');
  assert.equal(resolveLibraryTokens('{{author.initials}}', { authorEmail: 'sam@x.com' }), 'S');
  assert.equal(formatLibraryDate(new Date(2026, 11, 31, 23, 59), '[Due] YYYY-MM-DD HH:mm a'), 'Due 2026-12-31 23:59 pm');
});

test('names and tags', () => {
  assert.deepEqual(cleanLibraryTags([' Electrical ', 'electrical', '', 'x'.repeat(50)]), ['Electrical', 'x'.repeat(40)]);
  assert.deepEqual(cleanLibraryTags('A, b ,a'), ['A', 'b']);
  assert.equal(defaultLibraryItemName(libraryPayloadFromClipboard(clipboard)), 'Approved {{date}}');
  assert.equal(defaultLibraryItemName({ items: [{ kind: 'mark', object: rect() }] }), 'Shape');
  assert.equal(defaultLibraryItemName({ items: [{ kind: 'mark', object: rect() }, { kind: 'mark', object: rect() }] }), '2 marks');
  assert.equal(libraryCopyName('Door tag', ['Door tag', 'Door tag copy']), 'Door tag copy 2');
});

const items = [
  { id: 'a', name: 'Door tag', tags: ['Doors'], kinds: ['marker'], updatedAt: '2026-10-01' },
  { id: 'b', name: 'approved stamp', tags: ['Review', 'Doors'], kinds: ['text'], updatedAt: '2026-10-03' },
  { id: 'c', name: 'Cloud', tags: [], kinds: ['shape'], updatedAt: '2026-10-02' },
];

test('find, sort and group', () => {
  assert.deepEqual(filterLibraryItems(items, { query: 'door' }).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(filterLibraryItems(items, { query: 'survey marker' }).map((i) => i.id), ['a']);
  assert.deepEqual(filterLibraryItems(items, { tag: 'review' }).map((i) => i.id), ['b']);
  assert.deepEqual(sortLibraryItems(items, 'name').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(sortLibraryItems(items, 'newest').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(sortLibraryItems(items, 'recent', { a: 5, c: 9 }).map((i) => i.id), ['c', 'a', 'b']);
  const groups = groupLibraryItemsByTag(items);
  assert.deepEqual(groups.map((g) => [g.tag, g.items.map((i) => i.id)]), [['Doors', ['a', 'b']], ['Review', ['b']], [null, ['c']]]);
  assert.deepEqual(planBulkTagChange(items, { add: ['Site'], remove: ['doors'] }), [
    { id: 'a', tags: ['Site'] }, { id: 'b', tags: ['Review', 'Site'] }, { id: 'c', tags: ['Site'] },
  ]);
});

test('who may change an item matches the database rules', () => {
  const personal = { library: 'personal', createdBy: 'me' };
  const mine = { library: 'project', createdBy: 'me' };
  const theirs = { library: 'project', createdBy: 'them' };
  assert.equal(canChangeLibraryItem(personal, { userId: 'me' }), true);
  assert.equal(canChangeLibraryItem(personal, { userId: 'them' }), false);
  assert.equal(canChangeLibraryItem(mine, { userId: 'me', canAdd: true }), true);
  assert.equal(canChangeLibraryItem(mine, { userId: 'me', canAdd: false }), false, 'a viewer now');
  assert.equal(canChangeLibraryItem(theirs, { userId: 'me', canAdd: true }), false);
  assert.equal(canChangeLibraryItem(theirs, { userId: 'me', canManage: true }), true);
  assert.equal(canChangeLibraryItem(theirs, {}), false);
});

test('export and import round trip; bad files are refused with a sentence', () => {
  const payload = libraryPayloadFromClipboard(clipboard);
  const file = buildLibraryExportFile([{ name: 'Set', tags: ['A'], payload }], { now: new Date('2026-10-27T12:00:00Z') });
  const parsed = JSON.parse(file);
  assert.equal(parsed.format, LIBRARY_EXPORT_FORMAT);
  const back = parseLibraryImportFile(file);
  assert.equal(back.items.length, 1);
  assert.equal(back.items[0].name, 'Set');
  assert.deepEqual(back.items[0].payload.items, payload.items);
  assert.match(parseLibraryImportFile('nope').error, /not a mark library file/);
  assert.match(parseLibraryImportFile(JSON.stringify({ format: LIBRARY_EXPORT_FORMAT, version: 99, items: [] })).error, /newer Survey/);
  assert.match(parseLibraryImportFile(JSON.stringify({ format: LIBRARY_EXPORT_FORMAT, version: 1, items: [{ payload: { items: [] } }] })).error, /no marks/);
});

test('rows: unusable payloads are dropped, rows are built from items', () => {
  const payload = libraryPayloadFromClipboard(clipboard);
  const row = libraryRowFromItem({ library: 'project', projectId: 'p1', name: '  Door  set ', tags: ['x', 'X'], payload });
  assert.equal(row.name, 'Door set');
  assert.deepEqual(row.tags, ['x']);
  assert.equal(row.project_id, 'p1');
  assert.deepEqual(row.kinds, ['shape', 'text', 'callout', 'marker']);
  assert.equal(libraryRowFromItem({ library: 'personal', projectId: 'p1', name: 'a', payload }).project_id, null);
  const item = libraryItemFromRow({ id: 'i1', library: 'project', project_id: 'p1', created_by: 'u', name: 'N', tags: [], payload, updated_at: 't' });
  assert.equal(item.library, 'project');
  assert.equal(libraryItemFromRow({ id: 'i2', payload: { version: 9, items: [{}] } }), null);
  assert.equal(sanitizeLibraryPayload({ items: [{ kind: 'script', object: {} }] }), null);
});
