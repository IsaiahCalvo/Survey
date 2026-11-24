// The Survey agent's tools, run in the app on the open document (KAL-527).
// The model (survey-agent edge function) only asks for a tool; this file
// answers it through the Survey panel's own writes (the "bridge" the panel
// publishes), so sync, Excel rows, auto-entity and role checks behave exactly
// as if the person had tapped. Every write returns a change with an undo.
import { APP_ONLY_KINDS, answerSetFor, itemAnswerHint, itemAnswerSpec, itemKind, typedAnswer } from '../services/answerSets.js';
import { categoriesOf, checklistOf, entitiesOf, itemText, modulesOf } from '../services/templateConfigShape.js';
import { MARK_COLOR_HEX, normalizeItemName, scoreItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';
import { markBox, visiblePageBox } from './planView.js';
import { answerSetMeaning, moduleKind, moduleMeaning } from '../../supabase/functions/_shared/surveyAgentMeaning.js';
import { boundsCover, findDescribedOnPages, markerBoxAroundTag, tagShape } from './planText.js';
import { floorNumberOf, kindFromWord, parseDescribedTarget, scoreDescribedTag, templateKinds, wingLetterOf } from './spokenTag.js';
import { nearestToPlace, parsePlaceTarget } from './placeFind.js';
import { summarizeSurvey, summaryText } from '../services/surveySummary.js';
import { learnedForModel, learnedNameFor, learnedStateFor, memoryKey, rewordText } from './agentMemory.js';
import { DEFAULT_PLACEMENT, placementFromWords, placementWords } from './sheetKind.js';

export { normalizeItemName, scoreItemName };

// One add_all_from_plan call adds at most this many; the rest on asking again.
const MAX_BULK_ITEMS = 60;
// survey_status names at most this many items per group; the counts are whole.
const STATUS_LIST_MAX = 20;
// One read_scanned_pages call reads at most this many pages (seconds each).
const MAX_OCR_PAGES = 4;
// One tidy_notes call rewrites at most this many items' notes.
const MAX_TIDY_ITEMS = 300;

// "Floor 2", "level 2", "2nd floor" and "2" are one floor; "Ground" stays a word.
const floorKeyOf = (value) => {
  const text = String(value ?? '').toLowerCase().replace(/\b(floor|level|lvl|fl|storey|story)\b/g, ' ').replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
  return text.replace(/^0+(\d)/, '$1');
};

// The panel fills this while Survey mode is open (SurveySpacesRail).
export const surveyAgentBridge = { current: null };

function categoryIndex(template) {
  const byKey = new Map();
  const list = [];
  for (const module of modulesOf(template)) {
    for (const category of categoriesOf(module)) {
      const entry = { module, category };
      byKey.set(`${module.id}\0${category.id}`, entry);
      if (!byKey.has(`*\0${category.id}`)) byKey.set(`*\0${category.id}`, entry);
      list.push(entry);
    }
  }
  return { list, find: (moduleId, categoryId) => byKey.get(`${moduleId}\0${categoryId}`) || byKey.get(`*\0${categoryId}`) || null };
}

/**
 * The project's own kinds of device, from its template's categories and the
 * names of items already in them (spokenTag.templateKinds), so "smoke
 * detector 4" or "VAV 12" works for any trade, not a fixed list.
 */
export function projectKinds(b) {
  const tags = new Map();
  for (const marker of Object.values(b?.markers || {})) {
    if (!marker?.categoryId || !marker.name) continue;
    if (!tags.has(marker.categoryId)) tags.set(marker.categoryId, []);
    tags.get(marker.categoryId).push(marker.name);
  }
  return templateKinds(categoryIndex(b?.template).list.map(({ category }) => ({
    name: category.name,
    tags: tags.get(category.id) || [],
  })));
}

/**
 * The one item that clearly fits best, or null. A lone fit is enough
 * ("camera twelve" when there is one camera 12, whatever floor); with
 * others, it must be clearly the best.
 */
export function clearBest(list) {
  const [best, next] = list || [];
  if (!best) return null;
  return (next ? best.score >= 0.8 && next.score < best.score - 0.1 : best.score >= 0.6) ? best : null;
}

/**
 * Items that fit a described device ("camera 6, fourth floor"), best first.
 * An item's own floor and wing (brought from Walkthru or Plot, or typed)
 * count before the sheet title's, which a bare PDF needs. The same item in
 * several modules (same name, same page) is kept once, the open module's;
 * same-named items on other pages are separate devices.
 */
export async function describedItems(b, target) {
  const { pages = [], unreadPages = [] } = typeof b.readSheets === 'function' ? await b.readSheets() : {};
  const sheetOfPage = new Map(pages.map((p) => [p.page, p.sheet || {}]));
  const { find } = categoryIndex(b.template);
  const items = [];
  for (const [id, marker] of Object.entries(b.markers || {})) {
    if (!marker) continue;
    const entry = find(marker.moduleId, marker.categoryId);
    const sheet = sheetOfPage.get(marker.pageNumber) || {};
    const ownFloor = floorNumberOf(marker.floor);
    const ownWing = wingLetterOf(marker.wing);
    const floor = ownFloor ?? sheet.floor ?? null;
    const score = scoreDescribedTag(target, marker.name, { category: entry?.category?.name, pageFloor: floor, pageWing: ownWing ?? sheet.wing ?? null });
    if (score < 0.5) continue;
    items.push({
      id,
      name: marker.name || 'Unnamed item',
      category: entry?.category?.name || null,
      ...(entry?.module?.name ? { module: entry.module.name } : {}),
      page: marker.pageNumber || null,
      ...(ownFloor != null ? { floor: ownFloor } : sheet.floor != null ? { sheet_floor: sheet.floor } : {}),
      ...(sheet.kind ? { sheet: sheet.kind } : {}),
      score,
      here: !b.currentModuleId || marker.moduleId === b.currentModuleId,
      moduleId: marker.moduleId,
    });
  }
  items.sort((x, y) => y.score - x.score || Number(y.here) - Number(x.here) || x.name.localeCompare(y.name, undefined, { numeric: true }));
  const keptModules = new Map();
  const kept = items.filter((m) => {
    const key = `${normalizeItemName(m.name)}|${m.page}`;
    const modules = keptModules.get(key);
    if (modules && !modules.has(m.moduleId)) return false;
    keptModules.set(key, (modules || new Set()).add(m.moduleId));
    return true;
  });
  return { items: kept, pages, unreadPages };
}

// An offered line or category name: at most this many characters.
const OFFER_TEXT_MAX = 120;
// "Power at door" and "power at the door." are the same line.
const offerKey = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
const sameWords = (a, b) => offerKey(a) === offerKey(b);
const activeChecklist = (category) => checklistOf(category)
  .map((item, index) => (typeof item === 'string' ? { id: `item-${index}`, text: item } : item))
  .filter((item) => item && item.archived !== true && item.id);

// Notes come as { text, media } or, straight from the database, as that object
// in a JSON string or as plain text.
const noteObjectOf = (note) => {
  if (!note) return {};
  if (typeof note === 'string') {
    try {
      const parsed = note.trim().startsWith('{') ? JSON.parse(note) : null;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* plain text */ }
    return { text: note };
  }
  return typeof note === 'object' ? note : {};
};
const noteTextOf = (note) => String(noteObjectOf(note).text || '');
const mediaCountOf = (note) => {
  const { media } = noteObjectOf(note);
  return Array.isArray(media) ? media.length : 0;
};

const clone = (value) => (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : (value ?? null));

const out = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

class ToolError extends Error {}

// A browser agent has no file to drop, so survey_add_photo takes the image as
// base64 (optionally a data: URL). Decode it to a Blob the upload path accepts,
// and cap the size so a huge paste can't be forced through.
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
// Sniff the real image type from the first bytes. The declared MIME (from a
// data: URL) is not trusted — a caller could label any bytes image/jpeg — so
// the content itself decides, and anything we don't recognise is refused.
function sniffImageMime(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // ISO-BMFF (HEIC/HEIF, iPhone photos): "....ftyp<brand>".
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

function decodePhotoBase64(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new ToolError('No image data given.');
  // Drop a data: URL prefix if present; what follows the first comma is the
  // base64 payload. A bare base64 string is taken whole.
  const comma = raw.startsWith('data:') ? raw.indexOf(',') : -1;
  const b64 = (comma >= 0 ? raw.slice(comma + 1) : raw).replace(/\s+/g, '');
  let bytes;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } catch {
    throw new ToolError('The image data is not valid base64.');
  }
  if (!bytes.length) throw new ToolError('The image data is empty.');
  if (bytes.length > PHOTO_MAX_BYTES) {
    throw new ToolError(`The photo is too large (${Math.round(bytes.length / (1024 * 1024))}MB). The limit is ${PHOTO_MAX_BYTES / (1024 * 1024)}MB.`);
  }
  const mime = sniffImageMime(bytes);
  if (!mime) throw new ToolError('That is not a supported image (JPEG, PNG, GIF, WebP or HEIC).');
  return new Blob([bytes], { type: mime });
}

/**
 * attachments: Map of attachment id -> { file, kind, name } the person added
 * in this chat. documentId: the document the turn started on; once the person
 * opens another one, every tool refuses, so a slow reply cannot land there.
 * extraTools: more tools ({ name, execute(args) }, for example the shared
 * annotation tools), named without the WebMCP survey_ prefix here. Where they
 * take a page and a spot, near_item_id or near_plan_match_id can stand in.
 * Returns { run(name, input) -> { content, isError, change }, undo(changes) }.
 * A change is { itemId, documentId, label, fields }: each field holds the
 * value before and the value this tool wrote, so undo only reverts a field
 * nobody has changed since. Markup an extra tool added is
 * { annotationId, documentId, label }; undo deletes it through getDocument.
 */
// A plan match's sheet kind and, for a table row, its spot (sheetKind.js).
const sheetFields = (m) => ({
  ...(m.sheetKind ? { sheet: m.sheetKind } : {}),
  ...(m.spot === 'table' ? { spot: 'table row' } : {}),
});

/** The project's placement rule: the sheet kinds a device is put on. */
export function placementOf(rows) {
  const row = (rows || []).find((r) => r.kind === 'placement');
  const kinds = row ? placementFromWords(row.means) : [];
  return { kinds: kinds.length ? kinds : [...DEFAULT_PLACEMENT], saved: Boolean(row && kinds.length) };
}

/**
 * Which plan matches the placement rule picks: on a sheet of a kind it
 * names, and not a table row unless it names schedules. Sheets whose kind
 * can't be told are left to the model and the person.
 */
export function placementPick(matches, kinds) {
  const want = new Set(kinds || DEFAULT_PLACEMENT);
  const fits = (m) => m.sheet && want.has(m.sheet) && (m.spot !== 'table row' || want.has('schedule'));
  const picked = (matches || []).filter(fits);
  const unknown = (matches || []).filter((m) => !m.sheet);
  return { picked, unknown };
}

export function createSurveyAgentToolbox({
  getBridge = () => surveyAgentBridge.current,
  attachments = new Map(),
  documentId,
  undoLastTurn = null,
  extraTools = [],
  getDocument = null,
  requestPhoto = null,
  // Ids of the items worked on in this chat, for the end-of-walk summary.
  walkItems = null,
  // What the agent learned in the project (agentMemory.js store), or null
  // where there is none (WebMCP, tests): remember / forget then refuse.
  memory = null,
  // What the agent offered to add to the template in this chat (KAL-529),
  // kept by the panel across turns so each offer is made once. null: no
  // offer tools (WebMCP, tests that leave it out).
  offered = null,
  // KAL-532: askPhoto({ blob, question }) -> the answer text, from a model
  // that can see. null: no photo questions here.
  askPhoto = null,
} = {}) {
  const bridge = () => {
    const b = getBridge();
    if (!b || !b.template) throw new ToolError('Survey mode is not open with a template. Ask the person to open Survey mode first.');
    if (documentId !== undefined && (b.documentId || null) !== (documentId || null)) {
      throw new ToolError('The person opened another document, so this request stopped. Tell them to ask again.');
    }
    return b;
  };
  const markerOf = (b, itemId) => {
    const marker = b.markers?.[itemId];
    if (!marker) throw new ToolError(`No item with id ${itemId}. Use find_items to get an id.`);
    return marker;
  };
  // set_answers by name, so "D-117 lock yes" is one model step: only a
  // single clear match is used; anything else sends the model back to ask.
  // A name the project taught ("D101" is D-1-01) stands for that item's name.
  const memoryRows = (b) => (memory && b?.projectId ? memory.cached(b.projectId) : []);
  // With a device on several sheets: which matches the project's placement
  // rule picks (default the floor plan), so the model need not ask, or that
  // it should ask with ask_which_page.
  const placementHint = (b, matches) => {
    // Only the ones that fit about as well as the best: the same tag twice.
    const top = Math.max(0, ...(matches || []).map((m) => m.score ?? 1));
    const near = (matches || []).filter((m) => (m.score ?? 1) >= top - 0.1);
    if (near.length < 2) return {};
    const rule = placementOf(memoryRows(b));
    const { picked } = placementPick(near, rule.kinds);
    const perKind = new Map();
    for (const m of picked) perKind.set(m.sheet, (perKind.get(m.sheet) || 0) + 1);
    const clear = picked.length > 0 && [...perKind.values()].every((n) => n === 1);
    return {
      placement: {
        rule: placementWords(rule.kinds),
        ...(clear
          ? { use: picked.map((m) => m.id), say: `Use ${picked.length === 1 ? 'this one' : 'these'} without asking.` }
          : { use: [], say: 'The rule does not pick one clearly: ask with ask_which_page.' }),
      },
    };
  };
  const learnedName = (b, heard) => learnedNameFor(memoryRows(b), heard) || heard;
  const markerIdByName = (b, name) => {
    const heard = learnedName(b, String(name || '').trim());
    if (!heard) throw new ToolError('Give item_id or item_name.');
    const { find } = categoryIndex(b.template);
    const scored = Object.entries(b.markers || {})
      .filter(([, marker]) => marker)
      .map(([id, marker]) => ({ id, name: nameOf(marker), score: scoreItemName(heard, marker.name, find(marker.moduleId, marker.categoryId)?.category?.name) }))
      .filter((m) => m.score >= 0.5);
    const exact = scored.filter((m) => m.score >= 1);
    if (exact.length === 1) return exact[0].id;
    if (!exact.length && scored.length === 1) return scored[0].id;
    // The same tag in several modules (D-117 for installation and for
    // commissioning): the one in the module open in the panel.
    const here = (exact.length ? exact : scored).filter((m) => b.currentModuleId && b.markers[m.id]?.moduleId === b.currentModuleId);
    if (here.length === 1 && (exact.length ? exact : scored).every((m) => m.id === here[0].id || b.markers[m.id]?.moduleId !== b.currentModuleId)) return here[0].id;
    if (!scored.length) return null;
    const names = (exact.length ? exact : scored).map((m) => m.name).sort((a, b2) => a.localeCompare(b2, undefined, { numeric: true }));
    throw new ToolError(`Several items match ${heard}: ${names.slice(0, 5).join(', ')}. Ask which one; nothing changed.`);
  };
  const writable = (b) => {
    if (b.canEdit === false) throw new ToolError('This person can only view this document, so nothing can be changed.');
  };
  // An entity by id or by its name as said ("not started" for "Not Started").
  const entityFor = (b, value) => {
    const said = String(value ?? '').trim();
    if (!said) return null;
    const list = entitiesOf(b.template);
    const key = normalizeItemName(said);
    // A state word the project taught ("done" is Commissioned here).
    const taught = learnedStateFor(memoryRows(b), said);
    const found = list.find((e) => e.id === said) || list.find((e) => normalizeItemName(e.name) === key)
      || (taught ? list.find((e) => normalizeItemName(e.name) === normalizeItemName(taught)) : null);
    if (!found) throw new ToolError(`"${said}" is not one of this template's entities (${list.map((e) => e.name).join(', ') || 'it has none'}). Nothing changed.`);
    return found;
  };
  const entityChange = (b, itemId, entity) => {
    const marker = markerOf(b, itemId);
    const field = { type: 'entity', before: marker.entityId || null, after: entity?.id || null };
    b.setEntity(itemId, entity?.id || null);
    return {
      content: entity ? `Set ${nameOf(marker)} to ${entity.name}.` : `Cleared the entity on ${nameOf(marker)}.`,
      change: { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: entity ${entity ? entity.name : 'cleared'}`, fields: [field] },
    };
  };
  // set_answers' item_name: the item by name, or else by description
  // ("camera twelve fourth floor" is C-4-12), when one clearly fits best.
  const itemIdFor = async (b, name) => {
    const heard = learnedName(b, String(name || '').trim());
    const byName = markerIdByName(b, heard);
    if (byName) return byName;
    const target = parseDescribedTarget(heard, { kinds: projectKinds(b) });
    if (target?.number != null && target.kind) {
      const { items } = await describedItems(b, target);
      const [best, next] = items;
      if (clearBest(items)) return best.id;
      if (best && next) {
        const list = items.slice(0, 5).map((m) => `${m.name}${m.page ? ` (page ${m.page})` : ''}`).join(', ');
        throw new ToolError(`Several items fit ${heard}: ${list}. Ask which one; nothing changed.`);
      }
    }
    throw new ToolError(`No item named ${heard}. Check with find_items, find_described or find_on_plan; nothing changed.`);
  };
  const nameOf = (marker) => marker?.name || 'Unnamed item';
  // Only someone who may change the template sees an offer (KAL-529).
  const templateEditable = (b) => b.canEdit !== false && b.canEditTemplate === true
    && typeof b.addChecklistLine === 'function' && typeof b.addCategory === 'function';
  const offerAllowed = (b) => {
    if (!offered) throw new ToolError('Offering template changes is not on here.');
    if (!templateEditable(b)) throw new ToolError('This person cannot change the template, so do not offer. Keep it in the note.');
  };
  // Uploads files to an item's note, as a person adding them would.
  const attachFiles = async (b, itemId, marker, files) => {
    const field = { type: 'note', before: clone(marker.note), afterText: noteTextOf(marker.note), afterMedia: null };
    const refs = [];
    for (const a of files) refs.push(await b.uploadMedia(itemId, a.file, a.kind));
    b.addMediaRefs(itemId, refs);
    field.afterMedia = mediaCountOf(marker.note) + refs.length;
    const what = files.length === 1 && files[0].kind === 'photo' ? 'photo' : `file${refs.length === 1 ? '' : 's'}`;
    return {
      content: `Attached ${refs.length} ${what} to ${nameOf(marker)}.`,
      change: { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: ${refs.length} ${what} attached`, fields: [field] },
    };
  };
  // Plan matches from find_on_plan in this chat, so create_item takes an id
  // instead of coordinates the model could make up.
  const planMatches = new Map();
  const extras = new Map((extraTools || []).map((t) => [String(t.name).replace(/^survey_/, ''), t]));

  // Where new items go: a category from the template, and maybe an entity.
  const itemTarget = (b, categoryId, entityId) => {
    writable(b);
    if (typeof b.createItem !== 'function') throw new ToolError('Items cannot be added here.');
    const entry = categoryIndex(b.template).list.find(({ category }) => category.id === categoryId);
    if (!entry) throw new ToolError(`No category with id ${categoryId}. Use get_survey_context.`);
    const entity = entityId ? entitiesOf(b.template).find((e) => e.id === entityId) : null;
    if (entityId && !entity) throw new ToolError(`No entity with id ${entityId}.`);
    return { entry, entity };
  };
  const sameNamed = (b, categoryId, name) => Object.entries(b.markers || {}).find(([, m]) => m?.categoryId === categoryId
    && normalizeItemName(m.name) === normalizeItemName(name));
  const addItem = (b, entry, entity, name, page, tagBox) => b.createItem({
    name,
    moduleId: entry.module.id,
    categoryId: entry.category.id,
    entityId: entity?.id || null,
    page,
    bounds: markerBoxAroundTag(tagBox, b.getPageSize?.(page) || null),
  });
  const createdChange = (b, itemId, label) => ({ itemId, documentId: b.documentId || null, label, fields: [{ type: 'create' }] });

  // A spot just right of an item's box (or of a tag found on the plan), or
  // left of it when that runs off the page: where a person means by "a note
  // by D-117". PDF points from the page's top-left, like the plan boxes.
  const GAP = 8;
  const NOTE_ROOM = 160;
  const placeNear = (tool, input) => {
    const { near_item_id: itemId, near_plan_match_id: matchId, ...rest } = input;
    if (!itemId && !matchId) return rest;
    let page;
    let box;
    if (itemId) {
      const marker = markerOf(bridge(), itemId);
      if (!marker.pageNumber || !marker.bounds) throw new ToolError(`${nameOf(marker)} is not placed on the plan, so there is nothing to put this next to.`);
      page = marker.pageNumber;
      box = marker.bounds;
    } else {
      const match = planMatches.get(matchId);
      if (!match) throw new ToolError(`No plan match ${matchId}. Use find_on_plan first.`);
      page = match.page;
      box = match.box;
    }
    const size = bridge().getPageSize?.(page) || null;
    const right = box.x + box.width + GAP;
    const fitsRight = !size || right + NOTE_ROOM <= size.width;
    const x = fitsRight ? right : Math.max(0, box.x - GAP - NOTE_ROOM);
    const y = Math.max(0, size ? Math.min(box.y, size.height - 1) : box.y);
    // A highlight only needs the page; it finds its words there.
    if (tool === 'add_highlight') return { ...rest, page: rest.page ?? page };
    // A callout's box goes beside the item, its arrow at the item's middle.
    if (tool === 'add_callout') {
      return {
        ...rest,
        page: rest.page ?? page,
        arrow_x: rest.arrow_x ?? box.x + box.width / 2,
        arrow_y: rest.arrow_y ?? box.y + box.height / 2,
        box_x: rest.box_x ?? x,
        box_y: rest.box_y ?? y,
      };
    }
    return { ...rest, page: rest.page ?? page, x: rest.x ?? x, y: rest.y ?? y };
  };

  // The same item in another module: its marker there, or a new one on the
  // same spot. Waits for the panel to show a new one before answering it.
  const sameName = (a, c) => normalizeItemName(a) === normalizeItemName(c);
  // Tags repeat floor to floor ("C-06" on every sheet): a copy in another
  // module is the same device only on the same page, on the same spot.
  const overlaps = (a, c) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
  const samePlace = (a, c) => {
    if (a.pageNumber == null || c.pageNumber == null) return a.pageNumber == null && c.pageNumber == null;
    if (a.pageNumber !== c.pageNumber) return false;
    return !a.bounds || !c.bounds || overlaps(a.bounds, c.bounds);
  };
  const waitForMarker = async (id) => {
    for (let i = 0; i < 40; i += 1) {
      if (getBridge()?.markers?.[id]) return getBridge();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  };
  // Where the other module's answers go: its item on the same spot, or a
  // new one there. Throws, writing nothing, when neither can be.
  const siblingFor = (b, itemId, marker, other) => {
    const moduleName = other.module.name || 'the other module';
    const siblings = Object.entries(b.markers || {}).filter(([id, m]) => id !== itemId && m?.moduleId === other.module.id
      && m.categoryId === other.category.id && sameName(m.name, marker.name) && samePlace(m, marker));
    if (siblings.length > 1) {
      throw new ToolError(`${nameOf(marker)} has ${siblings.length} ${moduleName} items in the same place. Nothing changed; ask which one.`);
    }
    if (!siblings.length && (!marker.pageNumber || !marker.bounds || typeof b.createItem !== 'function')) {
      throw new ToolError(`${nameOf(marker)} has no ${moduleName} item yet, and it is not on the plan to add one. Nothing changed.`);
    }
    return siblings[0] || null;
  };
  const answerInModule = async (b, itemId, marker, other, answers) => {
    const moduleName = other.module.name || 'the other module';
    const changes = [];
    let sibling = siblingFor(b, itemId, marker, other);
    let live = b;
    if (!sibling) {
      const newId = b.createItem({ name: marker.name || nameOf(marker), moduleId: other.module.id, categoryId: other.category.id, entityId: null, page: marker.pageNumber, bounds: marker.bounds });
      if (!newId) throw new ToolError(`Could not add ${nameOf(marker)} to ${moduleName}.`);
      changes.push(createdChange(b, newId, `Added ${nameOf(marker)} to ${moduleName}`));
      live = await waitForMarker(newId);
      if (!live) throw new ToolError(`Added ${nameOf(marker)} to ${moduleName}, but it did not open in time to fill in. Ask again.`);
      sibling = [newId, live.markers[newId]];
    }
    const [siblingId, siblingMarker] = sibling;
    const byId = new Map(activeChecklist(other.category).map((line) => [line.id, line]));
    const responses = siblingMarker.checklistResponses || {};
    const fields = answers.map((a) => ({ type: 'answer', id: a.checklist_item_id, before: clone(responses[a.checklist_item_id]), after: a.value }));
    fields.push({ type: 'autoEntity', before: siblingMarker.entityId || null, after: undefined });
    live.setAnswers(siblingId, answers.map((a) => ({ checklistItemId: a.checklist_item_id, value: a.value })));
    const said = answers.map((a) => `${itemText(byId.get(a.checklist_item_id))} = ${a.value}`).join('; ');
    changes.push({ itemId: siblingId, documentId: b.documentId || null, label: `${nameOf(marker)} (${moduleName}): ${said}`, fields });
    return { text: `Set ${answers.length} ${moduleName} answer${answers.length === 1 ? '' : 's'} on ${nameOf(marker)}.`, changes };
  };

  const saveMemory = async (b, row, line) => {
    let saved;
    try {
      saved = await memory.save(b.projectId, row);
    } catch (err) {
      throw new ToolError(`Could not save it: ${err.message}`);
    }
    if (saved.same) return { content: `Already saved: ${line}.` };
    return {
      content: `Saved for this project: ${line}.${saved.before ? ` (Replaced "${saved.before.means}".)` : ''}`,
      change: { memory: { projectId: b.projectId, row: saved.row, before: saved.before }, label: `Learned: ${line}` },
    };
  };

  // Items, then plan tags, that fit a kind and number ("reader 1409" fits
  // tag 310H-R1409). find_described's search, and the fallback when
  // find_items or find_on_plan find nothing by exact name.
  const describedSearch = async (b, target, { min } = {}) => {
    const { items, pages, unreadPages } = await describedItems(b, target);
    const shownItems = items.slice(0, 5).map(({ here: _, moduleId: __, ...m }) => m);
    const markers = Object.entries(b.markers || {});
    const plan = findDescribedOnPages(target, pages, { score: scoreDescribedTag, ...(min != null ? { min } : {}) })
      .map((m) => {
        const covering = markers.find(([, marker]) => marker?.pageNumber === m.page && boundsCover(marker.bounds, m.box));
        const id = `plan-${planMatches.size + 1}`;
        planMatches.set(id, m);
        return {
          id,
          page: m.page,
          text: m.text,
          ...(m.sheetFloor != null ? { sheet_floor: m.sheetFloor } : {}),
          ...sheetFields(m),
          score: m.score,
          ...(covering ? { already_item: { id: covering[0], name: nameOf(covering[1]) } } : {}),
        };
      })
      .slice(0, 5);
    return {
      looked_for: { kind: target.kind, number: target.number, floor: target.floor, wing: target.wing },
      items: shownItems,
      plan,
      ...placementHint(b, plan),
      ...(unreadPages.length ? { pages_without_text: unreadPages.length } : {}),
    };
  };

  // The kind-and-number reading of words that matched nothing exactly, or
  // null when there is no number in them or nothing fits.
  const describedFallback = async (b, words) => {
    const kinds = projectKinds(b);
    const parsed = parseDescribedTarget(words, { kinds });
    if (!parsed || parsed.number == null) return null;
    const target = { kind: parsed.kind || null, kindWord: parsed.kindWord || null, code: parsed.code || null, codes: parsed.codes || null, number: parsed.number, floor: parsed.floor ?? null, wing: parsed.wing || null };
    // A bare number of three or more digits ("1409") is the end of one tag
    // in a few hundred; with no kind said it may still fit, ranked lower.
    const min = !target.kind && !target.code && String(target.number).length >= 3 ? 0.3 : undefined;
    const found = await describedSearch(b, target, { min });
    return found.items.length || found.plan.length ? found : null;
  };

  // find_described by place: items of the kind nearest a printed place label
  // (on a bare PDF, printed tags of the kind), with the one clearly nearest.
  const findByPlace = async (b, place) => {
    const { pages = [], unreadPages = [] } = typeof b.readSheets === 'function' ? await b.readSheets() : {};
    const sheetFloor = new Map(pages.map((p) => [p.page, p.sheet?.floor ?? null]));
    const ofKind = (name) => templateKinds([{ name }])[0]?.kind === place.kind || kindFromWord(name).kind === place.kind;
    const onFloor = (page, own = null) => place.floor == null || (own ?? sheetFloor.get(page)) === place.floor;
    const { find } = categoryIndex(b.template);
    const markers = Object.entries(b.markers || {});
    const items = markers
      .filter(([, m]) => m?.bounds && m.pageNumber && ofKind(find(m.moduleId, m.categoryId)?.category?.name || '')
        && onFloor(m.pageNumber, floorNumberOf(m.floor)))
      .map(([id, m]) => ({ key: id, id, name: nameOf(m), page: m.pageNumber, box: m.bounds, here: !b.currentModuleId || m.moduleId === b.currentModuleId }));
    // The same device in two modules is one candidate: the open module's.
    const seen = new Set();
    const oneEach = items.sort((x, y) => Number(y.here) - Number(x.here))
      .filter((i) => { const k = `${normalizeItemName(i.name)}|${i.page}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const near = nearestToPlace(place, oneEach, pages, { pageSize: (page) => b.getPageSize?.(page) || null });
    const codes = new Set([...(place.codes || []), place.kind[0], place.kind.split(' ').map((w) => w[0]).join('')]);
    const tags = [];
    if (!near.list.length) {
      for (const { page, words = [] } of pages) {
        if (!onFloor(page)) continue;
        for (const w of words) {
          const m = /^([a-z]{1,4})[-\s.]?\d[\w-]*$/i.exec(String(w.text || '').trim());
          if (!m || !codes.has(m[1].toLowerCase()) || !w.box) continue;
          if (markers.some(([, mk]) => mk?.pageNumber === page && boundsCover(mk.bounds, w.box))) continue;
          tags.push({ key: `${page}:${w.text}`, page, box: w.box, text: w.text.trim() });
        }
      }
    }
    const nearTags = tags.length ? nearestToPlace(place, tags, pages, { pageSize: (page) => b.getPageSize?.(page) || null }) : { list: [], clear: null };
    const plan = nearTags.list.slice(0, 5).map((t) => {
      const id = `plan-${planMatches.size + 1}`;
      planMatches.set(id, { page: t.page, text: t.text, box: t.box, source: 'text', score: 1 });
      return { id, page: t.page, text: t.text, place: t.place, distance: t.distance, clear: t === nearTags.clear };
    });
    return {
      looked_for: { kind: place.kind, place: place.place.join(' '), floor: place.floor },
      by_place: true,
      items: near.list.slice(0, 5).map((i) => ({ id: i.id, name: i.name, page: i.page, place: i.place, distance: i.distance, clear: i === near.clear })),
      plan,
      ...(unreadPages.length ? { pages_without_text: unreadPages.length } : {}),
    };
  };

  const tools = {
    // "Whenever I say D101 I mean D-1-01" (a name) or "always write not
    // installed, not missing" (wording): saved for everyone on the project.
    async remember({ kind, heard, means } = {}) {
      const b = bridge();
      writable(b);
      if (!memory || !b.projectId) throw new ToolError('This drawing is not in a project, so nothing can be learned here.');
      const said = String(heard || '').trim();
      if (!said || !String(means || '').trim()) throw new ToolError('Give what they say (heard) and what it means.');
      let target = String(means).trim();
      if (kind === 'name') {
        // It must be a real item; the saved name is that item's own name.
        const itemId = await itemIdFor(b, target);
        target = nameOf(markerOf(b, itemId));
        if (said.toLowerCase() === target.toLowerCase()) throw new ToolError(`${said} is already that item's own name; nothing saved.`);
      } else if (kind === 'placement') {
        // "Mark it on the floor plan, schedule and riser": one rule per project.
        const kinds = placementFromWords(`${said} ${target}`);
        if (!kinds.length) throw new ToolError('Say which sheets: floor plan, schedule, riser, detail or legend. Nothing saved.');
        target = kinds.join(', ');
        return saveMemory(b, { kind, heard: 'sheets', means: target }, `mark devices on ${placementWords(kinds)}`);
      } else if (kind === 'state') {
        // "Done means commissioned": the saved meaning is one entity's own name.
        const entity = entitiesOf(b.template).find((e) => normalizeItemName(e.name) === normalizeItemName(target));
        if (!entity) throw new ToolError(`"${target}" is not one of this template's entities (${entitiesOf(b.template).map((e) => e.name).join(', ') || 'it has none'}). Nothing saved.`);
        if (entitiesOf(b.template).some((e) => normalizeItemName(e.name) === normalizeItemName(said))) throw new ToolError(`${said} is already an entity's own name; nothing saved.`);
        target = entity.name;
      } else if (kind !== 'wording') {
        throw new ToolError('kind is name, wording, state or placement.');
      }
      const lineOf = (row) => (kind === 'name' ? `"${row.heard}" means ${row.means}`
        : kind === 'state' ? `"${row.heard}" means ${row.means}` : `write "${row.means}" for "${row.heard}"`);
      let saved;
      try {
        saved = await memory.save(b.projectId, { kind, heard: said, means: target });
      } catch (err) {
        // No signal: keep it on the device; it is saved for the project later.
        if (typeof memory.saveLater !== 'function') throw new ToolError(`Could not save it: ${err.message}`);
        const { row } = memory.saveLater(b.projectId, { kind, heard: said, means: target });
        return { content: `Saved on this device: ${lineOf(row)}. It is shared with the project when there is signal.` };
      }
      const line = lineOf(saved.row);
      if (saved.same) return { content: `Already saved: ${line}.` };
      return {
        content: `Saved for this project: ${line}.${saved.before ? ` (Replaced "${saved.before.means}".)` : ''}`,
        change: { memory: { projectId: b.projectId, row: saved.row, before: saved.before }, label: `Learned: ${line}` },
      };
    },

    // "Page 6 or 33?": the panel shows a button per page plus both, neither
    // and other, and a "remember for this project" switch. Nothing changes.
    ask_which_page({ plan_match_ids: ids = [], question = '' } = {}) {
      const b = bridge();
      const seen = new Set();
      const options = (Array.isArray(ids) ? ids : []).map((id) => [id, planMatches.get(id)])
        .filter(([id, m]) => m && !seen.has(`${m.page}|${m.text}`) && seen.add(`${m.page}|${m.text}`))
        .slice(0, 4)
        .map(([id, m]) => ({ id, page: m.page, text: m.text, sheet: m.sheetKind || null, spot: m.spot || 'drawing' }))
        .sort((a, c) => a.page - c.page);
      if (options.length < 2) throw new ToolError('Give two or more plan match ids from find_described or find_on_plan.');
      return {
        content: 'The person now sees a button for each page, plus all, none and other, and a switch to remember the answer for this project. Ask in one short sentence naming each page and its sheet, then wait for their answer.',
        choice: {
          question: String(question || '').trim().slice(0, 200) || null,
          options,
          canRemember: Boolean(memory && b.projectId && b.canEdit !== false),
        },
      };
    },

    async forget({ heard } = {}) {
      const b = bridge();
      writable(b);
      if (!memory || !b.projectId) throw new ToolError('This drawing is not in a project, so nothing was learned here.');
      const key = memoryKey(heard);
      const rows = (await memory.list(b.projectId)).filter((r) => memoryKey(r.heard) === key);
      if (!key || !rows.length) throw new ToolError(`Nothing saved for "${String(heard || '').trim()}"; nothing changed.`);
      try {
        for (const row of rows) await memory.remove(b.projectId, row.id);
      } catch (err) {
        throw new ToolError(`Could not remove it: ${err.message}`);
      }
      return {
        content: `Forgot ${rows.map((r) => (r.kind === 'name' ? `"${r.heard}" = ${r.means}` : `"${r.heard}" -> "${r.means}"`)).join(' and ')}.`,
        change: { memory: { projectId: b.projectId, removed: rows }, label: `Forgot "${rows[0].heard}"` },
      };
    },

    // Old notes in the person's preferred words: every whole "from" in this
    // document's item notes becomes "to". Undo puts each note back.
    tidy_notes({ from, to } = {}) {
      const b = bridge();
      writable(b);
      const f = String(from || '').trim();
      const t = String(to || '').trim();
      if (!f || !t) throw new ToolError('Give the words to replace (from) and the words to write (to).');
      const changes = [];
      for (const [itemId, marker] of Object.entries(b.markers || {})) {
        if (!marker) continue;
        const text = noteTextOf(marker.note);
        const next = rewordText(text, f, t);
        if (next === text) continue;
        if (changes.length >= MAX_TIDY_ITEMS) break;
        b.updateNote(itemId, (prev) => ({ ...prev, text: rewordText(String(prev?.text || ''), f, t) }));
        changes.push({
          itemId,
          documentId: b.documentId || null,
          label: `${nameOf(marker)}: note reworded`,
          fields: [{ type: 'note', before: clone(marker.note), afterText: next, afterMedia: mediaCountOf(marker.note) }],
        });
      }
      if (!changes.length) return { content: `No notes here say "${f}"; nothing changed.` };
      return {
        content: `Changed "${f}" to "${t}" in ${changes.length} note${changes.length === 1 ? '' : 's'}.`,
        changes,
      };
    },

    get_survey_context() {
      const b = bridge();
      const { list } = categoryIndex(b.template);
      const counts = new Map();
      // One name per category, so "add all doors" knows what a door tag looks like.
      const examples = new Map();
      for (const marker of Object.values(b.markers || {})) {
        const key = marker?.categoryId;
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
        if (key && !examples.has(key) && String(marker.name || '').trim()) examples.set(key, String(marker.name).trim());
      }
      const allModules = modulesOf(b.template);
      const multiModule = allModules.length > 1;
      const selected = b.selectedMarkerId && b.markers?.[b.selectedMarkerId];
      const current = allModules.find((m) => m.id === (b.currentModuleId || selected?.moduleId)) || (multiModule ? null : allModules[0]);
      return {
        content: out({
          template: b.template.name || null,
          answers: answerSetFor(b.template).map((a) => a.value),
          ...(answerSetMeaning(answerSetFor(b.template)) ? { answer_meaning: answerSetMeaning(answerSetFor(b.template)) } : {}),
          categories: list.map(({ module, category }) => ({
            id: category.id,
            name: category.name,
            ...(multiModule ? { module: module.name } : {}),
            item_count: counts.get(category.id) || 0,
            ...(examples.has(category.id) ? { example_item: examples.get(category.id) } : {}),
            checklist: activeChecklist(category).map((item) => ({ id: item.id, text: itemText(item), ...itemAnswerSpec(item) })),
          })),
          entities: entitiesOf(b.template).map((e) => ({ id: e.id, name: e.name })),
          // What plain talk means in each module ("it's installed", "it works").
          modules: allModules.map((m) => ({ name: m.name || null, kind: moduleKind(m.name), meaning: moduleMeaning(m.name) })),
          current_module: current ? current.name || null : null,
          selected_item: selected ? { id: b.selectedMarkerId, name: nameOf(selected) } : null,
          page_on_screen: b.getCurrentPage?.() || null,
          can_edit: b.canEdit !== false,
          ...(offered ? { template_editable: templateEditable(b) } : {}),
          // Names and note wording this project taught the agent.
          ...(memory && b.projectId ? { learned: learnedForModel(memoryRows(b)) } : {}),
          // Which sheets a device goes on (sheetKind.js): the project's rule, else the floor plan.
          placement: placementWords(placementOf(memoryRows(b)).kinds),
        }),
      };
    },

    async find_items({ query, category_id: categoryId } = {}) {
      const b = bridge();
      if (!String(query || '').trim()) throw new ToolError('Say which item to look for.');
      query = learnedName(b, String(query).trim());
      const { find } = categoryIndex(b.template);
      const matches = [];
      for (const [id, marker] of Object.entries(b.markers || {})) {
        if (!marker || (categoryId && marker.categoryId !== categoryId)) continue;
        const entry = find(marker.moduleId, marker.categoryId);
        const score = scoreItemName(query, marker.name, entry?.category?.name);
        if (score >= 0.5) {
          matches.push({
            id,
            name: nameOf(marker),
            category: entry?.category?.name || null,
            ...(entry?.module?.name ? { module: entry.module.name } : {}),
            on_plan: Boolean(marker.pageNumber && marker.bounds),
            score: Math.round(score * 100) / 100,
            here: Boolean(b.currentModuleId) && marker.moduleId === b.currentModuleId,
          });
        }
      }
      matches.sort((a, b2) => b2.score - a.score || a.name.localeCompare(b2.name));
      // The same tag in several modules (D-117 in Installation and in
      // Commissioning): the person means the one in the module open on
      // screen, so of the best matches only those are listed and the model
      // doesn't ask which. A weaker match here never hides a better one
      // elsewhere.
      const top = matches[0]?.score;
      const best = matches.filter((m) => m.score === top);
      const bestHere = best.filter((m) => m.here);
      const kept = bestHere.length ? [...bestHere, ...matches.filter((m) => m.score < top)] : matches;
      const shown = kept.slice(0, 5).map(({ here: _, ...m }) => m);
      const otherModules = bestHere.length ? [...new Set(best.filter((m) => !m.here).map((m) => m.module).filter(Boolean))] : [];
      // No item by that name, but a kind and a number were said ("reader
      // 1409"): look the way find_described does, so tag 310H-R1409 is found.
      if (!shown.length) {
        const fit = await describedFallback(b, query);
        if (fit) return { content: out({ matches: [], by_kind_and_number: fit }) };
      }
      return {
        content: out({
          matches: shown,
          ...(otherModules.length ? { open_module_only: `Showing the open module's items; the same names are also in ${otherModules.join(', ')}.` } : {}),
        }),
      };
    },

    get_item({ item_id: itemId } = {}) {
      const b = bridge();
      const marker = markerOf(b, itemId);
      const entry = categoryIndex(b.template).find(marker.moduleId, marker.categoryId);
      const entity = entitiesOf(b.template).find((e) => e.id === marker.entityId);
      const responses = marker.checklistResponses || {};
      return {
        content: out({
          id: itemId,
          name: nameOf(marker),
          category: entry ? { id: entry.category.id, name: entry.category.name } : null,
          ...(entry?.module ? { module: entry.module.name || null, meaning: moduleMeaning(entry.module.name) } : {}),
          entity: entity ? { id: entity.id, name: entity.name } : null,
          checklist: entry ? activeChecklist(entry.category).map((item) => ({
            id: item.id,
            text: itemText(item),
            ...itemAnswerSpec(item),
            answer: responses[item.id]?.selection || null,
          })) : [],
          note: noteTextOf(marker.note),
          media_count: mediaCountOf(marker.note),
          on_plan: Boolean(marker.pageNumber && marker.bounds),
        }),
      };
    },

    // Answers and a note in one step: "D-117 is installed but has no power"
    // sets the installation lines and notes the power. all_lines answers
    // every line the person did not name one by one ("everything's in").
    async set_answers({ item_id: givenId, item_name: itemName, answers, all_lines: allLines = null, note = null, entity: entitySaid = null } = {}) {
      const b = bridge();
      writable(b);
      const itemId = givenId || await itemIdFor(b, itemName);
      const marker = markerOf(b, itemId);
      const entry = categoryIndex(b.template).find(marker.moduleId, marker.categoryId);
      const addition = String(note || '').trim();
      const named = (Array.isArray(answers) ? answers : []).map((a) => ({ ...a }));
      const entity = entityFor(b, entitySaid);
      if (!named.length && !allLines && !addition && !entity) throw new ToolError('No answers given (and no note or entity).');
      if ((named.length || allLines) && !entry) throw new ToolError('This item has no category in the template, so it has no checklist.');
      const lines = entry ? activeChecklist(entry.category) : [];
      const checklist = new Map(lines.map((item) => [item.id, item]));
      const allowed = answerSetFor(b.template).map((a) => a.value);
      // Lines of the same item in another module ("it has an IP" while
      // Installation is open is a Commissioning line): those answers go to
      // that module's item of the same name, added at the same spot if the
      // person has not placed it there yet.
      const elsewhere = new Map();
      // Typed lines (text, number, score, count, date, many) take what was said, not a listed answer.
      const lineById = new Map(categoryIndex(b.template).list.flatMap(({ category }) => activeChecklist(category)).map((l) => [l.id, l]));
      for (const a of named) {
        const line = checklist.get(a?.checklist_item_id) || lineById.get(a?.checklist_item_id);
        if (line && APP_ONLY_KINDS.includes(itemKind(line))) {
          throw new ToolError(`"${itemText(line)}" is a ${itemKind(line)} line: it is filled in the app, not by voice.`);
        }
        if (line && itemKind(line) !== 'choice') {
          const typed = typedAnswer(line, a.value);
          if (typed === null) throw new ToolError(`"${a.value}" does not fit "${itemText(line)}": ${itemAnswerHint(line)}.`);
          if (!typed) throw new ToolError(`"${itemText(line)}" needs a value.`);
          a.value = typed;
        } else if (!allowed.includes(a?.value)) throw new ToolError(`"${a?.value}" is not an allowed answer. Allowed: ${allowed.join(', ')}.`);
        if (checklist.has(a?.checklist_item_id)) continue;
        const other = entry && categoryIndex(b.template).list.find(({ module, category }) => module.id !== entry.module.id
          && sameName(category.name, entry.category.name)
          && activeChecklist(category).some((line) => line.id === a?.checklist_item_id));
        if (!other) throw new ToolError(`${a?.checklist_item_id} is not on the ${entry?.category?.name || 'item\'s'} checklist. Use get_item for its checklist ids.`);
        if (!elsewhere.has(other.module.id)) elsewhere.set(other.module.id, { entry: other, answers: [] });
        elsewhere.get(other.module.id).answers.push(a);
      }
      if (allLines && !allowed.includes(allLines)) throw new ToolError(`"${allLines}" is not an allowed answer. Allowed: ${allowed.join(', ')}.`);
      const own = named.filter((a) => checklist.has(a.checklist_item_id));
      const given = new Set(own.map((a) => a.checklist_item_id));
      const list = [...own, ...(allLines ? lines.filter((l) => !given.has(l.id) && itemKind(l) === 'choice').map((l) => ({ checklist_item_id: l.id, value: allLines })) : [])];
      // Every other module is checked before anything is written, so a turn
      // never half-writes and then reports only the failure.
      for (const { entry: other } of elsewhere.values()) siblingFor(b, itemId, marker, other);
      const siblingChanges = [];
      for (const { entry: other, answers: theirs } of elsewhere.values()) {
        try {
          siblingChanges.push(await answerInModule(b, itemId, marker, other, theirs));
        } catch (err) {
          // Adding the item failed after earlier modules were written: stop
          // here, and hand back what was written so it can still be undone.
          const done = siblingChanges.flatMap((c) => c.changes);
          if (!done.length) throw err;
          return {
            content: `${siblingChanges.map((c) => c.text).join(' ')} ${err?.message || 'The rest failed.'} Nothing else changed.`,
            ...(done.length === 1 ? { change: done[0] } : { changes: done }),
          };
        }
      }
      const responses = marker.checklistResponses || {};
      const fields = list.map((a) => ({ type: 'answer', id: a.checklist_item_id, before: clone(responses[a.checklist_item_id]), after: a.value }));
      const said = [];
      if (list.length) {
        // A tap's answer can move the entity (auto-entity rule). What it moved
        // to is only known once the app re-renders: settle() fills `after`.
        fields.push({ type: 'autoEntity', before: marker.entityId || null, after: undefined });
        b.setAnswers(itemId, list.map((a) => ({ checklistItemId: a.checklist_item_id, value: a.value })));
        said.push(list.map((a) => `${itemText(checklist.get(a.checklist_item_id))} = ${a.value}`).join('; '));
      }
      if (addition) {
        const beforeText = noteTextOf(marker.note).trimEnd();
        fields.push({ type: 'note', before: clone(marker.note), afterText: beforeText ? `${beforeText}\n${addition}` : addition, afterMedia: mediaCountOf(marker.note) });
        b.updateNote(itemId, (prev) => {
          const before = String(prev?.text || '').trimEnd();
          return { ...prev, text: before ? `${before}\n${addition}` : addition };
        });
        said.push(`note "${addition.length > 80 ? `${addition.slice(0, 77)}...` : addition}"`);
      }
      const what = [list.length ? `${list.length} answer${list.length === 1 ? '' : 's'}` : '', addition ? 'a note' : ''].filter(Boolean).join(' and ');
      const ownChange = list.length || addition
        ? { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: ${said.join('; ')}`, fields }
        : null;
      const elsewhereText = siblingChanges.map((c) => c.text).join(' ');
      // The entity goes last, once the app has applied any automatic entity
      // the answers set, so the one the person said wins.
      const idNote = givenId ? '' : ` (item id ${itemId})`;
      let entitySet = null;
      if (entity) {
        if (list.length) await new Promise((resolve) => setTimeout(resolve, 0));
        entitySet = entityChange(b, itemId, entity);
      }
      return {
        content: [
          what ? `Set ${what} on ${nameOf(marker)}${idNote}.` : '',
          elsewhereText,
          entitySet ? (what ? entitySet.content : entitySet.content.replace(/\.$/, `${idNote}.`)) : '',
        ].filter(Boolean).join(' '),
        ...((all) => (all.length === 1 ? { change: all[0] } : { changes: all }))([
          ...(ownChange ? [ownChange] : []), ...siblingChanges.flatMap((c) => c.changes), ...(entitySet ? [entitySet.change] : []),
        ]),
      };
    },

    add_note({ item_id: itemId, text } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const addition = String(text || '').trim();
      if (!addition) throw new ToolError('The note text is empty.');
      const beforeText = noteTextOf(marker.note).trimEnd();
      const field = {
        type: 'note',
        before: clone(marker.note),
        afterText: beforeText ? `${beforeText}\n${addition}` : addition,
        afterMedia: mediaCountOf(marker.note),
      };
      b.updateNote(itemId, (prev) => {
        const before = String(prev?.text || '').trimEnd();
        return { ...prev, text: before ? `${before}\n${addition}` : addition };
      });
      return {
        content: `Added to the note on ${nameOf(marker)}.`,
        change: { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: note "${addition.length > 80 ? `${addition.slice(0, 77)}...` : addition}"`, fields: [field] },
      };
    },

    set_entity({ item_id: itemId, entity_id: entityId } = {}) {
      const b = bridge();
      writable(b);
      markerOf(b, itemId);
      return entityChange(b, itemId, entityFor(b, entityId));
    },

    async attach_media({ item_id: itemId, attachment_ids: ids } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const list = (Array.isArray(ids) ? ids : []).map((id) => [id, attachments.get(id)]);
      const missing = list.filter(([, a]) => !a || a.attachedTo).map(([id]) => id);
      if (!list.length || missing.length) throw new ToolError(`No unattached file with id ${missing.join(', ') || '(none)'} in this chat.`);
      const result = await attachFiles(b, itemId, marker, list.map(([, a]) => a));
      for (const [, a] of list) a.attachedTo = itemId;
      return result;
    },

    async take_photo({ item_id: itemId } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      if (typeof requestPhoto !== 'function') throw new ToolError('The camera cannot be opened here. Ask the person to attach a photo instead.');
      const file = await requestPhoto({ itemId, name: nameOf(marker) });
      if (!file) return { content: `The person closed the camera without taking a photo for ${nameOf(marker)}.` };
      // The item may have changed while the camera was open.
      return attachFiles(b, itemId, markerOf(bridge(), itemId), [{ file, kind: 'photo' }]);
    },

    async add_photo({ item_id: itemId, image_base64: imageBase64 } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const blob = decodePhotoBase64(imageBase64);
      const field = { type: 'note', before: clone(marker.note), afterText: noteTextOf(marker.note), afterMedia: null };
      const ref = await b.uploadMedia(itemId, blob, 'photo');
      b.addMediaRefs(itemId, [ref]);
      field.afterMedia = mediaCountOf(marker.note) + 1;
      return {
        content: `Added a photo to ${nameOf(marker)}.`,
        change: { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: photo added`, fields: [field] },
      };
    },

    export_summary() {
      const b = bridge();
      const { list } = categoryIndex(b.template);
      const markers = Object.values(b.markers || {});
      const catCounts = new Map();
      const entCounts = new Map();
      for (const marker of markers) {
        if (marker?.categoryId) catCounts.set(marker.categoryId, (catCounts.get(marker.categoryId) || 0) + 1);
        const key = marker?.entityId || null;
        entCounts.set(key, (entCounts.get(key) || 0) + 1);
      }
      const entities = entitiesOf(b.template);
      const lines = [`${b.template.name || 'Survey'} — ${markers.length} item${markers.length === 1 ? '' : 's'}`, '', 'By category:'];
      for (const { category } of list) lines.push(`- ${category.name}: ${catCounts.get(category.id) || 0}`);
      if (entities.length) {
        lines.push('', 'By status:');
        for (const entity of entities) lines.push(`- ${entity.name}: ${entCounts.get(entity.id) || 0}`);
        const none = entCounts.get(null) || 0;
        if (none) lines.push(`- (no status): ${none}`);
      }
      return { content: lines.join('\n') };
    },

    async find_on_plan({ text } = {}) {
      const b = bridge();
      const query = String(text || '').trim();
      if (query.replace(/[^a-z0-9]/gi, '').length < 2) throw new ToolError('Say the tag to look for, for example D-117.');
      if (typeof b.findOnPlan !== 'function') throw new ToolError('The plan cannot be searched here.');
      const found = await b.findOnPlan(query);
      const markers = Object.entries(b.markers || {});
      const matches = (found?.matches || []).map((m) => {
        const id = `plan-${planMatches.size + 1}`;
        planMatches.set(id, m);
        const covering = markers.find(([, marker]) => marker?.pageNumber === m.page && boundsCover(marker.bounds, m.box));
        return {
          id,
          page: m.page,
          text: m.text,
          ...sheetFields(m),
          ...(covering ? { already_item: { id: covering[0], name: nameOf(covering[1]) } } : {}),
        };
      });
      // "1409" or "reader 1409" is no exact tag; 310H-R1409 ends in it.
      if (!matches.length) {
        const fit = await describedFallback(b, query);
        if (fit) return { content: out({ matches: [], by_kind_and_number: fit }) };
      }
      return {
        content: out({
          matches,
          ...placementHint(b, matches),
          ...(found?.unreadPages?.length ? { pages_without_text: found.unreadPages.length } : {}),
        }),
      };
    },

    // "Find camera 6 on the 4th floor": the kind, the number and maybe the
    // floor or wing, never the whole tag. Items first, then tags on the plan.
    async find_described({ description = '', kind = null, number = null, floor = null, wing = null } = {}) {
      const b = bridge();
      const kinds = projectKinds(b);
      const parsed = parseDescribedTarget(description, { kinds }) || {};
      const said = String(kind || '').trim().toLowerCase();
      const saidKind = said ? kindFromWord(said, kinds) : null;
      const target = {
        kind: saidKind ? saidKind.kind : parsed.kind || null,
        kindWord: said || parsed.kindWord || null,
        code: parsed.code || null,
        codes: saidKind ? saidKind.codes : parsed.codes || null,
        number: Number.isFinite(Number(number)) && number !== null ? Number(number) : parsed.number ?? null,
        floor: Number.isFinite(Number(floor)) && floor !== null ? Number(floor) : parsed.floor ?? null,
        wing: ({ west: 'w', east: 'e', north: 'n', south: 's' })[String(wing || '').toLowerCase()] || parsed.wing || null,
      };
      // "The camera by the stairs" (or "by stair 2"): by a place printed on
      // the plan, unless the model gave the number itself.
      const place = number == null ? parsePlaceTarget(description, { kinds }) : null;
      if (place) return { content: out(await findByPlace(b, place)) };
      if (target.number == null) {
        throw new ToolError('Say the number of the one to find (camera 6), or where it is (the camera by the stairs).');
      }
      return { content: out(await describedSearch(b, target)) };
    },

    // Scanned sheets have no text, so tags on them can't be found until text
    // recognition reads them (on the device, no signal needed). The current
    // page first when no pages are named.
    async read_scanned_pages({ pages = null } = {}) {
      const b = bridge();
      if (typeof b.recognizePage !== 'function') throw new ToolError('Text recognition is not available here.');
      const { unreadPages = [] } = typeof b.readSheets === 'function' ? await b.readSheets() : {};
      const named = Array.isArray(pages) ? pages.map(Number).filter(Number.isFinite) : [];
      let list = named.length ? named.filter((p) => unreadPages.includes(p)) : [...unreadPages];
      const current = b.getCurrentPage?.();
      if (!named.length && current && list.includes(current)) list = [current, ...list.filter((p) => p !== current)];
      list = list.slice(0, MAX_OCR_PAGES);
      if (!list.length) return { content: unreadPages.length ? 'Those pages already have text to read.' : 'Every page already has text to read.' };
      const read = [];
      const failed = [];
      for (const page of list) {
        try { if (await b.recognizePage(page)) read.push(page); else failed.push(page); } catch { failed.push(page); }
      }
      const left = unreadPages.length - read.length;
      const parts = [read.length ? `Read the text on page${read.length === 1 ? '' : 's'} ${read.join(', ')}.` : 'No page could be read.'];
      if (failed.length) parts.push(`Page${failed.length === 1 ? '' : 's'} ${failed.join(', ')} gave no text.`);
      if (left > 0) parts.push(`${left} scanned page${left === 1 ? '' : 's'} still unread; ask again for more.`);
      return { content: parts.join(' '), read };
    },

    show_on_plan({ plan_match_id: matchId } = {}) {
      const b = bridge();
      const match = planMatches.get(matchId);
      if (!match) throw new ToolError(`No plan match ${matchId}. Use find_described or find_on_plan first.`);
      if (typeof b.showPlace !== 'function') throw new ToolError('The plan cannot be moved here.');
      b.showPlace(match.page, match.box);
      return { content: `Showing "${match.text}" on page ${match.page}.` };
    },

    create_item({ name, category_id: categoryId, plan_match_id: matchId, entity_id: entityId = null } = {}) {
      const b = bridge();
      const { entry, entity } = itemTarget(b, categoryId, entityId);
      const itemName = String(name || '').trim().slice(0, 120);
      if (!itemName) throw new ToolError('Give the item a name.');
      const match = planMatches.get(matchId);
      if (!match) throw new ToolError(`No plan match ${matchId}. Use find_on_plan first.`);
      const same = sameNamed(b, categoryId, itemName);
      if (same) throw new ToolError(`${nameOf(same[1])} already exists (id ${same[0]}).`);
      const itemId = addItem(b, entry, entity, itemName, match.page, match.box);
      if (!itemId) throw new ToolError('The item could not be added. Is Survey mode open on this document?');
      return {
        content: `Added ${itemName} (${entry.category.name}) on page ${match.page}, id ${itemId}.`,
        change: createdChange(b, itemId, `Added ${itemName} (${entry.category.name}) on page ${match.page}`),
      };
    },

    // "Add all doors on this sheet": every tag shaped like the example on
    // one page, as items of one category, skipping ones already items.
    async add_all_from_plan({ category_id: categoryId, like, page, entity_id: entityId = null } = {}) {
      const b = bridge();
      const { entry, entity } = itemTarget(b, categoryId, entityId);
      if (typeof b.findAllOnPlan !== 'function') throw new ToolError('The plan cannot be searched here.');
      if (!tagShape(like)) throw new ToolError('Give an example tag with its letters, for example D-117, so I know what to look for.');
      const onPage = Number(page) || b.getCurrentPage?.() || null;
      if (!onPage) throw new ToolError('Say which page to look on.');
      const { matches, unread } = await b.findAllOnPlan(like, onPage);
      if (unread) throw new ToolError(`Page ${onPage} has no text to read. Run text recognition on it first.`);
      const markers = Object.entries(b.markers || {});
      const fresh = matches.filter((m) => !sameNamed(b, categoryId, m.name)
        && !markers.some(([, marker]) => marker?.pageNumber === onPage && boundsCover(marker.bounds, m.box)));
      const already = matches.length - fresh.length;
      const added = [];
      const changes = [];
      for (const m of fresh.slice(0, MAX_BULK_ITEMS)) {
        const itemId = addItem(b, entry, entity, m.name, onPage, m.box);
        if (!itemId) break;
        added.push(m.name);
        changes.push(createdChange(b, itemId, `Added ${m.name} (${entry.category.name}) on page ${onPage}`));
      }
      if (fresh.length && !added.length) throw new ToolError('The items could not be added. Is Survey mode open on this document?');
      const parts = [`Found ${matches.length} tag${matches.length === 1 ? '' : 's'} like ${like} on page ${onPage}.`];
      if (added.length) parts.push(`Added ${added.length} as ${entry.category.name}: ${added.join(', ')}.`);
      if (already) parts.push(already === 1 ? '1 was already an item.' : `${already} were already items.`);
      if (fresh.length > added.length) parts.push(`${fresh.length - added.length} more not added; ask again to add the rest.`);
      return { content: parts.join(' '), changes };
    },

    // "What's left on this sheet?": each item's checklist progress on one
    // page (default the page on screen) or the whole survey.
    survey_status({ page = null, all_pages: allPages = false, category_id: categoryId = null, floor = null } = {}) {
      const b = bridge();
      const index = categoryIndex(b.template);
      const floorKey = floorKeyOf(floor);
      // A floor spans pages: it reads across the survey unless a page is named.
      const onPage = allPages || (floorKey && !Number(page)) ? null : (Number(page) || b.getCurrentPage?.() || null);
      let kind = null;
      if (categoryId) {
        kind = index.list.find((e) => e.category.id === categoryId) || null;
        if (!kind) throw new ToolError(`No category ${categoryId}. Use get_survey_context for the category ids.`);
      }
      const all = Object.values(b.markers || {}).filter(Boolean);
      if (floorKey && !all.some((m) => floorKeyOf(m.floor))) {
        throw new ToolError('No item in this survey has a floor set, so I cannot tell floors apart. Ask which page that floor is on.');
      }
      const items = Object.entries(b.markers || {})
        .filter(([, m]) => m && (onPage == null || m.pageNumber === onPage))
        .filter(([, m]) => !kind || m.categoryId === kind.category.id)
        .filter(([, m]) => !floorKey || floorKeyOf(m.floor) === floorKey)
        .map(([id, m]) => {
          const entry = index.find(m.moduleId, m.categoryId);
          const checklist = entry ? activeChecklist(entry.category) : [];
          const responses = m.checklistResponses || {};
          const missing = checklist.filter((c) => !responses[c.id]?.selection).map(itemText);
          return { id, name: nameOf(m), total: checklist.length, missing };
        })
        .sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
      const done = items.filter((i) => !i.missing.length);
      const notStarted = items.filter((i) => i.total && i.missing.length === i.total);
      const partly = items.filter((i) => i.missing.length && i.missing.length < i.total);
      const names = (list) => list.slice(0, STATUS_LIST_MAX).map((i) => i.name);
      return {
        content: out({
          scope: [onPage == null ? (floorKey ? `floor ${String(floor).trim()}` : 'whole survey') : `page ${onPage}`, kind ? kind.category.name : null].filter(Boolean).join(', '),
          items: items.length,
          done: done.length,
          not_started: { count: notStarted.length, names: names(notStarted) },
          partly_done: {
            count: partly.length,
            items: partly.slice(0, STATUS_LIST_MAX).map((i) => ({ name: i.name, missing: i.missing.slice(0, 6) })),
          },
        }),
      };
    },

    // "Wrap up": what this walk did (the items worked on in this chat), or
    // a page, or the whole survey, with the items that have issues. The
    // panel offers the text to save or share.
    walk_summary({ scope = 'walk', page = null, save = false } = {}) {
      const b = bridge();
      const walked = typeof walkItems === 'function' ? walkItems() : [];
      const useWalk = scope === 'walk' && walked.length > 0;
      const onPage = scope === 'page' ? (Number(page) || b.getCurrentPage?.() || null) : null;
      const summary = summarizeSurvey({ template: b.template, markers: b.markers, itemIds: useWalk ? walked : null, page: onPage });
      const label = useWalk ? 'this walk' : onPage ? `page ${onPage}` : 'the whole survey';
      const title = `${b.template.name || 'Survey'}: summary of ${label}`;
      return {
        content: out({
          scope: label,
          ...(scope === 'walk' && !useWalk ? { note: 'Nothing was worked on in this chat yet, so this is the whole survey.' } : {}),
          totals: summary.totals,
          categories: summary.categories.map((c) => ({
            name: c.name,
            items: c.items,
            done: c.done,
            partly_done: c.partly,
            not_started: c.notStarted,
            with_issues: c.issues.slice(0, STATUS_LIST_MAX).map((i) => ({ name: i.name, issues: i.lines.slice(0, 4).map((l) => `${l.text} = ${l.answer}`) })),
          })),
        }),
        summary: { title, text: summaryText(summary, { title }), ...(save === true ? { save: true } : {}) },
      };
    },

    // "Circle D-117", "cloud this area": a shape around an item, a plan tag
    // or what is on screen, drawn the way the person's own tools draw it.
    mark_on_plan({ shape, item_id: itemId, plan_match_id: matchId, on_screen: onScreen, color } = {}) {
      const b = bridge();
      if (b.canEdit === false) throw new ToolError('This person can only view this document, so nothing can be drawn.');
      const doc = typeof getDocument === 'function' ? getDocument() : null;
      if (!doc?.addShape) throw new ToolError('Drawing on the plan is not available here.');
      const kind = ['circle', 'box', 'cloud'].includes(shape) ? shape : 'circle';
      const picked = [itemId, matchId, onScreen === true].filter(Boolean).length;
      if (picked !== 1) throw new ToolError('Say what to mark: one item, one plan tag, or what is on screen.');
      let page;
      let box;
      let what;
      if (itemId) {
        const marker = markerOf(b, itemId);
        if (!marker.pageNumber || !marker.bounds) throw new ToolError(`${nameOf(marker)} is not placed on the plan, so there is nothing to mark.`);
        page = marker.pageNumber;
        box = marker.bounds;
        what = nameOf(marker);
      } else if (matchId) {
        const match = planMatches.get(matchId);
        if (!match) throw new ToolError(`No plan match ${matchId}. Use find_on_plan first.`);
        page = match.page;
        box = match.box;
        what = match.text ? `"${match.text}"` : 'that tag';
      } else {
        page = b.getCurrentPage?.() || null;
        const size = page && (doc.getPageSize?.(page) || b.getPageSize?.(page));
        box = size ? visiblePageBox(page, size) : null;
        if (!box) throw new ToolError('Could not tell which part of the plan is on screen. Name an item to mark instead.');
        what = 'the area on screen';
      }
      const size = doc.getPageSize?.(page) || b.getPageSize?.(page);
      if (!size) throw new ToolError('That page is not in the open document.');
      const at = markBox(box, size, { shape: kind, inset: !itemId && !matchId });
      const res = doc.addShape({
        page,
        shape: kind === 'circle' ? 'ellipse' : 'rect',
        ...at,
        strokeColor: MARK_COLOR_HEX[color] || MARK_COLOR_HEX.red,
        strokeWidth: 2,
        ...(kind === 'cloud' ? { borderStyle: 'cloud' } : {}),
      });
      if (res?.reason === 'locked') throw new ToolError('A locked annotation on that page blocked the save, so nothing was drawn.');
      if (!res?.ok) throw new ToolError('Could not draw that on the plan.');
      const word = { circle: 'a circle', box: 'a box', cloud: 'a cloud' }[kind];
      const label = `Drew ${word} around ${what} on page ${page}.`;
      return {
        content: res.id ? `${label.slice(0, -1)} (id ${res.id}).` : label,
        ...(res.id ? { change: { annotationId: res.id, documentId: b.documentId || null, label } } : {}),
      };
    },

    // KAL-529: offer a new checklist line or category. Nothing changes here;
    // the panel shows a Yes / No card and adds it only on Yes.
    offer_checklist_line({ category_id: categoryId, text, item_id: itemId = null, answer = null } = {}) {
      const b = bridge();
      offerAllowed(b);
      const line = String(text || '').trim().replace(/\s+/g, ' ').slice(0, OFFER_TEXT_MAX);
      if (!line) throw new ToolError('Say what the new line is.');
      const entry = categoryIndex(b.template).list.find(({ category }) => category.id === categoryId);
      if (!entry) throw new ToolError(`No category with id ${categoryId}. Use get_survey_context.`);
      const have = activeChecklist(entry.category).find((l) => sameWords(itemText(l), line));
      if (have) throw new ToolError(`${entry.category.name} already has the line "${itemText(have)}" (id ${have.id}). Answer that one instead; nothing was offered.`);
      const key = `line|${entry.category.id}|${offerKey(line)}`;
      if (offered.has(key)) throw new ToolError('That line was already offered in this chat. Do not offer it again.');
      let item = null;
      if (itemId) {
        const marker = markerOf(b, itemId);
        if (marker.categoryId !== entry.category.id) throw new ToolError(`${nameOf(marker)} is not a ${entry.category.name}. Offer the line on its own category, or leave item_id out.`);
        item = { id: itemId, name: nameOf(marker) };
      }
      const value = answer == null ? null : String(answer).trim();
      if (value && !answerSetFor(b.template).some((a) => a.value === value)) {
        throw new ToolError(`"${value}" is not one of this template's answers (${answerSetFor(b.template).map((a) => a.value).join(', ')}).`);
      }
      offered.add(key);
      return {
        content: `Offered to add "${line}" to ${entry.category.name}. The person decides on a Yes / No card under your reply; nothing is added yet. Ask them to tap Yes if they want it, and do not say it was added.`,
        offer: {
          kind: 'line',
          documentId: b.documentId || null,
          moduleId: entry.module.id,
          categoryId: entry.category.id,
          categoryName: entry.category.name,
          text: line,
          ...(item && value ? { itemId: item.id, itemName: item.name, answer: value } : {}),
        },
      };
    },

    offer_category({ name } = {}) {
      const b = bridge();
      offerAllowed(b);
      const label = String(name || '').trim().replace(/\s+/g, ' ').slice(0, OFFER_TEXT_MAX);
      if (!label) throw new ToolError('Say what the new category is called.');
      const module = modulesOf(b.template).find((m) => m.id === b.currentModuleId) || modulesOf(b.template)[0];
      if (!module) throw new ToolError('This template has no module to add a category to.');
      const have = categoriesOf(module).find((c) => sameWords(c.name, label));
      if (have) throw new ToolError(`${module.name || 'This module'} already has the category ${have.name} (id ${have.id}); nothing was offered.`);
      const key = `category|${module.id}|${offerKey(label)}`;
      if (offered.has(key)) throw new ToolError('That category was already offered in this chat. Do not offer it again.');
      offered.add(key);
      return {
        content: `Offered to add the category ${label}${module.name ? ` to ${module.name}` : ''}. The person decides on a Yes / No card under your reply; nothing is added yet. Do not say it was added.`,
        offer: { kind: 'category', documentId: b.documentId || null, moduleId: module.id, moduleName: module.name || null, name: label },
      };
    },

    // KAL-532: "is the reader mounted in the photo?"
    async ask_about_photo({ item_id: itemId = null, photo = null, attachment_id: attachmentId = null, question } = {}) {
      const b = bridge();
      if (typeof askPhoto !== 'function') throw new ToolError('Photo questions are not on here.');
      const asked = String(question || '').trim();
      if (!asked) throw new ToolError('Say what to find out from the photo.');
      if (Boolean(itemId) === Boolean(attachmentId)) throw new ToolError('Give item_id or attachment_id, not both.');
      let blob;
      let what;
      if (attachmentId) {
        const a = attachments.get(attachmentId);
        if (!a) throw new ToolError(`No file ${attachmentId} in this chat.`);
        if (a.kind !== 'photo') throw new ToolError(`${a.name || attachmentId} is not a photo.`);
        blob = a.file;
        what = a.name || 'the photo';
      } else {
        const marker = markerOf(b, itemId);
        const photos = typeof b.photosOf === 'function' ? b.photosOf(itemId) : [];
        if (!photos.length) throw new ToolError(`${nameOf(marker)} has no photos.`);
        const n = photo == null ? photos.length : Number(photo);
        if (!Number.isInteger(n) || n < 1 || n > photos.length) {
          throw new ToolError(`${nameOf(marker)} has ${photos.length} photo${photos.length === 1 ? '' : 's'}; say which, 1 to ${photos.length}.`);
        }
        if (typeof b.readMedia !== 'function') throw new ToolError('Photos cannot be read here.');
        blob = await b.readMedia(photos[n - 1]);
        what = `photo ${n} of ${photos.length} on ${nameOf(marker)}`;
      }
      if (!blob) throw new ToolError('Could not open that photo.');
      const answer = String(await askPhoto({ blob, question: asked }) || '').trim();
      if (!answer) throw new ToolError('The photo check gave no answer. Try again.');
      return { content: out({ photo: what, answer }) };
    },

    show_item({ item_id: itemId } = {}) {
      const b = bridge();
      const marker = markerOf(b, itemId);
      b.showMarker(itemId);
      return { content: `Showing ${nameOf(marker)}.` };
    },
    // The server sends the markup tools on the model's next step.
    open_markup_tools() {
      return { content: 'The annotation tools are ready.' };
    },

    // The chat's own Undo, by voice: "no, that was D-118" or "undo that".
    undo_last_turn() {
      bridge();
      const result = undoLastTurn?.();
      if (!result) throw new ToolError('There is nothing of yours to take back in this chat.');
      const kept = result.kept ? `, ${result.kept} kept because they were changed again since` : '';
      return { content: `Took back the last changes: ${result.reverted} reverted${kept}.` };
    },
  };

  return {
    async run(name, input) {
      const extra = extras.get(name);
      if (extra) {
        try {
          if (extra.access?.minRole === 'editor' && getBridge()?.canEdit === false) {
            throw new ToolError('This person can only view this document, so nothing can be changed.');
          }
          const content = await extra.execute(placeNear(name, input || {}));
          const text = typeof content === 'string' ? content : out(content);
          // "Added a text note on page 1 (id abc)." -> Undo can delete it.
          const added = name.startsWith('add_') && text.match(/\s*\(id ([^)\s]+)\)\.?\s*$/);
          if (!added) return { isError: false, content: text };
          return {
            isError: false,
            content: text,
            change: { annotationId: added[1], documentId: getBridge()?.documentId || null, label: `${text.slice(0, added.index)}.` },
          };
        } catch (err) {
          return { content: err?.message || 'That failed.', isError: true };
        }
      }
      const fn = tools[name];
      if (!fn) return { content: `Unknown tool ${name}.`, isError: true };
      // Learned names are read by the item lookups: load them once first.
      const projectId = getBridge()?.projectId;
      if (memory && projectId) await memory.list(projectId).catch((err) => console.warn('[survey-agent] memory not loaded', err));
      try {
        return { isError: false, ...(await fn(input || {})) };
      } catch (err) {
        if (err instanceof ToolError) return { content: err.message, isError: true };
        console.warn('[survey-agent] tool failed', name, err);
        return { content: err?.message ? `That failed: ${err.message}` : 'That failed.', isError: true };
      }
    },
    // Records what the auto-entity rule did, once the app has re-rendered
    // after a turn.
    settle(changes) {
      const b = getBridge();
      const list = changes || [];
      list.forEach((change, index) => {
        for (const field of change.fields || []) {
          if (field.type !== 'autoEntity' || field.after !== undefined) continue;
          // A later entity write on the same item saw what auto-complete left;
          // only with none since is the item's entity now that value.
          const later = list.slice(index + 1)
            .filter((c) => c.itemId === change.itemId)
            .flatMap((c) => c.fields || [])
            .find((f) => f.type === 'entity' || f.type === 'autoEntity');
          if (later) field.after = later.before ?? null;
          else if (b?.markers?.[change.itemId]) field.after = b.markers[change.itemId].entityId || null;
        }
      });
    },
    // Takes back `changes` (one turn's, oldest first). A field goes back only
    // while it still holds what the agent wrote, so a later tap or a later
    // agent turn is kept. Returns { reverted, kept } field counts.
    undo(changes) {
      const b = getBridge();
      const result = { reverted: 0, kept: 0 };
      const list = (Array.isArray(changes) ? changes : [changes]).filter(Boolean);
      // One working copy per item, newest change first, written once: the
      // bridge's markers only refresh after the app re-renders.
      const work = new Map();
      const removed = new Set();
      for (const change of [...list].reverse()) {
        if (change.memory) {
          // Learned names and wording: put back what was there before.
          const { projectId, row, before, removed: forgotten } = change.memory;
          const job = forgotten
            ? Promise.all(forgotten.map((r) => memory?.restore(projectId, r)))
            : before ? memory?.restore(projectId, before) : memory?.removeSaved(projectId, row);
          Promise.resolve(job).catch((err) => console.warn('[survey-agent] memory undo failed', err));
          result.reverted += 1;
          continue;
        }
        if (change.annotationId) {
          const doc = typeof getDocument === 'function' ? getDocument() : null;
          const sameDoc = (b?.documentId || null) === (change.documentId || null);
          const res = doc && sameDoc && doc.findAnnotation?.(change.annotationId) ? doc.deleteAnnotation(change.annotationId) : null;
          if (res?.ok) result.reverted += 1; else result.kept += 1;
          continue;
        }
        const marker = b?.markers?.[change.itemId];
        if (!marker || (b.documentId || null) !== (change.documentId || null)) {
          result.kept += change.fields?.length || 0;
          continue;
        }
        if (!work.has(change.itemId)) {
          work.set(change.itemId, {
            checklistResponses: clone(marker.checklistResponses) || {},
            note: clone(marker.note),
            entityId: marker.entityId || null,
          });
        }
        const item = work.get(change.itemId);
        let answersIntact = true;
        for (const field of change.fields || []) {
          if (field.type === 'answer') {
            if ((item.checklistResponses[field.id]?.selection ?? null) === field.after) {
              if (field.before) item.checklistResponses[field.id] = clone(field.before);
              else delete item.checklistResponses[field.id];
              result.reverted += 1;
            } else {
              answersIntact = false;
              result.kept += 1;
            }
          } else if (field.type === 'autoEntity') {
            if (answersIntact && field.after !== undefined && field.after !== field.before && item.entityId === field.after) {
              item.entityId = field.before;
            }
          } else if (field.type === 'entity') {
            if (item.entityId === field.after) { item.entityId = field.before; result.reverted += 1; } else result.kept += 1;
          } else if (field.type === 'note') {
            const same = noteTextOf(item.note).trimEnd() === String(field.afterText || '').trimEnd()
              && (field.afterMedia == null || mediaCountOf(item.note) === field.afterMedia);
            if (same) { item.note = clone(field.before); result.reverted += 1; } else result.kept += 1;
          } else if (field.type === 'create') {
            // Remove an added item only while nobody has filled anything in.
            const untouched = !Object.values(item.checklistResponses || {}).some((r) => r?.selection)
              && !noteTextOf(item.note).trim() && !mediaCountOf(item.note);
            if (untouched && typeof b.deleteMarker === 'function') { removed.add(change.itemId); result.reverted += 1; } else result.kept += 1;
          }
        }
      }
      for (const [itemId, snapshot] of work) {
        if (removed.has(itemId)) b.deleteMarker(itemId);
        else b.restoreMarker(itemId, snapshot);
      }
      return result;
    },
  };
}
