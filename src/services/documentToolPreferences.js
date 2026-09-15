import { supabase as defaultClient } from '../supabaseClient.js';
import { runActorBoundDatabaseMutation } from './actorBoundDatabaseMutation.js';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';

export const DOCUMENT_TOOL_IDS = Object.freeze([
  'pen', 'highlighter', 'text-highlight', 'eraser', 'rect', 'ellipse', 'line', 'arrow',
  'callout', 'counter', 'text', 'note', 'underline', 'strikeout', 'squiggly', 'surveyMarker',
]);
export const DOCUMENT_TOOL_STYLE_FIELDS = Object.freeze([
  'strokeColor', 'strokeWidth', 'strokeOpacity', 'fillColor', 'fillOpacity',
]);

const TOOL_IDS = new Set(DOCUMENT_TOOL_IDS);
const STYLE_FIELDS = new Set(DOCUMENT_TOOL_STYLE_FIELDS);
const MAX_JSON_BYTES = 32768;
const READ_RPC = 'read_document_tool_preferences';
const WRITE_RPC = 'write_document_tool_preferences';
const NEW_PREFIX = 'documentToolPreferencesV2:';
const OLD_PENDING_PREFIX = 'toolPrefsPending_';
const MAX_PENDING_DRAFTS_PER_SCOPE = 16;
const TAB_ID_KEY = 'documentToolPreferencesTabIdV1';
const SAFE_COLOR_NAMES = new Set(['aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon',
  'navy', 'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'transparent', 'white', 'yellow']);

const codedError = (code, message) => Object.assign(new Error(message), { code });
const safeStorage = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

function validText(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function resolveDocumentToolPreferenceScope({ actorUserId, documentId, supabaseDocId } = {}) {
  if (!validText(documentId)) return null;
  if (validText(supabaseDocId)) {
    if (!validText(actorUserId)) return null;
    return Object.freeze({ kind: 'account-cloud', actorUserId, documentId, supabaseDocId });
  }
  if (validText(actorUserId)) {
    return Object.freeze({ kind: 'account-local', actorUserId, documentId, supabaseDocId: null });
  }
  return Object.freeze({ kind: 'device-local', deviceScopeId: 'device-local', documentId, supabaseDocId: null });
}

export function documentToolPreferenceScopeKey(scope) {
  if (scope?.kind === 'account-cloud') return JSON.stringify(['account-cloud', scope.actorUserId, scope.documentId, scope.supabaseDocId]);
  if (scope?.kind === 'account-local') return JSON.stringify(['account-local', scope.actorUserId, scope.documentId]);
  if (scope?.kind === 'device-local') return JSON.stringify(['device-local', scope.deviceScopeId, scope.documentId]);
  return null;
}

function defaultTabId() {
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (validText(existing)) return existing;
    const created = randomUUID();
    window.sessionStorage.setItem(TAB_ID_KEY, created);
    return created;
  } catch { return randomUUID(); }
}

function keys(scope, tabId) {
  const scopeKey = documentToolPreferenceScopeKey(scope);
  if (!scopeKey) return null;
  return {
    scopeKey,
    cache: `${NEW_PREFIX}cache:${scopeKey}`,
    pendingPrefix: `${NEW_PREFIX}pending:${scopeKey}:`,
    pending: `${NEW_PREFIX}pending:${scopeKey}:${JSON.stringify(tabId)}`,
    conflictBackup: `${NEW_PREFIX}conflictBackup:${scopeKey}:${JSON.stringify(tabId)}`,
    legacyPending: scope.kind === 'account-cloud'
      ? `${OLD_PENDING_PREFIX}${JSON.stringify([scope.actorUserId, scope.documentId, scope.supabaseDocId])}`
      : null,
  };
}

function pendingRecords(storage, scoped, scopeKey) {
  const records = [];
  const count = Number(storage?.length || 0);
  for (let index = 0; index < count; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(scoped.pendingPrefix)) continue;
    records.push({ ...readPending(storage, key, scopeKey), storageKey: key });
    if (records.length > MAX_PENDING_DRAFTS_PER_SCOPE) {
      throw codedError('DOCUMENT_TOOL_PREFERENCES_PENDING_LIMIT', 'Too many tool setting drafts need to sync. No draft was removed.');
    }
  }
  return records.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}

export function validateDocumentToolPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'Tool settings are not valid.');
  const result = {};
  for (const toolId of Object.keys(value).sort()) {
    if (!TOOL_IDS.has(toolId)) throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'Tool settings contain an unknown tool.');
    const entry = value[toolId];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'Tool settings are not valid.');
    const clean = {};
    for (const field of Object.keys(entry).sort()) {
      if (!STYLE_FIELDS.has(field)) throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'Tool settings contain an unknown field.');
      const fieldValue = entry[field];
      if (field === 'strokeColor' || field === 'fillColor') {
        const rgb = typeof fieldValue === 'string'
          ? fieldValue.match(/^rgba?\(([0-9]{1,3}),[ ]*([0-9]{1,3}),[ ]*([0-9]{1,3})(?:,[ ]*(0(?:\.[0-9]+)?|1(?:\.0+)?))?\)$/) : null;
        const validColor = validText(fieldValue, 64)
          && (/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(fieldValue)
            || SAFE_COLOR_NAMES.has(fieldValue.toLowerCase())
            || (rgb && Number(rgb[1]) <= 255 && Number(rgb[2]) <= 255 && Number(rgb[3]) <= 255));
        if (!validColor) throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'A tool color is not valid.');
      } else if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)
        || (field.includes('Opacity') && (fieldValue < 0 || fieldValue > 100))
        || (field === 'strokeWidth' && (fieldValue < 0 || fieldValue > 1000))) {
        throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'A tool size or opacity is not valid.');
      }
      clean[field] = fieldValue;
    }
    result[toolId] = clean;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_JSON_BYTES) {
    throw codedError('DOCUMENT_TOOL_PREFERENCES_INVALID', 'Tool settings are too large.');
  }
  return result;
}

