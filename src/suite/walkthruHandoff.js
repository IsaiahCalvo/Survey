// Walkthru walk -> Survey Markers (KAL-594, suite spec KAL-584).
//
// Survey and Walkthru share one database, so Survey reads a walk's nodes from
// the `walkthru` schema and turns each node WITH a Category into a Survey
// Marker dot on the same page, at the same spot. A node with no Category (a
// "default node") stays in Walkthru. A Category that is not in the chosen
// Module is listed and counted under "Not in this Module", never dropped.
//
// Matching is plain rules, never a best guess (suite rules):
//   1. library id: the node's Category and the Module's Category point at the
//      same library entry;
//   2. else an exact name, which the user confirms before anything is written.
//
// Sending the same walk again finds each marker by its shared id (suiteId =
// walkthru.nodes.suite_device_id) and updates it in place: same marker id, its
// checklist answers, Entity and spot are kept (the field may have moved it).
//
// Spots: Walkthru stores x_pct / y_pct as fractions of the page with the PDF's
// own rotation taken out, top-left origin (Walkthru packages/shared/src/
// coords.ts). Survey stores PDF points on the page as pdf.js shows it at scale
// 1, page rotation applied, top-left origin. pageToPoint below is Walkthru's
// fromCanonical, so the two only line up when Survey has the floor's original
// PDF, unchanged.
//
// Dependency-free apart from two pure Survey helpers, so the Node tests run it
// as it is.

import { buildDotMarkerBounds, buildPolygonMarkerBounds } from '../survey/markerShapes.js';
import { resolveNextSurveyEntity } from '../survey/nextSurveyEntity.js';

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const clean = (value) => (nonEmpty(value) ? value.trim() : null);

function moduleOf(template, moduleId) {
  const modules = template?.modules || template?.spaces || template?.config?.modules || [];
  return modules.find((mod) => mod?.id === moduleId) || null;
}

function categoriesOf(mod) {
  return (mod?.categories || mod?.cats || []).filter((c) => c && c.id != null);
}

