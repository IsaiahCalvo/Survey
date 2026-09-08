import { copyLocalDocumentState, LOCAL_DOCUMENT_MAX_BYTES, LOCAL_DOCUMENT_MAX_STATE_BYTES } from './localDocumentStore.js';
import { createLocalDocumentStateReader } from './localDocumentState.js';
import { fingerprintLocalPdfBlob } from './localPdfByteFingerprint.js';

export const LOCAL_RECOVERY_BUNDLE_EXTENSION = '.survey-recovery';
export const LOCAL_RECOVERY_BUNDLE_HEADER_BYTES = 64;
export const LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES = LOCAL_DOCUMENT_MAX_STATE_BYTES + 16 * 1024;
export const LOCAL_RECOVERY_BUNDLE_MAX_BYTES = LOCAL_RECOVERY_BUNDLE_HEADER_BYTES + LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES + LOCAL_DOCUMENT_MAX_BYTES;
const magic = new TextEncoder().encode('SURVEY-RECOVERY\0');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localId = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const metadataKeys = ['sessionId', 'writerId', 'fileId', 'sourceLocalId', 'baseCanonicalRevision',
  'name', 'size', 'type', 'created_at', 'updated_at', 'sequence'];
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const nativeSlice = (blob, start = 0, end, type) => Blob.prototype.slice.call(blob, start, end, type);
const nativeRead = blob => Blob.prototype.arrayBuffer.call(blob);
const equalBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

async function bounded(options, operation) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const { signal } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('A positive recovery timeout is required');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal');
  const deadline = performance.now() + timeoutMs;
  let stopped = false;
  let timer;
  let abort;
  const current = () => {
    if (signal?.aborted) throw fail('recovery-canceled', 'Recovery export was canceled');
    if (stopped || performance.now() >= deadline) throw fail('recovery-timed-out', 'Recovery file processing timed out');
  };
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() => { stopped = true; reject(fail('recovery-timed-out', 'Recovery file processing timed out')); }, timeoutMs);
    abort = () => reject(fail('recovery-canceled', 'Recovery export was canceled'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    current();
    const result = await Promise.race([operation({ current, remaining: () => Math.max(1, Math.ceil(deadline - performance.now())) }), interrupted]);
    current(); return result;
  } finally { stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function inspectJson(value, budget = { count: 0 }, depth = 0) {
  if (++budget.count > 250_000 || depth > 100) throw fail('invalid-recovery-state', 'Recovery state is too complex');
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) throw fail('invalid-recovery-state', 'Recovery JSON contains an invalid number');
    return;
  }
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key)) throw fail('unsafe-recovery-key', 'Recovery data contains an unsafe object key');
    inspectJson(value[key], budget, depth + 1);
  }
}

function copyMetadata(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw fail('invalid-recovery-metadata', 'Recovery metadata must be a plain object');
  const result = {};
  for (const key of Reflect.ownKeys(input)) {
    if (!metadataKeys.includes(key) && !['createdAt', 'updatedAt'].includes(key)) throw fail('invalid-recovery-metadata', 'Recovery metadata contains unsupported fields');
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw fail('invalid-recovery-metadata', 'Recovery metadata cannot contain accessors');
    if (metadataKeys.includes(key)) result[key] = field.value;
  }
  if (metadataKeys.some(key => !Object.hasOwn(result, key))
    || ['sessionId', 'writerId', 'fileId'].some(key => !uuid.test(result[key] || ''))
    || !localId.test(result.sourceLocalId || '')
    || !Number.isSafeInteger(result.baseCanonicalRevision) || result.baseCanonicalRevision <= 0
    || !Number.isSafeInteger(result.sequence) || result.sequence <= 0
    || !Number.isSafeInteger(result.size) || result.size <= 0 || result.size > LOCAL_DOCUMENT_MAX_BYTES
    || result.type !== 'application/pdf'
    || ['created_at', 'updated_at'].some(key => typeof result[key] !== 'string' || result[key].length > 64 || !Number.isFinite(Date.parse(result[key])))) {
    throw fail('invalid-recovery-metadata', 'The draft metadata is invalid');
  }
  const name = result.name;
  // This is the managed store's display name, not a filesystem destination.
  // Keep its exact contract, including names with no extension or characters
  // another OS disallows. Download/Save As owns output-name sanitization.
  if (typeof name !== 'string' || !name.trim() || name.length > 1024) {
    throw fail('invalid-recovery-filename', 'The recovery PDF display name is invalid');
  }
  return Object.fromEntries(metadataKeys.map(key => [key, result[key]]));
}

