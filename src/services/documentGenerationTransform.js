// PRIVATE SERVER PREREQUISITE. Never return this plan to an end user: it
// contains other users' attached surveys and private connector history.
// The caller proves the captured SQL digest, exact PDF/page dimensions and
// sidecar byte attestations. This pure transform neither proves those inputs
// nor publishes/archives anything. Node tested (bounded node:zlib codec);
// this complete module has not been verified in Deno.
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { materializeAnnotationGenerationState } from './annotationGenerationState.js';
import { syncByPageToDoc, syncSurveyMarkersToDoc, deletedPdfAnnotationStorageKey } from './annotationDocStore.js';
import { transformPageState, pageNumberAfterOperation } from '../utils/pageAnnotationReindex.js';
import { calloutToAnnotationObject, deriveCalloutsFromByPage } from '../utils/calloutAnnotationBridge.js';
import { mapSurveyMarkerRowToLocalAnnotation } from './documentSurveyMarkerMapper.js';
import { isSurveyMarkerType } from '../utils/surveyMarkerType.js';
import { EXPORT_ACK_FIELDS } from './excelExportAck.js';

const MAX_BYTES = 64 * 1024 * 1024, MAX_ROWS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pageAliases = new Set(['page', 'pageNumber', 'pageId', 'page_number']);
const addresses = new Set([...pageAliases, 'pages', 'pageIds', 'pageNumbers', 'targetPage', 'sourcePage', 'assignedPages', 'currentPage', 'current_page']);
const domains = new Set(['annotationsByPage', 'surveyMarkers', 'annotations', 'pageNames', 'pageTransformations',
  'bookmarks', 'spaces', 'regionOverlayDisabled', 'deletedPdfAnnotations']);
