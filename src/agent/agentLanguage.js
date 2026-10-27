// The Survey agent speaks English only (owner 2026-10-26: "only English, not
// English and Spanish. Let's just do one for now"). This sets how the device
// and the server hear, the language the agent answers in, and the voice.
export const AGENT_LANG = 'en';

const deviceLanguage = (nav) => String(nav?.language || 'en-US');

/** The locale to hear and speak with: the device's own English (en-GB, en-AU...), else en-US. */
export function agentLocale(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const own = deviceLanguage(nav);
  return own.toLowerCase().startsWith('en-') ? own : 'en-US';
}

// What the app itself says out loud.
const SAID = {
  savedFirst: 'No signal. I saved that and will send it when you are back online.',
  savedBusy: 'That was a lot at once. I saved it and will send it in a moment.',
  saved: 'Saved.',
  sayAgain: 'Sorry, say that again?',
};
export const agentSays = (key) => SAID[key] || '';

// "Take it" / "cancel" while the camera is open.
export const SHUTTER_WORDS = /\b(take it|snap( it)?|cheese|shoot|take (the |a )?(photo|picture|pic))\b/i;
export const CANCEL_WORDS = /\b(cancel|never ?mind|no photo|close( the)? camera)\b/i;
