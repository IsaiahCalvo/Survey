// Reverse one connector write on a survey-markers dict, in place.
//
// Every connector write tool (set_answers, add_note, set_entity, create_item in
// survey-mcp) captures a small descriptor of ONLY the sub-fields it touched —
// the same shape that rides in a change_id token and is stored in the
// agent_change table. This applies that descriptor back:
//
//   { v:1, d:<documentId>, m:<markerId>, kind, ... }
//     kind 'answers':     keys: { <checklistItemId>: <priorValue|null> }
//     kind 'note_append': seg:  <the exact text segment that was appended>
//     kind 'entity':      b:    { entityId, entityName, entityColor } (null = was unset)
//     kind 'create':      (no extra fields — undo deletes the marker it added)
//
// It is intentionally surgical: a later edit to a DIFFERENT answer, or to the
// note after the append, survives the undo. Both survey-mcp's own undo_change
// tool (the agent taking its change back) and the person-side survey-undo
// function (the person pressing Undo on /agent-link) run this one copy, so the
// two paths can never drift apart.
//
// Pure: it mutates `markers` and never touches the database. Unknown kinds throw
// so a malformed descriptor is a loud failure, not a silent no-op.

// A note can be a plain string, an object { text, media, ... }, or that object
// as a JSON string (document_annotations.notes is TEXT). Return it as an object
// so the append can be stripped from `text` while media and other fields stay.
export function noteObjectOf(note) {
  if (note && typeof note === 'object') return { ...note };
  if (typeof note === 'string' && note.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(note);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* plain text */ }
  }
  return typeof note === 'string' && note ? { text: note } : {};
}

// The kinds this module knows how to reverse. Callers validate against this set
// before loading a document, so a bad token fails fast with a friendly message.
export const UNDO_KINDS = new Set(['answers', 'note_append', 'entity', 'create']);

export function applyUndoDescriptor(markers, descriptor) {
  const u = descriptor || {};
  const id = String(u.m || '');
  const kind = String(u.kind || '');
  if (kind === 'create') { delete markers[id]; return; } // the item this change added
  const marker = markers[id];
  if (!marker) return; // already gone — nothing to put back
  if (kind === 'answers') {
    // Restore ONLY the checklist entries this change set; leave the rest (an
    // answer changed afterwards survives). null/undefined = it was unset before.
    const keys = (u.keys && typeof u.keys === 'object') ? u.keys : {};
    const responses = { ...(marker.checklistResponses || {}) };
    for (const [clId, prior] of Object.entries(keys)) {
      if (prior === null || prior === undefined) delete responses[clId];
      else responses[clId] = prior;
    }
    markers[id] = { ...marker, checklistResponses: responses };
  } else if (kind === 'note_append') {
    // Strip just the text this change appended, if the note still ends with it;
    // a note edited since is left untouched.
    const seg = String(u.seg || '');
    const obj = noteObjectOf(marker.note ?? marker.notes);
    const current = String(obj.text || '');
    if (seg && current.endsWith(seg)) {
      obj.text = current.slice(0, current.length - seg.length);
      markers[id] = { ...marker, note: obj };
    }
  } else if (kind === 'entity') {
    const before = (u.b && typeof u.b === 'object') ? u.b : {};
    const patch = {};
    for (const [k, val] of Object.entries(before)) patch[k] = val === null ? undefined : val;
    markers[id] = { ...marker, ...patch };
  } else {
    throw new Error(`Unknown undo kind: ${kind}`);
  }
}
