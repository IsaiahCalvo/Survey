// Survey templates link their Categories to the Kal Voe suite library as they
// save (KAL-585, Nightly flag 'suite'). Matches are by exact name, made on the
// device and sent through the library's offline outbox, so a save never
// waits on the network. Checklists are never changed.
import { supabase } from '../supabaseClient.js';
import { linkTemplateCategories } from './libraryModel.js';
import { libraryStoreFor } from './libraryStore.js';
import { isSuiteOn } from './suiteWords.js';

export function linkTemplatesForSave(templates, userId, { on = isSuiteOn(), store = null } = {}) {
  if (!on || !userId || !Array.isArray(templates)) return templates;
  try {
    const lib = store || libraryStoreFor(supabase, userId);
    if (!lib) return templates;
    const { entries, company } = lib.getState();
    const { templates: linked, created } = linkTemplateCategories(templates, entries, { userId, company });
    if (created.length) lib.addMany(created);
    return linked;
  } catch (err) {
    console.warn('[suite-library] template link skipped', err?.message || err);
    return templates;
  }
}

/** Load the library early (Templates opened) so a save links to known entries. */
export function warmSuiteLibrary(userId, { on = isSuiteOn() } = {}) {
  if (!on || !userId) return;
  try { libraryStoreFor(supabase, userId)?.refresh(); } catch { /* offline: the device copy is used */ }
}