function copyState(input, pdfId) {
  const snapshot = copyLocalDocumentState(input, pdfId, LOCAL_DOCUMENT_MAX_STATE_BYTES);
  if (Object.keys(snapshot).some(key => !['version', 'pdfId', 'entries'].includes(key))) throw fail('invalid-recovery-state', 'Recovery state contains unsupported fields');
  createLocalDocumentStateReader({ localId: pdfId, _surveyPdfId: pdfId, storageMode: 'local', _localDocumentState: snapshot });
  const budget = { count: 0 };
  inspectJson(snapshot, budget);
  for (const raw of Object.values(snapshot.entries)) inspectJson(JSON.parse(raw), budget);
  return snapshot;
}

async function digest(bytes, control) {
  control.current();
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw fail('recovery-hash-unavailable', 'Recovery integrity checks are unavailable');
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  control.current();
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 32) throw fail('recovery-hash-unavailable', 'Recovery integrity checks failed');
  return new Uint8Array(buffer);
}

async function verifyPdfHeader(blob, control) {
  const bytes = new Uint8Array(await nativeRead(nativeSlice(blob, 0, 1024)));
  control.current();
  const signature = [37, 80, 68, 70, 45];
  if (!bytes.some((_byte, index) => signature.every((value, offset) => bytes[index + offset] === value))) throw fail('invalid-recovery-pdf', 'The recovery file does not contain a PDF');
}

/** Portable bytes and exact app state only. No identity is assigned, no source
 * is discarded, and no download or cloud-save acknowledgment is produced. */
export async function createLocalRecoveryBundle({ metadata, file, state }, options = {}) {
  // Capture all mutable caller inputs before the first await. Native Blob
  // methods bypass instance overrides and retain immutable original bytes.
  const retained = nativeSlice(file, 0, undefined, 'application/pdf');
  const capturedMetadata = copyMetadata(metadata);
  const capturedState = copyState(state, capturedMetadata.sourceLocalId);
  if (retained.size !== capturedMetadata.size) throw fail('recovery-size-mismatch', 'The draft PDF size does not match its metadata');
  return bounded(options, async control => {
    await verifyPdfHeader(retained, control);
    const fingerprint = await fingerprintLocalPdfBlob(retained, { timeoutMs: control.remaining() });
    control.current();
    const manifest = { format: 'survey-local-recovery', version: 1,
      metadata: capturedMetadata, state: capturedState, pdfFingerprint: fingerprint };
    const json = JSON.stringify(manifest);
    if (json.length > LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES) throw fail('recovery-too-large', 'The recovery manifest is too large');
    const manifestBytes = new TextEncoder().encode(json);
    if (manifestBytes.length > LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES) throw fail('recovery-too-large', 'The recovery manifest is too large');
    const header = new Uint8Array(LOCAL_RECOVERY_BUNDLE_HEADER_BYTES);
    header.set(magic);
    const view = new DataView(header.buffer);
    view.setUint32(16, 1, true);
    view.setUint32(20, manifestBytes.length, true);
    view.setUint32(24, retained.size, true);
    // Offset 28 is reserved and must stay zero in version 1.
    header.set(await digest(manifestBytes, control), 32);
    control.current();
    return new Blob([header, manifestBytes, retained], { type: 'application/octet-stream' });
  });
}

