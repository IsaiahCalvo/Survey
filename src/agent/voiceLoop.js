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

/**
 * The main gate's settings with createBandLevel (measured on mixed site
 * noise, scripts/voice-eval): a lower ratio than the raw-level default,
 * since band-limiting already takes out most machine noise.
 */
export const MAIN_GATE = { ratio: 2 };

/**
 * Loudness in the speech band (250 to 3500 Hz) instead of the whole signal:
 * a generator's hum or a truck's rumble sits mostly below speech, so with it
 * filtered out the gate can still tell when someone starts talking. Keeps
 * filter state across frames; one per stream.
 */
export function createBandLevel(sampleRate, { low = 250, high = 3500 } = {}) {
  const biquad = (type, f0) => {
    const w = (2 * Math.PI * Math.min(f0, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    const a1 = -2 * c / a0;
    const a2 = (1 - alpha) / a0;
    const b0 = (type === 'high' ? (1 + c) / 2 : (1 - c) / 2) / a0;
    const b1 = (type === 'high' ? -(1 + c) : 1 - c) / a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    return (x) => {
      const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    };
  };
  // Two of each: a steeper edge, so a strong hum just under `low` stays out.
  const filters = [biquad('high', low), biquad('high', low), biquad('low', high), biquad('low', high)];
  return (samples) => {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      let v = samples[i];
      for (const f of filters) v = f(v);
      sum += v * v;
    }
    return Math.sqrt(sum / samples.length);
  };
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
 * Many names in a row ("D-101", "D-102", ... "D-130") as one range,
 * "D-101 to D-130": shows speech to text how names are written without
 * listing them all. A long list of names makes Whisper repeat names from it
 * over and over instead of writing what was said.
 */
export function nameRanges(names) {
  const groups = new Map();
  const out = [];
  for (const name of names) {
    const m = String(name).match(/^(.*?[^\d])(\d+)$/);
    if (!m) { out.push({ at: out.length, text: name }); continue; }
    // Zero-padded numbers ("A-01") only group with the same width.
    const key = `${m[1]}\u0000${m[2].startsWith('0') ? m[2].length : ''}`;
    if (!groups.has(key)) {
      groups.set(key, { prefix: m[1], nums: [], at: out.length });
      out.push(null);
    }
    groups.get(key).nums.push(Number(m[2]));
    if (m[2].startsWith('0')) groups.get(key).width = m[2].length;
  }
  for (const { prefix, nums, at, width = 0 } of groups.values()) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const pad = (n) => String(n).padStart(width, '0');
    const parts = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
      if (j - i >= 2) parts.push(`${prefix}${pad(sorted[i])} to ${prefix}${pad(sorted[j])}`);
      else for (let k = i; k <= j; k += 1) parts.push(`${prefix}${pad(sorted[k])}`);
      i = j + 1;
    }
    out[at] = { text: parts };
  }
  return out.filter(Boolean).flatMap((o) => o.text);
}

/**
 * Words for speech to text to expect: the template's checklist and entity
 * words, then the item names, as ranges where they run in order. Whisper
 * keeps only the end of a long hint, so the likeliest names go last, one by
 * one: the items worked on in this chat (recent, oldest first) and then the
 * selected item. The list stays short.
 */
export function transcriptionHints(bridge, { maxNames = 12, maxWords = 16, maxLikely = 4, recent = [] } = {}) {
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
  const likely = take([bridge?.selectedMarkerId, ...[...recent].reverse()].filter(Boolean).map(nameOf), maxLikely);
  // Every name in the ranges, the likely ones too, so a range isn't split.
  const byKey = new Map();
  for (const m of Object.values(markers)) {
    const name = String(m?.name || '').trim().slice(0, 40);
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  const all = [...byKey.values()];
  const rest = nameRanges(all).filter((r) => !seen.has(r.toLowerCase())).slice(0, Math.max(0, maxNames - likely.length));
  return [...words, ...rest, ...likely.reverse()];
}

/**
 * Puts item names back the way they are written when speech to text split or
 * spelled them differently ("D1-18", "D 118", "d one eighteen" -> "D-118").
 * Only names with a letter and a digit, and only an exact match once spaces, dashes and
 * number words are set aside, so ordinary words are never touched.
 */
export function snapItemNames(text, names) {
  const known = new Map();
  // Names like CAM-12 or FA-204 also by their spoken long form: "Camera 12"
  // (a word starting with the letters) or "fire alarm 204" (initials of
  // words of four letters or more, so "fix all 204" stays). Two letters or
  // more, so "Day 12" never becomes D-12.
  const spoken = new Map();
  for (const name of names || []) {
    const key = normalizeItemName(name);
    if (key && /\d/.test(key) && /[a-z]/.test(key) && !known.has(key)) known.set(key, String(name));
    const parts = key.match(/^([a-z]{2,})(\d+)$/);
    if (parts) {
      if (!spoken.has(parts[2])) spoken.set(parts[2], []);
      spoken.get(parts[2]).push({ letters: parts[1], name: String(name) });
    }
  }
  const byLongForm = (core) => {
    const tokens = core.toLowerCase().split(/[\s-]+/);
    // The words before the number: letters only, and not number words.
    let k = 0;
    while (k < tokens.length && /^[a-z]+$/.test(tokens[k]) && normalizeItemName(tokens[k]) === tokens[k]) k += 1;
    const digits = normalizeItemName(tokens.slice(k).join(' '));
    if (!k || !/^\d+$/.test(digits)) return null;
    const lead = tokens.slice(0, k);
    const fits = (spoken.get(digits) || []).filter(({ letters }) => (lead.length === 1
      ? lead[0].length > letters.length && lead[0].startsWith(letters)
      : lead.every((w) => w.length >= 4) && lead.map((w) => w[0]).join('') === letters));
    return fits.length === 1 ? fits[0].name : null;
  };
  const words = String(text || '').split(/(\s+)/);
  if (!known.size) return String(text || '');
  const out = [];
  for (let i = 0; i < words.length;) {
    if (/^\s+$/.test(words[i]) || !words[i]) { out.push(words[i]); i += 1; continue; }
    let hit = null;
    // Up to five words ("d one eighteen", "fire alarm two oh four"), longest first.
    for (let n = 5; n >= 1 && !hit; n -= 1) {
      const end = i + (n - 1) * 2;
      if (end >= words.length) continue;
      const span = words.slice(i, end + 1).join('');
      const core = span.replace(/^[^\w]+|[^\w]+$/g, '');
      const key = normalizeItemName(core);
      // Spelled letters heard as one word: "F A 204" written "EFA 204".
      const spelled = key.match(/^e([flmnsx][a-z]+\d+)$/)?.[1];
      const name = known.get(key) || (spelled && known.get(spelled)) || byLongForm(core);
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
