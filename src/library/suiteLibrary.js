// The app's way in to the suite library (KAL-585): one store per signed-in
// person, and the hook that saves every Survey Category into the library when
// templates are saved. Everything here is off unless the Nightly flag 'suite'
// is on.
import { isFeatureOn } from '../featureFlags.js';
import { supabase } from '../supabaseClient';
import { getMyCompany } from '../services/companyService.js';
import { libraryStoreFor } from './libraryStore.js';

export function suiteLibraryOn() {
  try { return isFeatureOn('suite'); } catch { return false; }
}

export function suiteLibraryStore(userId) {
  if (!userId || !supabase) return null;
  return libraryStoreFor({ client: supabase, userId, loadCompany: getMyCompany });
}

/**
 * Templates about to be saved, with each named Category linked to its
 * library entry (new entries are queued and sync on their own, also
 * offline). With the flag off, or signed out, the list comes back as it was.
 */
export async function linkTemplatesForSave(templates, { userId, waitMs = 3000 } = {}) {
  if (!suiteLibraryOn() || !userId || !Array.isArray(templates)) return templates;
  const store = suiteLibraryStore(userId);
  if (!store) return templates;
  try {
    // Know the company (and the entries already there) before linking, so a
    // company member's new Categories go to the Company library. Offline,
    // this gives up after a moment and links against this device's copy.
    await Promise.race([store.ready(), new Promise((resolve) => { setTimeout(resolve, waitMs); })]);
    return store.linkTemplates(templates).templates;
  } catch (err) {
    // The library must never stop a template from saving.
    console.warn('[SuiteLibrary] link skipped', err);
    return templates;
  }
}