/** Strict v1 reader. PDF bytes remain Blob slices, never a whole-file buffer.
 * Call importLocalDocumentCopy(file,state) only after explicit user choice. */
export async function parseLocalRecoveryBundle(blob, options = {}) {
  const retained = nativeSlice(blob);
  if (retained.size < LOCAL_RECOVERY_BUNDLE_HEADER_BYTES || retained.size > LOCAL_RECOVERY_BUNDLE_MAX_BYTES) throw fail('invalid-recovery-size', 'The recovery bundle is empty, truncated, or too large');
  return bounded(options, async control => {
    const header = new Uint8Array(await nativeRead(nativeSlice(retained, 0, LOCAL_RECOVERY_BUNDLE_HEADER_BYTES)));
    control.current();
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (!equalBytes(header.subarray(0, 16), magic)) throw fail('invalid-recovery-format', 'This is not a Survey recovery bundle');
    if (view.getUint32(16, true) !== 1 || view.getUint32(28, true) !== 0) throw fail('unsupported-recovery-version', 'This recovery bundle version is not supported');
    const manifestLength = view.getUint32(20, true);
    const pdfLength = view.getUint32(24, true);
    if (!manifestLength || manifestLength > LOCAL_RECOVERY_BUNDLE_MAX_MANIFEST_BYTES || !pdfLength || pdfLength > LOCAL_DOCUMENT_MAX_BYTES
      || LOCAL_RECOVERY_BUNDLE_HEADER_BYTES + manifestLength + pdfLength !== retained.size) throw fail('invalid-recovery-size', 'The recovery bundle lengths do not match its contents');
    const manifestBytes = new Uint8Array(await nativeRead(nativeSlice(retained, LOCAL_RECOVERY_BUNDLE_HEADER_BYTES, LOCAL_RECOVERY_BUNDLE_HEADER_BYTES + manifestLength)));
    if (!equalBytes(await digest(manifestBytes, control), header.subarray(32))) throw fail('recovery-integrity-failed', 'The recovery manifest is damaged');
    let manifest;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
      manifest = JSON.parse(text);
      // The writer emits canonical JSON. This also refuses duplicate keys and
      // alternate numeric encodings rather than accepting an ambiguous header.
      if (JSON.stringify(manifest) !== text) throw new Error('Noncanonical manifest');
      inspectJson(manifest);
    } catch (error) {
      if (['unsafe-recovery-key', 'invalid-recovery-state'].includes(error?.code)) throw error;
      throw fail('invalid-recovery-json', 'The recovery manifest is not valid canonical UTF-8 JSON');
    }
    if (!manifest || Array.isArray(manifest) || manifest.format !== 'survey-local-recovery' || manifest.version !== 1
      || Object.keys(manifest).length !== 5 || Object.keys(manifest).some(key => !['format', 'version', 'metadata', 'state', 'pdfFingerprint'].includes(key))
      || typeof manifest.pdfFingerprint !== 'string' || !/^sha256-chunks-v1:[a-f0-9]{64}$/.test(manifest.pdfFingerprint)) throw fail('invalid-recovery-format', 'The recovery manifest format is unsupported');
    const metadata = copyMetadata(manifest.metadata);
    if (metadata.size !== pdfLength) throw fail('recovery-size-mismatch', 'The recovery PDF size does not match its metadata');
    const state = copyState(manifest.state, metadata.sourceLocalId);
    const pdf = nativeSlice(retained, LOCAL_RECOVERY_BUNDLE_HEADER_BYTES + manifestLength, undefined, 'application/pdf');
    await verifyPdfHeader(pdf, control);
    const fingerprint = await fingerprintLocalPdfBlob(pdf, { timeoutMs: control.remaining() });
    control.current();
    if (fingerprint !== manifest.pdfFingerprint) throw fail('recovery-integrity-failed', 'The recovery PDF bytes are damaged');
    const file = new File([pdf], metadata.name, { type: 'application/pdf', lastModified: Date.parse(metadata.updated_at) });
    return { file, state, metadata };
  });
}
