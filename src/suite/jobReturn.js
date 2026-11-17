// A Survey Project that came from a Plot job, sent back as a .kvjob (KAL-758,
// the Survey side of KAL-619; Nightly 'suite').
//
// Plot owns each device's Tag and spot. It reads the file Survey sends back
// and shows what the field changed as suggestions the designer accepts or
// rejects (Plot: `plot job field-changes`, docs/spec/kvjob-return.md). So the
// file is the same package Plot sent, with sourceApp "survey":
//   - each page keeps the pageId and source Plot gave it;
//   - each item keeps its suiteId and carries its Tag, Location and spot now.
//     Its spot stays Plot's own unless the Survey Marker was moved;
//   - a Survey Marker added in the field goes as a new item, on the page of
//     the job it sits on;
//   - red lines go in annotations as { kind: "markup", ... } (a pen stroke
//     with every point, an ellipse as its two box corners), points as page
//     fractions from the top left.
// Matching is by shared id only (suite rules).
//
// A marker that arrived from the job carries `suiteOrigin` (walkthruHandoff.js
// originOf): the page, spot and words it came with, the page size it was
// placed with, and the middle of the marker then. That is what tells a move
// from no move.
//
// Pure apart from jszip, so the Node tests run it as it is.

import JSZip from 'jszip';
import { JOB_FORMAT } from './jobPackage.js';
import { historyAnnotationBox } from '../utils/historyGeometry.js';

// A marker this far (page points) from where it arrived was moved.
const MOVE_PT = 1;

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const list = (value) => (Array.isArray(value) ? value : []);
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n.toFixed(5))));

function normalizeRotation(value) {
  const n = ((Math.round(Number(value) / 90) * 90) % 360 + 360) % 360;
  return Number.isFinite(n) ? n : 0;
}

/**
 * The page spot (0-1 from the top left of the page as drawn) of a point in
 * page points, for a page of this size: the reverse of pageToPoint.
 */
