// Row-level security sweep: every user-data table and both private buckets,
// probed as signed-out, a stranger, a viewer, an editor and the owner.
//
// The owner gets one private row in every table (seeded below). Strangers and
// signed-out callers must see none of it and change none of it; document
// collaborators see only what belongs to the shared document, never the
// owner's invites, sessions, billing or linked accounts.
//
// Probes use password sign-in against the API (not the UI): this is about the
// database, and 5 roles x 30 tables through the UI would take minutes.
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, apiClientFor as clientFor, expect, test } from './helpers.mjs';

const DOC = E2E_DOCUMENT.id;
const PROJECT = E2E_PROJECT.id;
const TEMPLATE = 'e2e00000-0000-4000-8000-000000000201';
const SESSION = 'e2e00000-0000-4000-8000-000000000202';

async function must(label, request) {
  const { error } = await request;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function accountIds(admin) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return Object.fromEntries(Object.entries(E2E_ACCOUNTS)
    .map(([key, account]) => [key, data.users.find((u) => u.email === account.email).id]));
}

async function seedOwnerRows(admin, ids) {
  const owner = ids.owner;
  const expires = new Date(Date.now() + 7 * 864e5).toISOString();
  await must('template', admin.from('templates').upsert({ id: TEMPLATE, user_id: owner, name: 'RLS sweep template' }, { onConflict: 'id' }));
  await must('session', admin.from('survey_sessions').upsert({ id: SESSION, template_id: TEMPLATE, user_id: owner }, { onConflict: 'id' }));
  const replace = async (table, column, value, row) => {
    await must(`clear ${table}`, admin.from(table).delete().eq(column, value));
    await must(table, admin.from(table).insert(row));
  };
  await replace('survey_items', 'session_id', SESSION, { session_id: SESSION, annotation_id: 'rls-a1', module_id: 'm', category_id: 'c' });
  await replace('survey_presence', 'session_id', SESSION, { session_id: SESSION, user_id: owner, client_type: 'web' });
  await replace('excel_schema_mapping', 'session_id', SESSION, { session_id: SESSION, sheet_name: 's', module_id: 'm', category_id: 'c' });
  await replace('connected_services', 'user_id', owner, { user_id: owner, service_name: 'onedrive' });
  await replace('document_annotations', 'annotation_id', 'rls-a1', {
    document_id: DOC, user_id: owner, annotation_id: 'rls-a1', annotation_type: 'square', page_number: 1, bounds: {},
  });
  await replace('document_history_events', 'client_event_id', 'rls-e1', { document_id: DOC, client_event_id: 'rls-e1', event_type: 'test', summary: 'rls' });
  await replace('document_revisions', 'document_id', DOC, { document_id: DOC, revision_number: 1, snapshot_json: {} });
  await replace('document_invites', 'document_id', DOC, { document_id: DOC, token: 'rls-doc-token', role: 'editor', intended_role: 'editor', expires_at: expires });
  await replace('project_invites', 'project_id', PROJECT, {
    project_id: PROJECT, token: 'rls-project-token', role: 'editor', intended_role: 'editor', created_by: owner, expires_at: expires,
  });
  await replace('template_invites', 'template_id', TEMPLATE, {
    template_id: TEMPLATE, token: 'rls-template-token', role: 'editor', intended_role: 'editor', created_by: owner, expires_at: expires,
  });
  await replace('spaces', 'document_id', DOC, { document_id: DOC, name: 'rls space', start_page: 1, end_page: 1 });
  await replace('document_templates', 'document_id', DOC, { document_id: DOC, template_id: TEMPLATE, linked_by: owner });
  await replace('doc_yjs_updates', 'document_id', DOC, { document_id: DOC, client_id: 'rls', seq: 1, update: '\\x00' });
  await replace('doc_yjs_state', 'document_id', DOC, { document_id: DOC, state: '\\x00', state_vector: '\\x00', through_seq: 1 });
}

// Each table, and the filter that picks out the owner's rows in it.
const ownerRows = (ids) => ({
  projects: ['id', PROJECT],
  documents: ['id', DOC],
  templates: ['id', TEMPLATE],
  survey_sessions: ['id', SESSION],
  survey_items: ['session_id', SESSION],
  survey_presence: ['session_id', SESSION],
  excel_schema_mapping: ['session_id', SESSION],
  connected_services: ['user_id', ids.owner],
  usage_metrics: ['user_id', ids.owner],
  user_subscriptions: ['user_id', ids.owner],
  users: ['id', ids.owner],
  project_status: ['project_id', PROJECT],
  document_invites: ['document_id', DOC],
  project_invites: ['project_id', PROJECT],
  template_invites: ['template_id', TEMPLATE],
  spaces: ['document_id', DOC],
  document_collaborators: ['document_id', DOC],
  project_collaborators: ['project_id', PROJECT],
  document_annotations: ['document_id', DOC],
  document_history_events: ['document_id', DOC],
  document_revisions: ['document_id', DOC],
  document_templates: ['document_id', DOC],
  doc_yjs_updates: ['document_id', DOC],
  doc_yjs_state: ['document_id', DOC],
});

