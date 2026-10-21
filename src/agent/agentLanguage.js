// The Survey agent's language: English or Spanish (many crews speak it).
// It sets how the device and the server hear, the language the agent
// answers in, and the voice. Picked in the chat, remembered per device;
// the first time it follows the device's language.
export const AGENT_LANG_KEY = 'survey.agent.lang';
export const AGENT_LANGS = Object.freeze({
  en: { label: 'English', short: 'EN', locale: 'en-US' },
  es: { label: 'Español', short: 'ES', locale: 'es-US' },
});

const deviceLanguage = (nav) => String(nav?.language || 'en-US');

export function readAgentLang({ storage = safeStorage(), nav = typeof navigator !== 'undefined' ? navigator : null } = {}) {
  let saved = null;
  try { saved = storage?.getItem(AGENT_LANG_KEY); } catch { /* storage blocked */ }
  if (saved && AGENT_LANGS[saved]) return saved;
  return deviceLanguage(nav).toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function writeAgentLang(lang, { storage = safeStorage() } = {}) {
  try { storage?.setItem(AGENT_LANG_KEY, lang); } catch { /* storage blocked */ }
}

/** The locale to hear and speak with: the device's own if it is that language. */
export function agentLocale(lang, nav = typeof navigator !== 'undefined' ? navigator : null) {
  const own = deviceLanguage(nav);
  return own.toLowerCase().startsWith(`${lang}-`) ? own : (AGENT_LANGS[lang] || AGENT_LANGS.en).locale;
}

// What the app itself says out loud (the agent's own replies come back in
// the chosen language from the model).
const SAID = {
  en: {
    savedFirst: 'No signal. I saved that and will send it when you are back online.',
    savedBusy: 'That was a lot at once. I saved it and will send it in a moment.',
    saved: 'Saved.',
  },
  es: {
    savedFirst: 'No hay señal. Lo guardé y lo enviaré cuando vuelva la conexión.',
    savedBusy: 'Fue mucho a la vez. Lo guardé y lo enviaré en un momento.',
    saved: 'Guardado.',
  },
};
export const agentSays = (lang, key) => (SAID[lang] || SAID.en)[key] || SAID.en[key];

// "Take it" / "cancel" while the camera is open, in either language.
export const SHUTTER_WORDS = /\b(take it|snap( it)?|cheese|shoot|take (the |a )?(photo|picture|pic))\b|\b(t[oó]mala|s[aá]cala|(toma|saca) (la )?foto|foto ya|dispara)\b/i;
export const CANCEL_WORDS = /\b(cancel|never ?mind|no photo|close( the)? camera)\b|\b(cancela(r)?|olv[ií]dalo|sin foto|cierra la c[aá]mara)\b/i;

function safeStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
