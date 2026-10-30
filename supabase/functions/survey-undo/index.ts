// survey-undo: the person presses "Undo" on /agent-link to take back one change
// an AI agent made through the connector.
//
// When a connector write lands, survey-mcp records the change's surgical
// before-state in the agent_change table (see #1113). This function reverses one
// such row AS THE PERSON: it loads the document's Yjs annotation doc (snapshot +
// WAL tail, exactly as the app does), applies the shared undo descriptor, and
// appends the diff with append_annotation_update on the PERSON's own token. So:
//   - It is the person's own action, not an agent's — there is NO connector-writes
//     flag gate here. The only gate is the append RPC's editor RLS (the person
//     must still have edit rights on that document), which is the real backstop.
//   - It runs the ONE shared surgical apply (surveyUndoApply.js), the same code
//     survey-mcp's undo_change tool uses, so an answer changed afterwards, or the
//     note edited since, survives the undo.
// It then stamps agent_change.undone_at so the row shows as undone and can't be
// undone twice.
//
// Plain HTTP POST { change_id: <agent_change row id> }, Bearer <person jwt>.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.8';
import * as Y from 'npm:yjs@13.6.30';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../_shared/surveyMarkerDocSync.js';
import { bytesToPgHex, pgHexToBytes } from '../_shared/pgBytea.js';
import { applyUndoDescriptor, UNDO_KINDS } from '../_shared/surveyUndoApply.js';
import { parseBody, s } from '../_shared/inputSchema.js';
import { GUEST_REFUSED_MESSAGE, isGuestUser } from '../_shared/guestSession.js';

const MARKER_FIELDS_FLAG = 'survey-marker-fields';
const SNAPSHOT_ENC_GZIP = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  // Same Bearer-token API shape as survey-mcp; the page calls with the person's
  // JWT, never cookies. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const json = (status: number, body: unknown) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
);

// gunzip a snapshot stored with encoding_version = 2.
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const chunk = new Uint8Array(bytes.length);
  chunk.set(bytes);
  writer.write(chunk);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// Rebuild the document's Yjs annotation doc from its snapshot + WAL tail — the
// same load the app and survey-mcp do (annotationDocSync.js): apply the
// snapshot, then replay every annotation_updates row with a higher seq, in
// order. (Kept in step with the copy in survey-mcp/index.ts.)
async function loadAnnotationDoc(db: SupabaseClient, documentId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const { data: snap, error: snapErr } = await db.from('annotation_snapshots')
    .select('snapshot, at_seq, encoding_version').eq('document_id', documentId).maybeSingle();
  if (snapErr) throw new Error('load snapshot');
  let fromSeq = 0;
  if (snap?.snapshot) {
    let bytes = pgHexToBytes(snap.snapshot);
    if (Number(snap.encoding_version) === SNAPSHOT_ENC_GZIP) bytes = await gunzip(bytes);
    Y.applyUpdate(doc, bytes);
    fromSeq = Number(snap.at_seq) || 0;
  }
  const PAGE = 1000;
  for (;;) {
    const { data: rows, error } = await db.from('annotation_updates')
      .select('seq, data').eq('document_id', documentId).gt('seq', fromSeq)
      .order('seq', { ascending: true }).limit(PAGE);
    if (error) throw new Error('load updates');
    if (!rows || rows.length === 0) break;
    for (const row of rows) {
      Y.applyUpdate(doc, pgHexToBytes(row.data as string));
      fromSeq = Math.max(fromSeq, Number(row.seq));
    }
    if (rows.length < PAGE) break;
  }
  return doc;
}

// Apply the reversal to the markers dict and append the diff to the WAL as the
// person. Mirrors survey-mcp's writeMarkers: unchanged markers stay (no key is
// omitted), only the touched marker emits an op, and an open client merges it.
async function writeMarkers(
  db: SupabaseClient,
  documentId: string,
  mutate: (markers: Record<string, Record<string, unknown>>) => void,
  fieldMaps: boolean,
): Promise<{ changed: boolean }> {
  const doc = await loadAnnotationDoc(db, documentId);
  const markers = docToSurveyMarkers(doc) as Record<string, Record<string, unknown>>;
  mutate(markers);
  const before = Y.encodeStateVector(doc);
  const res = syncSurveyMarkersToDoc(doc, markers, { origin: 'agent', fieldMaps });
  if (!res.added && !res.updated && !res.removed) return { changed: false };
  const update = Y.encodeStateAsUpdate(doc, before);
  const { error } = await db.rpc('append_annotation_update', {
    p_document_id: documentId,
    p_client_id: `undo-${crypto.randomUUID()}`,
    p_client_seq: 1,
    p_data: bytesToPgHex(update),
  });
  if (error) {
    const msg = String(error.message || '');
    if (error.code === '42501' || /not permitted|editor|locked/i.test(msg)) {
      throw new Error('no_edit');
    }
    throw new Error('append');
  }
  return { changed: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'sign_in_required' });
  const db = createClient(supabaseUrl(), Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return json(401, { error: 'sign_in_required' });
  if (isGuestUser(userData.user)) return json(403, { error: 'guest_not_allowed' });

  let raw: unknown;
  try { raw = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
  const parsed = parseBody({ change_id: s.string({ max: 64 }) }, raw as Record<string, unknown>);
  if (!parsed.ok) return json(400, { error: 'bad_request' });
  const changeId = String(parsed.value.change_id || '');
  if (!UUID.test(changeId)) return json(400, { error: 'bad_change_id' });

  // Read the recorded change. RLS lets the person read only their OWN rows, and
  // only from a non-agent session — so an agent token cannot reach this.
  const { data: row, error } = await db.from('agent_change')
    .select('document_id, kind, payload, undone_at').eq('id', changeId).maybeSingle();
  if (error) return json(500, { error: 'lookup_failed' });
  if (!row) return json(404, { error: 'not_found' });
  if (row.undone_at) return json(200, { ok: true, changed: false, already_undone: true });

  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  const documentId = String(row.document_id || '');
  if (!UUID.test(documentId) || !UNDO_KINDS.has(String(payload.kind || row.kind || ''))) {
    return json(422, { error: 'cannot_undo' });
  }

  // The write must match the person's current marker shape (per-field vs
  // whole-value), the same as the connector write did.
  let fieldMaps = false;
  try {
    const { data: flags } = await db.rpc('get_my_feature_flags', {}, { get: true });
    fieldMaps = (flags as Record<string, boolean> | null)?.[MARKER_FIELDS_FLAG] === true;
  } catch { /* default off */ }

  let result: { changed: boolean };
  try {
    result = await writeMarkers(db, documentId, (markers) => applyUndoDescriptor(markers, payload), fieldMaps);
  } catch (err) {
    if (String((err as Error)?.message) === 'no_edit') {
      return json(403, { error: 'no_edit' });
    }
    console.error('[survey-undo] undo failed', err);
    return json(500, { error: 'undo_failed' });
  }

  // Stamp it undone so the row shows as undone and can't be undone twice. The
  // WAL write already landed; a failure here is cosmetic, so never fail on it.
  await db.from('agent_change').update({ undone_at: new Date().toISOString() }).eq('id', changeId);

  return json(200, { ok: true, changed: result.changed });
});