const own = (o, k) => Object.hasOwn(o, k);
const put = (o,k,v) => Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});
const safeIdentity = id => typeof id === 'string' && id.length > 0 && !own(Object.prototype,id) && id !== 'prototype';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function fail(reason) {
  const error = new Error('The complete source state cannot be transformed safely. Its original data was kept.');
  error.code = 'DOCUMENT_GENERATION_TRANSFORM_INVALID'; error.reason = reason; throw error;
}
const check = (v, reason = 'shape') => { if (!v) fail(reason); };
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : object(v)
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const same = (a, b) => canonical(a) === canonical(b);
function cloneJson(v, depth = 0, ancestors = new Set(), budget = { bytes: MAX_BYTES }) {
  check(depth <= 64, 'depth');
  budget.bytes -= typeof v === 'string' ? Buffer.byteLength(v) : 8;
  check(budget.bytes >= 0, 'capacity');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { check(Number.isFinite(v), 'json'); return v; }
  check(v && typeof v === 'object' && !ancestors.has(v), 'json');
  const array = Array.isArray(v), keys = Reflect.ownKeys(v);
  check(array || [Object.prototype, null].includes(Object.getPrototypeOf(v)), 'json');
  check(!array || keys.length === v.length + 1, 'json');
  ancestors.add(v); const out = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, key);
    check(typeof key === 'string' && d.enumerable && own(d, 'value'), 'json');
    if (array) check(/^(0|[1-9]\d*)$/.test(key) && Number(key) < v.length, 'json');
    budget.bytes -= Buffer.byteLength(key); check(budget.bytes >= 0, 'capacity');
    Object.defineProperty(out, key, { value: cloneJson(d.value, depth + 1, ancestors, budget), enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(v); return out;
}
function seq(value) {
  check(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value), 'sequence');
  const n = BigInt(value); check(n <= 9223372036854775807n, 'sequence'); return n;
}
function rejectAddresses(v) {
  if (!v || typeof v !== 'object') return;
  for (const [key, value] of Object.entries(v)) {
    check(!addresses.has(key) && !domains.has(key), 'unknown-page-domain');
    rejectAddresses(value);
  }
}
function extraField(key,value) {
  check(!addresses.has(key) && !domains.has(key), 'unknown-page-domain'); rejectAddresses(value);
}
function page(value, count) { check(Number.isSafeInteger(value) && value > 0 && value <= count, 'page'); return value; }
function carrier(value, expected, count) {
  check(object(value), 'carrier');
  for (const [key, entry] of Object.entries(value)) {
    if (pageAliases.has(key)) check(page(entry, count) === expected, 'page-alias');
    else if (['data','legacyCallout','annotationData'].includes(key)) { if (entry != null) carrier(entry, expected, count); }
    else if (key === 'pdfNativeAnnotationIdentity') {
      check(object(entry) && page(entry.pageNumber, count) === expected, 'native-identity');
    } else extraField(key,entry);
  }
}
function annotationId(o) {
  const id = o?.data?.id ?? o?.id ?? o?.annotationId ?? o?.pdfAnnotationId;
  // The shared utility uses plain id dictionaries. Reject prototype keys in
  // visible carriers; private survey identities use own-property maps below.
  check(safeIdentity(id), 'annotation-id'); return id;
}
function flatModern(byPage) {
  return Object.fromEntries(Object.entries(byPage).flatMap(([p,b])=>b.objects.map(o=>[annotationId(o),{p:Number(p),o}])));
}
function legacyJson(value, key = '') {
  if (value instanceof Y.Map) value = Object.fromEntries(value.entries());
  if (Array.isArray(value)) return value.map(v => legacyJson(v));
  if (!object(value)) return cloneJson(value);
  const out = {};
  for (const [field, entry] of Object.entries(value)) {
    // Legacy per-property Fabric Y.Maps use undefined to mean a removed
    // property. Preserve its absence, not a new JSON null/default value.
    if (entry === undefined && key === 'fabric') continue;
    Object.defineProperty(out, field, {value:legacyJson(entry, field),enumerable:true,writable:true,configurable:true});
  }
  return out;
}
function legacyVisible(doc) {
  const annotations = doc.getMap('annotations'), tombstones = doc.getMap('__annotationDeletionTombstones');
  const markers = doc.getMap('__annotationUndoCreateMarkers'), snapshots = doc.getMap('__annotationLatestSnapshot');
  const owners = doc.getMap('__annotationFabricFieldOwners'), fields = doc.getMap('__annotationLatestFabricFields');
  const visible = new Map([...annotations.entries()].map(([id, value]) => {
    check(value instanceof Y.Map, 'legacy-record'); return [id, legacyJson(value)];
  }));
  const deleted = new Set(tombstones.keys());
  for (const [id] of tombstones) {
    // An active delete must not resurrect through a stale SQL/sidecar copy.
    check(!visible.has(id) || markers.has(id), 'legacy-delete-conflict');
    visible.delete(id);
  }
  // Read-only counterpart of crdtUndoManager.reconcileLateCollaboratorEdits:
  // creator undo cannot erase later fields owned by a collaborator.
  for (const [id, marker] of markers) {
    if (deleted.has(id)) continue;
    const saved = snapshots.get(id); if (!saved) continue;
    const snapshot = legacyJson(saved), creator = marker?.creatorId ?? snapshot?.meta?.authorId;
    check(typeof creator === 'string' && creator.length > 0, 'legacy-undo-owner');
    const ownerMap = owners.get(id);
    if (ownerMap == null) continue;
    check(ownerMap instanceof Y.Map, 'legacy-undo-owner');
    const foreign = [...ownerMap.entries()].filter(([, owner]) => owner !== creator);
    if (!foreign.length) continue;
    const current = visible.get(id) || {};
    const result = {...snapshot,...current,fabric:{...snapshot.fabric,...current.fabric},meta:{...snapshot.meta,...current.meta}};
    const latest = fields.get(id); check(latest == null || latest instanceof Y.Map, 'legacy-undo-fields');
    for (const [key, owner] of foreign) {
      check(typeof owner === 'string' && owner.length > 0, 'legacy-undo-owner');
      if (latest?.has(key)) {
        const value = latest.get(key);
        if (value === undefined) delete result.fabric[key]; else result.fabric[key] = cloneJson(value);
      }
    }
    visible.set(id, result);
  }
  return {visible,deleted};
}
function validateModel(model, count) {
  for (const key of ['annotationsByPage', 'surveyMarkers', 'annotations', 'pageNames', 'pageTransformations', 'regionOverlayDisabled']) {
    if (own(model, key)) check(object(model[key]), 'domain-shape');
  }
  const seen = new Set();
  for (const [key, bucket] of Object.entries(model.annotationsByPage || {})) {
    check(/^[1-9]\d*$/.test(key), 'page-key'); const p = page(Number(key), count);
    check(object(bucket) && Array.isArray(bucket.objects), 'page-bucket');
    for (const o of bucket.objects) { carrier(o, p, count); const id = annotationId(o); check(!seen.has(id), 'duplicate-id'); seen.add(id); }
    for (const [field, value] of Object.entries(bucket)) if (field !== 'objects') extraField(field,value);
  }
  for (const key of ['annotations', 'surveyMarkers']) for (const [id, v] of Object.entries(model[key] || {})) {
    check(safeIdentity(id), 'annotation-id'); carrier(v, page(v.pageNumber ?? v.pageId ?? v.page, count), count);
    for (const alias of ['id', 'annotationId']) if (v[alias] != null) check(v[alias] === id, 'annotation-alias');
  }
  for (const key of ['pageNames', 'pageTransformations']) for (const p of Object.keys(model[key] || {})) {
    check(/^[1-9]\d*$/.test(p), 'page-key'); page(Number(p), count);rejectAddresses(model[key][p]);
  }
  for (const key of ['spaces', 'bookmarks', 'deletedPdfAnnotations']) if (own(model, key)) check(Array.isArray(model[key]), 'domain-shape');
  for (const space of model.spaces || []) {
    check(object(space) && Array.isArray(space.assignedPages), 'spaces');
    for(const [key,value] of Object.entries(space))if(key!=='assignedPages')extraField(key,value);
    const assigned=new Set();
    for (const entry of space.assignedPages) {
      const p = page(entry.pageId ?? entry.pageNumber, count);
      check(!assigned.has(p),'duplicate-space-page');assigned.add(p);
      for(const [key,value] of Object.entries(entry)) {
        if(pageAliases.has(key)||key==='targetPage')check(value===p,'page-alias');
        else if(key!=='regions')extraField(key,value);
      }
      if (entry.regions != null) { check(Array.isArray(entry.regions), 'regions'); for (const r of entry.regions) carrier(r, p, count); }
    }
  }
  const bookmarks = values => { for (const b of values) {
    check(object(b), 'bookmarks');
    for(const key of ['pageIds','pageNumbers'])if(b[key]!=null){check(Array.isArray(b[key]),'bookmarks');b[key].forEach(p=>page(p,count));}
    for (const k of [...pageAliases, 'targetPage']) if (b[k] != null) page(b[k], count);
    if (b.children != null) { check(Array.isArray(b.children), 'bookmarks'); bookmarks(b.children); }
    for(const [key,value] of Object.entries(b))if(!pageAliases.has(key)&&!['targetPage','pageIds','pageNumbers','children'].includes(key))extraField(key,value);
  } }; bookmarks(model.bookmarks || []);
  for (const d of model.deletedPdfAnnotations || []) carrier(d, page(d.pageNumber, count), count);
  for (const key of Object.keys(model.regionOverlayDisabled || {})) { const m = key.match(/^(.*)-(\d+)$/); check(m, 'region-overlay'); page(Number(m[2]), count); }
}
function prepareOperation(operation, count) {
  check(object(operation), 'operation');
  const type = operation.type; check(['move', 'reorder', 'insert', 'delete', 'rotate', 'copy', 'duplicate'].includes(type), 'operation');
  let map = p => p, source = null, target = null, nextCount = count;
  if (type === 'delete') { const n = page(operation.page, count); check(count > 1, 'last-page'); map = p => p < n ? p : p === n ? null : p - 1; nextCount--; }
  if (type === 'insert') { const n = page(operation.afterPage, count); map = p => p <= n ? p : p + 1; nextCount++; }
  if (type === 'move' || type === 'reorder') { const a = page(operation.from, count), b = page(operation.to, count);
    map = p => p === a ? b : a < b && p > a && p <= b ? p - 1 : a > b && p >= b && p < a ? p + 1 : p; }
  if (type === 'copy' || type === 'duplicate') { source = page(operation.page ?? operation.source, count);
    const after = page(operation.afterPage ?? operation.page ?? operation.target, count); target = after + 1; map = p => p <= after ? p : p + 1; nextCount++; }
  if (type === 'rotate') { page(operation.page, count); check(Number.isFinite(operation.delta ?? 90) && (operation.delta ?? 90) % 90 === 0, 'rotation'); }
  return { map, source, target, nextCount };
}

