/* Documents preview "Team": the document's owner (uploader) first, then its
 * active collaborators, one row per person. Rows come from
 * getDocumentCollaborators (document_collaborators, which carries `email`).
 * Tests: tests/documentTeam.test.mjs.
 */

const nameOf = (person) => person?.name || person?.user_metadata?.full_name
  || (person?.email ? String(person.email).split('@')[0] : '');

export function documentTeamRows(doc, collaborators, currentUser) {
  const rows = [];
  const seen = new Set();
  const list = Array.isArray(collaborators) ? collaborators : [];
  const ownerId = doc?.user_id || null;
  if (ownerId) {
    const ownerRow = list.find((c) => c?.user_id === ownerId);
    const isMe = currentUser?.id && currentUser.id === ownerId;
    const name = (isMe ? nameOf(currentUser) : '') || nameOf(ownerRow?.user || ownerRow) || 'Owner';
    rows.push({ id: ownerId, name, role: 'owner', isMe: Boolean(isMe) });
    seen.add(ownerId);
  }
  for (const c of list) {
    const id = c?.user_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const isMe = currentUser?.id && currentUser.id === id;
    const name = (isMe ? nameOf(currentUser) : '') || nameOf(c.user || c) || 'Collaborator';
    rows.push({ id, name, role: String(c.role || 'viewer').toLowerCase(), isMe: Boolean(isMe) });
  }
  return rows;
}
