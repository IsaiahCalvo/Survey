// A small AI model on the device for the Survey agent with no signal
// (Nightly, flag survey-agent-offline). It never decides on its own what
// exists: the app's plain rules find the real candidate items first, and
// the model only picks among them, in a fixed answer shape whose every
// choice is a list of those candidates (structured output). What it picks
// is checked again by offlineHelper before anything is written.
//
// Where the model comes from:
//   - the phone apps: the phone's own model through the DeviceModel plugin
//     (packages/device-model): Apple's on-device model on iOS 26 with Apple
//     Intelligence on, Gemini Nano through ML Kit on Android phones that
//     have AICore. Free, on the device.
//   - Chrome and Edge: their built-in model (the Prompt API, window
//     LanguageModel; Gemini Nano in Chrome), free once downloaded.
// Each answers the same ask() below.

const TIMEOUT_MS = 20_000;
const OPTIONS = Object.freeze({
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});

const builtIn = (LM) => LM ?? globalThis.LanguageModel ?? null;

// The phone app's plugin, or null in a browser. Tests pass `native`
// (null for none). An app build from before the plugin has no header for
// it, which reads as no model. The plugin is kept in a holder: Capacitor's
// plugin object answers every property, `then` too, so it must never be
// the value a promise resolves to.
let phoneHolder = null;
async function phone(native) {
  if (native !== undefined) return { plugin: native };
  const cap = globalThis.Capacitor;
  if (!cap?.isNativePlatform?.()) return { plugin: null };
  if (Array.isArray(cap.PluginHeaders) && !cap.PluginHeaders.some((h) => h?.name === 'DeviceModel')) return { plugin: null };
  if (!phoneHolder) {
    phoneHolder = import('@capacitor/core')
      .then(({ registerPlugin }) => ({ plugin: registerPlugin('DeviceModel') }))
      .catch(() => ({ plugin: null }));
  }
  return phoneHolder;
}

const PHONE_STATES = new Set(['ready', 'downloadable', 'downloading']);

/** The model's answer text as an object: JSON, maybe fenced or with words around it. */
export function parseModelJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

/**
 * { state, engine }: state 'ready' (on the device), 'downloadable' (can be
 * fetched), 'downloading', or 'none'; engine 'apple', 'gemini-nano'
 * (phones) or 'browser' (Chrome/Edge, about 2 GB to fetch).
 */
export async function deviceModelInfo(LM, { native } = {}) {
  const { plugin } = await phone(native);
  if (plugin?.availability) {
    try {
      const out = await plugin.availability();
      const state = PHONE_STATES.has(out?.state) ? out.state : 'none';
      return { state, engine: out?.engine === 'apple' ? 'apple' : 'gemini-nano' };
    } catch { /* an app build without the plugin: try the browser's */ }
  }
  const api = builtIn(LM);
  if (!api || typeof api.availability !== 'function') return { state: 'none', engine: 'browser' };
  try {
    const state = await api.availability(OPTIONS);
    if (state === 'available' || state === 'readily') return { state: 'ready', engine: 'browser' };
    if (state === 'downloadable' || state === 'after-download') return { state: 'downloadable', engine: 'browser' };
    if (state === 'downloading') return { state: 'downloading', engine: 'browser' };
    return { state: 'none', engine: 'browser' };
  } catch {
    return { state: 'none', engine: 'browser' };
  }
}

/** Just the state of deviceModelInfo. */
export async function deviceModelState(LM, options) {
  return (await deviceModelInfo(LM, options)).state;
}

/**
 * Fetches the model (needs a tap: browsers only start the download from
 * one). onProgress(0..1), or onProgress(null) when the size is not known
 * (Android tells bytes, not the total). Resolves true once it is fetched.
 */
export async function downloadDeviceModel({ onProgress, LM, native } = {}) {
  const { plugin } = await phone(native);
  if (plugin?.download) {
    let listener = null;
    try {
      listener = await plugin.addListener?.('downloadProgress', () => onProgress?.(null));
      const out = await plugin.download();
      return Boolean(out?.ok);
    } catch {
      return false;
    } finally {
      listener?.remove?.();
    }
  }
  const api = builtIn(LM);
  if (!api?.create) return false;
  const session = await api.create({
    ...OPTIONS,
    monitor(m) {
      m.addEventListener?.('downloadprogress', (e) => onProgress?.(Number(e.loaded) || 0));
    },
  });
  session.destroy?.();
  return true;
}

/**
 * One question to the device's model, answered in the given JSON shape.
 * Returns the parsed object, or null (no model, too slow, or not JSON).
 */
export async function askDeviceModel({ system, prompt, schema, LM, native, timeoutMs = TIMEOUT_MS }) {
  const { plugin } = await phone(native);
  if (plugin?.generate) {
    try {
      const out = await withTimeout(plugin.generate({ system, prompt, schemaJson: JSON.stringify(schema || {}) }), timeoutMs);
      return parseModelJson(out?.text);
    } catch {
      return null;
    }
  }
  const api = builtIn(LM);
  if (!api?.create) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  let session = null;
  try {
    session = await api.create({ ...OPTIONS, initialPrompts: [{ role: 'system', content: system }], signal: controller?.signal });
    const raw = await session.prompt(prompt, { responseConstraint: schema, signal: controller?.signal });
    return parseModelJson(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    session?.destroy?.();
  }
}

/** The ask() offlineHelper takes, when the device has a model ready; else null. */
export async function readyDeviceModel(LM, { native } = {}) {
  if (await deviceModelState(LM, { native }) !== 'ready') return null;
  return { ask: (request) => askDeviceModel({ ...request, LM, native }) };
}
