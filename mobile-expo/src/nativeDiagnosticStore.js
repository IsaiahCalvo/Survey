export const NATIVE_DIAGNOSTIC_STORE_KEY = 'survey.native-diagnostics.v1';

const EMPTY_STATE = Object.freeze({ diagnostics: [], pendingEvents: [], recoveries: [] });
const BLOCKED_KEY = /(?:email|filename|fileName|token|password|authorization|content|annotation)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TOKEN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const FILE = /\b[^\s<>"'`/\\]+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|tiff?)\b/gi;

const sanitizeString = (value, limit = 240) => String(value || '')
  .replace(URL, '[url]')
  .replace(EMAIL, '[email]')
  .replace(TOKEN, '[token]')
  .replace(FILE, '[file]')
  .replace(/[\r\n]+/g, ' ')
  .slice(0, limit);

const sanitize = (value, depth = 0) => {
  if (value == null) return null;
  if (depth > 3) return undefined;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(-24).map((entry) => sanitize(entry, depth + 1)).filter((entry) => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_KEY.test(key))
    .slice(0, 30)
    .map(([key, entry]) => [key, sanitize(entry, depth + 1)])
    .filter(([, entry]) => entry !== undefined));
};

export const normalizeNativeDiagnosticState = (value) => ({
  diagnostics: Array.isArray(value?.diagnostics)
    ? value.diagnostics.slice(-24).map((entry) => sanitize(entry)).filter(Boolean)
    : [],
  pendingEvents: Array.isArray(value?.pendingEvents)
    ? value.pendingEvents.slice(-8).map((entry) => sanitize(entry)).filter(Boolean)
    : [],
  recoveries: Array.isArray(value?.recoveries)
    ? value.recoveries.slice(-8).filter((entry) => Number.isFinite(entry)).map(Number)
    : [],
});

export const mergeNativeDiagnosticStates = (stored, live) => {
  const persisted = normalizeNativeDiagnosticState(stored);
  const current = normalizeNativeDiagnosticState(live);
  const pendingById = new Map(
    [...persisted.pendingEvents, ...current.pendingEvents]
      .map((entry) => [String(entry?.id || ''), entry])
      .filter(([id]) => id),
  );
  return normalizeNativeDiagnosticState({
    diagnostics: [...persisted.diagnostics, ...current.diagnostics],
    pendingEvents: [...pendingById.values()],
    recoveries: [...persisted.recoveries, ...current.recoveries],
  });
};

export const acknowledgeNativeAnalyticsEvents = (pendingEvents, acknowledgedIds) => {
  const acknowledged = new Set(
    (Array.isArray(acknowledgedIds) ? acknowledgedIds : []).map((id) => String(id)),
  );
  return normalizeNativeDiagnosticState({
    pendingEvents: (Array.isArray(pendingEvents) ? pendingEvents : [])
      .filter((entry) => !acknowledged.has(String(entry?.id || ''))),
  }).pendingEvents;
};

export const claimNativeAnalyticsEvents = (pendingEvents, inFlightIds) => {
  const claimed = [];
  for (const entry of Array.isArray(pendingEvents) ? pendingEvents : []) {
    const id = String(entry?.id || '');
    if (!id || inFlightIds?.has?.(id)) continue;
    inFlightIds?.add?.(id);
    claimed.push(entry);
  }
  return claimed;
};

export async function loadNativeDiagnosticState(storage) {
  try {
    const raw = await storage?.getItem?.(NATIVE_DIAGNOSTIC_STORE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    return normalizeNativeDiagnosticState(JSON.parse(raw));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function saveNativeDiagnosticState(storage, state) {
  const normalized = normalizeNativeDiagnosticState(state);
  await storage?.setItem?.(NATIVE_DIAGNOSTIC_STORE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createNativeDiagnosticPersistenceGate(storage) {
  let hydrated = false;
  let requested = false;
  let latestState = () => EMPTY_STATE;
  let chain = Promise.resolve();

  const enqueue = () => {
    chain = chain
      .catch(() => undefined)
      .then(() => saveNativeDiagnosticState(storage, latestState()));
    return chain;
  };

  return {
    persist(stateProvider) {
      latestState = stateProvider;
      if (!hydrated) {
        requested = true;
        return chain;
      }
      return enqueue();
    },
    markHydrated() {
      hydrated = true;
      if (!requested) return chain;
      requested = false;
      return enqueue();
    },
    flush() {
      return chain;
    },
  };
}
