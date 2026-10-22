// One thing said is one message. The mic cuts a clip at every short pause,
// and people pause mid-thought ("D-117... is installed... no power"), so
// clips that follow each other closely are joined: a turn goes out only
// after the person has been quiet for a moment (graceMs) after the last
// clip. Each clip is heard (turned into words) as soon as it is cut, so
// the wait mostly overlaps hearing.

// Owner 2026-10-22: still cut off mid-thought at 1 s (on top of the mic's
// own 1.1 s of quiet before it cuts a clip).
export const TURN_GRACE_MS = 1400;
// Words that leave a sentence open ("D-117 is installed and", "the",
// "um"): the turn waits this much longer, up to UNFINISHED_MAX_MS in all.
export const UNFINISHED_EXTRA_MS = 1500;
export const UNFINISHED_MAX_MS = 4500;

const OPEN_ENDINGS = new Set([
  'and', 'but', 'or', 'so', 'then', 'also', 'plus', 'because', 'with', 'without', 'to', 'for', 'of', 'on', 'in', 'at', 'by', 'from',
  'the', 'a', 'an', 'its', "it's", 'is', 'are', 'was', 'has', 'have', 'had', 'hasn\'t', 'isn\'t', 'not', 'no', 'that', 'this', 'which',
  'um', 'uh', 'umm', 'uhh', 'er', 'like', 'find',
  'y', 'e', 'el', 'la', 'de', 'que', 'con', 'pero', 'o',
]);

/** Whether heard words stop where a sentence cannot end ("... and", "the", "um"). */
export function looksUnfinished(text) {
  const words = String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (/[,;:-]$/.test(String(text).trim())) return true;
  return OPEN_ENDINGS.has(words[words.length - 1].replace(/[^a-z'áéíóúñ]/g, ''));
}

// Under the survey-agent function's 4 MiB audio limit (about 110 s of
// 16 kHz speech): a turn this big goes out before the next clip joins it.
export const TURN_MAX_BYTES = 3_500_000;

/**
 * onTurn(parts) gets the parts of one turn, in order, each what add() was
 * given with its `text` promise settled.
 */
/**
 * peek(): the words heard so far in this turn when the parts carry none yet
 * (the web mic's clips are heard once the turn goes out), for the
 * unfinished-sentence wait.
 */
export function createTurnJoiner({
  onTurn, graceMs = TURN_GRACE_MS, maxBytes = TURN_MAX_BYTES, setTimer = setTimeout, clearTimer = clearTimeout,
  peek = null, extraMs = UNFINISHED_EXTRA_MS, maxExtraMs = UNFINISHED_MAX_MS,
} = {}) {
  let parts = [];
  let timer = null;
  let hearing = false;
  let extra = 0;
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  // The newest words: the last part's own, else what peek() has heard.
  const heardSoFar = () => {
    const last = parts[parts.length - 1];
    if (typeof last?.text === 'string' && last.text.trim()) return last.text;
    try { return String(peek?.() || ''); } catch { return ''; }
  };
  // The quiet moment is over: send, unless the words so far stop mid-sentence.
  const due = () => {
    timer = null;
    if (extra < maxExtraMs && looksUnfinished(heardSoFar())) {
      extra += extraMs;
      timer = setTimer(due, extraMs);
      return undefined;
    }
    return flush();
  };
  const flush = async () => {
    stopTimer();
    if (!parts.length) return;
    const taken = parts;
    parts = [];
    extra = 0;
    const texts = await Promise.all(taken.map((p) => Promise.resolve(p.text).catch(() => '')));
    onTurn(taken.map((p, i) => ({ ...p, text: texts[i] })));
  };
  const wait = () => {
    stopTimer();
    if (!hearing && parts.length) timer = setTimer(due, graceMs);
  };
  return {
    /** A clip was cut (or words came in): { text: string | Promise, ... }. */
    add(part) {
      const size = (p) => p.clip?.size || 0;
      if (size(part) && parts.reduce((n, p) => n + size(p), size(part)) > maxBytes) flush();
      parts.push(part);
      wait();
    },
    /** The person started (true) or stopped (false) talking. */
    hearing(on) { hearing = Boolean(on); if (hearing) stopTimer(); else wait(); },
    /** Send what is held now (the person stopped hands-free). */
    flush,
    /** Drop what is held. */
    clear() { stopTimer(); parts = []; extra = 0; },
    get holding() { return parts.length; },
  };
}

/** The words of one turn: the parts' words joined, empty parts skipped. */
export function joinTurnText(parts) {
  return parts.map((p) => String(p.text || '').trim()).filter(Boolean).join(' ');
}

// A short gap between joined clips, so the words don't run together.
const JOIN_GAP_MS = 250;

/**
 * The hands-free mic's clips (16-bit mono WAV, same rate) as one WAV, so
 * the whole turn is heard in one go, with its context.
 */
export async function joinWavs(blobs) {
  if (blobs.length === 1) return blobs[0];
  const datas = await Promise.all(blobs.map(async (b) => new Uint8Array(await b.arrayBuffer())));
  const head = datas[0].slice(0, 44);
  const rate = new DataView(head.buffer).getUint32(24, true);
  const gap = Math.round((rate * JOIN_GAP_MS) / 1000) * 2;
  const pcm = datas.map((d) => d.subarray(44));
  const size = pcm.reduce((n, p) => n + p.length, 0) + gap * (pcm.length - 1);
  const out = new Uint8Array(44 + size);
  out.set(head, 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, 36 + size, true);
  view.setUint32(40, size, true);
  let at = 44;
  pcm.forEach((p, i) => { if (i) at += gap; out.set(p, at); at += p.length; });
  return new Blob([out], { type: 'audio/wav' });
}
