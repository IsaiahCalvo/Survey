// SERVER PRIVATE. This owns bounded worker scheduling and result transport. It
// does not publish a generation, grant access, or make a worker a security
// sandbox. Node worker JS limits do not cap RSS, ArrayBuffers, or network use.
import { Worker } from 'node:worker_threads';
import {
  captureReplacementJson,
  replacementByteView,
  replacementDataProperty,
} from './documentReplacementInput.js';

const JSON_LIMIT = 16 * 1024 * 1024;
const PDF_LIMIT = 256 * 1024 * 1024;
const PAGE_LIMIT = 10000;
const TIMER_LIMIT = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SEQ = /^(0|[1-9][0-9]{0,18})$/;
const WORKER_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 16,
  stackSizeMb: 4,
});
const MESSAGES = Object.freeze({
  DOCUMENT_REPLACEMENT_EXECUTOR_INPUT: 'The document replacement request is invalid.',
  DOCUMENT_REPLACEMENT_EXECUTOR_BUSY: 'The document replacement executor is busy.',
  DOCUMENT_REPLACEMENT_EXECUTOR_LIMIT: 'The document replacement executor input limit was reached.',
  DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED: 'The document replacement request was aborted.',
  DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT: 'The document replacement request timed out.',
  DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED: 'The document replacement executor is closed.',
  DOCUMENT_REPLACEMENT_EXECUTOR_FAILED: 'The document replacement worker failed.',
  DOCUMENT_GENERATION_REPLACEMENT_INVALID: 'The complete document replacement could not be prepared.',
});

function failure(code) {
  return Object.assign(new Error(MESSAGES[code]), { code });
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, expected) => plain(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string')
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const validUuid = value => typeof value === 'string' && UUID.test(value);
const validSeq = value => typeof value === 'string' && SEQ.test(value)
  && BigInt(value) <= 9223372036854775807n;

function ownData(value, key) {
  return replacementDataProperty(value, key);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freezeTree(value[key]);
    Object.freeze(value);
  }
  return value;
}

