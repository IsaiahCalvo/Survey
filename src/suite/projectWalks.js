// Walkthru walks inside a Survey Project (KAL-595, Nightly flag 'suite').
//
// "Add a Walkthru walk" (KAL-594) records the walk on the Project in
// public.project_walkthroughs. The Project then shows a Walkthru tab: each walk
// with its photos, audio, video, notes and next actions, read only, and a link
// that opens the whole walk in Walkthru's read-only viewer. Everyone in the
// Project can read it, whether or not they can open the walk in Walkthru: the
// two database functions below check the Project, not the walk.

import { walkthruAppUrl } from './suiteApps.js';

export const PROJECT_WALKS_EVENT = 'survey:project-walks-changed';

/** Remember that a walk went into a Project (sending it again just touches it). */
export async function recordProjectWalk(supabase, projectId, walkthroughId, now = new Date().toISOString()) {
  if (!supabase || !projectId || !walkthroughId) return false;
  const { error } = await supabase
    .from('project_walkthroughs')
    .upsert({ project_id: projectId, walkthrough_id: walkthroughId, updated_at: now }, { onConflict: 'project_id,walkthrough_id' });
  if (error) throw new Error(`Could not add the walk to the Project: ${error.message || error}`);
  return true;
}

export function announceProjectWalks(projectId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROJECT_WALKS_EVENT, { detail: { projectId } }));
}

/** The walks of one Project, newest added first, with what each holds. */
export async function listProjectWalks(supabase, projectId) {
  if (!supabase || !projectId) return [];
  const { data, error } = await supabase.rpc('list_project_walkthroughs', { p_project_id: projectId });
  if (error) throw new Error(error.message || String(error));
  return (data || []).map((row) => ({
    id: row.walkthrough_id,
    name: row.name || 'Walkthru walk',
    address: row.address || '',
    updatedAt: row.updated_at || null,
    addedAt: row.added_at || null,
    counts: {
      floors: row.floors || 0,
      nodes: row.nodes || 0,
      plainNodes: row.plain_nodes || 0,
      photos: row.photos || 0,
      videos: row.videos || 0,
      audio: row.audio || 0,
      notes: row.notes || 0,
      nextActions: row.next_actions || 0,
    },
  }));
}

/** One walk's read-only bundle (the same shape a Walkthru share link reads). */
export async function readProjectWalk(supabase, projectId, walkthroughId) {
  const db = typeof supabase?.schema === 'function' ? supabase.schema('walkthru') : null;
  if (!db) throw new Error('This copy of Survey cannot read Walkthru walks.');
  const { data, error } = await db.rpc('get_project_walkthrough', {
    p_project_id: projectId,
    p_walkthrough_id: walkthroughId,
  });
  if (error) throw new Error(error.message || String(error));
  const row = Array.isArray(data) ? data[0] : data;
  return row?.walkthrough ? row : null;
}

const asList = (value) => (Array.isArray(value) ? value : []);

function nodeLabel(nodesById, nodeId) {
  const node = nodeId ? nodesById.get(nodeId) : null;
  const title = String(node?.title || '').trim();
  return title || null;
}

function recordingLabel(recording, index, total) {
  return total > 1 ? `Recording ${total - index}` : 'Recording';
}

/**
 * The walk sorted into the tab's folders. Pure: dates stay as given, the
 * panel formats them.
 * @returns {{photos:Array, video:Array, audio:Array, notes:Array, nextActions:Array}}
 */
export function projectWalkFolders(bundle) {
  const nodes = asList(bundle?.nodes);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const media = asList(bundle?.media_assets);
  const byKind = (kind) => media
    .filter((m) => m?.kind === kind)
    .map((m) => ({ id: m.id, node: nodeLabel(nodesById, m.node_id), capturedAtMs: m.captured_at_ms ?? null }));
  const recordings = asList(bundle?.audio_recordings);
  return {
    photos: byKind('photo'),
    video: byKind('video'),
    audio: recordings.map((r, i) => ({
      id: r.id,
      label: recordingLabel(r, i, recordings.length),
      startedAt: r.started_at || null,
      durationMs: r.duration_ms ?? null,
    })),
    notes: asList(bundle?.notes)
      .filter((n) => String(n?.text || '').trim())
      .map((n) => ({ id: n.id, text: String(n.text).trim(), node: nodeLabel(nodesById, n.node_id), updatedAt: n.updated_at || null })),
    nextActions: asList(bundle?.action_items)
      .filter((a) => String(a?.title || '').trim())
      .map((a) => ({ id: a.id, title: String(a.title).trim(), done: a.status === 'done' || a.status === 'completed' })),
  };
}

/** Where the walk opens: Walkthru's read-only viewer for Project members. */
export function projectWalkUrl(channel, projectId, walkthroughId) {
  return `${walkthruAppUrl(channel)}/survey-projects/${encodeURIComponent(projectId)}/walks/${encodeURIComponent(walkthroughId)}`;
}

/** "3:05" from milliseconds; '' when unknown. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
