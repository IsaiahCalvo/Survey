// Shared documents carry their survey templates (owner 2026-10-07: "When you
// share a document, should the people you share it with get your survey
// template so they can see and place your survey markers?" -> "Yes, they can
// use and edit it"). The grant runs in the template owner's app under the
// CURRENT database rules (migration 20260701120000): only a template's owner
// may add template_collaborators rows; any collaborator may read the template;
// editors may update it. The in-memory client below enforces those rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  documentMembers,
  grantDocumentTemplates,
  grantRememberedDocumentTemplates,
  mergeOwnAndSharedTemplateRows,
  ownTemplateRowIds,
  ownerDisplayName,
  planTemplateGrants,
  readRememberedDocumentTemplates,
  rememberDocumentTemplates,
  sameTemplateConfig,
  sharedFromRow,
  sharedTemplateLabel,
  splitTemplatesForSave,
  stripSharedFields,
  surveyMarkersNeedUnknownTemplate,
  templateRoleForDocumentRole,
  templatesUsedByDocument,
} from '../src/services/sharedTemplates.js';
import { buildAtomicTemplatePayload, mapAuthoritativeTemplateRows } from '../src/home/templatePersistence.js';
import { sanitizeTemplateConfig } from '../src/utils/templateConfig.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';
const DOC = 'dddddddd-0000-4000-8000-00000000000d';
const TPL = '11111111-0000-4000-8000-000000000001';
const TPL2 = '22222222-0000-4000-8000-000000000002';
const B_TPL = '33333333-0000-4000-8000-000000000003';

const template = (id, rowId, moduleId, categoryId, extra = {}) => ({
  id,
  supabaseId: rowId,
  name: `Template ${id}`,
  modules: [{ id: moduleId, name: 'Module', categories: [{ id: categoryId, name: 'Walls' }] }],
  ...extra,
});

// ---------------------------------------------------------------- in-memory db

function makeDb() {
  return {
    templates: [
      { id: TPL, user_id: A, name: 'Walls', config: { id: 't_a1', name: 'Walls', modules: [{ id: 'm1', categories: [{ id: 'c1' }] }] }, created_at: '2026-10-01T00:00:00Z', user_archived_at: null },
      { id: TPL2, user_id: A, name: 'Doors', config: { id: 't_a2', name: 'Doors', modules: [] }, created_at: '2026-10-02T00:00:00Z', user_archived_at: null },
      { id: B_TPL, user_id: B, name: 'B own', config: { id: 't_b1', name: 'B own' }, created_at: '2026-10-03T00:00:00Z', user_archived_at: null },
    ],
    documents: [{ id: DOC, user_id: A, project_id: null }],
    document_collaborators: [
      { document_id: DOC, user_id: B, role: 'editor', email: 'b@example.com', status: 'active' },
      { document_id: DOC, user_id: C, role: 'viewer', email: 'c@example.com', status: 'active' },
    ],
    template_collaborators: [],
    document_templates: [],
    projects: [],
    project_collaborators: [],
    writes: [],
  };
}

const canAccessTemplate = (db, uid, tplId, need) => {
  const tpl = db.templates.find((t) => t.id === tplId);
  if (!tpl) return false;
  if (tpl.user_id === uid) return true;
  const row = db.template_collaborators.find((r) => r.template_id === tplId && r.user_id === uid && r.status === 'active');
  if (!row) return false;
  const rank = { viewer: 1, editor: 2, owner: 3 };
  return rank[row.role] >= rank[need];
};

// RLS as in the migrations, for the tables the grant touches.
const visible = (db, uid, table, row) => {
  if (table === 'templates') return canAccessTemplate(db, uid, row.id, 'viewer');
  if (table === 'template_collaborators') return canAccessTemplate(db, uid, row.template_id, 'viewer');
  return true;
};

