// Manage team -> a person's "View activity": the files of one project that
// person edited, latest first. Read from document_history_events, which the
// app writes for every markup change; the database only returns rows for
// documents the viewer can open.
import { supabase } from '../supabaseClient.js';

const EVENT_SCAN_LIMIT = 2000;

// rows: [{ document_id, occurred_at }], names: Map(document id -> file name).
// One entry per file: its newest edit and how many edits were seen.
export function groupEditsByFile(rows, names) {
  const byDoc = new Map();
  for (const row of rows || []) {
    const at = Date.parse(row?.occurred_at);
    if (!row?.document_id || Number.isNaN(at)) continue;
    const cur = byDoc.get(row.document_id);
    if (cur) {
      cur.count += 1;
      if (at > cur.at) cur.at = at;
    } else {
      byDoc.set(row.document_id, { documentId: row.document_id, file: names.get(row.document_id) || 'Untitled', at, count: 1 });
    }
  }
  return [...byDoc.values()].sort((a, b) => b.at - a.at);
}

export async function listMemberProjectEdits(projectId, userId) {
  if (!supabase || !projectId || !userId) return [];
  const { data: docs, error: docError } = await supabase
    .from('documents').select('id, name').eq('project_id', projectId);
  if (docError) throw docError;
  if (!docs?.length) return [];
  const names = new Map(docs.map((d) => [d.id, d.name]));
  const { data: rows, error } = await supabase
    .from('document_history_events')
    .select('document_id, occurred_at')
    .eq('user_id', userId)
    .in('document_id', docs.map((d) => d.id))
    .order('occurred_at', { ascending: false })
    .limit(EVENT_SCAN_LIMIT);
  if (error) throw error;
  return groupEditsByFile(rows, names);
}