const samePreferences = (left, right) => JSON.stringify(validateDocumentToolPreferences(left))
  === JSON.stringify(validateDocumentToolPreferences(right));

function parse(storage, key) {
  const raw = storage?.getItem?.(key);
  if (raw == null) return null;
  return { raw, value: JSON.parse(raw) };
}

function readCache(storage, key, scope, scopeKey) {
  const parsed = parse(storage, key);
  if (!parsed) return null;
  const value = parsed.value;
  const expectedDocumentId = scope.kind === 'account-cloud' ? scope.supabaseDocId : scope.documentId;
  if (value?.version !== 1 || value.scopeKey !== scopeKey || value.documentId !== expectedDocumentId
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !validText(value.clientRevision) || !validText(value.documentId)
    || !validText(value.updatedAt)) throw codedError('DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED', 'Saved tool settings could not be read.');
  return { ...value, preferences: validateDocumentToolPreferences(value.preferences), raw: parsed.raw };
}

function readPending(storage, key, scopeKey) {
  const parsed = parse(storage, key);
  if (!parsed) return null;
  const value = parsed.value;
  if (value?.version !== 2 || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0
    || !validText(value.clientRevision) || value.scopeKey !== scopeKey) {
    throw codedError('DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED', 'Pending tool settings could not be read. They were kept.');
  }
  return { ...value, preferences: validateDocumentToolPreferences(value.preferences),
    basePreferences: value.basePreferences ? validateDocumentToolPreferences(value.basePreferences) : {}, raw: parsed.raw };
}

function changedFields(base, next) {
  const changes = new Map();
  for (const toolId of DOCUMENT_TOOL_IDS) {
    const fields = new Set([...Object.keys(base?.[toolId] || {}), ...Object.keys(next?.[toolId] || {})]);
    for (const field of fields) {
      if (JSON.stringify(base?.[toolId]?.[field]) !== JSON.stringify(next?.[toolId]?.[field])) {
        changes.set(`${toolId}:${field}`, { toolId, field, value: next?.[toolId]?.[field] });
      }
    }
  }
  return changes;
}

function applyChanges(preferences, changes) {
  const result = validateDocumentToolPreferences(preferences);
  for (const { toolId, field, value } of changes.values()) {
    const entry = { ...(result[toolId] || {}) };
    if (value === undefined) delete entry[field]; else entry[field] = value;
    result[toolId] = entry;
  }
  return validateDocumentToolPreferences(result);
}

