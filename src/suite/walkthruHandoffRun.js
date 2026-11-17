// Walkthru walk -> Survey Project, the run (KAL-594). The pure mapping lives in
// walkthruHandoff.js; this file reads the walk from the shared database and
// writes the result with Survey's own pieces, which the caller passes in so
// the steps are testable without a browser:
//
//   addPdfToProject(file, name) -> document row   Survey's upload path (dedupes
//                                                 identical bytes, so sending a
//                                                 walk again reuses the document)
//   pageSizes(blob) -> (pageNumber) => {width, height, rotation} | null
//   openDoc(documentId) -> annotation doc handle  (openAnnotationDoc)
//   linkTemplate(documentId)                      (linkDocumentTemplates)
//   outlines(blob, nodes) -> Map(node -> polygon) tag outlines, for a job file
//                                                 (jobOutlines.js); optional
//
// Markers go into the document's live-editing doc, never document_annotations:
// those rows are only a mirror and are not read back. The full map (what the
// document already had plus the walk's markers) is written, so nothing the
// document already holds is removed.

import { buildWalkMarkers } from './walkthruHandoff.js';

const WALKTHRU_SCHEMA = 'walkthru';
const WALKTHRU_BUCKET = 'walkthrough-assets';

function walkthru(supabase) {
  return typeof supabase?.schema === 'function' ? supabase.schema(WALKTHRU_SCHEMA) : null;
}

async function rows(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the walk's ${what}: ${error.message || error}`);
  return data || [];
}

/** The walks this person can open in Walkthru, newest first. */
export async function listWalks(supabase, { limit = 50 } = {}) {
  const db = walkthru(supabase);
  if (!db) return [];
  return rows(
    db.from('walkthroughs').select('id, name, address, updated_at')
      .is('deleted_at', null).order('updated_at', { ascending: false }).limit(limit),
    'list',
  );
}

/**
 * One walk: its floors with their current PDF, its nodes and the Categories
 * they use. Only PDFs travel; an image floor is reported, not sent.
 */
export async function readWalk(supabase, walkthroughId) {
  const db = walkthru(supabase);
  if (!db) throw new Error('This copy of Survey cannot read Walkthru walks.');
  const [walks, floors, nodes] = await Promise.all([
    rows(db.from('walkthroughs').select('id, name').eq('id', walkthroughId).limit(1), 'name'),
    rows(db.from('floors').select('id, name, level_index, active_asset_id')
      .eq('walkthrough_id', walkthroughId).is('deleted_at', null).order('level_index'), 'floors'),
    rows(db.from('nodes').select('id, floor_id, page_index, x_pct, y_pct, node_type_id, title, suite_device_id, building, wing, floor_label, location')
      .eq('walkthrough_id', walkthroughId).is('deleted_at', null), 'nodes'),
  ]);
  if (!walks[0]) throw new Error('That walk was not found, or you cannot open it.');
  const assetIds = floors.map((f) => f.active_asset_id).filter(Boolean);
  const typeIds = [...new Set(nodes.map((n) => n.node_type_id).filter(Boolean))];
  const [assets, nodeTypes] = await Promise.all([
    assetIds.length
      ? rows(db.from('floor_assets').select('id, format, storage_path, original_filename').in('id', assetIds), 'drawings')
      : [],
    typeIds.length
      ? rows(db.from('node_types').select('*').in('id', typeIds), 'Categories')
      : [],
  ]);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return {
    walk: walks[0],
    nodeTypes,
    floors: floors.map((floor) => ({
      ...floor,
      asset: assetById.get(floor.active_asset_id) || null,
      nodes: nodes.filter((n) => n.floor_id === floor.id),
    })),
  };
}

