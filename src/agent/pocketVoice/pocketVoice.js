// The on-device voice (Nightly flag survey-agent-device-voice): Kyutai Pocket
// TTS running in a worker, so speech needs no server and no signal once the
// files are on the device (~146 MB, kept in Cache Storage). Audio streams out
// in small pieces and plays as it comes, so a reply starts before it is all
// made.
import { VOICE_FILE, dropOldCaches, fetchModelFile } from './pocketModelFiles.js';

const SAMPLE_RATE = 24000;

// The voice clip as 24 kHz mono samples, the rate the voice model takes.
async function voiceSamples(bytes) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new Offline(1, SAMPLE_RATE, SAMPLE_RATE);
  const decoded = await probe.decodeAudioData(bytes.slice(0));
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const ctx = new Offline(1, frames, SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

// A slow device makes audio slower than it plays. Then playback waits until
// enough is made that the rest arrives before it is needed, so the reply
// plays through without gaps; a fast device starts on the first piece.
const SECONDS_PER_WORD = 0.4;
export function readyToStart(job) {
  // The first piece carries the fixed start-up cost; the rate is measured
  // from it on.
  if (job.pending.length < 2 || !job.firstAt) return false;
  const elapsed = (performance.now() - job.firstAt) / 1000;
  const made = job.produced - job.firstDuration;
  const rate = elapsed > 0 ? made / elapsed : 0;
  if (rate >= 1.1) return true;
  const remaining = Math.max(0, job.expected - job.produced);
  // Making what is left must not take longer than playing what is made.
  return rate > 0 && remaining / rate <= job.produced;
}

function playPending(job) {
  const { ctx } = job;
  while (job.pending.length) {
    const buffer = job.pending.shift();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    const at = Math.max(job.nextAt, ctx.currentTime + (job.sources.length ? 0 : 0.05));
    node.start(at);
    job.nextAt = at + buffer.duration;
    job.sources.push(node);
  }
}

export const canRunPocketVoice = () => typeof window !== 'undefined'
  && typeof Worker === 'function'
  && typeof WebAssembly === 'object'
  && Boolean(window.OfflineAudioContext || window.webkitOfflineAudioContext);

/**
 * state: 'idle' (not started), 'loading', 'ready' or 'error'. progress: 0..1
 * of the download. onChange is told each time either changes.
 */
export function createPocketVoice({ onChange = () => {}, makeWorker = null } = {}) {
  let worker = null;
  let state = 'idle';
  let progress = 0;
  let error = null;
  let preparing = null;
  let job = null; // the reply being made: { ctx, sources, nextAt, ended, resolve, reject }
  const waiters = new Map(); // message type -> resolve

  const set = (next) => {
    if ('state' in next) state = next.state;
    if ('progress' in next) progress = next.progress;
    if ('error' in next) error = next.error;
    onChange({ state, progress, error });
  };

  const finishJob = () => {
    const current = job;
    if (!current) return;
    const last = current.sources[current.sources.length - 1];
    const done = () => { if (job === current) job = null; current.resolve(); };
    if (!last) { done(); return; }
    last.onended = done;
    // A source that already played out never fires onended.
    if (current.ctx.currentTime >= current.nextAt) done();
  };

  const onMessage = (e) => {
    const m = e.data || {};
    if (m.type === 'progress' && m.total) {
      set({ progress: Math.min(1, m.loaded / m.total) });
    } else if (m.type === 'audio_chunk' && job && m.data?.length) {
      const buffer = job.ctx.createBuffer(1, m.data.length, SAMPLE_RATE);
      buffer.copyToChannel(m.data, 0);
      job.pending.push(buffer);
      job.produced += buffer.duration;
      if (!job.firstAt) { job.firstAt = performance.now(); job.firstDuration = buffer.duration; }
      if (!job.started && readyToStart(job)) job.started = true;
      if (job.started) playPending(job);
    } else if (m.type === 'stream_ended') {
      if (job && !job.started) { job.started = true; playPending(job); }
      finishJob();
    } else if (m.type === 'error') {
      const err = new Error(String(m.error || 'The on-device voice failed.'));
      if (job) { const current = job; job = null; current.reject(err); }
      const waiter = waiters.get('*');
      if (waiter) waiter.reject(err);
    }
    const waiter = waiters.get(m.type);
    if (waiter) { waiters.delete(m.type); waiter.resolve(m); }
  };

  const waitFor = (type) => new Promise((resolve, reject) => {
    waiters.set(type, { resolve, reject });
    waiters.set('*', { resolve: () => {}, reject: (err) => { waiters.delete(type); reject(err); } });
  });

  const start = () => {
    worker = makeWorker ? makeWorker() : new Worker(new URL('./pocketTtsWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onMessage;
    worker.onerror = (e) => {
      const waiter = waiters.get('*');
      if (waiter) waiter.reject(new Error(e?.message || 'The on-device voice could not start.'));
    };
  };

  return {
    get state() { return state; },
    get progress() { return progress; },
    get error() { return error; },
    /** Downloads (first time only) and starts the voice. Safe to call again. */
    prepare() {
      if (preparing) return preparing;
      set({ state: 'loading', progress: 0, error: null });
      preparing = (async () => {
        dropOldCaches();
        start();
        const loaded = waitFor('loaded');
        worker.postMessage({ type: 'load' });
        const [clip] = await Promise.all([fetchModelFile(VOICE_FILE.name), loaded]);
        const samples = await voiceSamples(clip);
        const encoded = waitFor('voice_encoded');
        worker.postMessage({ type: 'voice_audio', data: { audio: samples } }, [samples.buffer]);
        await encoded;
        set({ state: 'ready', progress: 1 });
      })().catch((err) => {
        set({ state: 'error', error: err?.message || String(err) });
        try { worker?.terminate(); } catch { /* already gone */ }
        worker = null;
        preparing = null;
        throw err;
      });
      return preparing;
    },
    /**
     * Speaks words through ctx (a running AudioContext). Resolves when the
     * last piece has played; rejects if the voice fails.
     */
    speak(words, ctx) {
      if (state !== 'ready' || !worker) return Promise.reject(new Error('The on-device voice is not ready.'));
      this.stop();
      return new Promise((resolve, reject) => {
        const expected = String(words).split(/\s+/).filter(Boolean).length * SECONDS_PER_WORD;
        job = { ctx, sources: [], pending: [], produced: 0, expected, started: false, firstDuration: 0, nextAt: 0, resolve, reject, startedAt: performance.now(), firstAt: 0 };
        worker.postMessage({ type: 'generate', data: { text: words, voice: 'custom' } });
      });
    },
    stop() {
      const current = job;
      job = null;
      if (worker) worker.postMessage({ type: 'stop' });
      if (!current) return;
      for (const node of current.sources) {
        try { node.onended = null; node.stop(); } catch { /* not started or over */ }
      }
      current.resolve();
    },
  };
}
