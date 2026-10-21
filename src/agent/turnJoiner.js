// One thing said is one message. The mic cuts a clip at every short pause,
// and people pause mid-thought ("D-117... is installed... no power"), so
// clips that follow each other closely are joined: a turn goes out only
// after the person has been quiet for a moment (graceMs) after the last
// clip. Each clip is heard (turned into words) as soon as it is cut, so
// the wait mostly overlaps hearing.

export const TURN_GRACE_MS = 1000;

/**
 * onTurn(parts) gets the parts of one turn, in order, each what add() was
 * given with its `text` promise settled.
 */
export function createTurnJoiner({ onTurn, graceMs = TURN_GRACE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let parts = [];
  let timer = null;
  let hearing = false;
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const flush = async () => {
    stopTimer();
    if (!parts.length) return;
    const taken = parts;
    parts = [];
    const texts = await Promise.all(taken.map((p) => Promise.resolve(p.text).catch(() => '')));
    onTurn(taken.map((p, i) => ({ ...p, text: texts[i] })));
  };
  const wait = () => {
    stopTimer();
    if (!hearing && parts.length) timer = setTimer(flush, graceMs);
  };
  return {
    /** A clip was cut (or words came in): { text: string | Promise, ... }. */
    add(part) { parts.push(part); wait(); },
    /** The person started (true) or stopped (false) talking. */
    hearing(on) { hearing = Boolean(on); if (hearing) stopTimer(); else wait(); },
    /** Send what is held now (the person stopped hands-free). */
    flush,
    /** Drop what is held. */
    clear() { stopTimer(); parts = []; },
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