function pdfName(walkName, floor, floorCount) {
  const base = String(walkName || 'Walkthru walk').trim();
  const name = floorCount > 1 && floor.name && floor.name !== base ? `${base} - ${floor.name}` : base;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/**
 * Send one walk into one Survey Project.
 * @returns {Promise<{documents: Array<{floorId:string, documentId:string, added:number, updated:number}>,
 *   added:number, updated:number, defaultNodes:number, unplaced:number,
 *   notInModule:Array<{nodeTypeId:string,name:string,count:number}>, skippedFloors:Array<{floorId:string,name:string,reason:string}>}>}
 */
export async function sendWalkToProject({
  supabase, walk, template, moduleId, categoryFor, entityId = null,
  addPdfToProject, pageSizes, openDoc, linkTemplate = null, newId, outlines = null,
  download = (path) => supabase.storage.from(WALKTHRU_BUCKET).download(path),
  now = new Date().toISOString(),
}) {
  const totals = {
    documents: [], added: 0, updated: 0, defaultNodes: 0, unplaced: 0,
    notInModule: [], skippedFloors: [],
  };
  const missing = new Map();
  const floors = walk.floors || [];

  for (const floor of floors) {
    const asset = floor.asset;
    if (!asset?.storage_path || String(asset.format || '').toLowerCase() !== 'pdf') {
      totals.skippedFloors.push({ floorId: floor.id, name: floor.name, reason: asset ? 'not a PDF' : 'no drawing' });
      // Its Category nodes are still counted, so the totals add up.
      for (const node of floor.nodes) {
        if (node.node_type_id == null) totals.defaultNodes += 1;
        else totals.unplaced += 1;
      }
      continue;
    }

    const { data: blob, error } = await download(asset.storage_path);
    if (error || !blob) throw new Error(`Could not download "${floor.name}": ${error?.message || 'no file'}`);
    const name = pdfName(walk.walk?.name, floor, floors.length);
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/pdf' }) : blob;
    const pageSize = await pageSizes(blob);
    let outlineFor = null;
    if (outlines) {
      try {
        const found = await outlines(blob, floor.nodes);
        if (found?.size) outlineFor = (node) => found.get(node) || null;
      } catch (outlineError) {
        // No outlines: the devices land as dots.
        console.warn('[suite] could not read tag outlines', outlineError);
      }
    }
    const doc = await addPdfToProject(file, name);
    if (!doc?.id) throw new Error(`Could not add "${name}" to the Project.`);

    const handle = await openDoc(doc.id);
    try {
      const existing = handle.getSurveyMarkers() || {};
      const out = buildWalkMarkers({
        nodes: floor.nodes, nodeTypes: walk.nodeTypes, template, moduleId, categoryFor,
        pageSize, existingMarkers: existing, newId, entityId, now, outlineFor,
      });
      handle.applySurveyMarkers({ ...existing, ...out.markers });
      if (typeof handle.drain === 'function') await handle.drain();
      if (typeof handle.flushSnapshot === 'function') await handle.flushSnapshot();
      totals.documents.push({ floorId: floor.id, documentId: doc.id, added: out.added, updated: out.updated });
      totals.added += out.added;
      totals.updated += out.updated;
      totals.defaultNodes += out.defaultNodes;
      totals.unplaced += out.unplaced;
      for (const m of out.notInModule) {
        const entry = missing.get(m.nodeTypeId) || { ...m, count: 0 };
        entry.count += m.count;
        missing.set(m.nodeTypeId, entry);
      }
    } finally {
      if (typeof handle.destroy === 'function') await handle.destroy();
    }
    if (linkTemplate) await linkTemplate(doc.id);
  }

  totals.notInModule = [...missing.values()];
  return totals;
}

/** Page sizes of a PDF as pdf.js shows them at scale 1 (rotation applied). */
export async function readPdfPageSizes(blob, loadPdfjs) {
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const sizes = new Map();
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      sizes.set(n, { width: viewport.width, height: viewport.height, rotation: page.rotate || 0 });
    }
  } finally {
    try { await task.destroy(); } catch { /* the sizes are already read */ }
  }
  return (pageNumber) => sizes.get(pageNumber) || null;
}
