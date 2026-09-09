import { normalizeAnnotationSequence, compareAnnotationSequences } from './annotationSequence.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const uuid = value => typeof value === 'string' && UUID.test(value);
const generation = value => value === null || uuid(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ERROR_CODES = new Set(['SG001', 'SG002', 'SG003', '42501', '40001', '55P03', '23505',
  '23514', '22023', '25001', '54000', '57014', 'PGRST202', 'PGRST301', 'PGRST302',
  'ETIMEDOUT', 'ANNOTATION_ACTOR_MISMATCH']);
const error = (code = 'ANNOTATION_GENERATION_PROTOCOL') => Object.assign(new Error(
  code === 'ANNOTATION_GENERATION_INPUT' ? 'Invalid annotation generation request'
    : 'The server did not confirm this annotation generation request',
), { code });
function requireValue(value, code) { if (!value) throw error(code); }
function sequence(value, input = false, nullable = false) {
  try {
    if (!input && value !== null) requireValue(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value));
    return normalizeAnnotationSequence(value, { nullable });
  } catch { throw error(input ? 'ANNOTATION_GENERATION_INPUT' : 'ANNOTATION_GENERATION_PROTOCOL'); }
}
function decimal(value, nullable = false) {
  const result = sequence(value, true, nullable);
  return result === null ? null : String(result);
}
function bytea(value, input = false) {
  requireValue(typeof value === 'string' && /^\\x(?:[0-9a-f]{2})*$/.test(value),
    input ? 'ANNOTATION_GENERATION_INPUT' : 'ANNOTATION_GENERATION_PROTOCOL');
  return value;
}
async function digest(value) {
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  const hashed = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashed), b => b.toString(16).padStart(2, '0')).join('');
}
function transportError(value, documentId, pdfGenerationId) {
  // Do not expose SQL, tokens, paths, or provider diagnostics through sync UI.
  const code = ERROR_CODES.has(value?.code)
    ? value.code : 'ANNOTATION_GENERATION_PROTOCOL';
  const result = error(code);
  if (code === 'SG001' || code === 'SG002') {
    result.message = 'This PDF generation is no longer writable here. Saved edits need recovery review.';
    let details;
    try { details = typeof value.details === 'string' ? JSON.parse(value.details) : value.details; } catch { /* no trusted hint */ }
    if (plain(details) && details.document_id === documentId
      && details.expected_generation_id === pdfGenerationId && generation(details.current_generation_id)
      && details.current_generation_id !== pdfGenerationId) {
      result.currentGenerationId = details.current_generation_id;
    }
  }
  return result;
}

/** Generation-checked transport. The injected request owns actor-bound JWTs
 * and deadlines. No method falls back to unscoped table reads or old RPCs. */
