// A small AI model on the device for the Survey agent with no signal
// (Nightly, flag survey-agent-offline). It never decides on its own what
// exists: the app's plain rules find the real candidate items first, and
// the model only picks among them, in a fixed answer shape whose every
// choice is a list of those candidates (structured output). What it picks
// is checked again by offlineHelper before anything is written.
//
// Today: Chrome and Edge's built-in model (the Prompt API, window
// LanguageModel; Gemini Nano in Chrome), free and on the device once
// downloaded. Next: Apple's on-device model on iPhone and Mac and Gemini
// Nano on Android through a small native plugin, and Gemma in other
// browsers. Each answers the same ask() below.

const TIMEOUT_MS = 20_000;
const OPTIONS = Object.freeze({
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});

const builtIn = (LM) => LM ?? globalThis.LanguageModel ?? null;

/**
 * 'ready' (on the device), 'downloadable' (can be fetched, about 2 GB),
 * 'downloading', or 'none' (this browser has no built-in model).
 */
export async function deviceModelState(LM) {
  const api = builtIn(LM);
  if (!api || typeof api.availability !== 'function') return 'none';
  try {
    const state = await api.availability(OPTIONS);
    if (state === 'available' || state === 'readily') return 'ready';
    if (state === 'downloadable' || state === 'after-download') return 'downloadable';
    if (state === 'downloading') return 'downloading';
    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * Fetches the built-in model (needs a tap: browsers only start the download
 * from one). onProgress(0..1). Resolves true once it is on the device.
 */
export async function downloadDeviceModel({ onProgress, LM } = {}) {
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
export async function askDeviceModel({ system, prompt, schema, LM, timeoutMs = TIMEOUT_MS }) {
  const api = builtIn(LM);
  if (!api?.create) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  let session = null;
  try {
    session = await api.create({ ...OPTIONS, initialPrompts: [{ role: 'system', content: system }], signal: controller?.signal });
    const raw = await session.prompt(prompt, { responseConstraint: schema, signal: controller?.signal });
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    session?.destroy?.();
  }
}

/** The ask() offlineHelper takes, when the device has a model ready; else null. */
export async function readyDeviceModel(LM) {
  if (await deviceModelState(LM) !== 'ready') return null;
  return { ask: (request) => askDeviceModel({ ...request, LM }) };
}
