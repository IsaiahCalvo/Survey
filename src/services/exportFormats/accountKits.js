/**
 * Load the export kits assigned to the signed-in account (public.kits +
 * public.account_kits, RLS limits rows to the user's own) into the registry.
 * Kits are data only and go through validateExportKit like built-ins; a bad
 * row is skipped, and a database kit may never replace a built-in id.
 * Returns a function that unregisters what it added.
 */
import { registerExportKit, BUILT_IN_EXPORT_KIT_IDS } from './registry.js';

export async function loadAccountExportKits(client) {
  const { data, error } = await client
    .from('account_kits')
    .select('kit_id, kit_version, kits(kind, label, definition)');
  if (error) {
    // Table missing on an older database, or offline: built-ins still work.
    console.warn('[exportKits] account kits not loaded:', error.message);
    return () => {};
  }
  const offs = [];
  for (const row of data || []) {
    const kit = row.kits;
    if (!kit || kit.kind !== 'exportKit' || BUILT_IN_EXPORT_KIT_IDS.includes(row.kit_id)) continue;
    try {
      offs.push(registerExportKit({
        label: kit.label || row.kit_id,
        ...kit.definition,
        id: row.kit_id,
        version: row.kit_version,
        kind: 'exportKit',
      }));
    } catch (err) {
      console.warn(`[exportKits] skipped ${row.kit_id}@${row.kit_version}:`, err.message);
    }
  }
  return () => offs.forEach((off) => off());
}
