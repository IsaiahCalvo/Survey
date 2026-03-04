const DEFAULT_RATE_WINDOW_MS = 2000;

const state = {
  enabled: false,
  counters: {},
  eventTimes: {},
  data: {},
  presence: {
    status: 'idle',
    disabled: false,
    lastErrorClass: null
  },
  lastErrorClass: null,
  lastError: null
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const pruneEventTimes = (type, windowMs = DEFAULT_RATE_WINDOW_MS) => {
  const times = state.eventTimes[type] || [];
  const cutoff = Date.now() - windowMs;
  const pruned = times.filter((ts) => ts >= cutoff);
  state.eventTimes[type] = pruned;
  return pruned;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export const setDebugEnabled = (enabled) => {
  state.enabled = !!enabled;
};

export const isDebugEnabled = () => state.enabled;

export const debugLog = (...args) => {
  if (!state.enabled) return;
  console.log(...args);
};

export const debugWarn = (...args) => {
  if (!state.enabled) return;
  console.warn(...args);
};

export const bumpDebugCounter = (name, delta = 1) => {
  if (!name) return;
  const current = toNumber(state.counters[name], 0);
  state.counters[name] = current + toNumber(delta, 0);
};

export const emitDebugEvent = (type, payload = {}) => {
  if (!type) return;
  bumpDebugCounter(type, 1);
  if (!state.eventTimes[type]) {
    state.eventTimes[type] = [];
  }
  state.eventTimes[type].push(Date.now());
  pruneEventTimes(type);

  if (state.enabled) {
    console.log(`[pdfDebug] ${type}`, payload);
  }
};

export const getEventRate = (type, windowMs = DEFAULT_RATE_WINDOW_MS) => {
  if (!type) return 0;
  const times = pruneEventTimes(type, windowMs);
  const seconds = Math.max(windowMs / 1000, 0.001);
  return Number((times.length / seconds).toFixed(2));
};

export const getEventRates = (windowMs = DEFAULT_RATE_WINDOW_MS) => {
  const rates = {};
  Object.keys(state.eventTimes).forEach((type) => {
    rates[type] = getEventRate(type, windowMs);
  });
  return rates;
};

export const setDebugData = (patch = {}) => {
  if (!patch || typeof patch !== 'object') return;
  state.data = {
    ...state.data,
    ...patch
  };
};

export const setPresenceDebugStatus = (patch = {}) => {
  if (!patch || typeof patch !== 'object') return;
  state.presence = {
    ...state.presence,
    ...patch
  };
};

export const setLastDebugError = (errorClass, detail = null) => {
  const safeClass = errorClass || null;
  state.lastErrorClass = safeClass;
  state.lastError = {
    errorClass: safeClass,
    detail,
    at: new Date().toISOString()
  };
};

export const clearDebugState = () => {
  state.counters = {};
  state.eventTimes = {};
  state.data = {};
  state.presence = {
    status: 'idle',
    disabled: false,
    lastErrorClass: null
  };
  state.lastErrorClass = null;
  state.lastError = null;
};

export const getDebugSnapshot = () => ({
  enabled: state.enabled,
  counters: { ...state.counters },
  rates: getEventRates(DEFAULT_RATE_WINDOW_MS),
  data: clone(state.data),
  presence: clone(state.presence),
  lastErrorClass: state.lastErrorClass,
  lastError: clone(state.lastError)
});

if (typeof window !== 'undefined') {
  window.pdfDebug = {
    enable: () => setDebugEnabled(true),
    disable: () => setDebugEnabled(false),
    isEnabled: () => isDebugEnabled(),
    dump: () => getDebugSnapshot(),
    clear: () => clearDebugState(),
    eventRate: (type, windowMs) => getEventRate(type, windowMs),
    rates: (windowMs) => getEventRates(windowMs)
  };
}

export default {
  setDebugEnabled,
  isDebugEnabled,
  debugLog,
  debugWarn,
  bumpDebugCounter,
  emitDebugEvent,
  getEventRate,
  getEventRates,
  setDebugData,
  setPresenceDebugStatus,
  setLastDebugError,
  clearDebugState,
  getDebugSnapshot
};