export function pointToPage(px, py, page) {
  const w = Number(page?.width);
  const h = Number(page?.height);
  if (![px, py, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const rotation = normalizeRotation(page?.rotation);
  const sideways = rotation === 90 || rotation === 270;
  const natW = sideways ? h : w;
  const natH = sideways ? w : h;
  let nx;
  let ny;
  switch (rotation) {
    case 90: nx = py; ny = natH - px; break;
    case 180: nx = natW - px; ny = natH - py; break;
    case 270: nx = natW - py; ny = px; break;
    default: nx = px; ny = py;
  }
  return { x: nx / natW, y: ny / natH };
}

const centerOf = (bounds) => {
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const w = Number(bounds?.width);
  const h = Number(bounds?.height);
  return [x, y, w, h].every(Number.isFinite) ? { x: x + w / 2, y: y + h / 2 } : null;
};

/** Where an arrived marker sits now, as the job's spot: Plot's own unless it moved. */
function spotNow(marker, origin) {
  const sent = { x: Number(origin.x), y: Number(origin.y) };
  if (!Number.isFinite(sent.x) || !Number.isFinite(sent.y)) return null;
  const now = centerOf(marker.bounds);
  const then = origin.center;
  if (!now || !then || Math.hypot(now.x - then.x, now.y - then.y) <= MOVE_PT) return { spot: sent, moved: false };
  // Move Plot's own spot by what the marker moved, so a marker drawn on the
  // Tag's outline still says where Plot's device point is.
  const a = pointToPage(then.x, then.y, origin.page);
  const b = pointToPage(now.x, now.y, origin.page);
  if (!a || !b) return { spot: sent, moved: false };
  return { spot: { x: clamp01(sent.x + b.x - a.x), y: clamp01(sent.y + b.y - a.y) }, moved: true };
}

/**
 * The package to send back.
 * @param {object} input
 * @param {object} input.manifest  the package.json Plot sent
 * @param {Array<{documentId?:string, markers:Record<string,object>}>} input.documents
 *   the Survey Markers of each document in the Project
 * @param {(marker:object)=>({categoryName?:string|null, typeName?:string|null}|null)} [input.libraryOf]
 *   the Category and Category Type names of a marker made in the field
 * @param {Array<object>} [input.markups]  red lines, already in the job's markup shape
 * @param {string} [input.now]
 * @returns {{ manifest: object, counts: { moved:number, retagged:number, relocated:number, added:number, unchanged:number, notInSurvey:number, markups:number, notPlaced:number } }}
 */
export function buildReturnManifest({ manifest, documents = [], libraryOf = () => null, markups = [], now = new Date().toISOString() }) {
  if (manifest?.format !== JOB_FORMAT) throw new Error('This is not a Kal Voe job file.');
  const items = list(manifest.items);
  const sentById = new Map(items.filter((i) => clean(i?.suiteId)).map((i) => [clean(i.suiteId), i]));
  const counts = { moved: 0, retagged: 0, relocated: 0, added: 0, unchanged: 0, notInSurvey: 0, markups: 0, notPlaced: 0 };

  // Each page of each document that holds an arrived marker is that job
  // page, with the size it was placed at: new markers there land on it.
  const pageOf = jobPagesOf(documents);

  const back = new Map();
  const added = [];
  for (const doc of documents) {
    for (const [key, marker] of Object.entries(doc?.markers || {})) {
      if (!marker) continue;
      const suiteId = clean(marker.suiteId) || clean(marker.id) || clean(key);
      const sent = suiteId ? sentById.get(suiteId) : null;
      if (sent) {
        // One real device: the first marker with its id speaks for it.
        if (back.has(suiteId)) continue;
        const origin = marker.suiteOrigin && marker.suiteOrigin.pageId === sent.pageId ? marker.suiteOrigin : null;
        const where = origin ? spotNow(marker, origin) : null;
        const tag = clean(marker.name) || sent.tag;
        const location = clean(marker.location);
        const item = {
          ...sent,
          tag,
          ...(where ? { position: where.spot } : {}),
        };
        if (location) item.location = location;
        else delete item.location;
        const moved = Boolean(where?.moved);
        const retagged = tag !== sent.tag;
        const relocated = (location || null) !== (clean(sent.location) || null);
        if (moved) counts.moved += 1;
        if (retagged) counts.retagged += 1;
        if (relocated) counts.relocated += 1;
        if (!moved && !retagged && !relocated) counts.unchanged += 1;
        back.set(suiteId, item);
        continue;
      }
      // Made in the field: a new device on the job page it sits on.
      if (!clean(marker.libraryEntryId) && !libraryOf(marker)?.categoryName) continue;
      const at = pageOf.get(`${doc.documentId || ''}\0${marker.pageNumber}`);
      const center = centerOf(marker.bounds);
      const spot = at && center ? pointToPage(center.x, center.y, at.page) : null;
      if (!spot) { counts.notPlaced += 1; continue; }
      const names = libraryOf(marker) || {};
      added.push({
        suiteId,
        tag: clean(marker.name) || '',
        library: {
          ...(clean(marker.libraryEntryId) ? { categoryEntryId: clean(marker.libraryEntryId) } : {}),
          ...(clean(marker.libraryTypeEntryId) ? { typeEntryId: clean(marker.libraryTypeEntryId) } : {}),
          categoryName: clean(names.categoryName) || '',
          ...(clean(names.typeName) ? { typeName: clean(names.typeName) } : {}),
        },
        pageId: at.pageId,
        position: { x: clamp01(spot.x), y: clamp01(spot.y) },
        ...(clean(marker.building) ? { building: clean(marker.building) } : {}),
        ...(clean(marker.wing) ? { wing: clean(marker.wing) } : {}),
        ...(clean(marker.floor) ? { floor: clean(marker.floor) } : {}),
        ...(clean(marker.location) ? { location: clean(marker.location) } : {}),
        mediaIds: [],
        source: { app: 'survey', nativeId: String(marker.id || key), version: 1 },
      });
      counts.added += 1;
    }
  }

  // A device Survey doesn't have (left out of the Module, say) goes back as
  // Plot sent it, so it never reads as removed.
  const outItems = items.map((item) => {
    const id = clean(item?.suiteId);
    if (id && back.has(id)) return back.get(id);
    counts.notInSurvey += 1;
    return item;
  });
  const pageIds = new Set(list(manifest.pages).map((p) => clean(p?.pageId)).filter(Boolean));
  const outMarkups = list(markups).filter((m) => m && pageIds.has(m.pageId));
  counts.markups = outMarkups.length;

  return {
    manifest: {
      ...manifest,
      sourceApp: 'survey',
      exportedAt: now,
      items: [...outItems, ...added],
      annotations: [...list(manifest.annotations), ...outMarkups],
    },
    counts,
  };
}

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const typeOf = (a) => String(a?.type || a?.data?.type || a?.pdfAnnotationType || '').toLowerCase();
const textOf = (a) => clean(a?.text) || clean(a?.data?.text) || clean(a?.contents) || null;
const colorOf = (a) => {
  const c = a?.stroke ?? a?.data?.stroke ?? a?.color ?? a?.fill;
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : null;
};

// A mark's points in page units: a line's two ends, a polyline's or
// polygon's corners, a pen stroke's path points, else its box's corners.
function markPoints(a, type) {
  const left = num(a.left);
  const top = num(a.top);
  if (Array.isArray(a.path)) {
    const sx = num(a.scaleX, 1);
    const sy = num(a.scaleY, 1);
    const offX = num(a.pathOffset?.x);
    const offY = num(a.pathOffset?.y);
    // Every point of the stroke, curves walked in a few steps, so Plot draws
    // the same freehand shape (two points would be a straight line).
    const raw = [];
    let at = null;
    const steps = 4;
    for (const seg of a.path) {
      if (!Array.isArray(seg) || seg.length < 3) continue;
      const nums = seg.slice(1).map(Number);
      if (!nums.every(Number.isFinite)) continue;
      const cmd = String(seg[0]).toUpperCase();
      if (cmd === 'Q' && at && nums.length >= 4) {
        const [cx, cy, x, y] = nums;
        for (let i = 1; i <= steps; i += 1) {
          const s = i / steps;
          const u = 1 - s;
          raw.push([u * u * at[0] + 2 * u * s * cx + s * s * x, u * u * at[1] + 2 * u * s * cy + s * s * y]);
        }
        at = [x, y];
      } else if (cmd === 'C' && at && nums.length >= 6) {
        const [c1x, c1y, c2x, c2y, x, y] = nums;
        for (let i = 1; i <= steps; i += 1) {
          const s = i / steps;
          const u = 1 - s;
          raw.push([
            u * u * u * at[0] + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s * s * s * x,
            u * u * u * at[1] + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * y,
          ]);
        }
        at = [x, y];
      } else {
        at = [nums[nums.length - 2], nums[nums.length - 1]];
        raw.push(at);
      }
    }
    return raw.map(([x, y]) => [left + sx * (x - offX), top + sy * (y - offY)]);
  }
  if (Array.isArray(a.points) && a.points.length > 1) {
    return a.points.map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p?.x), num(p?.y)]));
  }
  if ((type.includes('line') || type === 'arrow') && [a.x1, a.y1, a.x2, a.y2].every((v) => Number.isFinite(Number(v)))) {
    return [[left + num(a.x1), top + num(a.y1)], [left + num(a.x2), top + num(a.y2)]];
  }
  const box = historyAnnotationBox(a);
  if (!box || !(box.width > 0 || box.height > 0)) return [];
  // An ellipse goes as its box's two corners; Plot draws the ring.
  if (type.includes('ellipse') || type.includes('circle')) return [[box.x, box.y], [box.x + box.width, box.y + box.height]];
  return [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]];
}

