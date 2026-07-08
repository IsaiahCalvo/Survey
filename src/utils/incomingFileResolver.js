// incomingFileResolver — decide what to do when a user brings a PDF into the app.
//
// Decision 6 (DECISION-BATCH-2026-07-07, locked): duplicates are recognized by
// CONTENT HASH, never by name/size guessing, and the app never silently blocks
// and never silently duplicates:
//   - identical bytes, same name      -> reuse/unarchive the existing document
//   - identical bytes, different name -> reuse + offer the new name as an alias
//   - same name, different bytes      -> ask: open existing vs upload new version
//   - otherwise                       -> new document
//
// The server is the authority for byte-identity (unique index on
// user/project/content_sha256; createDocument dedups on it). This module only
// answers the one question the server can't: "does an ACTIVE document already
// use this name in this project with different (or unknown) contents?" — the
// case that must PAUSE the upload and ask, before any row is created.

const docName = (d) => d?.name ?? d?.fileName ?? null;
const docSha = (d) => d?.content_sha256 ?? null;
const docCreated = (d) => new Date(d?.created_at ?? d?.createdAt ?? 0).getTime();
const docProject = (d) => d?.project_id ?? d?.projectId ?? null;
const isArchived = (d) => d?.archived === true;

/**
 * Find the active same-name document whose contents differ (or are unknown —
 * legacy rows without a backfilled hash count as "unknown", and unknown must
 * ask rather than silently duplicate).
 *
 * @param {{name: string, sha: string, projectId: string|null}} incoming
 * @param {Array<object>} existingDocs - raw document rows (any project; filtered here)
 * @returns {{kind:'proceed'} | {kind:'version-ask', doc:object}}
 */
export function resolveIncomingUpload({ name, sha, projectId = null }, existingDocs = []) {
  if (!name || !sha) return { kind: 'proceed' };
  const scope = (Array.isArray(existingDocs) ? existingDocs : []).filter(
    (d) => !isArchived(d) && docName(d) === name && (docProject(d) ?? null) === (projectId ?? null)
  );
  if (scope.length === 0) return { kind: 'proceed' };

  // Same name + identical bytes -> let the server-side dedup reuse it.
  if (scope.some((d) => docSha(d) === sha)) return { kind: 'proceed' };

  // Same name, different (or unknown) bytes -> ask. Oldest copy is "the"
  // existing document the user thinks of. knownDifferent distinguishes a row
  // with a real mismatching hash from a legacy row with no hash yet — the
  // modal must not claim "contents are different" when it can't know.
  const doc = scope.slice().sort((a, b) => docCreated(a) - docCreated(b))[0];
  return { kind: 'version-ask', doc, knownDifferent: docSha(doc) !== null };
}

/**
 * After createDocument resolved/deduped the row: did the user's file come back
 * as an existing document under a DIFFERENT name? Then offer an alias
 * (decision 6). Requires the aliases column to exist on the returned row so a
 * client running ahead of the migration can't issue a failing update.
 *
 * @param {object} resolvedDoc - the row returned by createDocument
 * @param {{name: string, sha: string}} incoming
 * @returns {boolean}
 */
export function shouldOfferAlias(resolvedDoc, { name, sha }) {
  if (!resolvedDoc || !name || !sha) return false;
  if (docSha(resolvedDoc) !== sha) return false;
  if (!('name_aliases' in resolvedDoc)) return false;
  const known = [resolvedDoc.name, ...(resolvedDoc.name_aliases || [])];
  return !known.includes(name);
}

/**
 * Returns a non-colliding display name by appending " (n)" before the extension,
 * the way desktop operating systems do ("Report.pdf" -> "Report (1).pdf").
 * @param {string} name
 * @param {Iterable<string>} existingNames
 * @returns {string}
 */
export function nextAvailableName(name, existingNames = []) {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
