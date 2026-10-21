// Hands-free talk for the Survey agent: the parts with no browser in them, so
// node tests can drive them with recorded clips. handsFreeMic.js feeds these
// from the microphone; SurveyAgentPanel runs the talk, answer, listen loop.
import { normalizeItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';

/**
 * Tells when someone starts and stops talking, from one loudness value per
 * short frame (root mean square of the samples, 0 to 1). It learns the
 * background noise while nobody talks (a site with a generator is never
 * quiet), and calls it speech when a frame is clearly louder than that.
 *
 * push(level) returns:
 *   'start'   speech began (include the frames kept from just before it),
 *   'end'     speech ended after a pause; send the clip,
 *   'discard' it was only a short noise (a door bang, a cough),
 *   null      nothing changed.
 */
export function createSpeechGate({
  frameMs = 20,
  startMs = 140,
  endSilenceMs = 1100,
  minSpeechMs = 350,
  maxMs = 30_000,
  burstMs = 100,
  ratio = 2.6,
  minLevel = 0.012,
} = {}) {
  const frames = (ms) => Math.max(1, Math.round(ms / frameMs));
  const startFrames = frames(startMs);
  const endFrames = frames(endSilenceMs);
  const minSpeechFrames = frames(minSpeechMs);
  const maxFrames = frames(maxMs);
  const burstFrames = frames(burstMs);
  let floor = null;
  let talking = false;
  let loudRun = 0;
  let quietRun = 0;
  let length = 0;
  let speechFrames = 0;
  // Loud frames after a pause that may only be a bang (a hammer, a door):
  // they count as speech once they last longer than a bang does.
  let pendingLoud = 0;

  const learn = (level) => {
    // Quick at first, then slow, so one loud frame does not raise the floor.
    floor = floor == null ? level : floor + (level - floor) * (level > floor ? 0.02 : 0.1);
  };

  return {
    get talking() { return talking; },
    get floor() { return floor; },
    reset() {
      talking = false; loudRun = 0; quietRun = 0; length = 0; speechFrames = 0; pendingLoud = 0;
    },
    push(level) {
      const value = Number.isFinite(level) ? Math.max(0, level) : 0;
      const loud = value > Math.max(minLevel, (floor ?? value) * ratio);
      if (!talking) {
        if (loud) {
          loudRun += 1;
          if (loudRun >= startFrames) {
            talking = true;
            length = loudRun;
            speechFrames = loudRun;
            quietRun = 0;
            return 'start';
          }
        } else {
          loudRun = 0;
          learn(value);
        }
        return null;
      }
      length += 1;
      if (loud) {
        pendingLoud += 1;
        if (pendingLoud > burstFrames || quietRun === 0) {
          speechFrames += pendingLoud;
          pendingLoud = 0;
          quietRun = 0;
        }
      } else {
        quietRun += 1 + pendingLoud;
        pendingLoud = 0;
      }
      if (quietRun >= endFrames || length >= maxFrames) {
        const enough = speechFrames >= minSpeechFrames;
        this.reset();
        return enough ? 'end' : 'discard';
      }
      return null;
    },
  };
}

/**
 * The gate while the agent speaks: the person must be clearly louder than
 * the site noise and than what is left of the agent's voice after echo
 * cancellation (about a tenth of its level) to cut in.
 */
export const BARGE_IN_GATE = { ratio: 3, minLevel: 0.035 };

/**
 * True when what was heard is mostly the agent's own spoken reply (its voice
 * leaked back into the mic), so it must not be taken as the person talking.
 */
export function heardOwnVoice(heard, spoken) {
  const words = (t) => String(t || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const h = words(heard);
  if (!h.length) return false;
  const said = new Set(words(spoken));
  if (!said.size) return false;
  return h.filter((w) => said.has(w)).length / h.length >= 0.7;
}

/** Loudness of one frame of samples (root mean square, 0 to 1). */
export function frameLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Lower the sample rate by averaging (speech to text wants 16 kHz). */
export function downsample(samples, fromRate, toRate = 16_000) {
  if (!samples?.length || fromRate <= toRate) return Float32Array.from(samples || []);
  const step = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.min(samples.length, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += samples[j];
    out[i] = sum / Math.max(1, to - from);
  }
  return out;
}

/** A mono 16-bit WAV file from samples between -1 and 1. */
export function encodeWav(samples, sampleRate = 16_000) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

const MAX_SPOKEN_CHARS = 220;

/**
 * A reply as it should sound: no ids, links or list marks, tags read the way
 * people say them ("D-117" as "D 117"), at most two sentences.
 */
export function spokenReply(text) {
  let s = String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\(\s*id[^)]*\)/gi, '')
    .replace(/\bid\s+[\w-]+\.?/gi, '')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\b([A-Za-z]{1,4})-(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?:;])/g, '$1')
    .replace(/\.\s*\./g, '.')
    .trim();
  const sentences = s.match(/[^.!?]+[.!?]*/g) || [];
  s = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (s.length > MAX_SPOKEN_CHARS) s = `${s.slice(0, MAX_SPOKEN_CHARS).replace(/\s+\S*$/, '')}.`;
  return s;
}