function readSignal(options) {
  if (options === undefined) return undefined;
  if (!plain(options)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  const keys = Reflect.ownKeys(options);
  if (keys.some(key => typeof key !== 'string' || key !== 'signal'))
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  if (!Object.hasOwn(options, 'signal')) return undefined;
  const signal = ownData(options, 'signal');
  if (!(signal instanceof AbortSignal)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  return signal;
}

function captureInput(input) {
  if (!plain(input)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  const actorUserId = ownData(input, 'actorUserId');
  const documentId = ownData(input, 'documentId');
  const sourceId = ownData(input, 'sourceId');
  const operationId = ownData(input, 'operationId');
  const suppliedTargetModel = Object.hasOwn(input, 'targetContentModelVersion')
    ? ownData(input, 'targetContentModelVersion') : undefined;
  const aggregateAdmissionVersion = Object.hasOwn(input, 'aggregateAdmissionVersion')
    ? ownData(input, 'aggregateAdmissionVersion') : undefined;
  const legacySidecarArchiveVersion = Object.hasOwn(input, 'legacySidecarArchiveVersion')
    ? ownData(input, 'legacySidecarArchiveVersion') : undefined;
  const targetContentModelVersion = suppliedTargetModel === undefined ? 1 : suppliedTargetModel;
  const envelopeCapture = captureReplacementJson(ownData(input, 'envelope'), { maxBytes: JSON_LIMIT });
  const operationCapture = captureReplacementJson(ownData(input, 'operation'), { maxBytes: JSON_LIMIT });
  const objects = ownData(input, 'objects');
  if (!Array.isArray(objects) || objects.length < 1 || objects.length > 2)
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  const object = ownData(objects, '0');
  if (!plain(object)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  const objectId = ownData(object, 'id');
  const objectVersion = ownData(object, 'version');
  if (![actorUserId, documentId, sourceId, operationId, objectId, objectVersion].every(validUuid))
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  if (targetContentModelVersion !== 1 && targetContentModelVersion !== 2)
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  if (aggregateAdmissionVersion !== undefined
    && (aggregateAdmissionVersion !== 1 || targetContentModelVersion !== 2))
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  if (legacySidecarArchiveVersion !== undefined
    && (legacySidecarArchiveVersion !== 1 || aggregateAdmissionVersion !== 1))
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  if (objects.length < 1 || objects.length > (legacySidecarArchiveVersion === 1 ? 2 : 1))
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  const views = objects.map((entry, index) => {
    if (!plain(entry)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
    const id = ownData(entry, 'id'), version = ownData(entry, 'version');
    if (!validUuid(id) || !validUuid(version)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
    return { id, version, view: replacementByteView(ownData(entry, 'bytes')), index };
  });
  const view = views[0].view;
  const scalarBytes = [actorUserId, documentId, sourceId, operationId, objectId, objectVersion]
    .reduce((total, value) => total + (typeof value === 'string' ? Buffer.byteLength(value) + 2 : 8), 0);
  const byteLength = envelopeCapture.byteLength + operationCapture.byteLength + scalarBytes
    + views.reduce((total, item) => total + item.view.length, 0);
  return {
    byteLength,
    view,
    json: {
      actorUserId,
      documentId,
      sourceId,
      operationId,
      ...(suppliedTargetModel === undefined ? {} : { targetContentModelVersion }),
      ...(aggregateAdmissionVersion === undefined ? {} : { aggregateAdmissionVersion }),
      ...(legacySidecarArchiveVersion === undefined ? {} : { legacySidecarArchiveVersion }),
      envelope: envelopeCapture.value,
      operation: operationCapture.value,
      objectId, objectVersion,
      objects: views.map(item => ({ id: item.id, version: item.version, view: item.view })),
    },
  };
}

function expectedBinding(captured) {
  const envelope = captured.envelope;
  const semantic = plain(envelope) && plain(envelope.payload) ? envelope.payload.semantic : undefined;
  return {
    actorUserId: captured.actorUserId,
    documentId: captured.documentId,
    sourceId: captured.sourceId,
    operationId: captured.operationId,
    generationId: plain(envelope) ? envelope.generation_id : undefined,
    walHead: plain(envelope) ? envelope.wal_head : undefined,
    operationJson: stableJson(captured.operation),
    sourceObjectJson: plain(semantic) ? stableJson(semantic.source_object) : undefined,
    sourceContentModelVersion: semantic?.version === 2 ? semantic.content_model_version : 1,
    targetContentModelVersion: captured.targetContentModelVersion ?? 1,
    aggregateAdmissionVersion: captured.aggregateAdmissionVersion,
    legacySidecarArchiveVersion: captured.legacySidecarArchiveVersion,
  };
}

function validateResult(message, job) {
  if (!exactKeys(message, ['jobId', 'binding', 'result']) || message.jobId !== job.id) return null;
  const binding = message.binding;
  const targetModel = job.expected.targetContentModelVersion;
  if (!exactKeys(binding, job.expected.legacySidecarArchiveVersion === 1
    ? ['actorUserId', 'documentId', 'sourceId', 'operationId', 'generationId', 'walHead', 'targetContentModelVersion', 'aggregateAdmissionVersion', 'legacySidecarArchiveVersion']
    : job.expected.aggregateAdmissionVersion === 1
    ? ['actorUserId', 'documentId', 'sourceId', 'operationId', 'generationId', 'walHead', 'targetContentModelVersion', 'aggregateAdmissionVersion']
    : targetModel === 2
    ? ['actorUserId', 'documentId', 'sourceId', 'operationId', 'generationId', 'walHead', 'targetContentModelVersion']
    : ['actorUserId', 'documentId', 'sourceId', 'operationId', 'generationId', 'walHead'])
    || (targetModel === 2 && binding.targetContentModelVersion !== 2)
    || binding.aggregateAdmissionVersion !== job.expected.aggregateAdmissionVersion
    || binding.legacySidecarArchiveVersion !== job.expected.legacySidecarArchiveVersion) return null;
  for (const key of ['actorUserId', 'documentId', 'sourceId', 'operationId', 'generationId', 'walHead'])
    if (binding[key] !== job.expected[key]) return null;
  const result = message.result;
  if (!exactKeys(result, ['candidate', 'plan'])) return null;
  const candidate = result.candidate;
  if (!exactKeys(candidate, ['bytes', 'contentSha256', 'byteLength', 'pageCount'])) return null;
  if (!(candidate.bytes instanceof Uint8Array) || !(candidate.bytes.buffer instanceof ArrayBuffer)
    || candidate.bytes.byteOffset !== 0 || candidate.bytes.byteLength !== candidate.bytes.buffer.byteLength
    || candidate.bytes.byteLength < 5 || candidate.bytes.byteLength > PDF_LIMIT
    || String(candidate.bytes.byteLength) !== candidate.byteLength
    || typeof candidate.contentSha256 !== 'string' || !HASH.test(candidate.contentSha256)
    || !Number.isSafeInteger(candidate.pageCount) || candidate.pageCount < 1 || candidate.pageCount > PAGE_LIMIT
    || String.fromCharCode(...candidate.bytes.subarray(0, 5)) !== '%PDF-') return null;
  const plan = result.plan;
  if (!exactKeys(plan, job.expected.legacySidecarArchiveVersion === 1
    ? ['version', 'contentModelVersion', 'aggregateAdmissionVersion', 'legacySidecarArchive', 'operationId', 'source', 'operation', 'projection', 'baseline_base64', 'legacy']
    : job.expected.aggregateAdmissionVersion === 1
    ? ['version', 'contentModelVersion', 'aggregateAdmissionVersion', 'operationId', 'source', 'operation', 'projection', 'baseline_base64', 'legacy']
    : targetModel === 2
    ? ['version', 'contentModelVersion', 'operationId', 'source', 'operation', 'projection', 'baseline_base64', 'legacy']
    : ['version', 'operationId', 'source', 'operation', 'projection', 'baseline_base64', 'legacy'])
    || plan.version !== (job.expected.legacySidecarArchiveVersion === 1 ? 4
      : job.expected.aggregateAdmissionVersion === 1 ? 3 : targetModel)
    || (targetModel === 2 && plan.contentModelVersion !== 2)
    || plan.aggregateAdmissionVersion !== job.expected.aggregateAdmissionVersion
    || plan.operationId !== job.expected.operationId
    || stableJson(plan.operation) !== job.expected.operationJson) return null;
  const source = plan.source;
  if (!exactKeys(source, targetModel === 2
    ? ['documentId', 'generationId', 'contentModelVersion', 'walHead', 'sourceObject']
    : ['documentId', 'generationId', 'walHead', 'sourceObject'])
    || source.documentId !== job.expected.documentId || source.generationId !== job.expected.generationId
    || (targetModel === 2 && source.contentModelVersion !== job.expected.sourceContentModelVersion)
    || source.walHead !== job.expected.walHead || !validSeq(source.walHead)
    || stableJson(source.sourceObject) !== job.expected.sourceObjectJson) return null;
  const projectionDocument = plain(plan.projection) ? plan.projection.document : undefined;
  if (!plain(projectionDocument) || projectionDocument.id !== job.expected.documentId
    || !validUuid(projectionDocument.user_id) || !plain(plan.legacy)
    || plan.legacy.documentId !== job.expected.documentId) return null;
  for (const key of ['page_count', 'pagecount']) if (Object.hasOwn(projectionDocument, key)
    && projectionDocument[key] !== candidate.pageCount) return null;
  freezeTree(plan);
  return Object.freeze({ candidate: Object.freeze(candidate), plan });
}

// Internal seam for exact worker-message contract tests. Production callers
// use createDocumentReplacementExecutor; this performs no work or I/O.
export function __testValidateDocumentReplacementWorkerMessage(message, input) {
  try {
    const captured = captureInput(input);
    return validateResult(message, { id: message?.jobId, expected: expectedBinding(captured.json) });
  } catch { return null; }
}

/**
 * Creates one fixed worker scheduler. Its small interface hides input ownership,
 * queue and byte caps, deadlines, worker life, and output binding checks.
 */
export function createDocumentReplacementExecutor(options = {}) {
  let maxConcurrent, maxQueued, maxInputBytes, timeoutMs;
  try {
    if (!plain(options)) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
    const optionKeys = new Set(['maxConcurrent', 'maxQueued', 'maxInputBytes', 'timeoutMs']);
    if (Reflect.ownKeys(options).some(key => typeof key !== 'string' || !optionKeys.has(key)))
      throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
    const readOption = (key, fallback) => Object.hasOwn(options, key) ? ownData(options, key) : fallback;
    maxConcurrent = readOption('maxConcurrent', 1);
    maxQueued = readOption('maxQueued', 2);
    maxInputBytes = readOption('maxInputBytes', 384 * 1024 * 1024);
    timeoutMs = readOption('timeoutMs', 60000);
  } catch {
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');
  }
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32
    || !Number.isSafeInteger(maxQueued) || maxQueued < 0 || maxQueued > 10000
    || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMER_LIMIT)
    throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT');

  let closed = false;
  let retainedBytes = 0;
  let nextJobId = 1;
  let closePromise = null;
  let resolveClose = null;
  const active = new Set();
  const queue = [];

  const release = job => {
    if (!job.reserved) return;
    job.reserved = false;
    retainedBytes -= job.byteLength;
  };
  const clearJobHooks = job => {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    if (job.signal && job.abortListener) job.signal.removeEventListener('abort', job.abortListener);
    job.abortListener = null;
  };
  const settle = (job, error, value) => {
    if (job.settled) return false;
    job.settled = true;
    clearJobHooks(job);
    if (error) job.reject(error); else job.resolve(value);
    return true;
  };
  const maybeClose = () => {
    if (closed && active.size === 0 && queue.length === 0 && resolveClose) {
      const resolve = resolveClose;
      resolveClose = null;
      resolve();
    }
  };
  const removeQueued = job => {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  };
  const drain = () => {
    if (closed) return maybeClose();
    while (active.size < maxConcurrent && queue.length) {
      const job = queue.shift();
      if (job.settled) { release(job); continue; }
      if (job.signal?.aborted) {
        settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
        release(job);
        continue;
      }
      if (performance.now() >= job.deadline) {
        settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'));
        release(job);
        continue;
      }
      start(job);
    }
  };
  const stopActive = (job, code) => {
    if (!active.has(job)) return;
    settle(job, failure(code));
    if (job.worker) void job.worker.terminate().catch(() => {});
  };
  const cancel = (job, code) => {
    if (active.has(job)) return stopActive(job, code);
    removeQueued(job);
    settle(job, failure(code));
    release(job);
    drain();
  };
  const start = job => {
    active.add(job);
    let worker;
    try {
      worker = new Worker(new URL('./documentReplacementWorker.js', import.meta.url), {
        type: 'module',
        workerData: { jobId: job.id, input: job.input },
        transferList: [job.input.objects[0].bytes.buffer],
        env: {},
        execArgv: [],
        resourceLimits: WORKER_LIMITS,
        stdout: true,
        stderr: true,
      });
      job.worker = worker;
      job.input = null;
      worker.stdout.on('error', () => {});
      worker.stderr.on('error', () => {});
      worker.stdout.resume();
      worker.stderr.resume();
    } catch {
      settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_FAILED'));
      active.delete(job);
      release(job);
      drain();
      maybeClose();
      return;
    }
    worker.on('message', message => {
      if (job.settled) return;
      try {
        if (closed) settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
        else if (job.signal?.aborted) settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
        else if (performance.now() >= job.deadline) settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'));
        else if (exactKeys(message, ['jobId', 'error']) && message.jobId === job.id
          && message.error === 'DOCUMENT_GENERATION_REPLACEMENT_INVALID') {
          settle(job, failure('DOCUMENT_GENERATION_REPLACEMENT_INVALID'));
        } else {
          const value = validateResult(message, job);
          if (closed) settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
          else if (job.signal?.aborted) settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
          else if (performance.now() >= job.deadline) settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'));
          else settle(job, value ? null : failure('DOCUMENT_REPLACEMENT_EXECUTOR_FAILED'), value);
        }
      } catch {
        settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_FAILED'));
      }
      void worker.terminate().catch(() => {});
    });
    worker.on('error', () => {
      settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_FAILED'));
    });
    worker.on('exit', () => {
      settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_FAILED'));
      active.delete(job);
      release(job);
      job.worker = null;
      drain();
      maybeClose();
    });
  };

  function prepare(input, options = undefined) {
    const enteredAt = performance.now();
    return new Promise((resolve, reject) => {
      let signal;
      let captured;
      try {
        signal = readSignal(options);
        if (closed) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED');
        if (signal?.aborted) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED');
        if (active.size >= maxConcurrent && queue.length >= maxQueued)
          throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_BUSY');
        captured = captureInput(input);
        // Input inspection can invoke Proxy traps. Recheck all lifecycle and
        // count gates before reserving anything for this outer call.
        if (closed) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED');
        if (signal?.aborted) throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED');
        if (active.size >= maxConcurrent && queue.length >= maxQueued)
          throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_BUSY');
        if (captured.byteLength > maxInputBytes || retainedBytes > maxInputBytes - captured.byteLength)
          throw failure('DOCUMENT_REPLACEMENT_EXECUTOR_LIMIT');
      } catch (error) {
        reject(error?.code && MESSAGES[error.code]
          ? failure(error.code) : failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT'));
        return;
      }

      const job = {
        id: nextJobId++,
        resolve,
        reject,
        signal,
        abortListener: null,
        timer: null,
        deadline: enteredAt + timeoutMs,
        byteLength: captured.byteLength,
        expected: expectedBinding(captured.json),
        input: null,
        worker: null,
        reserved: true,
        settled: false,
      };
      retainedBytes += job.byteLength;
      try {
        // Capacity is reserved before this potentially large copy. The caller's
        // view stays attached; only this new full buffer crosses to the worker.
        const ownedObjects = captured.json.objects.map(item => {
          const ownedBytes = new Uint8Array(item.view.length);
          Uint8Array.prototype.set.call(ownedBytes, item.view.bytes);
          return { id: item.id, version: item.version, bytes: ownedBytes };
        });
        job.input = {
          actorUserId: captured.json.actorUserId,
          documentId: captured.json.documentId,
          sourceId: captured.json.sourceId,
          operationId: captured.json.operationId,
          ...(captured.json.targetContentModelVersion === undefined ? {}
            : { targetContentModelVersion: captured.json.targetContentModelVersion }),
          ...(captured.json.aggregateAdmissionVersion === undefined ? {}
            : { aggregateAdmissionVersion: captured.json.aggregateAdmissionVersion }),
          ...(captured.json.legacySidecarArchiveVersion === undefined ? {}
            : { legacySidecarArchiveVersion: captured.json.legacySidecarArchiveVersion }),
          envelope: captured.json.envelope,
          operation: captured.json.operation,
          objects: ownedObjects,
        };
      } catch {
        release(job);
        reject(failure('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT'));
        return;
      }
      if (performance.now() >= job.deadline) {
        release(job);
        reject(failure('DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'));
        return;
      }
      if (closed || signal?.aborted) {
        release(job);
        reject(failure(closed
          ? 'DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'
          : 'DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
        return;
      }
      job.abortListener = () => cancel(job, 'DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED');
      signal?.addEventListener('abort', job.abortListener, { once: true });
      const remaining = Math.max(1, Math.ceil(job.deadline - performance.now()));
      job.timer = setTimeout(() => cancel(job, 'DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'), remaining);
      if (active.size < maxConcurrent) start(job); else queue.push(job);
    });
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = new Promise(resolve => { resolveClose = resolve; });
    for (const job of queue.splice(0)) {
      settle(job, failure('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
      release(job);
    }
    for (const job of active) stopActive(job, 'DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED');
    maybeClose();
    return closePromise;
  }

  return Object.freeze({ prepare, close });
}
