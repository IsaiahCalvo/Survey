import * as Y from 'yjs';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { initializeSurveyCrdtV2, materializeSurveyCrdtV2 } from '../services/documentSurveyCrdtV2.js';
import { createDocumentGenerationReader } from '../services/documentGenerationReader.js';
import { docToByPage, syncByPageToDoc } from '../services/annotationDocStore.js';

export const MODEL2_FIXTURE_IDS = Object.freeze({
  actorUserId: 'd2000000-0000-4000-8000-000000000001',
  documentId: 'd2000000-0000-4000-8000-000000000002',
  generationId: 'd2000000-0000-4000-8000-000000000003',
  pdfId: 'd2000000-0000-4000-8000-000000000004',
  pdfVersion: 'd2000000-0000-4000-8000-000000000005',
  operationId: 'd2000000-0000-4000-8000-000000000006',
});

const hex = bytes => `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
const bytesFromHex = value => Uint8Array.from(value.slice(2).match(/../g) || [], part => parseInt(part, 16));
const sameBytes = (left, right) => {
  const a = bytesFromHex(left); const b = bytesFromHex(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Fixture-only checked backend. It accepts no table, auth, storage, or realtime calls. */
export async function createDocumentSurveyModelV2Fixture({ pdfBlob }) {
  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) throw new Error('A local PDF fixture is required.');
  const ids = MODEL2_FIXTURE_IDS;
  const authoritative = createDetachedYDoc(`document-survey-model-v2-fixture:${ids.generationId}`);
  initializeSurveyCrdtV2(authoritative, { surveyMarkers: {
    'fixture-marker-left': { annotationId: 'fixture-marker-left', pageNumber: 1,
      bounds: { x: 72, y: 96, width: 54, height: 54 }, moduleId: 'fixture-module',
      categoryId: 'fixture-category', entityId: 'fixture-entity-left', entityName: 'Left marker',
      entityColor: '#e05252', checklistResponses: { 'fixture-check-left': { selection: 'Y' } } },
    'fixture-marker-right': { annotationId: 'fixture-marker-right', pageNumber: 1,
      bounds: { x: 280, y: 96, width: 54, height: 54 }, moduleId: 'fixture-module',
      categoryId: 'fixture-category', entityId: 'fixture-entity-right', entityName: 'Right marker',
      entityColor: '#4f8fe8', checklistResponses: { 'fixture-check-right': { selection: 'N' } } },
  }, spaces: [{ id: 'fixture-space', name: 'Fixture space', assignedPages: [{ pageId: 1,
    regions: [{ regionId: 'fixture-region', name: 'Fixture region', color: '#49a66f',
      bounds: { x: 48, y: 220, width: 360, height: 180 } }] }] }] });
  syncByPageToDoc(authoritative, { 1: { objects: [{ id: 'fixture-ordinary-rect', type: 'rect',
    left: 170, top: 300, width: 110, height: 70, fill: 'rgba(245, 158, 11, 0.2)',
    stroke: '#f59e0b', strokeWidth: 4, data: { id: 'fixture-ordinary-rect', type: 'rectangle',
      label: 'Ordinary annotation' } }] } });
  const semanticView = doc => ({ survey: materializeSurveyCrdtV2(doc), annotationsByPage: docToByPage(doc) });
  const baselineSemantic = JSON.stringify(semanticView(authoritative));
  let offline = false, head = 0n;
  const rows = [];
  let snapshotWrites = 0, conditionalReads = 0, conditionalMatches = 0,
    conditionalFullResponses = 0, fullSnapshotReads = 0, rpcResponseDataBytes = 0;
  const initialUpdate = Y.encodeStateAsUpdate(authoritative);
  let snapshot = { at_seq: '0', snapshot: hex(initialUpdate), encoding_version: 1,
    writer_id: null, writer_epoch: '0' };
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const pdfHash = await sha256(pdfBytes);
  const pdf = Object.freeze({ bucket_id: 'documents', path: `${ids.actorUserId}/_generations/model2-fixture.pdf`,
    id: ids.pdfId, version: ids.pdfVersion, byte_length: String(pdfBytes.length), content_sha256: pdfHash });
  const publication = Object.freeze({ operation_id: ids.operationId, generation_id: ids.generationId,
    published_at: '2026-09-09T00:00:00.000Z', wal_head: '0' });
  const base = { version: 3, document_id: ids.documentId, generation_id: ids.generationId,
    content_model_version: 2 };

  async function executeRpc(name, params) {
    if (name === 'read_document_generation_collaboration') {
      if (params?.p_document_id !== ids.documentId || params?.p_generation_id !== ids.generationId) {
        throw new Error(`Fixture scope rejected: ${name}`);
      }
      return { data: { version: 1, actor_user_id: ids.actorUserId, document_id: ids.documentId,
        generation_id: ids.generationId, pdf, publication,
        role: 'owner' } };
    }
    if (params?.p_document_id !== ids.documentId || params?.p_generation_id !== ids.generationId
      || params?.p_content_model_version !== 2) throw new Error(`Fixture scope rejected: ${name}`);
    if (offline && ['append_annotation_update_v3', 'store_annotation_snapshot_v3'].includes(name)) {
      throw Object.assign(new Error('Fixture is offline.'), { code: 'MODEL2_FIXTURE_OFFLINE' });
    }
    if (name === 'read_document_generation_open_v3') return { data: { ...base,
      actor_user_id: ids.actorUserId,
      document: { id: ids.documentId, user_id: ids.actorUserId, project_id: null,
        name: 'Model 2 viewer fixture.pdf', file_path: pdf.path, file_size: String(pdfBytes.length) },
      pdf, publication,
      annotations: { ...base, wal_head: String(head), snapshot: params.p_include_snapshot ? snapshot : null,
        snapshot_sha256: params.p_include_snapshot ? await sha256(bytesFromHex(snapshot.snapshot)) : null } } };
    if (name === 'read_annotation_updates_v3') {
      const through = BigInt(params.p_through_seq ?? head);
      const eligible = rows.filter(row => BigInt(row.seq) > BigInt(params.p_after_seq)
        && BigInt(row.seq) <= through);
      return { data: { ...base, rows: eligible, through_seq: String(through), has_more: false } };
    }
    if (name === 'read_annotation_writer_sequence_v3') return { data: { ...base,
      client_id: params.p_client_id, client_seq: rows.filter(row => row.client_id === params.p_client_id)
        .reduce((highest, row) => BigInt(row.client_seq) > highest ? BigInt(row.client_seq) : highest, 0n).toString() } };
    if (name === 'read_annotation_checkpoint_conditional_v3') {
      const snapshotSha256 = await sha256(bytesFromHex(snapshot.snapshot));
      const matched = params.p_expected_at_seq === snapshot.at_seq
        && params.p_expected_writer_id === snapshot.writer_id
        && params.p_expected_writer_epoch === snapshot.writer_epoch
        && params.p_expected_encoding_version === snapshot.encoding_version
        && params.p_expected_snapshot_sha256 === snapshotSha256;
      return { data: { ...base, actor_user_id: ids.actorUserId, wal_head: String(head),
        snapshot_matches: matched, checkpoint: { at_seq: snapshot.at_seq,
          writer_id: snapshot.writer_id, writer_epoch: snapshot.writer_epoch,
          encoding_version: snapshot.encoding_version, snapshot_sha256: snapshotSha256,
          snapshot: matched ? null : snapshot.snapshot } } };
    }
    if (name === 'append_annotation_update_v3') {
      let row = rows.find(item => item.client_id === params.p_client_id && item.client_seq === params.p_client_seq);
      if (!row) {
        row = { seq: String(++head), client_id: params.p_client_id,
          client_seq: params.p_client_seq, actor_user_id: ids.actorUserId, data: params.p_data };
        rows.push(row); Y.applyUpdate(authoritative, bytesFromHex(row.data));
      }
      return { data: { ...base, ...row, accepted: true, data_sha256: await sha256(bytesFromHex(row.data)),
        current_generation_id: ids.generationId, is_current: true } };
    }
    if (name === 'read_annotation_snapshot_v3') return { data: { ...base, snapshot, wal_head: String(head) } };
    if (name === 'store_annotation_snapshot_v3') {
      snapshotWrites += 1;
      const exact = snapshot.at_seq === params.p_at_seq && sameBytes(snapshot.snapshot, params.p_snapshot)
        && snapshot.encoding_version === params.p_encoding_version
        && snapshot.writer_id === params.p_writer_id && snapshot.writer_epoch === params.p_writer_epoch;
      const matches = String(head) === params.p_at_seq
        && snapshot.at_seq === params.p_expected_at_seq
        && snapshot.writer_id === params.p_expected_writer_id
        && snapshot.writer_epoch === params.p_expected_writer_epoch
        && BigInt(params.p_writer_epoch) > BigInt(snapshot.writer_epoch);
      const stored = exact || matches;
      if (matches) snapshot = { at_seq: params.p_at_seq, snapshot: params.p_snapshot,
        encoding_version: params.p_encoding_version, writer_id: params.p_writer_id,
        writer_epoch: params.p_writer_epoch };
      return { data: { ...base, stored, at_seq: params.p_at_seq,
        writer_id: params.p_writer_id, writer_epoch: params.p_writer_epoch,
        encoding_version: params.p_encoding_version,
        ...(stored ? { snapshot_sha256: await sha256(bytesFromHex(params.p_snapshot)) } : {}) } };
    }
    throw new Error(`Live service blocked by model 2 fixture: ${name}`);
  }
  async function rpc(name, params) {
    const result = await executeRpc(name, params);
    rpcResponseDataBytes += new TextEncoder().encode(JSON.stringify(result?.data ?? null)).byteLength;
    if (name === 'read_annotation_snapshot_v3') fullSnapshotReads += 1;
    if (name === 'read_annotation_checkpoint_conditional_v3') {
      conditionalReads += 1;
      if (result?.data?.snapshot_matches) conditionalMatches += 1;
      else conditionalFullResponses += 1;
    }
    return result;
  }
  const builder = execute => {
    const value = { setHeader() { return value; }, abortSignal() { return value; },
      select() { return value; }, eq() { return value; }, is() { return value; },
      maybeSingle() { return value; }, retry() { return value; },
      then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); } };
    return value;
  };
  const channels = [];
  const fixtureAccessToken = 'fixture-local-token';
  const client = Object.freeze({
    rpc(name, params) { return builder(() => rpc(name, params)); },
    auth: { getSession: async () => ({ data: { session: { user: { id: ids.actorUserId },
      access_token: fixtureAccessToken } }, error: null }),
    onAuthStateChange(callback) { const subscription = { unsubscribe() {} };
      queueMicrotask(() => callback?.('SIGNED_IN', { user: { id: ids.actorUserId }, access_token: fixtureAccessToken }));
      return { data: { subscription } }; } },
    realtime: { async setAuth(token) {
      if (token !== fixtureAccessToken) throw new Error('Fixture realtime auth rejected.');
    } },
    from(table) {
      if (!['documents', 'document_collaborators'].includes(table)) throw new Error(`Fixture table blocked: ${table}`);
      return builder(() => table === 'documents'
        ? { data: { locked_at: null, locked_by: null, locked_label: null }, error: null }
        : { data: [], error: null });
    },
    channel(topic) {
      if (!String(topic).startsWith('document-lock:') && !String(topic).startsWith('generation-presence:')
        && !String(topic).startsWith(`anno-generation-${ids.documentId}-${ids.generationId}-`)) {
        throw new Error(`Fixture channel blocked: ${topic}`);
      }
      const callbacks = new Map();
      const channel = { on(event, _filter, callback) { callbacks.set(event, callback); return channel; },
        subscribe(callback) { channel.statusCallback = callback; channels.push(channel);
          queueMicrotask(() => callback?.('SUBSCRIBED')); return channel; },
        emitStatus(status) { return channel.statusCallback?.(status); },
        track: async () => 'ok', untrack: async () => 'ok', presenceState: () => ({}), callbacks };
      return channel;
    },
    removeChannel: async channel => { const index = channels.indexOf(channel); if (index >= 0) channels.splice(index, 1); return 'ok'; },
    getChannels: () => [...channels],
  });
  const reader = createDocumentGenerationReader({ request: rpc,
    getActorUserId: () => ids.actorUserId, download: async () => pdfBlob });
  return Object.freeze({ ids, client,
    read: ({ conditionalAnnotationCheckpoint = false } = {}) => reader.open({
      documentId: ids.documentId, actorUserId: ids.actorUserId,
      pdfGenerationId: ids.generationId, contentModelVersion: 2,
      conditionalAnnotationCheckpoint }),
    setOffline(value) { offline = value === true; },
    inspect() {
      const current = semanticView(authoritative);
      const markers = current.survey.surveyMarkers;
      const spaces = current.survey.spaces;
      const assignedPages = spaces.flatMap(space => space.assignedPages || []);
      const regions = assignedPages.flatMap(page => page.regions || []);
      const annotationCount = Object.values(current.annotationsByPage)
        .reduce((count, page) => count + (page?.objects?.length || 0), 0);
      return Object.freeze({ offline, walHead: String(head), walRows: rows.length,
        snapshotWrites, markerCount: Object.keys(markers).length,
        spaceCount: spaces.length, assignedPageCount: assignedPages.length,
        regionCount: regions.length, annotationCount,
        baselineSemanticMatch: JSON.stringify(current) === baselineSemantic,
        markerIds: Object.keys(markers).sort(), annotationId: 'fixture-ordinary-rect',
        regionId: 'fixture-region' });
    },
    inspectTransport() {
      return Object.freeze({ conditionalReads, conditionalMatches, conditionalFullResponses,
        fullSnapshotReads, rpcResponseDataBytes });
    },
    destroy() { authoritative.destroy(); },
  });
}