/** All inputs/outputs are server-private. `archive` is an owned recovery value,
 * not evidence of durable archival. Copy IDs derive only from operationId and
 * exact source identities, never time, provider state or traversal order. */
export async function transformDocumentGenerationSource(input) {
  const docs = [];
  try {
    const payload = cloneJson(input.sourcePayload), sidecars = cloneJson(input.sidecars ?? []);
    check(Buffer.byteLength(JSON.stringify(payload)) <= 16 * 1024 * 1024, 'capacity');
    const semantic = payload.semantic, s = semantic?.sources;
    check(object(semantic) && semantic.version === 1 && object(s) && object(semantic.document), 'source');
    const documentId = semantic.document_id, generationId = semantic.generation_id;
    check(UUID.test(documentId) && semantic.document.id === documentId && (generationId === null || UUID.test(generationId))
      && UUID.test(input.operationId), 'source-binding');
    const count = page(input.pageCount, Number.MAX_SAFE_INTEGER), op = cloneJson(input.operation), plan = prepareOperation(op, count);
    const sizes = cloneJson(input.pageSizes ?? []);
    if (sizes.length) { check(sizes.length === count, 'page-sizes'); for (const p of sizes) check(object(p) && Number.isFinite(p.width) && p.width > 0 && Number.isFinite(p.height) && p.height > 0, 'page-sizes'); }
    check(object(semantic.source_object) && semantic.source_object.bucket_id === 'documents'
      && typeof semantic.source_object.path === 'string' && semantic.source_object.path.length > 0
      && UUID.test(semantic.source_object.id), 'source-object');
    check(semantic.source_object.version === null || UUID.test(semantic.source_object.version), 'source-object');
    if (semantic.source_object.byte_length !== null) seq(semantic.source_object.byte_length);
    for (const key of ['page_count', 'pagecount']) if (semantic.document[key] != null) check(semantic.document[key] === count, 'page-count');
    const head = seq(semantic.wal_head);
    const expectedSources = new Set(['annotation_snapshot','annotation_updates','document_annotations','doc_yjs_state','doc_yjs_updates',
      'survey_sessions','survey_items','generation_baseline','generation_snapshot','generation_updates']);
    for (const key of expectedSources) check(own(s, key), 'source-domain');
    for (const [key, value] of Object.entries(s)) check(expectedSources.has(key) || value === null || (Array.isArray(value) && !value.length), 'source-domain');
    let budget = MAX_BYTES - Buffer.byteLength(JSON.stringify(sidecars)), rowCount = 0;
    check(budget > 0,'capacity');
    for (const value of Object.values(s)) rowCount += Array.isArray(value) ? value.length : value == null ? 0 : 1;
    check(rowCount <= MAX_ROWS, 'capacity');
    const decode = (text, encoding = 1) => {
      check(typeof text === 'string' && /^[A-Za-z0-9+/=\r\n]*$/.test(text), 'encoding');
      const compact = text.replace(/[\r\n]/g, ''), bytes = Buffer.from(compact, 'base64');
      check(bytes.toString('base64') === compact && [1, 2].includes(encoding), 'encoding');
      const out = encoding === 2 ? gunzipSync(bytes, { maxOutputLength: budget }) : bytes;
      budget -= out.byteLength; check(budget >= 0, 'capacity'); return out;
    };
    const newDoc = () => { const doc = createDetachedYDoc(); docs.push(doc); return doc; };
    const apply = (doc, bytes) => { Y.applyUpdate(doc, bytes); };
    const boundedDoc = doc => { let n = 0; for (const root of doc.share.values()) {
      check(root instanceof Y.Map || root.constructor === Y.AbstractType, 'yjs-root'); check(root._start === null, 'yjs-root');
      n += [...Y.Map.prototype.keys.call(root)].length; check(n <= MAX_ROWS, 'capacity');
    } check(!doc.store.pendingStructs && !doc.store.pendingDs, 'yjs-dependencies'); };
    const validateRow = (row, generated = false) => { check(object(row) && row.document_id === documentId, 'row-binding');
      if (generated) check(row.generation_id === generationId, 'row-binding');
      for (const key of ['writer_epoch', 'base_writer_epoch', 'base_at_seq', 'client_seq']) if (row[key] != null) seq(row[key]); };
    const modernDoc = newDoc();
    const snapshot = generationId === null ? s.annotation_snapshot : s.generation_snapshot;
    const updates = generationId === null ? s.annotation_updates : s.generation_updates;
    check(Array.isArray(updates), 'wal'); let at = 0n;
    if (generationId !== null) {
      const baseline = s.generation_baseline; validateRow(baseline, true); at = seq(baseline.base_seq);
      check([1,2].includes(baseline.baseline_encoding_version), 'encoding');
      check(at <= head, 'checkpoint');
      // A current snapshot is a standalone full state, not a CRDT delta from
      // baseline. Merging both can revive fields omitted by a newer checkpoint.
      if (snapshot == null) apply(modernDoc, decode(baseline.baseline_snapshot_base64, baseline.baseline_encoding_version));
    }
    if (snapshot != null) { validateRow(snapshot, generationId !== null); const checkpoint = seq(snapshot.at_seq);
      check(checkpoint >= at && checkpoint <= head, 'checkpoint'); at = checkpoint; apply(modernDoc, decode(snapshot.snapshot_base64, snapshot.encoding_version)); }
    for (const row of updates) { validateRow(row, generationId !== null); const next = seq(row.seq);
      check(next > at && (generationId === null || next === at + 1n) && next <= head, 'wal-order');
      apply(modernDoc, decode(row.data_base64)); at = next; }
    check(at === head, 'wal-head'); boundedDoc(modernDoc);
    const materialized = cloneJson(materializeAnnotationGenerationState(modernDoc));
    // Accepted empty state is authoritative too; map count cannot authorize
    // resurrection from stale secondary stores.
    const authoritative = generationId !== null || snapshot !== null || updates.length > 0;
    const legacy = newDoc(); check(Array.isArray(s.doc_yjs_updates), 'legacy-wal');
    let legacyAt = 0n;
    if (s.doc_yjs_state != null) { validateRow(s.doc_yjs_state); legacyAt = seq(s.doc_yjs_state.through_seq);
      apply(legacy, decode(s.doc_yjs_state.state_base64, s.doc_yjs_state.encoding_version ?? 1)); }
    let last = -1n;
    for (const row of s.doc_yjs_updates) { validateRow(row); const n = seq(row.seq); check(n > last, 'legacy-wal-order'); last = n;
      if (n > legacyAt) apply(legacy, decode(row.update_base64, row.encoding_version ?? 1)); }
    boundedDoc(legacy);
    const legacyState = legacyVisible(legacy);
    const modernIdentities = flatModern(materialized.annotationsByPage);
    // Build the accepted-state index once. Each secondary record then checks
    // only its own identities; legacy fallback imports grow this same index.
    // Rebuilding all page buckets for every row makes capture quadratic.
    const canonicalIndexes = {annotationsByPage:modernIdentities,surveyMarkers:materialized.surveyMarkers};
    for (const id of legacyState.deleted) check(!own(modernIdentities, id), 'legacy-delete-conflict');
    const identities = { annotations: {}, regions: {}, widgets: cloneJson(input.copiedWidgets ?? []) };
    const regionTargets = new Set();
    const mint = ({ kind, sourceId }) => {
      check(['annotation', 'region', 'row', 'survey-item'].includes(kind) && typeof sourceId === 'string' && sourceId.length > 0, 'copy-identity');
      const hex = createHash('sha256').update(`${input.operationId}\u0000${kind}\u0000${sourceId}`).digest('hex');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      if (kind === 'annotation' || kind === 'region') put(identities[kind === 'annotation' ? 'annotations' : 'regions'],sourceId,id);
      if (kind === 'region') regionTargets.add(id);
      return id;
    };
    for (const w of identities.widgets) { check(w.sourcePage === plan.source && w.targetPage === plan.target, 'widget-map');
      identities.annotations[`form-field:${w.sourcePage}:${w.sourceFieldId}`] = `form-field:${w.targetPage}:${w.targetFieldId}`; }
    const remapCopiedRegions = value => {
      if (!object(value)) return;
      if (value.regionId != null) {
        check(typeof value.regionId === 'string' && value.regionId.length > 0, 'region-identity');
        if (!regionTargets.has(value.regionId)) value.regionId = mint({ kind: 'region', sourceId: value.regionId });
      }
      remapCopiedRegions(value.data); remapCopiedRegions(value.legacyCallout); remapCopiedRegions(value.annotationData);
    };
    const clearReceipts = value => {
      if (!object(value)) return;
      for (const key of [...EXPORT_ACK_FIELDS, 'excelRowIndex', 'excel_row_index']) delete value[key];
      clearReceipts(value.data); clearReceipts(value.legacyCallout); clearReceipts(value.annotationData);
    };
    const repairAliases = (value, p) => {
      if (!object(value)) return;
      for (const key of pageAliases) if (own(value,key)) value[key]=p;
      repairAliases(value.data,p); repairAliases(value.legacyCallout,p); repairAliases(value.annotationData,p);
    };
    const transform = model => { validateModel(model, count); const result = transformPageState(model, op, { copiedWidgets: identities.widgets, createId: mint });
      for (const [p,bucket] of Object.entries(result.annotationsByPage)) for (const o of bucket.objects) repairAliases(o,Number(p));
      for (const key of ['surveyMarkers','annotations']) for (const value of Object.values(result[key])) repairAliases(value,value.pageNumber??value.pageId??value.page);
      for (const space of result.spaces) for (const entry of space.assignedPages) {
        repairAliases(entry,entry.pageId); for (const region of entry.regions||[]) repairAliases(region,entry.pageId);
        if(own(entry,'targetPage'))entry.targetPage=entry.pageId;
      }
      const bookmarks = entries => { for (const b of entries) {
        if (own(b,'page_number')) { const p=plan.map(b.page_number); if(p===null)delete b.page_number;else b.page_number=p; }
        if(own(b,'pageNumbers')){const original=b.pageNumbers;b.pageNumbers=[...new Set(original.map(plan.map).filter(p=>p!==null)
          .concat(plan.source!==null&&original.includes(plan.source)?[plan.target]:[]))].sort((a,b)=>a-b);}
        if (b.children) bookmarks(b.children);
      } }; bookmarks(result.bookmarks);
      if (plan.source !== null) {
        for (const o of result.annotationsByPage[plan.target]?.objects || []) remapCopiedRegions(o);
        for (const key of ['surveyMarkers', 'annotations']) for (const value of Object.values(result[key])) {
          if (value.pageNumber === plan.target) {
            remapCopiedRegions(value);clearReceipts(value);
            if(key==='surveyMarkers') {
              if(value.supabaseId!=null){check(UUID.test(value.supabaseId),'marker-row');value.supabaseId=mint({kind:'row',sourceId:value.supabaseId});}
              delete value.lastSyncedAt;
            }
          }
        }
      }
      result.regionOverlayDisabled = Object.fromEntries(result.regionOverlayDisabled);
      validateModel(result,plan.nextCount); return result; };
    const asCallout = c => { const p = page(c?.pageNumber ?? c?.page_number, count); check(sizes.length === count, 'callout-page-sizes');
      carrier(c, p, count); return calloutToAnnotationObject(c, sizes[p - 1]); };
    const byPage = values => { const result = {}; for (const [p, o] of values) { page(p, count); (result[p] ??= { objects: [] }).objects.push(o); } return result; };
    const flat = model => Object.fromEntries(Object.entries(model || {}).flatMap(([p, b]) => b.objects.map(o => [annotationId(o), { p: Number(p), o }])));
    const reconcile = model => {
      validateModel(model, count);
      for (const key of ['annotationsByPage', 'surveyMarkers']) {
        if (!own(model, key)) continue;
        const a = canonicalIndexes[key];
        const b = key === 'annotationsByPage' ? flat(model[key]) : model[key];
        for (const id of Object.keys(b)) check(!legacyState.deleted.has(id), 'legacy-delete-conflict');
        if (authoritative) { for (const [id, value] of Object.entries(b)) check(own(a, id) && same(a[id], value), 'representation-conflict'); }
        else { for (const [id, value] of Object.entries(b)) { check(!own(a, id) || same(a[id], value), 'representation-conflict'); put(a,id,value); } }
      }
    };
    const metaTransform = meta => {
      const known = {}, keep = {};
      for (const [key, value] of Object.entries(meta || {})) {
        if (domains.has(key)) known[key] = value;
        else if (key === 'calloutsList') {
          check(value === null || Array.isArray(value), 'meta-callouts');
          if (value?.length) { const callouts = byPage(value.map(c => [page(c.pageNumber ?? c.page_number, count), asCallout(c)]));
            reconcile({ annotationsByPage: callouts });
            keep[key] = deriveCalloutsFromByPage(transform({ annotationsByPage: callouts }).annotationsByPage);
          } else keep[key] = value;
        } else if(['currentPage','current_page'].includes(key))put(keep,key,pageNumberAfterOperation(page(value,count),op,plan.nextCount));
        else { extraField(key,value); put(keep,key,value); }
      }
      const changed = transform(known);
      for (const key of Object.keys(known)) keep[key] = changed[key];
      return keep;
    };
    check(Array.isArray(s.document_annotations), 'rows');
    const rows = [];
    for (const row of s.document_annotations) {
      validateRow(row); const p = page(row.page_number, count); check(typeof row.annotation_id === 'string' && row.annotation_id.length > 0, 'row-identity');
      let data = row.annotation_data; if (typeof data === 'string') data = JSON.parse(data); check(object(data), 'row-data');
      for(const [key,value] of Object.entries(row)) {
        if(pageAliases.has(key))check(value===p,'page-alias');
        else if(key!=='annotation_data')extraField(key,value);
      }
      if (data.fabricObject || data.callout || isSurveyMarkerType(row.annotation_type)) {
        for(const [key,value] of Object.entries(data)) {
          if(pageAliases.has(key))check(value===p,'page-alias');
          else if(!['fabricObject','callout'].includes(key))extraField(key,value);
        }
      }
      let model, kind;
      const withRowAuthor=value=>{
        if(authoritative||value.meta?.authorId||(!value.authorId&&!row.user_id))return value;
        const next=cloneJson(value);next.meta={...next.meta,authorId:value.authorId||row.user_id};return next;
      };
      if (data.fabricObject) { carrier(data.fabricObject, p, count); check(annotationId(data.fabricObject) === row.annotation_id, 'row-identity');
        data={...data,fabricObject:withRowAuthor(data.fabricObject)};
        if (data.pageNumber != null) check(data.pageNumber === p, 'page-alias');
        model = { annotationsByPage: byPage([[p, data.fabricObject]]) }; kind = 'fabric';
      } else if (row.annotation_type === 'callout' && data.callout) {
        data={...data,callout:withRowAuthor(data.callout)};
        model = { annotationsByPage: byPage([[p, asCallout(data.callout)]]) }; kind = 'callout';
      } else if (isSurveyMarkerType(row.annotation_type)) {
        const marker = mapSurveyMarkerRowToLocalAnnotation(row);
        // Mapper's optional undefined UI fields are not durable JSON fields.
        for (const key of Object.keys(marker)) if (marker[key] === undefined) delete marker[key];
        model = { surveyMarkers: { [row.annotation_id]: marker } }; kind = 'marker';
      } else { check(typeof data.type === 'string', 'unknown-row'); carrier(data, p, count);
        data=withRowAuthor(data);
        check(annotationId(data) === row.annotation_id, 'row-identity'); model = { annotationsByPage: byPage([[p, data]]) }; kind = 'raw'; }
      reconcile(model); const transformed = transform(model), outputs = kind === 'marker'
        ? Object.entries(transformed.surveyMarkers).map(([id, v]) => [v.pageNumber, id, v])
        : Object.entries(transformed.annotationsByPage).flatMap(([q, bucket]) => bucket.objects.map(v => [Number(q), annotationId(v), v]));
      for (const [q, id, value] of outputs) {
        const copy = plan.source !== null && p === plan.source && q === plan.target;
        const next = { ...cloneJson(row), page_number: q, annotation_id: id };
        repairAliases(next,q);
        if (copy) { next.id = mint({ kind: 'row', sourceId: row.id }); clearReceipts(next); }
        const nextData = cloneJson(data);
        if (kind === 'fabric') { nextData.fabricObject = value; if (own(nextData, 'pageNumber')) nextData.pageNumber = q; }
        else if (kind === 'callout') nextData.callout = deriveCalloutsFromByPage({ [q]: { objects: [value] } })[0];
        else if (kind === 'raw') Object.assign(nextData, value);
        else { if (own(nextData, 'pageNumber')) nextData.pageNumber = q; if (copy) remapCopiedRegions(nextData); }
        if (copy) clearReceipts(nextData);
        repairAliases(nextData,q);
        next.annotation_data = typeof row.annotation_data === 'string' ? JSON.stringify(nextData) : nextData;
        rows.push(next);
      }
    }
    const legacyProjection = { annotations: {}, callouts: {}, meta: {} };
    const historyRoots = new Set(['__annotationDeletionTombstones', '__annotationLatestFabric', '__annotationFabricFieldOwners',
      '__annotationLatestFabricFields', '__annotationLatestSnapshot', '__annotationUndoCreateMarkers']);
    for (const [name, root] of legacy.share) {
      const entries = name === 'annotations' ? [...legacyState.visible.entries()] : [...Y.Map.prototype.entries.call(root)];
      if (historyRoots.has(name)) continue; // Exact history is retained only in archive.
      check(['annotations', 'callouts', 'meta'].includes(name) || entries.length === 0, 'legacy-root');
      for (const [id, value] of entries) {
        if (name === 'meta') { put(legacyProjection.meta,id,value instanceof Y.AbstractType ? value.toJSON() : cloneJson(value)); continue; }
        check(name === 'annotations' || value instanceof Y.Map, 'legacy-record'); const v = legacyJson(value);
        const p = page(v.pageNumber, count); check(v.id === id && object(v.meta), 'legacy-identity');
        const field = name === 'annotations' ? 'fabric' : 'callout'; check(object(v[field]), 'legacy-record');
        for(const [key,value] of Object.entries(v)) {
          if(pageAliases.has(key))check(value===p,'page-alias');else if(key!==field)extraField(key,value);
        }
        const o = field === 'fabric' ? v.fabric : asCallout(v.callout);
        if (!authoritative && !o.meta?.authorId && v.meta.authorId) o.meta = {...o.meta,authorId:v.meta.authorId};
        check(annotationId(o) === id, 'legacy-identity'); carrier(o, p, count);
        const model = { annotationsByPage: byPage([[p, o]]) }; reconcile(model);
        const transformed = transform(model);
        for (const [q, bucket] of Object.entries(transformed.annotationsByPage)) for (const item of bucket.objects) {
          const targetId = annotationId(item), next = { ...cloneJson(v), id: targetId, pageNumber: Number(q),
            [field]: field === 'fabric' ? item : deriveCalloutsFromByPage({ [q]: { objects: [item] } })[0] };
          repairAliases(next,Number(q));if(plan.source!==null && p===plan.source && Number(q)===plan.target)clearReceipts(next.meta);
          put(legacyProjection[name],targetId,next);
        }
      }
    }
    legacyProjection.meta = metaTransform(legacyProjection.meta);
    check(Array.isArray(s.survey_sessions) && Array.isArray(s.survey_items), 'surveys');
    const sessions = new Map();
    for (const row of s.survey_sessions) { validateRow(row); check(UUID.test(row.id) && UUID.test(row.user_id) && !sessions.has(row.id), 'survey-session');
      for(const [key,value] of Object.entries(row))extraField(key,value);sessions.set(row.id, row); }
    const surveyItems = [], seenItems = new Set();
    for (const row of s.survey_items) {
      check(object(row) && sessions.has(row.session_id) && UUID.test(row.id) && !seenItems.has(row.id), 'survey-item'); seenItems.add(row.id);
      const sourceId=row.annotation_id??row.highlight_id;
      check(typeof sourceId==='string'&&sourceId.length>0,'survey-item');
      if(own(row,'annotation_id')&&own(row,'highlight_id'))check(row.annotation_id===row.highlight_id,'survey-item');
      for (const [key, value] of Object.entries(row)) if (key !== 'page_number') extraField(key,value);
      // Unplaced rows are valid business data; they never become page markers.
      if (row.page_number === null) { surveyItems.push(row); continue; }
      const p = page(row.page_number, count), mapped = plan.map(p);
      if (mapped != null) surveyItems.push({ ...row, page_number: mapped });
      if(p===plan.source){
        const next={...cloneJson(row),id:mint({kind:'survey-item',sourceId:row.id}),page_number:plan.target,excel_row_index:null};
        const targetId=own(identities.annotations,sourceId)?identities.annotations[sourceId]:mint({kind:'annotation',sourceId});
        for(const key of ['annotation_id','highlight_id'])if(own(row,key))next[key]=targetId;
        surveyItems.push(next);
      }
    }
    check(Array.isArray(semantic.sidecar_objects) && Array.isArray(sidecars)
      && sidecars.length === semantic.sidecar_objects.length, 'sidecar-set');
    const sidecarPaths = new Set(), transformedSidecars = [];
    for (const entry of sidecars) {
      check(object(entry) && typeof entry.path === 'string' && !sidecarPaths.has(entry.path)
        && semantic.sidecar_objects.some(o => o.bucket_id === 'documents' && o.path === entry.path), 'sidecar-set');
      sidecarPaths.add(entry.path); const data = entry.content;
      check(object(data) && data.version === 1, 'sidecar-version');
      const known = new Set(['version', 'updatedAt', 'pdfId', 'annotations', 'annotationsByPage', 'callouts', 'spaces', 'entities',
        'templateId', 'zoomLevel', 'currentPage', 'current_page', 'pageNames', 'bookmarks', 'pageTransformations', 'regionOverlayDisabled', 'items', 'activeSpaceId', 'deletedPdfAnnotations']);
      for (const [key, value] of Object.entries(data)) if (!known.has(key) || ['items', 'entities'].includes(key)) extraField(key,value);
      if (own(data, 'entities')) check(Array.isArray(data.entities) && data.entities.every(object), 'sidecar-entities');
      if (own(data, 'items')) check(object(data.items), 'sidecar-items');
      if (own(data, 'zoomLevel')) check(Number.isFinite(data.zoomLevel) && data.zoomLevel > 0, 'sidecar-view');
      const model = {};
      for (const key of domains) if (own(data, key) && key !== 'annotations') model[key] = data[key];
      if (own(data, 'annotations')) model.surveyMarkers = data.annotations;
      if (data.callouts != null) { check(Array.isArray(data.callouts), 'sidecar-callouts');
        const calloutModel = { annotationsByPage: byPage(data.callouts.map(c => [page(c.pageNumber ?? c.page_number, count), asCallout(c)])) };
        reconcile(calloutModel);
      }
      reconcile(model); const changed = transform(model), next = { ...data };
      for (const key of Object.keys(model)) next[key === 'surveyMarkers' ? 'annotations' : key] = changed[key];
      if (data.callouts != null) next.callouts = deriveCalloutsFromByPage(transform({ annotationsByPage:
        byPage(data.callouts.map(c => [page(c.pageNumber ?? c.page_number, count), asCallout(c)])) }).annotationsByPage);
      if (data.currentPage != null) next.currentPage = pageNumberAfterOperation(page(data.currentPage, count), op, plan.nextCount);
      if (data.current_page != null) next.current_page = pageNumberAfterOperation(page(data.current_page, count), op, plan.nextCount);
      transformedSidecars.push({ ...entry, content: next });
    }
    const nextMeta = metaTransform(materialized.annoMeta);
    // Metadata callouts can add fallback imports too, so assemble only after
    // every source has passed reconciliation. Accepted bucket metadata/order
    // remains intact; fallback insertion order matches first source arrival.
    if(!authoritative)materialized.annotationsByPage=byPage(Object.values(modernIdentities).map(v=>[v.p,v.o]));
    const transformedModern = transform({ annotationsByPage: materialized.annotationsByPage,
      surveyMarkers: materialized.surveyMarkers, deletedPdfAnnotations: materialized.deletedPdfAnnotations });
    const modern = { version: 1, annotationsByPage: transformedModern.annotationsByPage,
      surveyMarkers: transformedModern.surveyMarkers, deletedPdfAnnotations: transformedModern.deletedPdfAnnotations, annoMeta: nextMeta };
    const fresh = newDoc(); fresh.clientID = createHash('sha256').update(input.operationId).digest().readUInt32BE(0) || 1;
    syncByPageToDoc(fresh, modern.annotationsByPage); syncSurveyMarkersToDoc(fresh, modern.surveyMarkers);
    for (const [key, value] of Object.entries(nextMeta)) fresh.getMap('annoMeta').set(key, value);
    for (const d of modern.deletedPdfAnnotations) fresh.getMap('deletedPdfAnnotations').set(deletedPdfAnnotationStorageKey(d.pageNumber, d.pdfAnnotationId), d);
    const document = { ...semantic.document };
    for (const [key, value] of Object.entries(document)) {
      if (['current_page','page_count','pagecount'].includes(key)) continue;
      // Historical documents.annotations defaults to {} in the real schema.
      // No current reader establishes a nonempty shape for this column, so
      // retain the empty representation and refuse to guess for old content.
      if(key==='annotations'){check(object(value)&&Object.keys(value).length===0,'legacy-document-annotations');continue;}
      check(!addresses.has(key) && !domains.has(key), 'unknown-document-page-domain'); rejectAddresses(value);
    }
    for (const key of ['page_count', 'pagecount']) if (own(document, key)) document[key] = plan.nextCount;
    if (document.current_page != null) document.current_page = pageNumberAfterOperation(page(document.current_page, count), op, plan.nextCount);
    return { version: 1, operationId: input.operationId, operation: op,
      source: { documentId, generationId, walHead: semantic.wal_head, sourceObject: cloneJson(semantic.source_object) },
      baselineUpdate: Y.encodeStateAsUpdate(fresh), identityMap: identities,
      projection: { document, modern, documentAnnotations: rows, legacyYjs: legacyProjection,
        surveySessions: [...sessions.values()], surveyItems, sidecars: transformedSidecars },
      archive: { sourcePayload: cloneJson(payload), sidecars: cloneJson(sidecars) } };
  } catch (error) {
    if (error?.code === 'DOCUMENT_GENERATION_TRANSFORM_INVALID') throw error;
    fail('unsupported-or-malformed-state');
  } finally { for (const doc of docs) doc.destroy(); }
}
