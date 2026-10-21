// The device's own speech to text (the browser's SpeechRecognition), run
// beside the hands-free mic so most things said never reach Groq. It hears
// the same speech the mic cuts into clips; when a clip ends, what the device
// heard in that time is used if it is sure, and only otherwise is the clip
// sent to the server. Free, and it keeps the shared Groq allowance for the
// clips the device could not hear well.
//
// Once the device says it can't (no permission, no service, no network) it
// stays off for the session, and every clip goes to the server as before.

export const DEVICE_HEARING_MIN_CONFIDENCE = 0.7;
// How long after a clip ends to wait for the device's words; they usually
// land a few hundred ms after the speech stops.
const WAIT_MS = 1200;
// The device may time words a little before the mic's gate starts a clip.
const EARLY_MS = 400;
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

// Phones and tablets get the device's hearing through the app's own speech
// plugin instead: in mobile browsers the recognizer and the hands-free mic
// fight over the one microphone, and the mic can go silent.
export function sharesMicSafely(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  // iPadOS reports itself as a Mac with touch.
  if (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1) return false;
  return !(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());
}

export function deviceRecognition() {
  if (typeof window === 'undefined' || !sharesMicSafely()) return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Sure enough to skip the server: words, and no low confidence reported. */
export function isSureHearing(heard, minConfidence = DEVICE_HEARING_MIN_CONFIDENCE) {
  if (!heard || !String(heard.text || '').trim()) return false;
  // Some engines (Safari) report 0 when they give no score at all.
  const c = Number(heard.confidence);
  return !(c > 0 && c < minConfidence);
}

export function startDeviceHearing({ lang, Recognition = deviceRecognition(), now = () => Date.now() } = {}) {
  if (!Recognition) return null;
  const finals = [];
  const waiters = new Set();
  let running = true;
  let broken = false;
  let rec = null;

  const wake = () => { for (const w of [...waiters]) w(); };
  const begin = () => {
    rec = new Recognition();
    rec.lang = lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (!r.isFinal) continue;
        finals.push({ text: String(r[0]?.transcript || '').trim(), confidence: r[0]?.confidence, at: now() });
      }
      wake();
    };
    rec.onerror = (event) => {
      if (FATAL.has(event?.error)) { broken = true; running = false; wake(); }
    };
    // Engines stop on their own after a while: start again while wanted.
    rec.onend = () => {
      if (running && !broken) {
        try { begin(); } catch { broken = true; wake(); }
      }
    };
    rec.start();
  };
  try { begin(); } catch { return null; }

  return {
    get available() { return !broken; },
    /**
     * What the device heard during a clip that just ended (`endedAt`, lasting
     * `durationMs`): { text, confidence } or null. Words heard before the
     * clip are dropped, so the agent's own voice from earlier is never used.
     */
    heardFor(endedAt, durationMs) {
      const from = endedAt - durationMs - EARLY_MS;
      const take = () => {
        while (finals.length && finals[0].at < from) finals.shift();
        if (!finals.length) return null;
        const got = finals.splice(0);
        return {
          text: got.map((f) => f.text).filter(Boolean).join(' '),
          confidence: Math.min(...got.map((f) => (Number(f.confidence) > 0 ? Number(f.confidence) : 1))),
        };
      };
      if (broken) return Promise.resolve(null);
      const ready = take();
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve) => {
        const done = () => {
          waiters.delete(done);
          clearTimeout(timer);
          resolve(broken ? null : take());
        };
        const timer = setTimeout(done, Math.max(0, endedAt + WAIT_MS - now()));
        waiters.add(done);
      });
    },
    stop() {
      running = false;
      wake();
      try { rec?.abort?.(); } catch { /* already off */ }
    },
  };
}
