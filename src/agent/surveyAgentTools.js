// The Survey agent's tools, run in the app on the open document (KAL-527).
// The model (survey-agent edge function) only asks for a tool; this file
// answers it through the Survey panel's own writes (the "bridge" the panel
// publishes), so sync, Excel rows, auto-entity and role checks behave exactly
// as if the person had tapped. Every write returns a change with an undo.
import { answerSetFor } from '../services/answerSets.js';
import { categoriesOf, checklistOf, entitiesOf, itemText, modulesOf } from '../services/templateConfigShape.js';
import { MARK_COLOR_HEX, normalizeItemName, scoreItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';
import { markBox, visiblePageBox } from './planView.js';
import { answerSetMeaning, moduleKind, moduleMeaning } from '../../supabase/functions/_shared/surveyAgentMeaning.js';
import { boundsCover, findDescribedOnPages, markerBoxAroundTag, tagShape } from './planText.js';
import { kindOf, parseDescribedTarget, scoreDescribedTag } from './spokenTag.js';
import { summarizeSurvey, summaryText } from '../services/surveySummary.js';

export { normalizeItemName, scoreItemName };

// One add_all_from_plan call adds at most this many; the rest on asking again.
const MAX_BULK_ITEMS = 60;
// survey_status names at most this many items per group; the counts are whole.
const STATUS_LIST_MAX = 20;

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
  const markerIdByName = (b, name) => {
    const heard = String(name || '').trim();
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
    if (!scored.length) throw new ToolError(`No item named ${heard}. Check with find_items or find_on_plan; nothing changed.`);
    const names = (exact.length ? exact : scored).map((m) => m.name).sort((a, b2) => a.localeCompare(b2, undefined, { numeric: true }));
    throw new ToolError(`Several items match ${heard}: ${names.slice(0, 5).join(', ')}. Ask which one; nothing changed.`);
  };
  const writable = (b) => {
    if (b.canEdit === false) throw new ToolError('This person can only view this document, so nothing can be changed.');
  };
  const nameOf = (marker) => marker?.name || 'Unnamed item';
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

  const tools = {
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
            checklist: activeChecklist(category).map((item) => ({ id: item.id, text: itemText(item) })),
          })),
          entities: entitiesOf(b.template).map((e) => ({ id: e.id, name: e.name })),
          // What plain talk means in each module ("it's installed", "it works").
          modules: allModules.map((m) => ({ name: m.name || null, kind: moduleKind(m.name), meaning: moduleMeaning(m.name) })),
          current_module: current ? current.name || null : null,
          selected_item: selected ? { id: b.selectedMarkerId, name: nameOf(selected) } : null,
          page_on_screen: b.getCurrentPage?.() || null,
          can_edit: b.canEdit !== false,
        }),
      };
    },

    find_items({ query, category_id: categoryId } = {}) {
      const b = bridge();
      if (!String(query || '').trim()) throw new ToolError('Say which item to look for.');
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
    async set_answers({ item_id: givenId, item_name: itemName, answers, all_lines: allLines = null, note = null } = {}) {
      const b = bridge();
      writable(b);
      const itemId = givenId || markerIdByName(b, itemName);
      const marker = markerOf(b, itemId);
      const entry = categoryIndex(b.template).find(marker.moduleId, marker.categoryId);
      const addition = String(note || '').trim();
      const named = Array.isArray(answers) ? answers : [];
      if (!named.length && !allLines && !addition) throw new ToolError('No answers given.');
      if ((named.length || allLines) && !entry) throw new ToolError('This item has no category in the template, so it has no checklist.');
      const lines = entry ? activeChecklist(entry.category) : [];
      const checklist = new Map(lines.map((item) => [item.id, item]));
      const allowed = answerSetFor(b.template).map((a) => a.value);
      // Lines of the same item in another module ("it has an IP" while
      // Installation is open is a Commissioning line): those answers go to
      // that module's item of the same name, added at the same spot if the
      // person has not placed it there yet.
      const elsewhere = new Map();
      for (const a of named) {
        if (!allowed.includes(a?.value)) throw new ToolError(`"${a?.value}" is not an allowed answer. Allowed: ${allowed.join(', ')}.`);
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
      const list = [...own, ...(allLines ? lines.filter((l) => !given.has(l.id)).map((l) => ({ checklist_item_id: l.id, value: allLines })) : [])];
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
      return {
        content: [what ? `Set ${what} on ${nameOf(marker)}${givenId ? '' : ` (item id ${itemId})`}.` : '', elsewhereText].filter(Boolean).join(' '),
        ...((all) => (all.length === 1 ? { change: all[0] } : { changes: all }))([...(ownChange ? [ownChange] : []), ...siblingChanges.flatMap((c) => c.changes)]),
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
      const marker = markerOf(b, itemId);
      const entity = entityId ? entitiesOf(b.template).find((e) => e.id === entityId) : null;
      if (entityId && !entity) throw new ToolError(`${entityId} is not one of this template's entities.`);
      const field = { type: 'entity', before: marker.entityId || null, after: entity?.id || null };
      b.setEntity(itemId, entity?.id || null);
      return {
        content: entity ? `Set ${nameOf(marker)} to ${entity.name}.` : `Cleared the entity on ${nameOf(marker)}.`,
        change: { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: entity ${entity ? entity.name : 'cleared'}`, fields: [field] },
      };
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
          ...(covering ? { already_item: { id: covering[0], name: nameOf(covering[1]) } } : {}),
        };
      });
      return {
        content: out({
          matches,
          ...(found?.unreadPages?.length ? { pages_without_text: found.unreadPages.length } : {}),
        }),
      };
    },

    // "Find camera 6 on the 4th floor": the kind, the number and maybe the
    // floor or wing, never the whole tag. Items first, then tags on the plan.
    async find_described({ description = '', kind = null, number = null, floor = null, wing = null } = {}) {
      const b = bridge();
      const parsed = parseDescribedTarget(description) || {};
      const said = String(kind || '').trim().toLowerCase();
      const target = {
        kind: said ? (kindOf(said) || said) : parsed.kind || null,
        kindWord: said || parsed.kindWord || null,
        code: parsed.code || null,
        number: Number.isFinite(Number(number)) && number !== null ? Number(number) : parsed.number ?? null,
        floor: Number.isFinite(Number(floor)) && floor !== null ? Number(floor) : parsed.floor ?? null,
        wing: ({ west: 'w', east: 'e', north: 'n', south: 's' })[String(wing || '').toLowerCase()] || parsed.wing || null,
      };
      if (target.number == null) throw new ToolError('Say the number of the one to find, for example camera 6.');
      const { pages = [], unreadPages = [] } = typeof b.readSheets === 'function' ? await b.readSheets() : {};
      const sheetOfPage = new Map(pages.map((p) => [p.page, p.sheet || {}]));
      const { find } = categoryIndex(b.template);
      const items = [];
      for (const [id, marker] of Object.entries(b.markers || {})) {
        if (!marker) continue;
        const entry = find(marker.moduleId, marker.categoryId);
        const sheet = sheetOfPage.get(marker.pageNumber) || {};
        const score = scoreDescribedTag(target, marker.name, { category: entry?.category?.name, pageFloor: sheet.floor ?? null, pageWing: sheet.wing ?? null });
        if (score < 0.5) continue;
        items.push({
          id,
          name: nameOf(marker),
          category: entry?.category?.name || null,
          ...(entry?.module?.name ? { module: entry.module.name } : {}),
          page: marker.pageNumber || null,
          ...(sheet.floor != null ? { sheet_floor: sheet.floor } : {}),
          score,
          here: !b.currentModuleId || marker.moduleId === b.currentModuleId,
          moduleId: marker.moduleId,
        });
      }
      // The same item in several modules (same name, same page): the open
      // module's one. Same-named items on other pages, or in one module, are
      // separate devices and all stay, so the agent can ask which.
      items.sort((x, y) => y.score - x.score || Number(y.here) - Number(x.here) || x.name.localeCompare(y.name, undefined, { numeric: true }));
      const keptModules = new Map();
      const shownItems = items.filter((m) => {
        const key = `${normalizeItemName(m.name)}|${m.page}`;
        const modules = keptModules.get(key);
        if (modules && !modules.has(m.moduleId)) return false;
        keptModules.set(key, (modules || new Set()).add(m.moduleId));
        return true;
      }).slice(0, 5).map(({ here: _, moduleId: __, ...m }) => m);
      const markers = Object.entries(b.markers || {});
      const plan = findDescribedOnPages(target, pages, { score: scoreDescribedTag })
        .map((m) => {
          const covering = markers.find(([, marker]) => marker?.pageNumber === m.page && boundsCover(marker.bounds, m.box));
          const id = `plan-${planMatches.size + 1}`;
          planMatches.set(id, m);
          return {
            id,
            page: m.page,
            text: m.text,
            ...(m.sheetFloor != null ? { sheet_floor: m.sheetFloor } : {}),
            score: m.score,
            ...(covering ? { already_item: { id: covering[0], name: nameOf(covering[1]) } } : {}),
          };
        })
        .slice(0, 5);
      return {
        content: out({
          looked_for: { kind: target.kind, number: target.number, floor: target.floor, wing: target.wing },
          items: shownItems,
          plan,
          ...(unreadPages.length ? { pages_without_text: unreadPages.length } : {}),
        }),
      };
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
    survey_status({ page = null, all_pages: allPages = false } = {}) {
      const b = bridge();
      const onPage = allPages ? null : (Number(page) || b.getCurrentPage?.() || null);
      const index = categoryIndex(b.template);
      const items = Object.entries(b.markers || {})
        .filter(([, m]) => m && (onPage == null || m.pageNumber === onPage))
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
          scope: onPage == null ? 'whole survey' : `page ${onPage}`,
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
    walk_summary({ scope = 'walk', page = null } = {}) {
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
        summary: { title, text: summaryText(summary, { title }) },
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
      if (res?.reason === 'locked') throw new ToolError('A locked markup on that page blocked the save, so nothing was drawn.');
      if (!res?.ok) throw new ToolError('Could not draw that on the plan.');
      const word = { circle: 'a circle', box: 'a box', cloud: 'a cloud' }[kind];
      const label = `Drew ${word} around ${what} on page ${page}.`;
      return {
        content: res.id ? `${label.slice(0, -1)} (id ${res.id}).` : label,
        ...(res.id ? { change: { annotationId: res.id, documentId: b.documentId || null, label } } : {}),
      };
    },

    show_item({ item_id: itemId } = {}) {
      const b = bridge();
      const marker = markerOf(b, itemId);
      b.showMarker(itemId);
      return { content: `Showing ${nameOf(marker)}.` };
    },
    // The server sends the markup tools on the model's next step.
    open_markup_tools() {
      return { content: 'The markup tools are ready.' };
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
