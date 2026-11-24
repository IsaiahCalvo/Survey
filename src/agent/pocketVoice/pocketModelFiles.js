// Where the on-device voice's files come from, and how they are kept.
// Pinned revisions so a change upstream can't change what runs here.
// Models: KevinAHM/pocket-tts-onnx, CC BY 4.0 (exported from kyutai/pocket-tts).
// Voice: "casual" by Alba MacKenna from kyutai/tts-voices, CC BY 4.0.
// The built-in voices.bin of the web demo is not used: it also carries
// voices from non-commercial datasets (Expresso, EARS).
const MODEL_REPO = 'https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/58a6d00cf13d239b6748cb0769f35c580a8f606c/onnx/english_2026-04';
const VOICE_REPO = 'https://huggingface.co/kyutai/tts-voices/resolve/323332d33f997de8394f24a193e1a76df720e01a';

export const MODEL_FILES = Object.freeze([
  { name: 'bundle.json', bytes: 24381 },
  { name: 'tokenizer.model', bytes: 59339 },
  { name: 'bos_before_voice.npy', bytes: 4224 },
  { name: 'mimi_encoder_int8.onnx', bytes: 20779616 },
  { name: 'text_conditioner_int8.onnx', bytes: 16388384 },
  { name: 'flow_lm_main_int8.onnx', bytes: 76341079 },
  { name: 'flow_lm_flow_int8.onnx', bytes: 9962530 },
  { name: 'mimi_decoder_int8.onnx', bytes: 22684077 },
]);

export const VOICE_FILE = Object.freeze({ name: 'alba-mackenna/casual.wav', bytes: 958542, url: `${VOICE_REPO}/alba-mackenna/casual.wav` });

export const VOICE_CREDIT = 'On-device voice: Kyutai Pocket TTS (CC BY 4.0), voice by Alba MacKenna (CC BY 4.0).';

// One cache per set of pinned files; a new set gets a new name and the old
// one is dropped, so phones don't keep two copies of ~150 MB.
export const CACHE_NAME = 'survey-pocket-tts-58a6d00';
const OLD_CACHE = /^survey-pocket-tts-/;

export const modelUrl = (name) => (name === VOICE_FILE.name ? VOICE_FILE.url : `${MODEL_REPO}/${name}`);

const openCache = async () => {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
};

export async function dropOldCaches() {
  try {
    if (typeof caches === 'undefined') return;
    for (const key of await caches.keys()) {
      if (OLD_CACHE.test(key) && key !== CACHE_NAME) await caches.delete(key);
    }
  } catch { /* storage blocked: nothing to drop */ }
}

/** Whether every file is already on this device (no download needed). */
export async function modelFilesCached() {
  const cache = await openCache();
  if (!cache) return false;
  for (const name of [...MODEL_FILES.map((f) => f.name), VOICE_FILE.name]) {
    if (!(await cache.match(modelUrl(name)))) return false;
  }
  return true;
}

/**
 * The file's bytes, from Cache Storage when they are there, else downloaded
 * (and kept). onProgress(loadedBytes) during a download.
 */
export async function fetchModelFile(name, onProgress = () => {}) {
  const url = modelUrl(name);
  const cache = await openCache();
  const hit = cache ? await cache.match(url) : null;
  if (hit) {
    const bytes = await hit.arrayBuffer();
    onProgress(bytes.byteLength);
    return bytes;
  }
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Could not download ${name} (${response.status}).`);
  let bytes;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      onProgress(loaded);
    }
    const all = new Uint8Array(loaded);
    let offset = 0;
    for (const part of parts) { all.set(part, offset); offset += part.length; }
    bytes = all.buffer;
  } else {
    bytes = await response.arrayBuffer();
    onProgress(bytes.byteLength);
  }
  if (cache) {
    try {
      await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch { /* storage full: it works, it just downloads again next time */ }
  }
  return bytes;
}