function clientFor(db, uid) {
  const from = (table) => {
    const filters = [];
    let op = 'select';
    let payload = null;
    let single = false;
    const builder = {
      select() { return builder; },
      eq(col, v) { filters.push((r) => String(r[col]) === String(v)); return builder; },
      in(col, vs) { filters.push((r) => vs.map(String).includes(String(r[col]))); return builder; },
      is(col, v) { filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return builder; },
      gt(col, v) { filters.push((r) => String(r[col]) > String(v)); return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() { single = true; return builder; },
      insert(rows) { op = 'insert'; payload = rows; return builder; },
      update(patch) { op = 'update'; payload = patch; return builder; },
      upsert(rows) { op = 'upsert'; payload = rows; return builder; },
      then(resolve, reject) {
        try { resolve(run()); } catch (e) { reject(e); }
      },
    };
    const run = () => {
      const rows = db[table];
      const match = (r) => filters.every((f) => f(r)) && visible(db, uid, table, r);
      if (op === 'insert') {
        for (const r of payload) {
          if (table === 'template_collaborators' && !canAccessTemplate(db, uid, r.template_id, 'owner')) {
            return { data: null, error: { message: 'new row violates row-level security policy' } };
          }
        }
        for (const r of payload) {
          if (rows.some((x) => x.template_id === r.template_id && x.user_id === r.user_id)) {
            return { data: null, error: { message: 'duplicate key' } };
          }
        }
        payload.forEach((r, i) => rows.push({ id: `tc-${rows.length + i}`, ...r }));
        db.writes.push({ table, op, n: payload.length });
        return { data: null, error: null };
      }
      if (op === 'upsert') {
        // document_templates: only the template's owner links it (insert policy).
        if (payload.some((r) => r.linked_by !== uid || !canAccessTemplate(db, uid, r.template_id, 'owner'))) {
          return { data: null, error: { message: 'new row violates row-level security policy' } };
        }
        const fresh = payload.filter((r) => !rows.some((x) => x.document_id === r.document_id && x.template_id === r.template_id));
        rows.push(...fresh.map((r) => ({ ...r })));
        db.writes.push({ table, op, n: fresh.length });
        return { data: null, error: null };
      }
      if (op === 'update') {
        let hit = rows.filter(match);
        if (table === 'template_collaborators') hit = hit.filter((r) => canAccessTemplate(db, uid, r.template_id, 'owner'));
        if (table === 'templates') hit = hit.filter((r) => r.user_id === uid || canAccessTemplate(db, uid, r.id, 'editor'));
        hit.forEach((r) => Object.assign(r, payload));
        db.writes.push({ table, op, n: hit.length });
        return { data: null, error: null };
      }
      const out = rows.filter(match).map((r) => ({ ...r }));
      return { data: single ? (out[0] ?? null) : out, error: null };
    };
    return builder;
  };
  return { from };
}

// ---------------------------------------------------------------- reading

test('my templates come first, then the ones shared with me with my role', () => {
  const merged = mergeOwnAndSharedTemplateRows({
    ownRows: [{ id: B_TPL, user_id: B }],
    sharedRows: [{ id: TPL, user_id: A, config: { ownerName: 'Ann Lee' } }, { id: TPL2, user_id: A }],
    collaboratorRows: [{ template_id: TPL, role: 'editor', status: 'active' }],
    userId: B,
  });
  assert.deepEqual(merged.map((r) => r.id), [B_TPL, TPL]);
  assert.equal(merged[1].shared_role, 'editor');
  assert.deepEqual(sharedFromRow(merged[1]), { ownerId: A, ownerName: 'Ann Lee', role: 'editor', canEdit: true });
  assert.equal(sharedFromRow(merged[0]), null);
});

test('a row I own never counts as shared, and a switched-off grant is ignored', () => {
  const merged = mergeOwnAndSharedTemplateRows({
    ownRows: [],
    sharedRows: [{ id: TPL, user_id: B }, { id: TPL2, user_id: A }],
    collaboratorRows: [{ template_id: TPL, role: 'editor' }, { template_id: TPL2, role: 'editor', status: 'removed' }],
    userId: B,
  });
  assert.deepEqual(merged, []);
});

test('the app shape keeps who shared it; the stored template never carries that note', () => {
  const [mapped] = mapAuthoritativeTemplateRows([{ id: TPL, user_id: A, shared_role: 'viewer', config: { id: 't_a1', name: 'Walls', ownerName: 'Ann Lee', sharedFrom: { forged: true } } }]);
  assert.deepEqual(mapped.sharedFrom, { ownerId: A, ownerName: 'Ann Lee', role: 'viewer', canEdit: false });
  const [own] = mapAuthoritativeTemplateRows([{ id: B_TPL, user_id: B, config: { id: 't_b1', name: 'B', sharedFrom: { forged: true } } }]);
  assert.equal(own.sharedFrom, undefined, 'a stray stored sharedFrom never makes my own template look shared');
  assert.equal(sanitizeTemplateConfig(mapped).sharedFrom, undefined);
  assert.equal(sanitizeTemplateConfig(mapped).supabaseId, undefined);
  const [payload] = buildAtomicTemplatePayload([{ ...mapped, sharedFrom: mapped.sharedFrom }], { ownerId: B });
  assert.equal(payload.config.sharedFrom, undefined);
  assert.equal(stripSharedFields(mapped).sharedFrom, undefined);
});

test('saving splits my templates from shared ones (the snapshot only ever holds mine)', () => {
  const own = template('t_b1', B_TPL, 'mb', 'cb');
  const shared = template('t_a1', TPL, 'm1', 'c1', { sharedFrom: { ownerId: A, role: 'editor', canEdit: true } });
  const split = splitTemplatesForSave([own, shared, null]);
  assert.deepEqual(split.own.map((t) => t.id), ['t_b1']);
  assert.deepEqual(split.shared.map((t) => t.id), ['t_a1']);
});

test('config comparison ignores key order', () => {
  assert.equal(sameTemplateConfig({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  assert.equal(sameTemplateConfig({ a: 1 }, { a: 2 }), false);
});

test('badge label names the owner and says when it is use only', () => {
  assert.equal(sharedTemplateLabel({ ownerName: 'Ann Lee', canEdit: true }), 'Shared by Ann Lee');
  assert.equal(sharedTemplateLabel({ ownerName: null, canEdit: false }), 'Shared by another person · use only');
});

// ------------------------------------------------- which templates a document uses

test('a document uses the templates its survey markers point at, plus the open and remembered ones', () => {
  const templates = [
    template('t_a1', TPL, 'm1', 'c1'),
    template('t_a2', TPL2, 'm2', 'c2'),
    template('t_b1', B_TPL, 'mb', 'cb', { sharedFrom: { ownerId: B } }),
    template('t_local', null, 'mx', 'cx'),
  ];
  const markers = { x: { moduleId: 'm1', categoryId: 'c1' }, y: { categoryId: 'cb' } };
  const used = templatesUsedByDocument({ surveyMarkers: markers, templates, extraTemplateIds: ['t_a2'] });
  assert.deepEqual(used.map((t) => t.id).sort(), ['t_a1', 't_a2', 't_b1']);
  // Only my own saved templates can be granted.
  assert.deepEqual(ownTemplateRowIds(used), [TPL, TPL2].sort());
});

test('markers from a template I do not have ask the lists to read again', () => {
  const templates = [template('t_b1', B_TPL, 'mb', 'cb')];
  assert.equal(surveyMarkersNeedUnknownTemplate({ x: { moduleId: 'm1', categoryId: 'c1' } }, templates), true);
  assert.equal(surveyMarkersNeedUnknownTemplate({ x: { moduleId: 'mb', categoryId: 'cb' } }, templates), false);
  assert.equal(surveyMarkersNeedUnknownTemplate({}, templates), false);
});

// ---------------------------------------------------------------- planning

test('roles: document editors and owners can edit the template, viewers only use it', () => {
  assert.equal(templateRoleForDocumentRole('owner'), 'editor');
  assert.equal(templateRoleForDocumentRole('editor'), 'editor');
  assert.equal(templateRoleForDocumentRole('viewer'), 'viewer');
  assert.equal(templateRoleForDocumentRole('stranger'), null);
});

test('members: direct document role wins over the project role; the creators are owners; me left out', () => {
  const members = documentMembers({
    me: A,
    documentOwnerId: A,
    documentRows: [{ user_id: B, role: 'viewer', status: 'active' }, { user_id: 'gone', role: 'editor', status: 'removed' }],
    projectOwnerId: C,
    projectRows: [{ user_id: B, role: 'editor', status: 'active' }],
  });
  const byId = Object.fromEntries(members.map((m) => [m.userId, m.role]));
  assert.deepEqual(byId, { [B]: 'viewer', [C]: 'owner' });
});

// realCheck3 (2026-10-07, real backend): this used to pin "never lower", so
// a member the owner switched to viewer on the document could still change
// the template. The role now follows the document role both ways, except for
// a row the person got through a template invite of its own.
test('plan: add missing rows, raise viewer to editor, lower a document-given editor to viewer, never touch a switched-off row', () => {
  const plan = planTemplateGrants({
    templateRowIds: [TPL],
    templateOwners: new Map([[TPL, A]]),
    members: [
      { userId: B, role: 'viewer' },
      { userId: C, role: 'editor' },
      { userId: 'd', role: 'editor' },
      { userId: 'e', role: 'editor' },
      { userId: A, role: 'owner' },
    ],
    existing: [
      { id: 'r1', template_id: TPL, user_id: B, role: 'editor', status: 'active' },
      { id: 'r2', template_id: TPL, user_id: C, role: 'viewer', status: 'active' },
      { id: 'r3', template_id: TPL, user_id: 'd', role: 'viewer', status: 'removed' },
    ],
    grantedBy: A,
  });
  assert.deepEqual(plan.inserts.map((r) => [r.user_id, r.role, r.status, r.invited_by]), [['e', 'editor', 'active', A]]);
  assert.deepEqual(plan.upgrades.map((r) => [r.id, r.role]), [['r2', 'editor']]);
  assert.deepEqual(plan.downgrades.map((r) => [r.id, r.role]), [['r1', 'viewer']]);
});

test('plan: a row from an accepted template invite is never lowered', () => {
  const plan = planTemplateGrants({
    templateRowIds: [TPL],
    templateOwners: new Map([[TPL, A]]),
    members: [{ userId: B, role: 'viewer' }],
    existing: [{ id: 'r1', template_id: TPL, user_id: B, role: 'editor', status: 'active' }],
    grantedBy: A,
    invitedKeys: new Set([`${TPL}|${B}`]),
  });
  assert.deepEqual([plan.inserts.length, plan.upgrades.length, plan.downgrades.length], [0, 0, 0]);
});

// ---------------------------------------------------------------- granting

test('the owner opening a shared document gives every member its templates (editor / viewer)', async () => {
  const db = makeDb();
  const res = await grantDocumentTemplates({ client: clientFor(db, A), documentId: DOC, userId: A, ownerName: 'Ann Lee', templateRowIds: [TPL] });
  assert.deepEqual([res.granted, res.upgraded, res.skipped], [2, 0, null]);
  const rows = db.template_collaborators.map((r) => [r.user_id, r.role, r.status, r.invited_by]);
  assert.deepEqual(rows, [[B, 'editor', 'active', A], [C, 'viewer', 'active', A]]);
  assert.equal(db.templates.find((t) => t.id === TPL).config.ownerName, 'Ann Lee');
  // B can now read it (and edit it); C can read it but not edit it.
  const bRead = await clientFor(db, B).from('templates').select('*').in('id', [TPL]);
  assert.equal(bRead.data.length, 1);
  await clientFor(db, C).from('templates').update({ name: 'C was here' }).eq('id', TPL);
  assert.equal(db.templates.find((t) => t.id === TPL).name, 'Walls');
  await clientFor(db, B).from('templates').update({ name: 'B edit' }).eq('id', TPL);
  assert.equal(db.templates.find((t) => t.id === TPL).name, 'B edit');
});

test('running again writes nothing (reads first, writes only what is missing)', async () => {
  const db = makeDb();
  const client = clientFor(db, A);
  await grantDocumentTemplates({ client, documentId: DOC, userId: A, ownerName: 'Ann Lee', templateRowIds: [TPL] });
  const writes = db.writes.length;
  const again = await grantDocumentTemplates({ client, documentId: DOC, userId: A, ownerName: 'Ann Lee', templateRowIds: [TPL] });
  assert.deepEqual([again.granted, again.upgraded], [0, 0]);
  assert.equal(db.writes.length, writes);
});

test('the owner switches an editor to viewer: their template row goes to viewer (one invites read)', async () => {
  const db = makeDb();
  db.template_invites = [];
  const client = clientFor(db, A);
  await grantDocumentTemplates({ client, documentId: DOC, userId: A, templateRowIds: [TPL] });
  db.document_collaborators.find((r) => r.user_id === B).role = 'viewer';
  const res = await grantDocumentTemplates({ client, documentId: DOC, userId: A, templateRowIds: [TPL] });
  assert.deepEqual([res.granted, res.upgraded, res.downgraded], [0, 0, 1]);
  assert.equal(db.template_collaborators.find((r) => r.user_id === B).role, 'viewer');
  // B can still read it, but no longer change it.
  await clientFor(db, B).from('templates').update({ name: 'B edit' }).eq('id', TPL);
  assert.equal(db.templates.find((t) => t.id === TPL).name, 'Walls');
  // Back to editor: raised again.
  db.document_collaborators.find((r) => r.user_id === B).role = 'editor';
  const up = await grantDocumentTemplates({ client, documentId: DOC, userId: A, templateRowIds: [TPL] });
  assert.equal(up.upgraded, 1);
  assert.equal(db.template_collaborators.find((r) => r.user_id === B).role, 'editor');
});

test('a person who accepted a template invite as editor keeps editing when the document makes them viewer', async () => {
  const db = makeDb();
  db.template_collaborators = [{ id: 'tc-b', template_id: TPL, user_id: B, role: 'editor', status: 'active', invited_by: A }];
  db.template_invites = [{ template_id: TPL, accepted_by: B }];
  db.document_collaborators.find((r) => r.user_id === B).role = 'viewer';
  const res = await grantDocumentTemplates({ client: clientFor(db, A), documentId: DOC, userId: A, templateRowIds: [TPL] });
  assert.equal(res.downgraded, 0);
  assert.equal(db.template_collaborators.find((r) => r.user_id === B).role, 'editor');
});

test('a member cannot grant someone else\'s template (only the owner can, as the database says)', async () => {
  const db = makeDb();
  const res = await grantDocumentTemplates({ client: clientFor(db, B), documentId: DOC, userId: B, templateRowIds: [TPL] });
  assert.equal(res.granted, 0);
  assert.equal(db.template_collaborators.length, 0);
});

test('an editor\'s own template used on the document goes to the other members, owner included', async () => {
  const db = makeDb();
  const res = await grantDocumentTemplates({ client: clientFor(db, B), documentId: DOC, userId: B, ownerName: 'Bo', templateRowIds: [B_TPL] });
  assert.equal(res.granted, 2);
  const byUser = Object.fromEntries(db.template_collaborators.map((r) => [r.user_id, r.role]));
  assert.deepEqual(byUser, { [A]: 'editor', [C]: 'viewer' });
});

test('a private document grants nothing, but links its templates for whoever joins later', async () => {
  // realCheck4 (real backend, 2026-10-07): a document shared by a link that
  // is accepted while the owner is away got no link row, so the member's
  // claim found nothing. The grant now links before it checks for members.
  const db = makeDb();
  db.document_collaborators = [];
  const res = await grantDocumentTemplates({ client: clientFor(db, A), documentId: DOC, userId: A, templateRowIds: [TPL] });
  assert.equal(res.skipped, 'not shared');
  assert.equal(db.template_collaborators.length, 0);
  assert.deepEqual(db.document_templates, [{ document_id: DOC, template_id: TPL, linked_by: A }]);
  assert.deepEqual(db.writes, [{ table: 'document_templates', op: 'upsert', n: 1 }]);
});

test('a member cannot link someone else\'s template to the document', async () => {
  const db = makeDb();
  await grantDocumentTemplates({ client: clientFor(db, B), documentId: DOC, userId: B, templateRowIds: [TPL] });
  assert.deepEqual(db.document_templates, []);
});

test('a share from Home grants the templates this device saw the document use', async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  rememberDocumentTemplates(DOC, [TPL, 'not-a-uuid'], storage);
  assert.deepEqual(readRememberedDocumentTemplates(DOC, storage), [TPL]);
  const db = makeDb();
  const user = { id: A, email: 'ann@example.com', user_metadata: { full_name: 'Ann Lee' } };
  const res = await grantRememberedDocumentTemplates({ client: clientFor(db, A), documentId: DOC, user, storage });
  assert.equal(res.granted, 2);
  rememberDocumentTemplates(DOC, [], storage);
  assert.deepEqual(readRememberedDocumentTemplates(DOC, storage), []);
});

test('owner name: full name, then first + last, then email', () => {
  assert.equal(ownerDisplayName({ user_metadata: { full_name: 'Ann Lee' }, email: 'a@x.io' }), 'Ann Lee');
  assert.equal(ownerDisplayName({ user_metadata: { first_name: 'Ann', last_name: 'Lee' } }), 'Ann Lee');
  assert.equal(ownerDisplayName({ email: 'a@x.io' }), 'a@x.io');
  assert.equal(ownerDisplayName(null), null);
});

// ---------------------------------------------------------------- wiring

test('the templates read lists shared templates and keeps them across a snapshot save', () => {
  const hook = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
  const start = hook.indexOf('export const useTemplates');
  const body = hook.slice(start, hook.indexOf('// TEMPLATE UTILITY FUNCTIONS', start));
  assert.match(body, /from\('template_collaborators'\)[\s\S]*\.eq\('user_id', user\.id\)[\s\S]*\.eq\('status', 'active'\)/);
  assert.match(body, /mergeOwnAndSharedTemplateRows\(/);
  assert.match(body, /subscribeTemplatesChange\(/);
  assert.match(body, /filter\(isSharedTemplateRow\)/);
});

test('the hub saves shared templates to their own rows and never archives one', () => {
  const dash = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dash, /splitTemplatesForSave\(templatesToSave\)/);
  assert.match(dash, /persistSharedTemplateEdits\(shared\)/);
  assert.match(dash, /templates: withResolvedRows/);
  assert.match(dash, /can only be archived by its owner/);
});

test('the viewer mounts the shared-template hook once; Share from Home grants', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.equal(viewer.match(/useSharedDocumentTemplates\(\{/g)?.length, 1);
  const share = readFileSync(new URL('../src/home/ShareModal.jsx', import.meta.url), 'utf8');
  assert.match(share, /kind === 'document'[\s\S]{0,120}grantRememberedDocumentTemplates/);
});
