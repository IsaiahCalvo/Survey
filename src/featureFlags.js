// src/featureFlags.js — one switch board for unfinished features.
//
// New work ships in the code but stays hidden until its flag is on. Each flag
// has a stage:
//   beta    - an unfinished feature. Only Survey Nightly shows it. The stable
//             app (surveytool.app) never does, whatever /flags says and even
//             for testers: Isaiah wants the app people pay for free of beta.
//   rollout - ready for stable. /flags turns it on for testers, then everyone.
// A flag is on for this browser when the first of these that answers says so:
//   0. a beta flag in a stable production build: always off
//   1. localStorage 'survey.flag.<key>' = '1' / '0' (or the flag's older key)
//   2. the nightly build (VITE_RELEASE_CHANNEL=nightly) turns every flag on
//   3. a build-wide env var, where the flag has one
//   4. the server's answer for this person, saved from the last load
//      (feature_flags table: off, testers only, or on for everyone)
//   5. default: off
// Test builds skip step 0 so tests can still turn beta flags on: dev servers
// (vite dev) and `--mode e2e` builds (the e2e harness and the native-app walks,
// which run against a throwaway local database, never production). Moving a feature to stable = change its stage to
// 'rollout' (docs/RELEASE-CHANNELS.md).
// Features read their flag once at load, so a change made at /flags shows on
// the next reload. To add a flag: add it here and insert its row in a
// migration (see supabase/migrations/20261021030000_feature_flags.sql).

export const FEATURE_FLAGS = Object.freeze({
  'smart-fill': Object.freeze({
    label: 'Smart fill',
    legacyKey: 'SMART_FILL_BETA',
    env: 'VITE_ENABLE_SMART_FILL',
    stage: 'beta',
  }),
  'survey-agent': Object.freeze({
    label: 'Survey agent',
    legacyKey: 'SURVEY_AGENT_BETA',
    env: 'VITE_ENABLE_SURVEY_AGENT',
    stage: 'beta',
  }),
  'annotation-agent': Object.freeze({
    label: 'Agent annotation writes',
    env: 'VITE_ENABLE_ANNOTATION_AGENT',
    stage: 'beta',
  }),
  // Read by the survey-mcp edge function, not the app: Claude or ChatGPT
  // connectors write only for people this flag is on for at /flags.
  'survey-connector-writes': Object.freeze({
    label: 'Outside connector survey writes',
    stage: 'beta',
  }),
  'pro-lock': Object.freeze({
    label: 'Lock Pro features for Free plan',
    stage: 'rollout',
  }),
  'legacy-collab-retired': Object.freeze({
    label: 'Retire the legacy collab layer (step 1)',
    stage: 'rollout',
  }),
  'survey-marker-fields': Object.freeze({
    label: 'Survey markers merge concurrent field edits',
    stage: 'rollout',
  }),
  'custom-answers': Object.freeze({
    label: 'Make-your-own checklist answers in templates',
    stage: 'beta',
  }),
  layers: Object.freeze({
    label: 'Layers panel (markup layers + PDF content opacity)',
    stage: 'beta',
  }),
  'pinned-tools': Object.freeze({
    label: 'Pinned tools dock (favourite tools with their own colour and width)',
    stage: 'beta',
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

function isTestBuild(env) {
  return env?.DEV === true || env?.MODE === 'e2e';
}

export function isBetaFlag(key) {
  return FEATURE_FLAGS[key]?.stage === 'beta';
}

export function isFeatureOn(key, { storage = safeStorage(), env = readEnv() } = {}) {
  const def = FEATURE_FLAGS[key];
  if (!def) return false;
  if (def.stage === 'beta' && releaseChannel(env) !== 'nightly' && !isTestBuild(env)) return false;
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