/**
 * Words for speech to text to expect: the template's checklist and entity
 * words, then the item names (most likely to be misheard: "D1-18" for
 * "D-118"). Whisper keeps only the end of a long hint, so names go last, the
 * likeliest at the very end: the items worked on in this chat (recent, oldest
 * first) and then the selected item. The list stays short.
 */
export function transcriptionHints(bridge, { maxNames = 40, maxWords = 16, recent = [] } = {}) {
  const seen = new Set();
  const take = (list, max) => {
    const out = [];
    for (const raw of list) {
      const value = String(raw || '').trim().slice(0, 40);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= max) break;
    }
    return out;
  };
  const template = bridge?.template || {};
  const categories = (template.modules || []).flatMap((m) => m?.categories || []);
  const words = take([
    ...categories.map((c) => c?.name),
    ...categories.flatMap((c) => (c?.checklist || []).map((item) => item?.text)),
    ...(template.entities || []).map((e) => e?.name),
  ], maxWords);
  const markers = bridge?.markers || {};
  const nameOf = (id) => markers[id]?.name;
  // Likeliest first, so the cap drops the least likely; then reversed so the
  // likeliest end up last.
  const likely = [bridge?.selectedMarkerId, ...[...recent].reverse()].filter(Boolean).map(nameOf);
  const names = take([...likely, ...Object.values(markers).map((m) => m?.name)], maxNames);
  const keep = new Set(likely.filter(Boolean).map((n) => String(n).trim().toLowerCase()));
  const rest = names.filter((n) => !keep.has(n.toLowerCase()));
  const top = names.filter((n) => keep.has(n.toLowerCase())).reverse();
  return [...words, ...rest, ...top];
}

/**
 * Puts item names back the way they are written when speech to text split or
 * spelled them differently ("D1-18", "D 118", "d one eighteen" -> "D-118").
 * Only names with a letter and a digit, and only an exact match once spaces, dashes and
 * number words are set aside, so ordinary words are never touched.
 */
export function snapItemNames(text, names) {
  const known = new Map();
  for (const name of names || []) {
    const key = normalizeItemName(name);
    if (key && /\d/.test(key) && /[a-z]/.test(key) && !known.has(key)) known.set(key, String(name));
  }
  const words = String(text || '').split(/(\s+)/);
  if (!known.size) return String(text || '');
  const out = [];
  for (let i = 0; i < words.length;) {
    if (/^\s+$/.test(words[i]) || !words[i]) { out.push(words[i]); i += 1; continue; }
    let hit = null;
    // Up to four words ("d one eighteen", "door D 1 18"), longest first.
    for (let n = 4; n >= 1 && !hit; n -= 1) {
      const end = i + (n - 1) * 2;
      if (end >= words.length) continue;
      const span = words.slice(i, end + 1).join('');
      const core = span.replace(/^[^\w]+|[^\w]+$/g, '');
      const name = known.get(normalizeItemName(core));
      if (name) {
        const lead = span.slice(0, span.indexOf(core));
        const tail = span.slice(span.indexOf(core) + core.length);
        hit = { text: `${lead}${name}${tail}`, next: end + 1 };
      }
    }
    if (hit) { out.push(hit.text); i = hit.next; } else { out.push(words[i]); i += 1; }
  }
  return out.join('');
}

/**
 * Speech to text sometimes loops on a short stretch ("D-118, D-118, D-118,
 * ..."). Keep one copy of any phrase repeated three or more times in a row.
 */
export function cleanTranscript(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = s.replace(/(\b.{2,40}?)(?:[\s,.;]+\1\b){2,}[\s,.;]*/gi, '$1 ').trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/[\s,;]+$/, '');
}