// What a collaborator on the shared document may read; the rest stays the owner's.
const SHARED_WITH_COLLABORATORS = new Set([
  'projects', 'documents', 'document_collaborators', 'project_collaborators', 'document_annotations',
  'document_history_events', 'document_revisions', 'document_templates', 'doc_yjs_updates', 'doc_yjs_state',
]);

let admin;
let ids;
test.beforeAll(async () => {
  admin = adminClient();
  ids = await accountIds(admin);
  await seedOwnerRows(admin, ids);
});

async function visibleOwnerRows(client, table, [column, value]) {
  const { data, error } = await client.from(table).select('*').eq(column, value);
  if (error) return 0; // permission denied counts as nothing visible
  return data.length;
}

test('the owner sees their own row in every table (the probe works)', async () => {
  const owner = await clientFor(E2E_ACCOUNTS.owner);
  for (const [table, filter] of Object.entries(ownerRows(ids))) {
    expect(await visibleOwnerRows(owner, table, filter), table).toBeGreaterThan(0);
  }
});

test('signed-out callers and strangers see none of the owner\'s rows', async () => {
  for (const account of [null, E2E_ACCOUNTS.free, E2E_ACCOUNTS.pro]) {
    const client = await clientFor(account);
    for (const [table, filter] of Object.entries(ownerRows(ids))) {
      expect(await visibleOwnerRows(client, table, filter), `${account?.email || 'anon'} ${table}`).toBe(0);
    }
  }
});

test('collaborators see the shared document\'s rows and nothing else of the owner\'s', async () => {
  for (const account of [E2E_ACCOUNTS.viewer, E2E_ACCOUNTS.editor]) {
    const client = await clientFor(account);
    for (const [table, filter] of Object.entries(ownerRows(ids))) {
      const seen = await visibleOwnerRows(client, table, filter);
      if (SHARED_WITH_COLLABORATORS.has(table)) expect(seen, `${account.email} ${table}`).toBeGreaterThan(0);
      else expect(seen, `${account.email} ${table}`).toBe(0);
    }
  }
});

async function snapshot(rows) {
  const out = {};
  for (const [table, [column, value]] of Object.entries(rows)) {
    const { data, error } = await admin.from(table).select('*').eq(column, value);
    if (error) throw new Error(`${table}: ${error.message}`);
    out[table] = JSON.stringify(data);
  }
  return out;
}

const PATCHES = (attackerId) => [
  { user_id: attackerId }, { name: 'rls-was-here' }, { role: 'owner' }, { tier: 'enterprise' },
  { status: 'active' }, { token: 'rls-was-here' }, { archived: true }, { is_active: true }, { summary: 'rls' },
];

test('signed-out callers, strangers and viewers cannot change or delete the owner\'s rows', async () => {
  const rows = ownerRows(ids);
  for (const [key, account] of [['anon', null], ['free', E2E_ACCOUNTS.free], ['pro', E2E_ACCOUNTS.pro], ['viewer', E2E_ACCOUNTS.viewer]]) {
    const client = await clientFor(account);
    const before = await snapshot(rows);
    for (const [table, [column, value]] of Object.entries(rows)) {
      for (const patch of PATCHES(ids[key] || ids.free)) await client.from(table).update(patch).eq(column, value);
      await client.from(table).delete().eq(column, value);
    }
    const after = await snapshot(rows);
    for (const table of Object.keys(rows)) {
      expect(after[table], `${key} changed ${table}`).toBe(before[table]);
    }
  }
});

