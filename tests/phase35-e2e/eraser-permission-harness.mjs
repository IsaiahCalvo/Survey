import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import * as Y from 'yjs';
import { loadVerifiedTestAccounts } from '../../scripts/test-account-lease.mjs';

const PAGE = { width: 612, height: 792 };
const FAMILY_ORDER = [
  'pen',
  'highlighter',
  'shape',
  'text',
  'callout',
  'survey-marker',
  'text-markup',
];

function requireValue(name, value) {
  if (!value) {
    throw new Error(
      `[ERASER_E2E_INFRA] Missing ${name}. This suite requires a real Supabase test backend; it never skips.`,
    );
  }
  return value;
}

export function readHarnessConfig(override = null) {
  if (process.env.ERASER_PERMISSION_E2E !== '1' && override?.authorized !== true) {
    throw new Error(
      '[ERASER_E2E_INFRA] Set ERASER_PERMISSION_E2E=1 to authorize isolated test rows and storage.',
    );
  }
  const accounts = override?.accounts || loadVerifiedTestAccounts({ minimumAccounts: 3 });

  const supabaseUrl = requireValue(
    'ERASER_E2E_SUPABASE_URL or SUPABASE_TEST_URL',
    override?.supabaseUrl
      || process.env.ERASER_E2E_SUPABASE_URL
      || process.env.SUPABASE_TEST_URL,
  );
  const serviceKey = requireValue(
    'ERASER_E2E_SERVICE_KEY or SUPABASE_TEST_SERVICE_KEY',
    override?.serviceKey
      || process.env.ERASER_E2E_SERVICE_KEY
      || process.env.SUPABASE_TEST_SERVICE_KEY,
  );
  const anonKey = requireValue(
    'ERASER_E2E_ANON_KEY or SUPABASE_TEST_ANON_KEY',
    override?.anonKey
      || process.env.ERASER_E2E_ANON_KEY
      || process.env.SUPABASE_TEST_ANON_KEY,
  );
  const baseUrl = override?.baseUrl
    || process.env.ERASER_E2E_BASE_URL
    || 'http://localhost:5173';

  const host = new URL(supabaseUrl).hostname;
  const allowedHosts = new Set([
    'localhost',
    '127.0.0.1',
    'cvamwtpsuvxvjdnotbeg.supabase.co',
  ]);
  if (!allowedHosts.has(host)) {
    throw new Error(
      `[ERASER_E2E_INFRA] Refusing backend host "${host}". Use the main Survey project with leased bots.`,
    );
  }

  return { supabaseUrl, serviceKey, anonKey, baseUrl, accounts };
}