export function createAnnotationGenerationTransport(options) {
  requireValue(plain(options), 'ANNOTATION_GENERATION_INPUT');
  const { documentId, pdfGenerationId, actorUserId, request } = options;
  requireValue(uuid(documentId) && generation(pdfGenerationId) && uuid(actorUserId)
    && typeof request === 'function', 'ANNOTATION_GENERATION_INPUT');
  const base = Object.freeze({ p_document_id: documentId, p_generation_id: pdfGenerationId });
  async function rpc(name, params, label) {
    let result;
    try { result = await request(name, { ...base, ...params }, label); }
    catch (caught) { throw transportError(caught, documentId, pdfGenerationId); }
    if (result?.error) throw transportError(result.error, documentId, pdfGenerationId);
    const value = result?.data;
    requireValue(plain(value) && value.version === 2 && value.document_id === documentId
      && value.generation_id === pdfGenerationId);
    return value;
  }
  return Object.freeze({
    async snapshot() {
      const result = await rpc('read_annotation_snapshot_v2', {}, 'generation snapshot read');
      const walHead = sequence(result.wal_head);
      let snapshot = null;
      if (result.snapshot !== null) {
        const row = result.snapshot;
        requireValue(plain(row) && Number.isInteger(row.encoding_version) && [1, 2].includes(row.encoding_version)
          && (row.writer_id === null || text(row.writer_id)));
        snapshot = { at_seq: sequence(row.at_seq), snapshot: bytea(row.snapshot), encoding_version: row.encoding_version,
          writer_id: row.writer_id, writer_epoch: sequence(row.writer_epoch) };
        requireValue(compareAnnotationSequences(snapshot.at_seq, walHead) <= 0);
      }
      return { snapshot, walHead };
    },
    async updates(options = {}) {
      requireValue(plain(options), 'ANNOTATION_GENERATION_INPUT');
      const { afterSeq = 0, throughSeq = null, limit = 1000 } = options;
      const after = decimal(afterSeq), through = decimal(throughSeq, true);
      requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 1000
        && (through === null || compareAnnotationSequences(after, through) <= 0), 'ANNOTATION_GENERATION_INPUT');
      const result = await rpc('read_annotation_updates_v2', {
        p_after_seq: after, p_through_seq: through, p_limit: limit,
      }, 'generation annotation tail read');
      const frontier = sequence(result.through_seq);
      requireValue((through === null || compareAnnotationSequences(frontier, through) === 0)
        && compareAnnotationSequences(frontier, after) >= 0 && Array.isArray(result.rows)
        && result.rows.length <= limit && typeof result.has_more === 'boolean');
      let previous = after;
      const rows = result.rows.map(row => {
        requireValue(plain(row) && text(row.client_id)
          && (uuid(row.actor_user_id) || (pdfGenerationId === null && row.actor_user_id === null)));
        const seq = sequence(row.seq);
        requireValue(compareAnnotationSequences(seq, previous) > 0 && compareAnnotationSequences(seq, frontier) <= 0);
        previous = seq;
        return { seq, data: bytea(row.data), client_id: row.client_id,
          client_seq: sequence(row.client_seq), actor_user_id: row.actor_user_id };
      });
      requireValue(!result.has_more || (rows.length > 0 && compareAnnotationSequences(previous, frontier) < 0));
      // Legacy WAL may have gaps; no fabricated +1 requirement. The checked
      // server page, not the highest observed realtime row, defines coverage.
      return { rows, throughSeq: frontier, hasMore: result.has_more };
    },
    async writerSequence(writerId) {
      requireValue(text(writerId), 'ANNOTATION_GENERATION_INPUT');
      const result = await rpc('read_annotation_writer_sequence_v2', { p_client_id: writerId }, 'generation writer sequence read');
      requireValue(result.client_id === writerId);
      return sequence(result.client_seq);
    },
    async append(options) {
      requireValue(plain(options), 'ANNOTATION_GENERATION_INPUT');
      const { writerId, clientSeq, data } = options;
      requireValue(text(writerId), 'ANNOTATION_GENERATION_INPUT');
      const counter = decimal(clientSeq), payload = bytea(data, true);
      requireValue(compareAnnotationSequences(counter, 0) > 0, 'ANNOTATION_GENERATION_INPUT');
      const expectedHash = await digest(payload);
      const result = await rpc('append_annotation_update_v2', {
        p_client_id: writerId, p_client_seq: counter, p_data: payload,
      }, 'generation annotation WAL append');
      requireValue(result.accepted === true && result.actor_user_id === actorUserId
        && result.client_id === writerId && String(sequence(result.client_seq)) === counter
        && typeof result.data_sha256 === 'string' && SHA.test(result.data_sha256)
        && result.data_sha256 === expectedHash && generation(result.current_generation_id)
        && typeof result.is_current === 'boolean'
        && result.is_current === (result.current_generation_id === pdfGenerationId));
      const seq = sequence(result.seq);
      requireValue(compareAnnotationSequences(seq, 0) > 0);
      return { seq, clientSeq: sequence(result.client_seq), writerId,
        isCurrent: result.is_current, currentGenerationId: result.current_generation_id };
    },
    async storeSnapshot(options) {
      requireValue(plain(options), 'ANNOTATION_GENERATION_INPUT');
      const { atSeq, snapshot, encodingVersion, writerId, writerEpoch,
        expectedAtSeq, expectedWriterId, expectedWriterEpoch } = options;
      requireValue(text(writerId) && [1, 2].includes(encodingVersion)
        && (expectedWriterId === null || text(expectedWriterId)), 'ANNOTATION_GENERATION_INPUT');
      const at = decimal(atSeq), epoch = decimal(writerEpoch), payload = bytea(snapshot, true);
      const params = { p_at_seq: at, p_snapshot: payload, p_encoding_version: encodingVersion,
        p_writer_id: writerId, p_writer_epoch: epoch, p_expected_at_seq: decimal(expectedAtSeq, true),
        p_expected_writer_id: expectedWriterId, p_expected_writer_epoch: decimal(expectedWriterEpoch) };
      const expectedHash = await digest(payload);
      const result = await rpc('store_annotation_snapshot_v2', params, 'generation annotation snapshot write');
      requireValue(typeof result.stored === 'boolean' && String(sequence(result.at_seq)) === at
        && result.writer_id === writerId && String(sequence(result.writer_epoch)) === epoch);
      if (result.stored) requireValue(result.snapshot_sha256 === expectedHash && result.encoding_version === encodingVersion);
      return result.stored;
    },
  });
}
