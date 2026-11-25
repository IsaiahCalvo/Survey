// Audit round 5 #15: another person's answer used to flip the one on this
// screen with no word. Changes that reach this screen from another one are
// announced on the window, and the open Survey Marker says what changed.

export const REMOTE_ANSWERS_EVENT = 'survey:remote-answers';

const selectionOf = (response) => (response && typeof response === 'object' && !Array.isArray(response)
  ? response.selection
  : response);

function stable(value) {
  if (value === undefined || value === null || value === '') return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

/** Answers that differ between two marker dicts: [{ markerId, itemId, from, to, by }]. */
export function remoteAnswerChanges(prev, next) {
  const out = [];
  if (!prev || !next || prev === next) return out;
  for (const [markerId, after] of Object.entries(next)) {
    const before = prev[markerId];
    if (!before || !after || before === after) continue;
    const a = before.checklistResponses || {};
    const b = after.checklistResponses || {};
    if (a === b) continue;
    for (const itemId of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = selectionOf(a[itemId]);
      const to = selectionOf(b[itemId]);
      if (stable(from) === stable(to)) continue;
      out.push({ markerId, itemId, from: from ?? null, to: to ?? null, by: after.changedBy || null });
    }
  }
  return out;
}

export function announceRemoteAnswers(prev, next, target = globalThis) {
  const changes = remoteAnswerChanges(prev, next);
  if (!changes.length || typeof target?.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return changes;
  try { target.dispatchEvent(new CustomEvent(REMOTE_ANSWERS_EVENT, { detail: { changes } })); } catch { /* display only */ }
  return changes;
}

function answerWords(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    const inner = value.value ?? value.text ?? value.label;
    return inner === undefined || inner === null || inner === '' ? null : String(inner);
  }
  return String(value);
}

/** "Cable run changed on another screen (CT): now Y." */
export function remoteAnswerMessage(changes, itemTextOf = () => '') {
  if (!changes?.length) return '';
  const by = changes[0].by && changes.every((c) => c.by === changes[0].by) ? ` (${changes[0].by})` : '';
  if (changes.length > 1) return `${changes.length} answers changed on another screen${by}.`;
  const [change] = changes;
  const name = String(itemTextOf(change.itemId) || '').trim() || 'An answer';
  const now = answerWords(change.to);
  return now ? `${name} changed on another screen${by}: now ${now}.` : `${name} was cleared on another screen${by}.`;
}