function writeVerified(storage, key, value) {
  if (!storage) throw codedError('DOCUMENT_TOOL_PREFERENCES_LOCAL_WRITE_FAILED', 'Tool settings could not be saved on this device.');
  const raw = JSON.stringify(value);
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw codedError('DOCUMENT_TOOL_PREFERENCES_LOCAL_WRITE_FAILED', 'Tool settings could not be checked on this device.');
  } catch (error) {
    if (error?.code === 'DOCUMENT_TOOL_PREFERENCES_LOCAL_WRITE_FAILED') throw error;
    throw codedError('DOCUMENT_TOOL_PREFERENCES_LOCAL_WRITE_FAILED', 'Tool settings could not be saved on this device.');
  }
  return raw;
}

function replaceExact(storage, key, expectedRaw, value) {
  if (storage.getItem(key) !== expectedRaw) return null;
  if (value == null) {
    storage.removeItem(key);
    return storage.getItem(key) == null ? true : null;
  }
  return writeVerified(storage, key, value);
}

function normalizeReceipt(data, scope, expectedStatus) {
  if (!data || data.status !== expectedStatus || data.version !== 1 || data.documentId !== scope.supabaseDocId
    || !Number.isSafeInteger(data.revision) || data.revision < (expectedStatus === 'present' ? 1 : 0)) {
    throw codedError('DOCUMENT_TOOL_PREFERENCES_RECEIPT_INVALID', 'Tool settings could not be checked.');
  }
  if (expectedStatus === 'missing') return { ...data, revision: 0, preferences: null };
  if (!validText(data.clientRevision) || !validText(data.updatedAt)) throw codedError('DOCUMENT_TOOL_PREFERENCES_RECEIPT_INVALID', 'Tool settings could not be checked.');
  return { ...data, preferences: validateDocumentToolPreferences(data.preferences) };
}

function errorFromResponse(error) {
  const code = String(error?.code || 'DOCUMENT_TOOL_PREFERENCES_SYNC_FAILED');
  const known = new Set(['40001', '42501', '22023', '23505', '42P01', '42883']);
  return codedError(known.has(code) ? code : 'DOCUMENT_TOOL_PREFERENCES_SYNC_FAILED',
    code === '40001' ? 'Tool settings changed in another window. Your draft was kept. Choose which defaults to use.'
      : code === '42P01' || code === '42883' ? 'Private tool settings are not ready. Your draft was kept.'
        : 'Tool settings could not sync. Your draft was kept.');
}

async function actorRpc(client, scope, isCurrent, signal, name, args, write) {
  return runActorBoundDatabaseMutation({ client, actorUserId: scope.actorUserId, isCurrent, signal },
    ({ request }) => request(() => client.rpc(name, args), { write }));
}