function makeAdmin(config) {
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function makeAnon(config) {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function makePdfBytes() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  page.drawText('Survey eraser permission E2E', {
    x: 36,
    y: 750,
    size: 16,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Disposable backend-backed fixture', {
    x: 36,
    y: 728,
    size: 10,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  return pdf.save();
}

export async function provisionDisposableDocument(harness) {
  if (!harness?.admin || !harness?.users?.owner) {
    throw new Error('[ERASER_E2E_INFRA] users must exist before provisioning a document');
  }
  const { admin, users } = harness;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pdfBytes = await makePdfBytes();
  const filePath = `${users.owner.id}/eraser-permission-e2e/${suffix}.pdf`;
  const upload = await admin.storage
    .from('documents')
    .upload(filePath, new Blob([pdfBytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (upload.error) throw new Error(`[ERASER_E2E_INFRA] upload fixture: ${upload.error.message}`);

  const inserted = await admin.from('documents').insert({
    user_id: users.owner.id,
    name: `Eraser Permission E2E ${suffix}.pdf`,
    file_path: filePath,
    file_size: pdfBytes.length,
    archived: false,
    cutover_completed_at: new Date().toISOString(),
    embedded_import_completed_at: new Date().toISOString(),
  }).select('*').single();
  if (inserted.error) {
    await admin.storage.from('documents').remove([filePath]);
    throw new Error(`[ERASER_E2E_INFRA] insert fixture document: ${inserted.error.message}`);
  }
  const document = inserted.data;

  const collaborators = await admin.from('document_collaborators').upsert([
    {
      document_id: document.id,
      user_id: users.collaborator.id,
      email: users.collaborator.email,
      role: 'editor',
      status: 'active',
      invited_by: users.owner.id,
    },
    {
      document_id: document.id,
      user_id: users.viewer.id,
      email: users.viewer.email,
      role: 'viewer',
      status: 'active',
      invited_by: users.owner.id,
    },
  ], { onConflict: 'document_id,user_id' });
  if (collaborators.error) {
    await admin.from('documents').delete().eq('id', document.id);
    await admin.storage.from('documents').remove([filePath]);
    throw new Error(`[ERASER_E2E_INFRA] attach collaborators: ${collaborators.error.message}`);
  }

  const cleanup = async () => {
    const failures = [];
    const remember = (label, error) => {
      if (error) failures.push(`${label}: ${error.message || String(error)}`);
    };
    remember('annotations', (await admin.from('document_annotations').delete().eq('document_id', document.id)).error);
    remember('collaborators', (await admin.from('document_collaborators').delete().eq('document_id', document.id)).error);
    remember('document', (await admin.from('documents').delete().eq('id', document.id)).error);
    remember('storage', (await admin.storage.from('documents').remove([filePath])).error);
    if (failures.length) {
      throw new Error(`[ERASER_E2E_INFRA] document cleanup failed:\n${failures.join('\n')}`);
    }
  };

  return { document, filePath, cleanup };
}

export async function provisionHarness(configOverride = null) {
  const config = readHarnessConfig(configOverride);
  const admin = makeAdmin(config);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [leasedOwner, leasedCollaborator, leasedViewer] = config.accounts;
  const users = {
    owner: { id: leasedOwner.userId, email: leasedOwner.email, password: leasedOwner.password },
    collaborator: {
      id: leasedCollaborator.userId,
      email: leasedCollaborator.email,
      password: leasedCollaborator.password,
    },
    viewer: { id: leasedViewer.userId, email: leasedViewer.email, password: leasedViewer.password },
  };
  let filePath = null;
  let document = null;
  let ownerClient = null;

  const cleanup = async () => {
    const failures = [];
    const remember = (label, error) => {
      if (error) failures.push(`${label}: ${error.message || String(error)}`);
    };
    if (document?.id) {
      remember('annotations', (await admin.from('document_annotations').delete().eq('document_id', document.id)).error);
      remember('collaborators', (await admin.from('document_collaborators').delete().eq('document_id', document.id)).error);
      remember('document', (await admin.from('documents').delete().eq('id', document.id)).error);
    }
    if (filePath) {
      remember('storage', (await admin.storage.from('documents').remove([filePath])).error);
    }
    if (failures.length) {
      throw new Error(`[ERASER_E2E_INFRA] cleanup failed:\n${failures.join('\n')}`);
    }
  };

  try {
    const pdfBytes = await makePdfBytes();
    filePath = `${users.owner.id}/eraser-permission-e2e/${suffix}.pdf`;
    const upload = await admin.storage
      .from('documents')
      .upload(filePath, new Blob([pdfBytes], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (upload.error) throw new Error(`[ERASER_E2E_INFRA] upload fixture: ${upload.error.message}`);

    const inserted = await admin.from('documents').insert({
      user_id: users.owner.id,
      name: `Eraser Permission E2E ${suffix}.pdf`,
      file_path: filePath,
      file_size: pdfBytes.length,
      archived: false,
      cutover_completed_at: new Date().toISOString(),
      embedded_import_completed_at: new Date().toISOString(),
    }).select('*').single();
    if (inserted.error) {
      throw new Error(`[ERASER_E2E_INFRA] insert fixture document: ${inserted.error.message}`);
    }
    document = inserted.data;

    const collaboratorRows = [
      {
        document_id: document.id,
        user_id: users.collaborator.id,
        email: users.collaborator.email,
        role: 'editor',
        status: 'active',
        invited_by: users.owner.id,
      },
      {
        document_id: document.id,
        user_id: users.viewer.id,
        email: users.viewer.email,
        role: 'viewer',
        status: 'active',
        invited_by: users.owner.id,
      },
    ];
    const collaborators = await admin.from('document_collaborators').upsert(
      collaboratorRows,
      { onConflict: 'document_id,user_id' },
    );
    if (collaborators.error) {
      throw new Error(`[ERASER_E2E_INFRA] attach collaborators: ${collaborators.error.message}`);
    }
    ownerClient = await makeSignedInClient({ config }, users.owner);
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '[ERASER_E2E_INFRA] provision and cleanup failed');
    }
    throw error;
  }

  return {
    config,
    admin,
    anon: makeAnon(config),
    ownerClient,
    document,
    filePath,
    users,
    seedDoc: new Y.Doc(),
    seedClientSeq: 0,
    cleanup,
  };
}

function authorMeta(user, family) {
  return {
    authorId: user.id,
    authorName: user.email,
    createdAt: Date.now(),
    e2eFamily: family,
  };
}

function baseData(id, user, family) {
  return {
    id,
    authorId: user.id,
    annotationType: family === 'shape' ? 'square' : family,
    e2eFamily: family,
  };
}

function pathObject({ id, user, family, x, y, locked = false }) {
  const highlighter = family === 'highlighter';
  return {
    type: 'path',
    version: '5.3.0',
    originX: 'left',
    originY: 'top',
    left: x,
    top: y,
    width: 92,
    height: 28,
    path: [
      ['M', 0, 14],
      ['C', 20, 0, 45, 28, 68, 14],
      ['L', 92, 14],
    ],
    pathOffset: { x: 46, y: 14 },
    stroke: highlighter ? '#facc15' : '#2563eb',
    strokeWidth: highlighter ? 16 : 5,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    fill: null,
    opacity: highlighter ? 0.35 : 1,
    scaleX: 1,
    scaleY: 1,
    tool: highlighter ? 'highlighter' : 'pen',
    id,
    data: baseData(id, user, family),
    meta: authorMeta(user, family),
    ...(locked ? { locked: true } : {}),
  };
}

function rectObject({ id, user, family, x, y, locked = false }) {
  return {
    type: 'rect',
    version: '5.3.0',
    originX: 'left',
    originY: 'top',
    left: x,
    top: y,
    width: 92,
    height: 34,
    fill: 'rgba(239,68,68,0.15)',
    stroke: '#dc2626',
    strokeWidth: 3,
    strokeUniform: true,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    id,
    data: baseData(id, user, family),
    meta: authorMeta(user, family),
    ...(locked ? { locked: true } : {}),
  };
}

function textObject({ id, user, family, x, y, locked = false }) {
  return {
    type: 'textbox',
    version: '5.3.0',
    originX: 'left',
    originY: 'top',
    left: x,
    top: y,
    width: 110,
    height: 30,
    text: `${family} ${user.email.slice(0, 6)}`,
    fontFamily: 'Helvetica',
    fontSize: 14,
    fill: '#111827',
    scaleX: 1,
    scaleY: 1,
    id,
    data: baseData(id, user, family),
    meta: authorMeta(user, family),
    ...(locked ? { locked: true } : {}),
  };
}

function textMarkupObject({ id, user, family, x, y, locked = false }) {
  return {
    ...rectObject({ id, user, family, x, y, locked }),
    height: 5,
    fill: '#ef4444',
    stroke: null,
    strokeWidth: 0,
    isPdfImported: true,
    pdfAnnotationId: `pdf-${id}`,
    pdfAnnotationType: 'Underline',
    layer: 'pdf-annotations',
    hasControls: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  };
}

function calloutObject({ id, user, family, x, y }) {
  const callout = {
    id,
    annotationId: id,
    pageNumber: 1,
    arrowTip: { x: x / PAGE.width, y: (y + 36) / PAGE.height },
    knee: { x: (x + 40) / PAGE.width, y: (y + 12) / PAGE.height },
    textBoxPosition: { x: (x + 58) / PAGE.width, y: y / PAGE.height },
    textBoxWidth: 0.16,
    textBoxHeight: 0.045,
    text: `callout ${user.email.slice(0, 6)}`,
    style: { color: '#111827', lineWidth: 2 },
    data: baseData(id, user, family),
    meta: authorMeta(user, family),
  };
  return {
    type: 'group',
    version: '5.3.0',
    originX: 'left',
    originY: 'top',
    left: x,
    top: y,
    width: 156,
    height: 42,
    scaleX: 1,
    scaleY: 1,
    id,
    meta: authorMeta(user, family),
    data: {
      ...baseData(id, user, family),
      type: 'callout',
      legacyCallout: callout,
    },
  };
}

function objectFor({ family, id, user, x, y, locked = false }) {
  if (family === 'pen' || family === 'highlighter') {
    return pathObject({ family, id, user, x, y, locked });
  }
  if (family === 'shape') return rectObject({ family, id, user, x, y, locked });
  if (family === 'text') return textObject({ family, id, user, x, y, locked });
  if (family === 'callout') return calloutObject({ family, id, user, x, y });
  if (family === 'text-markup') return textMarkupObject({ family, id, user, x, y, locked });
  throw new Error(`Unsupported fixture family ${family}`);
}

function serializeFixtureObject(object, { documentId, userId, annotationId, clientSessionId }) {
  const type = object.data?.type === 'callout'
    ? 'callout'
    : ({
        path: 'ink',
        rect: 'square',
        textbox: 'freetext',
      }[String(object.type || '').toLowerCase()]);
  if (!type) throw new Error(`Unsupported fixture object type ${object.type}`);
  return {
    document_id: documentId,
    user_id: userId,
    annotation_id: annotationId,
    annotation_type: type,
    page_number: 1,
    bounds: {
      x: Number(object.left) || 0,
      y: Number(object.top) || 0,
      width: (Number(object.width) || 0) * (Number(object.scaleX) || 1),
      height: (Number(object.height) || 0) * (Number(object.scaleY) || 1),
      rotation: Number(object.angle) || 0,
    },
    annotation_data: {
      fabricObject: object,
      pageNumber: 1,
      schemaVersion: 1,
      clientSessionId,
    },
    color: object.stroke || object.fill || null,
    opacity: Number.isFinite(object.opacity) ? object.opacity : 1,
    stroke_width: Number.isFinite(object.strokeWidth) ? object.strokeWidth : null,
    font_size: Number.isFinite(object.fontSize) ? object.fontSize : null,
    last_modified_by: userId,
  };
}

function buildSurveyFixtureRow({ documentId, user, id, x, y, family, locked = false }) {
  return {
    document_id: documentId,
    user_id: user.id,
    annotation_id: id,
    annotation_type: 'survey-marker',
    page_number: 1,
    bounds: { x, y, width: 92, height: 34 },
    category_id: null,
    module_id: 'eraser-e2e-module',
    space_id: null,
    name: `marker ${user.email.slice(0, 6)}`,
    notes: null,
    entity_id: null,
    entity_name: null,
    checklist_responses: {},
    changed_by: null,
    changed_date: null,
    color: '#fde047',
    opacity: 0.35,
    last_modified_by: user.id,
    version: 1,
    annotation_data: {
      regionId: null,
      moduleId: 'eraser-e2e-module',
      scope: 'survey',
      userId: user.id,
      e2eFamily: family,
      locked,
    },
  };
}

export function buildFixtureRows({
  documentId,
  author,
  prefix,
  x = 80,
  lockedFamily = null,
  missingAuthorFamily = null,
}) {
  const rows = [];
  const fixtures = {};
  FAMILY_ORDER.forEach((family, index) => {
    const id = `${prefix}-${family}`;
    const y = 105 + index * 76;
    fixtures[family] = {
      id,
      family,
      authorId: author.id,
      center: {
        x: x + (family === 'callout' ? 84 : 46),
        y: y + (family === 'callout' ? 18 : family === 'text-markup' ? 3 : 17),
      },
    };

    if (family === 'survey-marker') {
      rows.push(buildSurveyFixtureRow({
        documentId,
        user: author,
        id,
        x,
        y,
        family,
        locked: lockedFamily === family,
      }));
      return;
    }

    const object = objectFor({
      family,
      id,
      user: author,
      x,
      y,
      locked: lockedFamily === family,
    });
    if (missingAuthorFamily === family) {
      delete object.authorId;
      delete object.meta?.authorId;
      delete object.data?.authorId;
      delete object.data?.userId;
      if (object.data?.legacyCallout) {
        delete object.data.legacyCallout.authorId;
        delete object.data.legacyCallout.meta?.authorId;
        delete object.data.legacyCallout.data?.authorId;
        delete object.data.legacyCallout.data?.userId;
      }
    }
    rows.push(serializeFixtureObject(object, {
      documentId,
      userId: author.id,
      annotationId: id,
      clientSessionId: `eraser-e2e-${prefix}`,
    }));
  });
  return { rows, fixtures };
}

export async function replaceFixtureRows(harness, ...sets) {
  const rows = sets.flatMap((set) => set.rows);
  const ids = rows.map((row) => row.annotation_id);
  const removed = await harness.admin
    .from('document_annotations')
    .delete()
    .eq('document_id', harness.document.id);
  if (removed.error) throw new Error(`[ERASER_E2E_INFRA] clear fixture rows: ${removed.error.message}`);
  const inserted = await harness.admin
    .from('document_annotations')
    .upsert(rows, { onConflict: 'document_id,annotation_id' });
  if (inserted.error) throw new Error(`[ERASER_E2E_INFRA] seed fixture rows: ${inserted.error.message}`);

  const annotations = harness.seedDoc.getMap('annotations');
  const markers = harness.seedDoc.getMap('surveyMarkers');
  let update = null;
  const capture = (value) => { update = value; };
  harness.seedDoc.on('update', capture);
  harness.seedDoc.transact(() => {
    for (const key of [...annotations.keys()]) annotations.delete(key);
    for (const key of [...markers.keys()]) markers.delete(key);
    for (const row of rows) {
      if (row.annotation_type === 'survey-marker') {
        markers.set(row.annotation_id, {
          annotationId: row.annotation_id,
          pageNumber: row.page_number,
          bounds: row.bounds,
          x: row.bounds?.x,
          y: row.bounds?.y,
          width: row.bounds?.width,
          height: row.bounds?.height,
          angle: row.bounds?.angle || 0,
          categoryId: row.category_id,
          moduleId: row.module_id,
          regionId: row.annotation_data?.regionId ?? null,
          name: row.name,
          notes: row.notes,
          color: row.color,
          opacity: row.opacity,
          locked: row.annotation_data?.locked === true,
          userId: row.user_id,
          authorId: row.user_id,
          lastModifiedBy: row.last_modified_by,
          annotationData: row.annotation_data,
        });
      } else {
        annotations.set(row.annotation_id, {
          p: row.page_number,
          o: row.annotation_data.fabricObject,
        });
      }
    }
  }, 'eraser-e2e-seed');
  harness.seedDoc.off('update', capture);
  if (!update) throw new Error('[ERASER_E2E_INFRA] current-store seed produced no Yjs update');
  harness.seedClientSeq += 1;
  let hex = '';
  for (const byte of update) hex += byte.toString(16).padStart(2, '0');
  if (!harness.ownerClient) {
    throw new Error('[ERASER_E2E_INFRA] authenticated owner client unavailable for WAL seed');
  }
  const currentInsert = await harness.ownerClient.rpc('append_annotation_update', {
    p_document_id: harness.document.id,
    p_client_id: 'eraser-permission-e2e-seed',
    p_client_seq: harness.seedClientSeq,
    p_data: `\\x${hex}`,
  });
  if (currentInsert.error) {
    throw new Error(`[ERASER_E2E_INFRA] seed annotation_updates: ${currentInsert.error.message}`);
  }
  return ids;
}

export async function readRows(harness, ids) {
  const result = await harness.admin
    .from('document_annotations')
    .select('annotation_id,annotation_type,user_id,bounds,annotation_data,updated_at')
    .eq('document_id', harness.document.id)
    .in('annotation_id', ids)
    .order('annotation_id');
  if (result.error) throw new Error(`[ERASER_E2E_INFRA] read fixture rows: ${result.error.message}`);
  return result.data || [];
}

function pgHexToBytes(value) {
  if (value instanceof Uint8Array) return value;
  const hex = String(value || '').replace(/^\\x/, '');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export async function readCurrentStore(harness) {
  const result = await harness.admin
    .from('annotation_updates')
    .select('seq,data')
    .eq('document_id', harness.document.id)
    .order('seq', { ascending: true });
  if (result.error) {
    throw new Error(`[ERASER_E2E_INFRA] read annotation_updates: ${result.error.message}`);
  }
  const doc = new Y.Doc();
  for (const row of result.data || []) Y.applyUpdate(doc, pgHexToBytes(row.data));
  return {
    annotations: Object.fromEntries(
      [...doc.getMap('annotations').entries()].map(([id, entry]) => [id, entry]),
    ),
    surveyMarkers: Object.fromEntries(doc.getMap('surveyMarkers').entries()),
    updateCount: (result.data || []).length,
  };
}

export function snapshotCurrentGeometry(state, ids) {
  return Object.fromEntries(ids.map((id) => [
    id,
    JSON.stringify(state.annotations[id] ?? state.surveyMarkers[id] ?? null),
  ]));
}

export function snapshotRows(rows) {
  return Object.fromEntries((rows || []).map((row) => [
    row.annotation_id,
    JSON.stringify({
      annotation_id: row.annotation_id,
      annotation_type: row.annotation_type,
      user_id: row.user_id,
      bounds: row.bounds,
      annotation_data: row.annotation_data,
    }),
  ]));
}

export async function waitForRowState(harness, predicate, message, timeoutMs = 20_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await predicate();
    if (last?.ok) return last.value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message}; last=${JSON.stringify(last)}`);
}

export async function setCollaboratorRole(harness, role) {
  const update = await harness.admin
    .from('document_collaborators')
    .update({ role, status: 'active' })
    .eq('document_id', harness.document.id)
    .eq('user_id', harness.users.collaborator.id)
    .select('role,status')
    .single();
  if (update.error) throw new Error(`[ERASER_E2E_INFRA] set collaborator role ${role}: ${update.error.message}`);
  return update.data;
}

export async function setDocumentLocked(harness, locked) {
  const update = await harness.admin
    .from('documents')
    .update({
      locked_at: locked ? new Date().toISOString() : null,
      locked_by: locked ? harness.users.owner.id : null,
      locked_label: locked ? 'eraser-e2e' : null,
    })
    .eq('id', harness.document.id);
  if (update.error) throw new Error(`[ERASER_E2E_INFRA] set document lock: ${update.error.message}`);
}

export function assertHarnessAccountIdentity(account, user) {
  const expectedId = account?.id || account?.userId;
  const expectedEmail = String(account?.email || '').trim().toLowerCase();
  if (!expectedId || !expectedEmail || user?.id !== expectedId
    || String(user?.email || '').trim().toLowerCase() !== expectedEmail) {
    throw new Error('[ERASER_E2E_INFRA] Authenticated session does not match the exact leased account');
  }
}

export async function makeSignedInClient(harness, account) {
  const client = createClient(harness.config.supabaseUrl, harness.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let signIn = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (signIn.error && /captcha/i.test(signIn.error.message || '')) {
    const admin = harness.admin || makeAdmin(harness.config);
    const generated = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: account.email,
    });
    if (generated.error) {
      throw new Error(
        `[ERASER_E2E_INFRA] generateLink(${account.email}): ${generated.error.message}`,
      );
    }
    const tokenHash = generated.data?.properties?.hashed_token;
    if (!tokenHash) {
      throw new Error(`[ERASER_E2E_INFRA] generateLink(${account.email}) returned no token hash`);
    }
    signIn = await client.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  }
  if (signIn.error) {
    throw new Error(`[ERASER_E2E_INFRA] signIn(${account.email}): ${signIn.error.message}`);
  }
  assertHarnessAccountIdentity(account, signIn.data?.user);
  return client;
}

export async function probeRejectedDelete(client, documentId, annotationId) {
  const result = await client
    .from('document_annotations')
    .delete({ count: 'exact' })
    .eq('document_id', documentId)
    .eq('annotation_id', annotationId)
    .select('annotation_id');
  return {
    error: result.error
      ? { code: result.error.code, message: result.error.message }
      : null,
    rows: result.data || [],
    count: result.count,
  };
}

export async function probeRejectedInsert(client, harness, annotationId) {
  const session = await client.auth.getUser();
  const userId = session.data.user?.id;
  const result = await client.from('document_annotations').insert({
    document_id: harness.document.id,
    user_id: userId,
    annotation_id: annotationId,
    annotation_type: 'ink',
    page_number: 1,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    annotation_data: { e2eProbe: true },
  }).select('annotation_id');
  return {
    error: result.error
      ? { code: result.error.code, message: result.error.message }
      : null,
    rows: result.data || [],
  };
}

export async function probeRejectedCurrentInsert(client, harness, clientSeq = Date.now()) {
  const result = await client.rpc('append_annotation_update', {
    p_document_id: harness.document.id,
    p_client_id: 'eraser-e2e-rls-probe',
    p_client_seq: clientSeq,
    p_data: '\\x00',
  });
  return {
    error: result.error
      ? { code: result.error.code, message: result.error.message }
      : null,
    rows: result.data || [],
  };
}

export async function openDocumentAs(
  context,
  harness,
  account,
  { renderer = 'pdfjs', missingIdentity = null, deferOpen = false } = {},
) {
  const authClient = await makeSignedInClient(harness, account);
  const sessionResult = await authClient.auth.getSession();
  const session = sessionResult.data?.session;
  if (sessionResult.error || !session) {
    throw new Error(
      `[ERASER_E2E_INFRA] leased session unavailable for ${account.email}: `
        + (sessionResult.error?.message || 'missing session'),
    );
  }
  assertHarnessAccountIdentity(account, session.user);
  const projectRef = new URL(harness.config.supabaseUrl).hostname.split('.')[0];
  const authStorageKey = `sb-${projectRef}-auth-token`;
  await context.addInitScript(({ email, password, sessionValue, storageKey }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(sessionValue));
    window.localStorage.setItem('__fix20AuthOverride', JSON.stringify({ email, password }));
  }, {
    email: account.email,
    password: account.password,
    sessionValue: session,
    storageKey: authStorageKey,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const url = new URL(harness.config.baseUrl);
  if (renderer === 'canvas') url.searchParams.set('renderer', 'canvas');
  url.searchParams.set('eraserE2EDocument', harness.document.id);
  url.searchParams.set('eraserE2EModule', 'eraser-e2e-module');
  if (deferOpen) url.searchParams.set('eraserE2EDeferOpen', '1');
  if (missingIdentity) url.searchParams.set('eraserE2EMissingIdentity', missingIdentity);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => typeof window.__eraserE2EOpenDocumentById === 'function',
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(() => {
    try {
      return Object.keys(window.localStorage || {}).some((key) => (
        key.includes('auth-token')
        && window.localStorage.getItem(key)?.includes('"access_token"')
      ));
    } catch {
      return false;
    }
  }, null, { timeout: 60_000 });
  if (deferOpen) return { page, errors, deferred: true };
  await page.evaluate(
    (documentId) => window.__eraserE2EOpenDocumentById(documentId),
    harness.document.id,
  );
  await page.waitForFunction(() => (
    document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]')
    && document.querySelector('[data-eraser-permission-e2e="true"]')?.textContent
  ), null, { timeout: 60_000 });
  await page.waitForFunction((documentId) => {
    try {
      const state = JSON.parse(
        document.querySelector('[data-eraser-permission-e2e="true"]')?.textContent || '',
      );
      return state.documentId === documentId;
    } catch {
      return false;
    }
  }, harness.document.id, { timeout: 60_000 });
  return { page, errors };
}

export async function openAnonymous(context, harness) {
  const page = await context.newPage();
  await page.goto(harness.config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => typeof window.__fix20OpenDocumentById === 'function',
    null,
    { timeout: 60_000 },
  );
  return page;
}

export async function selectEraser(page, mode) {
  const draw = page.getByRole('button', { name: 'Draw', exact: true });
  if (await draw.count() !== 1) throw new Error('[ERASER_E2E_INFRA] Draw toolbar button unavailable');
  await draw.click();
  const currentModeButton = page.locator('button[title="Partial erase"],button[title="Full stroke erase"]');
  if (await currentModeButton.count() !== 1) {
    throw new Error('[ERASER_E2E_INFRA] Eraser toolbar button unavailable after opening Draw');
  }
  await currentModeButton.click();
  const caret = page.locator('[data-eraser-caret-button="true"]');
  if (await caret.count() !== 1) throw new Error('[ERASER_E2E_INFRA] Eraser mode caret unavailable');
  await caret.click();
  const optionName = mode === 'entire' ? 'Full stroke erase' : 'Partial erase';
  const option = page.getByRole('button', { name: optionName, exact: true });
  if (await option.count() !== 1) throw new Error(`[ERASER_E2E_INFRA] ${optionName} option unavailable`);
  await option.click();
  await page.waitForFunction(() => (
    document.querySelector('[data-diag-eraser-wrapper="1"]')
    || document.querySelector('canvas[data-fabric="top"]')
  ), null, { timeout: 15_000 });
}

export async function pagePointToClient(page, point) {
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageDiv.boundingBox();
  if (!box) throw new Error('[ERASER_E2E_INFRA] page 1 is not measurable');
  return {
    x: box.x + (point.x / PAGE.width) * box.width,
    y: box.y + (point.y / PAGE.height) * box.height,
  };
}

export async function beginEraserStroke(page, point, span = 24) {
  const client = await pagePointToClient(page, point);
  await page.mouse.move(client.x - span, client.y);
  await page.mouse.down();
  await page.mouse.move(client.x + span, client.y, { steps: 8 });
  return client;
}

export async function finishEraserStroke(page, client, span = 24) {
  await page.mouse.move(client.x + span + 8, client.y, { steps: 3 });
  await page.mouse.up();
}

export async function dragEraserAcross(page, point, span = 24) {
  const client = await beginEraserStroke(page, point, span);
  await finishEraserStroke(page, client, span);
}

export async function runtimeState(page) {
  return page.evaluate(() => {
    let harness = null;
    try {
      harness = JSON.parse(
        document.querySelector('[data-eraser-permission-e2e="true"]')?.textContent || '',
      );
    } catch {
      harness = null;
    }
    return {
      harness,
    diag: window.__diagState
      ? {
          activeTool: window.__diagState.activeTool || null,
          objects: Object.values(window.__diagState.annotationsByPage || {})
            .flatMap((entry) => entry?.objects || [])
            .map((object) => ({
              id: object.id || object.data?.id || object.annotationId || null,
              type: object.data?.e2eFamily || object.data?.annotationType || object.pdfAnnotationType || object.type,
              authorId: object.meta?.authorId || object.authorId || object.data?.authorId || object.data?.userId || null,
            })),
        }
      : null,
    bodyReadonly: document.body.getAttribute('data-readonly'),
    eraserWrappers: document.querySelectorAll('[data-diag-eraser-wrapper]').length,
    maskClones: document.querySelectorAll('[data-eraser-mask-clone]').length,
    };
  });
}

export async function invokeForgedEraserCommits(page, { calloutId, surveyMarkerId }) {
  const argument = page.locator('[data-eraser-permission-argument="true"]');
  const response = page.locator('[data-eraser-permission-response="true"]');
  if (await argument.count() !== 1 || await response.count() !== 1) {
    throw new Error('[ERASER_E2E_INFRA] Direct eraser commit controls unavailable');
  }
  const invoke = async (command, id) => {
    const previous = await response.textContent();
    await argument.fill(id, { force: true });
    await page.locator(`[data-eraser-permission-command="${command}"]`).click({ force: true });
    await page.waitForFunction(
      ({ selector, before }) => {
        const value = document.querySelector(selector)?.textContent || '';
        return value && value !== before;
      },
      {
        selector: `[data-eraser-permission-response="true"]`,
        before: previous || '',
      },
      { timeout: 5_000 },
    );
    const payload = JSON.parse(await response.textContent());
    if (payload.error) throw new Error(payload.error);
    return payload.result;
  };
  const callout = await invoke('tryEraseCalloutCommit', calloutId);
  const surveyMarker = await invoke('tryEraseSurveyMarkerCommit', surveyMarkerId);
  const surveyMarkerBounds = await invoke('tryMoveSurveyMarkerCommit', surveyMarkerId);
  return { callout, surveyMarker, surveyMarkerBounds };
}

export async function waitForFixturesRendered(page, fixtures, { renderer = 'pdfjs' } = {}) {
  const expected = Object.values(fixtures).map(({ id, family }) => ({ id, family }));
  await page.waitForFunction(({ expectedFixtures, activeRenderer }) => {
    const diagObjects = Object.values(window.__diagState?.annotationsByPage || {})
      .flatMap((entry) => entry?.objects || []);
    let harnessState = { annotations: [], callouts: [] };
    try {
      harnessState = JSON.parse(
        document.querySelector('[data-eraser-permission-e2e="true"]')?.textContent || '',
      );
    } catch {
      return false;
    }
    const runtimeIds = new Set([
      ...diagObjects.map((object) => object.id || object.data?.id || object.annotationId),
      ...(harnessState.annotations || []).map((entry) => entry.id),
      ...(harnessState.callouts || []).map((entry) => entry.id),
    ].filter(Boolean).map(String));
    return expectedFixtures.every(({ id, family }) => {
      if (family === 'survey-marker') {
        return Boolean(document.querySelector(`[data-survey-marker-id="${CSS.escape(id)}"]`));
      }
      if (family === 'callout') {
        return Boolean(document.querySelector(`[data-callout-id="${CSS.escape(id)}"]`))
          || (activeRenderer === 'canvas' && runtimeIds.has(id));
      }
      return Boolean(document.querySelector(`[data-annotation-id="${CSS.escape(id)}"]`))
        || (activeRenderer === 'canvas' && runtimeIds.has(id));
    });
  }, { expectedFixtures: expected, activeRenderer: renderer }, { timeout: 45_000 });
}

function fixtureSelector(id) {
  const escaped = String(id).replace(/(["\\])/g, '\\$1');
  return [
    `[data-annotation-id="${escaped}"]`,
    `[data-callout-id="${escaped}"]`,
    `[data-survey-marker-id="${escaped}"]`,
  ].join(',');
}

export async function readVisibleGeometry(page, fixture) {
  return page.evaluate((id) => {
    const escaped = CSS.escape(id);
    const elements = [
      ...document.querySelectorAll(
        `[data-annotation-id="${escaped}"],`
        + `[data-callout-id="${escaped}"],`
        + `[data-survey-marker-id="${escaped}"]`,
      ),
    ];
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        d: element.getAttribute('d'),
        points: element.getAttribute('points'),
        x: element.getAttribute('x'),
        y: element.getAttribute('y'),
        width: element.getAttribute('width'),
        height: element.getAttribute('height'),
        transform: element.getAttribute('transform'),
        rect: [rect.x, rect.y, rect.width, rect.height],
      };
    });
  }, fixture.id);
}

async function fixtureClip(page, fixture) {
  const selector = fixtureSelector(fixture.id);
  const target = page.locator(selector).first();
  const box = await target.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    return {
      x: Math.max(0, box.x - 4),
      y: Math.max(0, box.y - 4),
      width: Math.max(1, box.width + 8),
      height: Math.max(1, box.height + 8),
    };
  }
  const client = await pagePointToClient(page, fixture.center);
  return {
    x: Math.max(0, client.x - 36),
    y: Math.max(0, client.y - 36),
    width: 72,
    height: 72,
  };
}

function changedPixelCount(beforeBytes, afterBytes) {
  const before = PNG.sync.read(beforeBytes);
  const after = PNG.sync.read(afterBytes);
  if (before.width !== after.width || before.height !== after.height) return Infinity;
  return pixelmatch(
    before.data,
    after.data,
    null,
    before.width,
    before.height,
    { threshold: 0.05, includeAA: true },
  );
}

export async function assertBlockedPreviewUntouched(page, fixture) {
  const clip = await fixtureClip(page, fixture);
  const beforePixels = await page.screenshot({ clip });
  const client = await beginEraserStroke(page, fixture.center);
  const preview = await page.evaluate((id) => {
    const escaped = CSS.escape(id);
    const cloneTargets = [
      ...document.querySelectorAll(
        `[data-eraser-mask-clone] [data-annotation-id="${escaped}"],`
        + `[data-eraser-mask-clone] [data-callout-id="${escaped}"],`
        + `[data-eraser-mask-clone] [data-survey-marker-id="${escaped}"]`,
      ),
    ];
    const ancestorStates = cloneTargets.flatMap((element) => {
      const states = [];
      let current = element;
      while (current && current instanceof Element) {
        const style = getComputedStyle(current);
        states.push({
          tag: current.tagName,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          mask: current.getAttribute('mask') || style.mask || style.webkitMask || null,
          clipPath: current.getAttribute('clip-path') || style.clipPath || null,
        });
        if (current.hasAttribute('data-eraser-mask-clone')) break;
        current = current.parentElement;
      }
      return states;
    });
    const paintedPreview = document.querySelector('[data-eraser-live-preview]');
    const paintedState = paintedPreview instanceof HTMLCanvasElement
      ? paintedPreview.toDataURL('image/png')
      : null;
    document.querySelectorAll('[data-eraser-cursor="true"]').forEach((cursor) => {
      cursor.dataset.e2ePriorDisplay = cursor.style.display;
      cursor.style.display = 'none';
    });
    return {
      cloneCount: document.querySelectorAll('[data-eraser-mask-clone]').length,
      targetCount: cloneTargets.length,
      targetStates: cloneTargets.map((element) => ({
        display: getComputedStyle(element).display,
        visibility: getComputedStyle(element).visibility,
        mask: element.getAttribute('mask'),
      })),
      ancestorStates,
      paintedState,
      liveSvgVisibility: getComputedStyle(
        document.querySelector('[data-diag-svg-wrapper]') || document.documentElement,
      ).visibility,
    };
  }, fixture.id);
  const duringPixels = await page.screenshot({ clip });
  preview.changedPixels = changedPixelCount(beforePixels, duringPixels);
  await finishEraserStroke(page, client);
  await page.evaluate(() => {
    document.querySelectorAll('[data-eraser-cursor="true"]').forEach((cursor) => {
      cursor.style.display = cursor.dataset.e2ePriorDisplay || '';
      delete cursor.dataset.e2ePriorDisplay;
    });
  });

  if (preview.cloneCount !== 0 && preview.targetCount === 0) {
    throw new Error(
      `[ERASER_E2E_INFRA] Blocked preview target ${fixture.family} ${fixture.id} was absent from the active SVG clone.`,
    );
  }
  if (preview.cloneCount === 0 && preview.paintedState === null) {
    throw new Error(
      `[ERASER_E2E_INFRA] No SVG clone or painted fallback existed for blocked ${fixture.family} ${fixture.id}.`,
    );
  }
  if (preview.changedPixels !== 0) {
    throw new Error(
      `[ERASER_PRODUCT_FAILURE] Blocked ${fixture.family} ${fixture.id} changed ${preview.changedPixels} preview pixels.`,
    );
  }
  if (preview.cloneCount !== 0) {
    const hidden = preview.targetStates.some((state) => (
      state.display === 'none'
      || state.visibility === 'hidden'
      || Boolean(state.mask)
    ));
    const hiddenAncestor = preview.ancestorStates.some((state) => (
      state.display === 'none'
      || state.visibility === 'hidden'
      || Number(state.opacity) === 0
    ));
    if (hidden || hiddenAncestor) {
      throw new Error(
        `[ERASER_PRODUCT_FAILURE] Blocked ${fixture.family} ${fixture.id} disappeared in live preview: ${JSON.stringify(preview)}`,
      );
    }
  } else if (preview.liveSvgVisibility === 'hidden') {
    throw new Error(
      `[ERASER_PRODUCT_FAILURE] Blocked ${fixture.family} hid the live SVG without a permission-safe clone.`,
    );
  }
  return preview;
}

export { FAMILY_ORDER, PAGE };