test('no collaborator can give a project or template away', async () => {
  const editor = await clientFor(E2E_ACCOUNTS.editor);
  const pro = await clientFor(E2E_ACCOUNTS.pro);
  await must('pro joins as template editor', admin.from('template_collaborators')
    .upsert({ template_id: TEMPLATE, user_id: ids.pro, role: 'editor' }, { onConflict: 'template_id,user_id' }));
  await must('pro joins as project editor', admin.from('project_collaborators').upsert({
    project_id: PROJECT, user_id: ids.pro, invited_by: ids.owner, role: 'editor', email: E2E_ACCOUNTS.pro.email, status: 'active',
  }, { onConflict: 'project_id,user_id' }));
  try {
    const attempts = [
      [editor, 'projects', PROJECT, ids.free], // hand it to a third person
      [pro, 'projects', PROJECT, ids.pro], // a Pro editor takes it
      [pro, 'templates', TEMPLATE, ids.pro],
    ];
    for (const [client, table, rowId, newOwner] of attempts) {
      await client.from(table).update({ user_id: newOwner }).eq('id', rowId);
      const { data } = await admin.from(table).select('user_id').eq('id', rowId).single();
      expect(data.user_id, `${table} owner`).toBe(ids.owner);
    }
    // Editors keep their normal rights: renaming the shared project still works.
    const { data: renamed, error } = await editor.from('projects').update({ name: 'Renamed by editor' }).eq('id', PROJECT).select('id');
    expect(error).toBeNull();
    expect(renamed).toHaveLength(1);
  } finally {
    await admin.from('projects').update({ user_id: ids.owner, name: E2E_PROJECT.name }).eq('id', PROJECT);
    await admin.from('templates').update({ user_id: ids.owner }).eq('id', TEMPLATE);
    await admin.from('template_collaborators').delete().eq('template_id', TEMPLATE).eq('user_id', ids.pro);
    await admin.from('project_collaborators').delete().eq('project_id', PROJECT).eq('user_id', ids.pro);
  }
});

test('outsiders cannot grant themselves access or a paid plan', async () => {
  const free = await clientFor(E2E_ACCOUNTS.free);
  const viewer = await clientFor(E2E_ACCOUNTS.viewer);
  await free.from('document_collaborators').insert({ document_id: DOC, user_id: ids.free, role: 'editor', email: E2E_ACCOUNTS.free.email, status: 'active' });
  await free.from('project_collaborators').insert({ project_id: PROJECT, user_id: ids.free, role: 'editor', email: E2E_ACCOUNTS.free.email, status: 'active' });
  await viewer.from('document_collaborators').update({ role: 'editor' }).eq('document_id', DOC).eq('user_id', ids.viewer);
  await free.from('user_subscriptions').update({ tier: 'pro' }).eq('user_id', ids.free);
  await free.from('user_subscriptions').upsert({ user_id: ids.free, tier: 'enterprise', status: 'active' }, { onConflict: 'user_id' });
  await free.from('document_invites').insert({ document_id: DOC, token: 'rls-free-token', role: 'owner', intended_role: 'owner', expires_at: new Date(Date.now() + 864e5).toISOString() });

  const { data: freeRole } = await free.rpc('get_my_document_role', { doc_id: DOC });
  expect(freeRole ?? null).toBeNull();
  const { data: viewerRole } = await viewer.rpc('get_my_document_role', { doc_id: DOC });
  expect(viewerRole).toBe('viewer');
  const { data: sub } = await admin.from('user_subscriptions').select('tier').eq('user_id', ids.free).single();
  expect(sub.tier).toBe('free');
  const { count } = await admin.from('document_invites').select('id', { count: 'exact', head: true }).eq('token', 'rls-free-token');
  expect(count).toBe(0);
  const { count: collabs } = await admin.from('project_collaborators').select('id', { count: 'exact', head: true })
    .eq('project_id', PROJECT).eq('user_id', ids.free);
  expect(collabs).toBe(0);
});

test('stored PDFs: collaborators can read, nobody else can read or overwrite', async () => {
  const { data: doc } = await admin.from('documents').select('file_path').eq('id', DOC).single();
  for (const [label, account, canRead] of [
    ['anon', null, false], ['free', E2E_ACCOUNTS.free, false], ['viewer', E2E_ACCOUNTS.viewer, true], ['owner', E2E_ACCOUNTS.owner, true],
  ]) {
    const client = await clientFor(account);
    const { data, error } = await client.storage.from('documents').download(doc.file_path);
    expect(Boolean(data && !error), `${label} read`).toBe(canRead);
  }
  const before = await (await admin.storage.from('documents').download(doc.file_path)).data.arrayBuffer();
  const junk = new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' });
  for (const account of [E2E_ACCOUNTS.free, E2E_ACCOUNTS.editor]) {
    const client = await clientFor(account);
    await client.storage.from('documents').upload(doc.file_path, junk, { upsert: true, contentType: 'application/pdf' });
    await client.storage.from('documents').remove([doc.file_path]);
  }
  const after = await (await admin.storage.from('documents').download(doc.file_path)).data.arrayBuffer();
  expect(after.byteLength).toBe(before.byteLength);
});