function markShape(a, type) {
  if (type === 'arrow' || a?.data?.arrowEnd || a?.arrowEnd) return 'arrow';
  if (type.includes('cloud')) return 'cloud';
  if (type.includes('text') || type.includes('callout') || type.includes('note')) return 'text';
  if (type.includes('ellipse') || type.includes('circle')) return 'ellipse';
  if (type.includes('polygon')) return 'polygon';
  if (type.includes('polyline')) return 'polyline';
  if (type.includes('line')) return 'line';
  if (Array.isArray(a.path) || type.includes('pen') || type.includes('ink') || type.includes('path')) return 'pen';
  return 'rectangle';
}

/**
 * One page's red lines as the job's markup: the page's drawn marks (not
 * Survey Markers, not highlights), points as page fractions.
 * @param {Array<object>} annotations  the page's marks, in page units
 * @param {{pageId:string, page:{width:number,height:number,rotation?:number}, author?:string|null}} at
 */
export function markupsFromPage(annotations, { pageId, page, author = null }) {
  const out = [];
  for (const a of list(annotations)) {
    if (!a || a.deleted || a.hidden) continue;
    const type = typeOf(a);
    if (!type || type.includes('surveymarker') || type.includes('marker') || type.includes('highlight') || type.includes('image') || type.includes('measure')) continue;
    const shape = markShape(a, type);
    const points = markPoints(a, type)
      .map(([x, y]) => pointToPage(x, y, page))
      .filter(Boolean)
      .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
    if (!points.length) continue;
    const mark = { kind: 'markup', shape, pageId, points };
    const text = shape === 'text' || type.includes('callout') ? textOf(a) : null;
    if (text) mark.text = text;
    const color = colorOf(a);
    if (color) mark.color = color;
    const who = clean(a.author) || clean(a.data?.author) || clean(author);
    if (who) mark.author = who;
    const when = clean(a.createdAt) || clean(a.data?.createdAt);
    if (when) mark.createdAt = when;
    out.push(mark);
  }
  return out;
}

/** The job page (and the size it was placed at) each document page is, from the markers that arrived on it. */
export function jobPagesOf(documents) {
  const pages = new Map();
  for (const doc of list(documents)) {
    for (const marker of Object.values(doc?.markers || {})) {
      const origin = marker?.suiteOrigin;
      if (!origin?.pageId || !origin.page || marker.pageNumber == null) continue;
      const key = `${doc.documentId || ''}\0${marker.pageNumber}`;
      if (!pages.has(key)) pages.set(key, { documentId: doc.documentId || '', pageNumber: Number(marker.pageNumber), pageId: origin.pageId, page: origin.page });
    }
  }
  return pages;
}

/** The file to send back: the job Plot sent, with the new package.json. */
export async function writeReturnJob(zip, manifest) {
  const out = new JSZip();
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || path === 'package.json') continue;
    out.file(path, await file.async('uint8array'));
  }
  out.file('package.json', JSON.stringify(manifest, null, 2));
  return out.generateAsync({ type: typeof Blob === 'function' ? 'blob' : 'uint8array', mimeType: 'application/zip' });
}

/** A file name for the send back: "<job> field changes.kvjob". */
export function returnFileName(manifest, date = new Date()) {
  const name = clean(manifest?.job?.name) || 'Job';
  const day = date.toISOString().slice(0, 10);
  return `${name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)} field changes ${day}.kvjob`;
}
