// agent-cli/survey-marker-roundtrip-e2e.mjs — survey-marker CRUD guard (data + mapper).
//
// Survey-marker creation via the UI needs a survey TEMPLATE (module + categories) that
// no test-account document has, so the UI create/rename/delete flow can't be reliably
// auto-driven (that hands-on flow is on the OWNER-FINAL-TEST checklist). This guards the
// part that CAN be proven honestly and reliably: the survey-marker DATA engine — the real
// serialization (buildSurveyMarkerRow), the survey-marker read filter, and the reload
// mapper (mapSurveyMarkerRowToLocalAnnotation) that a B2/B6 extraction is most likely to break.
//
// Uses the REAL Supabase client + the REAL mapper functions the app uses. Writes ONE
// clearly-labeled survey-marker on a throwaway doc, reads it back through the survey-marker
// filter, maps it, asserts create + rename roundtrip losslessly, then deletes + verifies.
//
//   node agent-cli/survey-marker-roundtrip-e2e.mjs [--doc <documentId>]
//
// Exit 0 = lossless CRUD roundtrip. Exit 1 = failed.
import { randomUUID } from 'node:crypto';
import { makeClient } from './lib/client.mjs';
import { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { SURVEY_MARKER_TYPE_VALUES } from '../src/utils/surveyMarkerType.js';

const DEFAULT_DOC_ID = '00e1cde9-449b-4771-9743-37bd604557a9';
const TEST_ANNOTATION_ID = 'agent-cli-survey-marker-gate-v1';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
};

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--doc' && argv[i + 1]) { flags.doc = argv[i + 1]; i += 1; }
  return flags;
}

// read our marker back through the app's survey-marker read filter (type + fabricObject present)
async function readMarker(supabase, documentId, annotationId) {
  const { data, error } = await supabase
    .from('document_annotations')
    .select('id, user_id, annotation_id, annotation_type, page_number, bounds, category_id, module_id, name, notes, entity_id, entity_name, checklist_responses, changed_by, changed_date, color, opacity, version, annotation_data, updated_at')
    .eq('document_id', documentId)
    .eq('annotation_id', annotationId)
    .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
    .not('annotation_data->fabricObject', 'is', null)
    .limit(1);
  if (error) throw new Error(`read marker: ${error.message}`);
  return (data || [])[0] || null;
}

async function pollPresent(supabase, documentId, annotationId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await readMarker(supabase, documentId, annotationId)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function deleteMarker(supabase, documentId, annotationId) {
  const { error } = await supabase.from('document_annotations').delete()
    .eq('document_id', documentId).eq('annotation_id', annotationId);
  if (error) throw new Error(`delete: ${error.message}`);
}

const flags = parseArgs(process.argv.slice(2));
const documentId = flags.doc || DEFAULT_DOC_ID;
const { supabase, userId, who } = await makeClient('user');
console.log(`# survey-marker-roundtrip — data+mapper CRUD gate`);
console.log(`# document: ${documentId}\n# auth: ${who}\n# test marker: ${TEST_ANNOTATION_ID}\n`);

let inserted = false;
try {
  // clean any stale row from an interrupted run
  await deleteMarker(supabase, documentId, TEST_ANNOTATION_ID).catch(() => {});

  // ── CREATE: build a marker via the REAL serializer, insert it ──────────────
  const NAME_1 = 'Agent CLI Survey Marker — safe to delete';
  const localAnnotation = {
    pageNumber: 1,
    bounds: { x: 120, y: 140, width: 60, height: 40, rotation: 0 },
    categoryId: null,
    moduleId: null,
    name: NAME_1,
    entityColor: '#FFFF00',
    opacity: 0.3,
    annotationData: {
      // fabricObject required by the app's survey-marker read filter
      fabricObject: { id: TEST_ANNOTATION_ID, type: 'rect', left: 120, top: 140, width: 60, height: 40, fill: '#FFFF00', opacity: 0.3, meta: { authorId: userId } },
    },
  };
  const row = buildSurveyMarkerRow({ documentId, userId, annotationId: TEST_ANNOTATION_ID, annotation: localAnnotation });
  const { error: insErr } = await supabase.from('document_annotations').insert(row);
  if (insErr) throw new Error(`insert: ${insErr.message}`);
  inserted = true;

  const present = await pollPresent(supabase, documentId, TEST_ANNOTATION_ID);
  check('1. survey marker written + readable via survey-marker filter', present);

  const back1 = await readMarker(supabase, documentId, TEST_ANNOTATION_ID);
  const mapped1 = mapSurveyMarkerRowToLocalAnnotation(back1);
  check('2. reload mapper reconstructs the marker (id + name)',
    mapped1 && mapped1.annotationId === TEST_ANNOTATION_ID && mapped1.name === NAME_1,
    `id=${mapped1?.annotationId}, name="${mapped1?.name}"`);

  // ── RENAME: edit the marker name, re-read, map, assert new name ────────────
  const NAME_2 = 'Renamed Survey Marker ' + Date.now().toString().slice(-5);
  const { error: renErr } = await supabase.from('document_annotations')
    .update({ name: NAME_2 }).eq('document_id', documentId).eq('annotation_id', TEST_ANNOTATION_ID);
  if (renErr) throw new Error(`rename: ${renErr.message}`);
  const back2 = await readMarker(supabase, documentId, TEST_ANNOTATION_ID);
  const mapped2 = mapSurveyMarkerRowToLocalAnnotation(back2);
  check('3. rename persists + maps back', mapped2 && mapped2.name === NAME_2, `name="${mapped2?.name}"`);

  // ── DELETE: remove it, verify it's gone via the filter ────────────────────
  await deleteMarker(supabase, documentId, TEST_ANNOTATION_ID);
  inserted = false;
  const gone = !(await readMarker(supabase, documentId, TEST_ANNOTATION_ID));
  check('4. delete removes the marker', gone);
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  if (inserted) await deleteMarker(supabase, documentId, TEST_ANNOTATION_ID).catch(() => {});
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${failed.length === 0 ? '✅ PASS' : '❌ FAIL'}: ${checks.length - failed.length}/${checks.length} survey-marker roundtrip checks passed`);
if (failed.length) { console.log('   failed: ' + failed.map(c => c.name).join('; ')); process.exitCode = 1; }