function normalizeRotation(value) {
  const r = ((Math.round(Number(value) / 90) * 90) % 360 + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/**
 * The Category Type a job file's device carries (KAL-617, KAL-618), as the
 * marker's libraryTypeEntryId: the Survey Category's Type with that library
 * id, else its Type with exactly that name, else the job file's own id.
 */
function typeLink(category, node) {
  const entryId = clean(node?.library_type_entry_id);
  const name = clean(node?.library_type_name);
  if (!entryId && !name) return {};
  const types = Array.isArray(category?.types) ? category.types : [];
  const byId = entryId ? types.find((t) => clean(t?.libraryEntryId) === entryId) : null;
  const byName = !byId && name ? types.find((t) => clean(t?.name) === name) : null;
  const id = clean(byId?.libraryEntryId) || clean(byName?.libraryEntryId) || entryId;
  return id ? { libraryTypeEntryId: id } : {};
}

/**
 * A Walkthru spot (fractions of the unrotated page) as a point on the page as
 * Survey shows it. `page` is the pdf.js viewport at scale 1: its width and
 * height already include the page's own rotation.
 * @returns {[number, number] | null}
 */
export function pageToPoint(xPct, yPct, page) {
  const x = Number(xPct);
  const y = Number(yPct);
  const w = Number(page?.width);
  const h = Number(page?.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const rotation = normalizeRotation(page?.rotation);
  const sideways = rotation === 90 || rotation === 270;
  const natW = sideways ? h : w;
  const natH = sideways ? w : h;
  const nx = Math.min(Math.max(x, 0), 1) * natW;
  const ny = Math.min(Math.max(y, 0), 1) * natH;
  switch (rotation) {
    case 90: return [natH - ny, nx];
    case 180: return [natW - nx, natH - ny];
    case 270: return [ny, natW - nx];
    default: return [nx, ny];
  }
}

/**
 * How each Walkthru Category maps onto the chosen Module.
 * @param {Array<{id:string,name:string,library_entry_id?:string|null}>} nodeTypes
 *   only the Categories the walk's nodes use
 * @returns {{
 *   linked: Record<string,string>,
 *   nameMatches: Array<{nodeTypeId:string,categoryId:string,name:string}>,
 *   missing: Array<{nodeTypeId:string,name:string}>
 * }} linked = by library id (ready); nameMatches = same exact name, waiting
 *   for the user to confirm; missing = not in this Module.
 */
export function matchCategories(nodeTypes, template, moduleId) {
  const categories = categoriesOf(moduleOf(template, moduleId));
  const linked = {};
  const nameMatches = [];
  const missing = [];
  for (const type of nodeTypes || []) {
    if (!type || type.id == null) continue;
    const libraryId = clean(type.library_entry_id ?? type.libraryEntryId);
    const byLibrary = libraryId ? categories.find((c) => clean(c.libraryEntryId) === libraryId) : null;
    if (byLibrary) {
      linked[type.id] = byLibrary.id;
      continue;
    }
    const name = clean(type.name) || '';
    const byName = name ? categories.find((c) => clean(c.name) === name) : null;
    if (byName) nameMatches.push({ nodeTypeId: type.id, categoryId: byName.id, name });
    else missing.push({ nodeTypeId: type.id, name });
  }
  return { linked, nameMatches, missing };
}

/**
 * The Survey Markers a walk becomes in one Survey document.
 *
 * @param {object} input
 * @param {Array<object>} input.nodes  walkthru.nodes rows for ONE floor PDF
 *   (page_index, x_pct, y_pct, node_type_id, title, suite_device_id,
 *   building, wing, floor_label, location)
 * @param {Array<object>} input.nodeTypes  walkthru.node_types rows
 * @param {object} input.template  the Survey template (modules, entities)
 * @param {string} input.moduleId
 * @param {Record<string,string>} input.categoryFor  node_type id -> Survey
 *   category id: the `linked` matches plus the name matches the user confirmed
 * @param {(pageNumber:number) => ({width:number,height:number,rotation?:number}|null)} input.pageSize
 * @param {Record<string,object>} [input.existingMarkers]  the document's
 *   surveyMarkers map, so a resend updates instead of copying
 * @param {() => string} input.newId
 * @param {string|null} [input.entityId]  the Entity new markers start with,
 *   when it is still in the template (else the template's first)
 * @param {string} [input.now]  ISO time stamp
 * @param {(node:object) => object|null} [input.outlineFor]  a tag outline
 *   (polygon, page units) for a node, from a job file (jobOutlines.js); a
 *   node without one lands as a dot
 * @returns {{
 *   markers: Record<string,object>,
 *   added: number, updated: number, defaultNodes: number,
 *   notInModule: Array<{nodeTypeId:string,name:string,count:number}>,
 *   unplaced: number
 * }}
 */
// What a marker from a job file looked like when it arrived (KAL-758): the
// sender's page, spot and words, the page size it was placed with, and the
// middle of the marker then. A send back compares the marker now with this.
function originOf(node, page, bounds) {
  const round = (n) => Math.round(Number(n) * 100) / 100;
  return {
    pageId: clean(node.origin_page_id),
    x: fractionOrNull(node.x_pct),
    y: fractionOrNull(node.y_pct),
    tag: clean(node.title),
    location: clean(node.location),
    page: { width: round(page.width), height: round(page.height), rotation: normalizeRotation(page.rotation) },
    center: { x: round(bounds.x + bounds.width / 2), y: round(bounds.y + bounds.height / 2) },
  };
}
const fractionOrNull = (value) => {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
};

const WALK_EDITABLE_FIELDS = ['name', 'building', 'wing', 'floor', 'location'];

function walkBaselineOf(fromWalk) {
  return {
    name: clean(fromWalk.name),
    building: clean(fromWalk.building),
    wing: clean(fromWalk.wing),
    floor: clean(fromWalk.floor),
    location: clean(fromWalk.location),
  };
}

function mergeFieldEditedText(priorMarker, fromWalk) {
  const priorBaseline = priorMarker.suiteWalkBaseline && typeof priorMarker.suiteWalkBaseline === 'object'
    ? priorMarker.suiteWalkBaseline
    : null;
  const origin = priorMarker.suiteOrigin && typeof priorMarker.suiteOrigin === 'object'
    ? priorMarker.suiteOrigin
    : null;
  const merged = {};
  const nextBaseline = {};

  for (const field of WALK_EDITABLE_FIELDS) {
    const incoming = fromWalk[field];
    const current = priorMarker[field];
    const hasStoredBaseline = Boolean(priorBaseline && Object.prototype.hasOwnProperty.call(priorBaseline, field));
    const hasOriginFallback = !hasStoredBaseline && origin && (field === 'name' || field === 'location');

    if (hasStoredBaseline || hasOriginFallback) {
      const baseValue = hasStoredBaseline
        ? clean(priorBaseline[field])
        : clean(field === 'name' ? origin.tag : origin.location);
      const fieldEdited = clean(current) !== baseValue;
      merged[field] = fieldEdited ? current : incoming;
      nextBaseline[field] = fieldEdited ? baseValue : clean(incoming);
    } else if (nonEmpty(current)) {
      // Legacy marker created before suiteWalkBaseline existed: never clobber a
      // non-empty Tag or place value already sitting on the marker.
      merged[field] = current;
      nextBaseline[field] = clean(incoming);
    } else {
      merged[field] = incoming;
      nextBaseline[field] = clean(incoming);
    }
  }

  return { merged, suiteWalkBaseline: nextBaseline };
}

export function buildWalkMarkers(input) {
  const {
    nodes = [], nodeTypes = [], template, moduleId, categoryFor = {},
    pageSize, existingMarkers = {}, newId, entityId = null,
    now = new Date().toISOString(), outlineFor = null,
  } = input || {};
  const typeById = new Map((nodeTypes || []).map((t) => [t.id, t]));
  const categoryById = new Map(categoriesOf(moduleOf(template, moduleId)).map((c) => [c.id, c]));
  const entity = resolveNextSurveyEntity(template?.entities, entityId);

  // A copied node keeps its shared id, so one id can sit on several markers:
  // each node takes the next unused marker with its id, in order.
  const bySuiteId = new Map();
  for (const [key, marker] of Object.entries(existingMarkers || {})) {
    if (!marker || !nonEmpty(marker.suiteId)) continue;
    const list = bySuiteId.get(marker.suiteId) || [];
    list.push({ key, marker });
    bySuiteId.set(marker.suiteId, list);
  }

  const markers = {};
  const missing = new Map();
  let added = 0;
  let updated = 0;
  let defaultNodes = 0;
  let unplaced = 0;

  for (const node of nodes || []) {
    if (!node) continue;
    if (node.node_type_id == null) { defaultNodes += 1; continue; }
    const type = typeById.get(node.node_type_id);
    const categoryId = categoryFor[node.node_type_id];
    const category = categoryId != null ? categoryById.get(categoryId) : null;
    if (!category) {
      const entry = missing.get(node.node_type_id) || {
        nodeTypeId: node.node_type_id, name: clean(type?.name) || '', count: 0,
      };
      entry.count += 1;
      missing.set(node.node_type_id, entry);
      continue;
    }

    const suiteId = clean(node.suite_device_id) || (node.id != null ? String(node.id) : null);
    const pageNumber = Number.isInteger(node.page_index) ? node.page_index + 1 : null;
    const page = pageNumber ? pageSize?.(pageNumber) : null;
    const point = page ? pageToPoint(node.x_pct, node.y_pct, page) : null;
    const outline = point && outlineFor ? outlineFor(node) : null;
    const shortSide = page ? Math.min(Number(page.width) || 0, Number(page.height) || 0) : 0;
    const dotWidth = shortSide > 800
      ? Math.max(12, Math.min(48, Math.round(shortSide * 0.025)))
      : undefined;
    const bounds = point
      ? ((outline && buildPolygonMarkerBounds(outline))
        || buildDotMarkerBounds(point, dotWidth ? { width: dotWidth } : undefined))
      : null;

    const fromWalk = {
      name: clean(node.title) || category.name || '',
      categoryId: category.id,
      moduleId,
      suiteId,
      libraryEntryId: clean(category.libraryEntryId) || clean(type?.library_entry_id) || null,
      ...typeLink(category, node),
      building: clean(node.building),
      wing: clean(node.wing),
      floor: clean(node.floor_label),
      location: clean(node.location),
      changedDate: now,
    };

    const prior = suiteId ? (bySuiteId.get(suiteId) || []).shift() : null;
    if (prior) {
      // Keep what the field has done: answers, Entity, note, spot, and any
      // Tag or place fields edited in Survey (#1593).
      const keepSpot = prior.marker.bounds && prior.marker.pageNumber != null;
      const { merged, suiteWalkBaseline } = mergeFieldEditedText(prior.marker, fromWalk);
      markers[prior.key] = {
        ...prior.marker,
        ...fromWalk,
        ...merged,
        suiteWalkBaseline,
        checklistResponses: prior.marker.checklistResponses || {},
        pageNumber: keepSpot ? prior.marker.pageNumber : (bounds ? pageNumber : prior.marker.pageNumber ?? null),
        bounds: keepSpot ? prior.marker.bounds : (bounds || prior.marker.bounds || null),
      };
      updated += 1;
      continue;
    }

    const id = newId();
    if (!bounds) unplaced += 1;
    markers[id] = {
      id,
      ...fromWalk,
      suiteWalkBaseline: walkBaselineOf(fromWalk),
      checklistResponses: {},
      entityId: entity?.id ?? null,
      entityName: entity?.name ?? null,
      entityColor: entity?.color ?? null,
      color: entity?.color ?? null,
      note: {},
      changedBy: '',
      pageNumber: bounds ? pageNumber : null,
      bounds: bounds || null,
      ...(bounds && clean(node.origin_page_id) ? { suiteOrigin: originOf(node, page, bounds) } : {}),
    };
    added += 1;
  }

  return {
    markers,
    added,
    updated,
    defaultNodes,
    unplaced,
    notInModule: [...missing.values()],
  };
}
