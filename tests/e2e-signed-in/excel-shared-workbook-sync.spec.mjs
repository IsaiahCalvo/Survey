// Excel sync audit (2026-10-29), against the real database functions.
// W4: a shared survey only syncs a work/school workbook. The first OneDrive export
//     registers before the upload (as a local file, no Graph ids), so every Excel
//     change went to review. kal307_bind_workbook_location records where the file
//     really lives, and only the owner or the person who linked it may do so.
// W6: answering a cloud conflict now settles the op with Excel's row as the agreed
//     baseline, so the next Excel edit to that row applies instead of going stale.
import { createHash, randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

// E2E_DOCUMENT is shared with the editor and the viewer, so the shared-doc gate applies.
const DOC = E2E_DOCUMENT.id;
const SCOPE = 'e2e-mod:e2e-cat';
const TABLES = ['excel_sync_ops', 'excel_sync_state', 'excel_sync_head', 'excel_sync_changesets', 'excel_workbook_registrations'];

async function userId(account) {
  const { data } = await adminClient().auth.admin.listUsers();
  return data.users.find((u) => u.email === account.email).id;
}

// The server only stores and compares fingerprints, so any stable hash of the row
// stands in for the app's (src/*.js does not load under Playwright).
const hash = (value) => createHash('sha256').update(JSON.stringify(value ?? '')).digest('hex');
async function fingerprints(values) {
  const fieldFingerprints = {
    changedBy: hash(''), changedDate: hash(''), item: hash(values.item), entity: hash(values.entity),
    notes: hash(values.notes), answers: Object.fromEntries(Object.entries(values.answers ?? {}).map(([id, v]) => [id, hash(v)])),
  };
  const identityVectorFingerprint = hash([values.item, values.entity]);
  return {
    identityRecord: {
      version: 'v1', origin: 'export', lastExportId: 'exp-e2e',
      identityVectorFingerprint, fullRowFingerprint: hash(values), fieldFingerprints,
    },
    base: { identityVector: identityVectorFingerprint, fields: fieldFingerprints },
  };
}

// One p_rows entry shaped like the excel-apply-changeset Edge builds it.
function applyRow({ markerId, changedFieldKeys, values, base, incoming, n }) {
  return {
    opId: `${SCOPE}#${n}#apply`, opType: 'apply', markerAnnotationId: markerId, scopeId: SCOPE,
    changedFieldKeys, fields: values, baseFingerprints: base,
    identity: { ...incoming.identityRecord }, identityRecord: incoming.identityRecord,
  };
}

async function apply({ actorId, templateId, workbookId, rows }) {
  const clientChangeSetId = `ccs-${randomUUID()}`;
  const { data, error } = await adminClient().rpc('kal308_apply_changeset', {
    p_actor_id: actorId, p_document_id: DOC, p_template_id: templateId, p_workbook_id: workbookId,
    p_capability_tier: 'business', // ignored: the server reads the tier from the registration
    p_client_change_set_id: clientChangeSetId,
    p_request_hash: createHash('sha256').update(clientChangeSetId).digest('hex'),
    p_device_hint: 'e2e', p_template_config: null, p_rows: rows,
  });
  expect(error).toBeNull();
  expect(data.error).toBeUndefined();
  return data.outcomes;
}

async function setUp(owner) {
  const templateId = `e2e-excel-${randomUUID().slice(0, 8)}`;
  // What the first OneDrive export does: register before the upload, as a local file.
  const { data, error } = await owner.rpc('kal307_register_workbook', {
    p_document_id: DOC, p_template_id: templateId, p_capability_tier: 'local',
  });
  expect(error).toBeNull();
  const workbookId = (Array.isArray(data) ? data[0] : data).workbook_id;
  const markerId = `surveyMarker-e2e-${randomUUID().slice(0, 8)}`;
  const seeded = await fingerprints({ item: 'D-1', notes: 'orig', answers: { c1: 'old' } });
  const seed = await owner.rpc('kal309_seed_sync_state', {
    p_document_id: DOC, p_template_id: templateId, p_workbook_id: workbookId,
    p_markers: [{ markerAnnotationId: markerId, scopeId: SCOPE, identityRecord: seeded.identityRecord, assignedToken: null }],
  });
  expect(seed.error).toBeNull();
  return { templateId, workbookId, markerId, seeded };
}

async function tearDown(templateId) {
  const db = adminClient();
  for (const table of TABLES) await db.from(table).delete().eq('document_id', DOC).eq('template_id', templateId);
}

test('a shared survey syncs a OneDrive workbook once its work location is recorded', async () => {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const editor = await apiClientFor(E2E_ACCOUNTS.editor);
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const { templateId, workbookId, markerId, seeded } = await setUp(owner);
  try {
    const values = { item: 'D-1', notes: 'orig', answers: { c1: 'new' } };
    const row = async (n) => applyRow({
      markerId, changedFieldKeys: ['answer:c1'], values, base: seeded.base, incoming: await fingerprints(values), n,
    });

    // Before: registered as a local file → every row held for review.
    expect((await apply({ actorId: ownerId, templateId, workbookId, rows: [await row(1)] }))[0].outcome).toBe('review');

    // An editor cannot upgrade the owner's workbook.
    const editorBind = await editor.rpc('kal307_bind_workbook_location', {
      p_document_id: DOC, p_template_id: templateId, p_workbook_id: workbookId,
      p_graph_drive_id: 'b!drive', p_graph_item_id: 'ITEM1', p_capability_tier: 'business',
    });
    expect(editorBind.error?.message || '').toMatch(/only the document owner or the person who linked/);

    // The owner's upload came back from a work OneDrive: record it.
    const bind = await owner.rpc('kal307_bind_workbook_location', {
      p_document_id: DOC, p_template_id: templateId, p_workbook_id: workbookId,
      p_graph_drive_id: 'b!drive', p_graph_item_id: 'ITEM1', p_capability_tier: 'business',
    });
    expect(bind.error).toBeNull();
    expect(bind.data).toBe(true);
    const { data: reg } = await adminClient().from('excel_workbook_registrations')
      .select('capability_tier, graph_drive_id, graph_item_id').eq('workbook_id', workbookId).single();
    expect(reg).toEqual({ capability_tier: 'business', graph_drive_id: 'b!drive', graph_item_id: 'ITEM1' });

    // Never moved to another file.
    const moved = await owner.rpc('kal307_bind_workbook_location', {
      p_document_id: DOC, p_template_id: templateId, p_workbook_id: workbookId,
      p_graph_drive_id: 'b!drive', p_graph_item_id: 'ITEM2', p_capability_tier: 'business',
    });
    expect(moved.data).toBe(false);

    // After: the same Excel change applies.
    expect((await apply({ actorId: ownerId, templateId, workbookId, rows: [await row(2)] }))[0].outcome).toBe('applied');
  } finally {
    await tearDown(templateId);
  }
});

test('answering a cloud conflict keeps the next Excel edit to that row syncing', async () => {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const { templateId, workbookId, markerId, seeded } = await setUp(owner);
  try {
    const bind = await owner.rpc('kal307_bind_workbook_location', {
      p_document_id: DOC, p_template_id: templateId, p_workbook_id: workbookId,
      p_graph_drive_id: 'b!drive', p_graph_item_id: 'ITEM1', p_capability_tier: 'business',
    });
    expect(bind.data).toBe(true);

    // Excel changes the answer AND the note; the app had also changed the answer.
    const excelRow = { item: 'D-1', notes: 'excel note', answers: { c1: 'excel' } };
    const incoming = await fingerprints(excelRow);
    const [first] = await apply({
      actorId: ownerId, templateId, workbookId,
      rows: [applyRow({ markerId, changedFieldKeys: ['answer:c1', 'notes'], values: excelRow, base: seeded.base, incoming, n: 1 })],
    });
    expect(first.outcome).toBe('applied');

    // The desktop reducer finds the clash and records it.
    const ack = await owner.rpc('kal309_ack_materialization', {
      p_document_id: DOC, p_template_id: templateId, p_op_uuid: first.opUuid, p_status: 'client_conflict_review',
    });
    expect(ack.error).toBeNull();

    // "Keep mine": the app sends Excel's row as the agreed baseline (what Excel holds).
    const resolved = await owner.rpc('kal309_resolve_materialization_conflict', {
      p_document_id: DOC, p_template_id: templateId, p_op_uuid: first.opUuid, p_resolution: 'keep-app',
      p_resolved_fingerprints: incoming.base,
    });
    expect(resolved.error).toBeNull();
    expect(resolved.data).toBe(true);
    const { data: ops } = await owner.rpc('kal309_fetch_since', { p_document_id: DOC, p_template_id: templateId, p_since_revision: 0 });
    expect(ops.find((op) => op.op_uuid === first.opUuid).op_status).toBe('resolved');

    // The next Excel edit to that row is based on Excel's row: it applies, not stale.
    const nextRow = { ...excelRow, item: 'D-1A' };
    const [second] = await apply({
      actorId: ownerId, templateId, workbookId,
      rows: [applyRow({ markerId, changedFieldKeys: ['item'], values: nextRow, base: incoming.base, incoming: await fingerprints(nextRow), n: 2 })],
    });
    expect(second.outcome).toBe('applied');
  } finally {
    await tearDown(templateId);
  }
});
