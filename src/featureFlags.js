// src/featureFlags.js — one switch board for unfinished features.
//
// New work ships in the code but stays hidden until its flag is on. A flag is
// on for this browser when the first of these that answers says so:
//   1. localStorage 'survey.flag.<key>' = '1' / '0' (or the flag's older key)
//   2. the nightly build (VITE_RELEASE_CHANNEL=nightly) turns every flag on
//   3. a build-wide env var, where the flag has one
//   4. the server's answer for this person, saved from the last load
//      (feature_flags table: off, testers only, or on for everyone)
//   5. default: off
// Features read their flag once at load, so a change made at /flags shows on
// the next reload. To add a flag: add it here and insert its row in a
// migration (see supabase/migrations/20261021030000_feature_flags.sql).

export const FEATURE_FLAGS = Object.freeze({
  'smart-fill': Object.freeze({
    label: 'Smart fill',
    legacyKey: 'SMART_FILL_BETA',
    env: 'VITE_ENABLE_SMART_FILL',
  }),
  'survey-agent': Object.freeze({
    label: 'Survey agent',
    legacyKey: 'SURVEY_AGENT_BETA',
    env: 'VITE_ENABLE_SURVEY_AGENT',
  }),
  'annotation-agent': Object.freeze({
    label: 'Agent annotation writes',
    env: 'VITE_ENABLE_ANNOTATION_AGENT',
  }),
  'survey-connector-writes': Object.freeze({
    label: 'Outside connector survey writes',
  }),
  'pro-lock': Object.freeze({
    label: 'Lock Pro features for Free plan',
  }),
  'legacy-collab-retired': Object.freeze({
    label: 'Retire the legacy collab layer (step 1)',
  }),
  'survey-marker-fields': Object.freeze({
    label: 'Survey markers merge concurrent field edits',
  }),
});

export const FLAG_OVERRIDE_PREFIX = 'survey.flag.';
export const FLAG_CACHE_KEY = 'survey.flags.server';
export const FLAGS_CHANGED_EVENT = 'survey:flags-changed';

function readEnv() {
  try {
    return import.meta.env || {};
  } catch {
    return {};
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    // Private browsing can throw on access.
    return null;
  }
}

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readCache(storage) {
  try {
    const parsed = JSON.parse(read(storage, FLAG_CACHE_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function releaseChannel(env = readEnv()) {
  return env?.VITE_RELEASE_CHANNEL === 'nightly' ? 'nightly' : 'stable';
}

export function isFeatureOn(key, { storage = safeStorage(), env = readEnv() } = {}) {
  const def = FEATURE_FLAGS[key];
  if (!def) return false;
  let own = read(storage, FLAG_OVERRIDE_PREFIX + key);
  if (own !== '1' && own !== '0' && def.legacyKey) own = read(storage, def.legacyKey);
  if (own === '1') return true;
  if (own === '0') return false;
  if (releaseChannel(env) === 'nightly') return true;
  if (def.env && env?.[def.env] === '1') return true;
  const cached = readCache(storage);
  return cached?.[key] === true;
}

// Ask the server which flags are on for whoever is signed in (or nobody) and
// save the answer for the next load. Returns true when the answer changed.
export async function refreshFeatureFlags(supabase, { storage = safeStorage() } = {}) {
  if (!supabase?.rpc) return false;
  const { data, error } = await supabase.rpc('get_my_feature_flags');
  if (error || !data || typeof data !== 'object') return false;
  const next = {};
  for (const key of Object.keys(FEATURE_FLAGS)) next[key] = data[key] === true;
  const before = JSON.stringify(readCache(storage) || {});
  const after = JSON.stringify(next);
  if (before === after) return false;
  try {
    storage?.setItem(FLAG_CACHE_KEY, after);
  } catch {
    return false;
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(FLAGS_CHANGED_EVENT, { detail: next }));
  } catch {
    // No DOM events here (tests, workers).
  }
  return true;
}

export function normalizeTesterEmails(text) {
  const list = String(text || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(list)].sort();
}
