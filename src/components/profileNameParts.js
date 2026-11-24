/**
 * First and last name for the Profile form.
 *
 * Accounts made by email sign-up store first_name and last_name. Accounts made
 * with Google (and older ones) store only full_name or name, so Profile said
 * "Not set" while the account button showed the person's name. When the two
 * parts are missing, split the full name: the first word, then the rest.
 */
export function profileNameParts(meta) {
  const first = String(meta?.first_name || '').trim();
  const last = String(meta?.last_name || '').trim();
  if (first || last) return { first, last };
  const full = String(meta?.full_name || meta?.name || '').trim().replace(/\s+/g, ' ');
  if (!full) return { first: '', last: '' };
  const space = full.indexOf(' ');
  return space < 0 ? { first: full, last: '' } : { first: full.slice(0, space), last: full.slice(space + 1) };
}