export function createDocumentToolPreferencesClient({
  client = defaultClient, storage = safeStorage(), lockManager = globalThis.navigator?.locks,
  makeRevision = randomUUID, tabId = defaultTabId(),
} = {}) {
  const snapshot = (scope) => {
    const scoped = keys(scope, tabId);
    if (!scoped) return { preferences: null, revision: 0, pending: false, errorCode: null };
    try {
      const pending = readPending(storage, scoped.pending, scoped.scopeKey)
        || pendingRecords(storage, scoped, scoped.scopeKey)[0] || null;
      const cache = readCache(storage, scoped.cache, scope, scoped.scopeKey);
      let legacyPreferences = null;
      if (!pending && scoped.legacyPending) {
        const legacy = parse(storage, scoped.legacyPending)?.value;
        if (legacy != null) {
          if (legacy.version !== 1 || !validText(legacy.revision)) throw codedError('DOCUMENT_TOOL_PREFERENCES_LEGACY_PENDING_INVALID', 'Old pending tool settings were kept for recovery.');
          legacyPreferences = validateDocumentToolPreferences(legacy.preferences);
        }
      }
      return { preferences: pending?.preferences || legacyPreferences || cache?.preferences || null, revision: cache?.revision || 0,
        pending: !!pending || !!legacyPreferences, conflict: Number.isSafeInteger(pending?.conflictRevision), errorCode: null };
    } catch (error) {
      return { preferences: null, revision: 0, pending: false, errorCode: error.code || 'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED' };
    }
  };

  const admit = (scope, preferences, { basePreferences = null } = {}) => {
    const scoped = keys(scope, tabId);
    if (!scoped) throw codedError('DOCUMENT_TOOL_PREFERENCES_SCOPE_UNAVAILABLE', 'Tool settings are not available for this document.');
    let clean = validateDocumentToolPreferences(preferences);
    if (scope.kind !== 'account-cloud') {
      const receipt = { version: 1, status: 'local', documentId: scope.documentId, revision: 1,
        scopeKey: scoped.scopeKey, clientRevision: makeRevision(), preferences: clean, updatedAt: new Date().toISOString() };
      writeVerified(storage, scoped.cache, receipt);
      return { snapshot: { preferences: clean, revision: 1, pending: false, errorCode: null }, draft: null };
    }
    const currentPending = readPending(storage, scoped.pending, scoped.scopeKey);
    const allPending = pendingRecords(storage, scoped, scoped.scopeKey);
    if (!currentPending && allPending.length >= MAX_PENDING_DRAFTS_PER_SCOPE) {
      throw codedError('DOCUMENT_TOOL_PREFERENCES_PENDING_LIMIT', 'Too many tool setting drafts need to sync. No draft was removed.');
    }
    const currentCache = readCache(storage, scoped.cache, scope, scoped.scopeKey);
    if (Number.isSafeInteger(currentPending?.conflictRevision)) {
      throw codedError('DOCUMENT_TOOL_PREFERENCES_CONFLICT_ACTION_REQUIRED',
        'Choose whether to keep the defaults shown here or use the saved defaults before making more changes.');
    }
    const draft = { version: 2, scopeKey: scoped.scopeKey,
      expectedRevision: currentPending?.expectedRevision ?? currentCache?.revision ?? 0,
      clientRevision: makeRevision(), preferences: clean,
      basePreferences: currentPending?.basePreferences || currentCache?.preferences
          || (basePreferences ? validateDocumentToolPreferences(basePreferences) : {}),
      ...(currentPending && basePreferences && samePreferences(basePreferences, currentPending.preferences)
        ? { predecessorClientRevision: currentPending.predecessorClientRevision || currentPending.clientRevision }
        : {}),
    };
    const raw = writeVerified(storage, scoped.pending, draft);
    return { snapshot: { preferences: clean, revision: currentCache?.revision || 0, pending: true, errorCode: null },
      draft: { ...draft, raw } };
  };

  const acquire = async (scope, signal, work) => {
    if (typeof lockManager?.request !== 'function') throw codedError('DOCUMENT_TOOL_PREFERENCES_SAFE_LOCK_UNAVAILABLE', 'Tool settings are saved here but cannot sync safely yet.');
    const lockName = `survey:document-tool-preferences:${scope.actorUserId}:${scope.supabaseDocId}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(abort, 60000);
    try {
      return await lockManager.request(lockName, { mode: 'exclusive', signal: controller.signal },
        () => work(controller.signal));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    }
  };

  const readRemote = async (scope, { isCurrent = () => true, signal } = {}) => {
    if (scope?.kind !== 'account-cloud') return null;
    const response = await actorRpc(client, scope, isCurrent, signal, READ_RPC,
      { p_document_id: scope.supabaseDocId }, false);
    if (response?.error) throw errorFromResponse(response.error);
    const status = response?.data?.status;
    if (status === 'missing') return normalizeReceipt(response.data, scope, 'missing');
    if (status === 'present') return normalizeReceipt(response.data, scope, 'present');
    throw codedError('DOCUMENT_TOOL_PREFERENCES_RECEIPT_INVALID', 'Tool settings could not be checked.');
  };

  const storeReceipt = (scope, receipt) => {
    const scoped = keys(scope, tabId);
    writeVerified(storage, scoped.cache, { ...receipt, scopeKey: scoped.scopeKey });
  };

  const flush = async (scope, { isCurrent = () => true, signal } = {}) => {
    if (scope?.kind !== 'account-cloud') return snapshot(scope);
    const scoped = keys(scope, tabId);
    return acquire(scope, signal, async (combinedSignal) => {
      if (!isCurrent()) throw codedError('DATABASE_MUTATION_SCOPE_CHANGED', 'Tool settings scope changed.');
      let queue = pendingRecords(storage, scoped, scoped.scopeKey);
      let pending = queue.shift() || null;
      let legacy = null;
      if (!pending && scoped.legacyPending) {
        const parsed = parse(storage, scoped.legacyPending);
        if (parsed) {
          const value = parsed.value;
          if (value?.version !== 1 || !validText(value.revision)) throw codedError('DOCUMENT_TOOL_PREFERENCES_LEGACY_PENDING_INVALID', 'Old pending tool settings were kept for recovery.');
          legacy = { raw: parsed.raw, preferences: validateDocumentToolPreferences(value.preferences), clientRevision: value.revision };
          const remote = await readRemote(scope, { isCurrent, signal: combinedSignal });
          if (remote.status !== 'missing') throw codedError('DOCUMENT_TOOL_PREFERENCES_LEGACY_CONFLICT', 'Old pending tool settings were kept because private settings already exist.');
          pending = { version: 2, scopeKey: scoped.scopeKey, expectedRevision: 0,
            clientRevision: legacy.clientRevision, preferences: legacy.preferences };
        }
      }
      if (!pending) return snapshot(scope);
      let firstError = null;
      for (let sent = 0; sent < MAX_PENDING_DRAFTS_PER_SCOPE && pending; sent += 1) {
        if (Number.isSafeInteger(pending.conflictRevision)) {
          firstError ||= codedError('DOCUMENT_TOOL_PREFERENCES_CONFLICT_ACTION_REQUIRED',
            'Tool settings changed in another window. Your draft was kept. Choose which defaults to use.');
          pending = queue.shift() || null;
          continue;
        }
        const response = await actorRpc(client, scope, isCurrent, combinedSignal, WRITE_RPC, {
          p_document_id: scope.supabaseDocId,
          p_expected_revision: pending.expectedRevision,
          p_client_revision: pending.clientRevision,
          p_preferences: pending.preferences,
        }, true);
        if (response?.error?.code === '40001') {
          const remote = await readRemote(scope, { isCurrent, signal: combinedSignal });
          if (remote?.status !== 'present') throw errorFromResponse(response.error);
          if (legacy) {
            storeReceipt(scope, remote);
            firstError ||= codedError('DOCUMENT_TOOL_PREFERENCES_LEGACY_CONFLICT',
              'Old pending tool settings were kept because private settings now exist.');
            legacy = null;
            pending = queue.shift() || null;
            continue;
          }
          const pendingKey = pending.storageKey;
          const currentRecord = storage.getItem(pendingKey) === pending.raw
            ? pending : readPending(storage, pendingKey, scoped.scopeKey);
          const current = currentRecord ? { ...currentRecord, storageKey: pendingKey } : null;
          if (!current || (current.clientRevision !== pending.clientRevision
            && current.predecessorClientRevision !== pending.clientRevision)) {
            firstError ||= errorFromResponse(response.error);
            pending = queue.shift() || null;
            continue;
          }
          pending = current;
          const localChanges = changedFields(pending.basePreferences || {}, pending.preferences);
          const remoteChanges = changedFields(pending.basePreferences || {}, remote.preferences);
          const overlaps = [...localChanges.keys()].some(key => remoteChanges.has(key));
          storeReceipt(scope, remote);
          if (overlaps) {
            const conflicted = { ...pending, conflictRevision: remote.revision };
            delete conflicted.raw;
            const raw = replaceExact(storage, pending.storageKey, pending.raw, conflicted);
            if (!raw) {
              firstError ||= errorFromResponse(response.error);
              pending = queue.shift() || null;
              continue;
            }
            pending = { ...conflicted, raw, storageKey: pending.storageKey };
            firstError ||= errorFromResponse(response.error);
            pending = queue.shift() || null;
            continue;
          }
          const rebased = { ...pending, expectedRevision: remote.revision,
            basePreferences: remote.preferences, preferences: applyChanges(remote.preferences, localChanges) };
          delete rebased.raw;
          const raw = replaceExact(storage, pending.storageKey, pending.raw, rebased);
          if (!raw) {
            firstError ||= errorFromResponse(response.error);
            pending = queue.shift() || null;
            continue;
          }
          pending = { ...rebased, raw, storageKey: pending.storageKey };
          continue;
        }
        if (response?.error) {
          firstError ||= errorFromResponse(response.error);
          pending = queue.shift() || null;
          continue;
        }
        const receipt = normalizeReceipt(response?.data, scope, 'written');
        if (receipt.clientRevision !== pending.clientRevision || receipt.revision !== pending.expectedRevision + 1
          || !samePreferences(receipt.preferences, pending.preferences)) {
          throw codedError('DOCUMENT_TOOL_PREFERENCES_RECEIPT_INVALID', 'Tool settings could not be checked. The draft was kept.');
        }
        if (!isCurrent()) throw codedError('DATABASE_MUTATION_SCOPE_CHANGED', 'Tool settings scope changed.');
        storeReceipt(scope, receipt);
        if (legacy) {
          replaceExact(storage, scoped.legacyPending, legacy.raw, null);
          legacy = null;
        } else if (replaceExact(storage, pending.storageKey, pending.raw, null)) {
        } else {
          const newer = readPending(storage, pending.storageKey, scoped.scopeKey);
          if (newer?.expectedRevision === pending.expectedRevision
            && newer.predecessorClientRevision === pending.clientRevision) {
            const rebased = { ...newer, expectedRevision: receipt.revision, basePreferences: receipt.preferences };
            delete rebased.predecessorClientRevision;
            const raw = replaceExact(storage, pending.storageKey, newer.raw, rebased);
            if (!raw) {
              pending = queue.shift() || null;
              continue;
            }
            pending = { ...rebased, raw, storageKey: pending.storageKey };
            continue;
          }
        }
        pending = queue.shift() || null;
      }
      if (firstError) throw firstError;
      return snapshot(scope);
    });
  };

  const refresh = async (scope, options = {}) => {
    if (!scope) return snapshot(scope);
    if (scope.kind !== 'account-cloud') return snapshot(scope);
    const scoped = keys(scope, tabId);
    try {
      const local = snapshot(scope);
      if (local.errorCode) return local;
      if (pendingRecords(storage, scoped, scoped.scopeKey).length || storage?.getItem?.(scoped.legacyPending)) {
        try { return await flush(scope, options); } catch (error) {
          return { ...snapshot(scope), errorCode: error.code || 'DOCUMENT_TOOL_PREFERENCES_SYNC_FAILED', error };
        }
      }
      try {
        const receipt = await readRemote(scope, options);
        if (receipt.status === 'present') storeReceipt(scope, receipt);
        return snapshot(scope);
      } catch (error) {
        return { ...snapshot(scope), errorCode: error.code || 'DOCUMENT_TOOL_PREFERENCES_SYNC_FAILED', error };
      }
    } catch (error) {
      return { preferences: null, revision: 0, pending: false,
        errorCode: error.code || 'DOCUMENT_TOOL_PREFERENCES_LOCAL_READ_FAILED', error };
    }
  };

  const subscribe = (scope, listener) => {
    const scoped = keys(scope, tabId);
    if (!scoped || typeof window === 'undefined' || typeof listener !== 'function') return () => {};
    const onStorage = event => {
      if (event.key === scoped.cache || event.key === scoped.legacyPending || event.key?.startsWith(scoped.pendingPrefix)) listener();
    };
    const onOnline = () => listener();
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('online', onOnline); };
  };

  const resolveConflict = (scope, choice) => {
    if (scope?.kind !== 'account-cloud' || !['keep', 'saved'].includes(choice)) {
      throw codedError('DOCUMENT_TOOL_PREFERENCES_SCOPE_UNAVAILABLE', 'Tool settings conflict choice is not available.');
    }
    const scoped = keys(scope, tabId);
    const pending = readPending(storage, scoped.pending, scoped.scopeKey)
      || pendingRecords(storage, scoped, scoped.scopeKey).find(item => Number.isSafeInteger(item.conflictRevision));
    const cache = readCache(storage, scoped.cache, scope, scoped.scopeKey);
    if (!pending || !Number.isSafeInteger(pending.conflictRevision) || !cache
      || cache.revision !== pending.conflictRevision) {
      throw codedError('DOCUMENT_TOOL_PREFERENCES_CONFLICT_ACTION_REQUIRED', 'The tool settings conflict must be refreshed before choosing.');
    }
    const pendingKey = pending.storageKey || scoped.pending;
    if (choice === 'saved') {
      writeVerified(storage, scoped.conflictBackup, { version: 1, scopeKey: scoped.scopeKey,
        clientRevision: pending.clientRevision, rawDraft: pending.raw, savedAt: new Date().toISOString() });
      replaceExact(storage, pendingKey, pending.raw, null);
      return snapshot(scope);
    }
    const rebased = { ...pending, expectedRevision: cache.revision, basePreferences: cache.preferences,
      clientRevision: makeRevision() };
    delete rebased.raw;
    delete rebased.storageKey;
    delete rebased.conflictRevision;
    if (!replaceExact(storage, pendingKey, pending.raw, rebased)) {
      throw codedError('DOCUMENT_TOOL_PREFERENCES_CONFLICT_ACTION_REQUIRED', 'The tool settings draft changed. Review it before choosing again.');
    }
    return snapshot(scope);
  };

  return Object.freeze({ snapshot, admit, refresh, flush, resolveConflict, subscribe });
}

export const documentToolPreferences = createDocumentToolPreferencesClient();
