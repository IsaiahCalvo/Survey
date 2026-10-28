// The small part of own Excel layouts (see ownKits.js) that the template
// editor needs on every load: the copy a template carries.
import { validateExportKit } from '../../../supabase/functions/_shared/kitShape.js';

export const OWN_KIT_LIMITS = Object.freeze({ label: 60, header: 80, columns: 60, perAccount: 50 });
export const OWN_KIT_PREFIX = 'own-';

export const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The own layout a template carries for everyone who opens it: the account's
 * kits are private, so a template picking one keeps a copy of it
 * ({ label, columns }) beside its exportKitId. Null when it carries none.
 */
export function templateOwnKitOf(template) {
  const id = template?.exportKitId;
  const carried = template?.ownExportKit;
  if (typeof id !== 'string' || !id.startsWith(OWN_KIT_PREFIX) || !carried || !Array.isArray(carried.columns)) return null;
  const kit = { id, kind: 'exportKit', version: '1.0.0', minEngine: 1, label: clean(carried.label, OWN_KIT_LIMITS.label) || 'Shared layout', columns: carried.columns };
  return validateExportKit(kit).length ? null : kit;
}

/** What a template keeps of an own layout it picks (see templateOwnKitOf). */
export const ownKitCopyFor = (kit) => (kit && kit.id?.startsWith(OWN_KIT_PREFIX)
  ? { label: kit.label, columns: kit.columns.map((c) => ({ ...c })) }
  : null);
