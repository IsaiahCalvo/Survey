// The Survey agent's tools, run in the app on the open document (KAL-527).
// The model (survey-agent edge function) only asks for a tool; this file
// answers it through the Survey panel's own writes (the "bridge" the panel
// publishes), so sync, Excel rows, auto-entity and role checks behave exactly
// as if the person had tapped. Every write returns a change with an undo.
import { answerSetFor } from '../services/answerSets.js';
import { categoriesOf, checklistOf, entitiesOf, itemText, modulesOf } from '../services/templateConfigShape.js';
import { normalizeItemName, scoreItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';
import { boundsCover, markerBoxAroundTag, tagShape } from './planText.js';

export { normalizeItemName, scoreItemName };

// One add_all_from_plan call adds at most this many; the rest on asking again.
const MAX_BULK_ITEMS = 60;

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
      const multiModule = modulesOf(b.template).length > 1;
      const selected = b.selectedMarkerId && b.markers?.[b.selectedMarkerId];
      return {
        content: out({
          template: b.template.name || null,
          answers: answerSetFor(b.template).map((a) => a.value),
          categories: list.map(({ module, category }) => ({
            id: category.id,
            name: category.name,
            ...(multiModule ? { module: module.name } : {}),
            item_count: counts.get(category.id) || 0,
            ...(examples.has(category.id) ? { example_item: examples.get(category.id) } : {}),
            checklist: activeChecklist(category).map((item) => ({ id: item.id, text: itemText(item) })),
          })),
          entities: entitiesOf(b.template).map((e) => ({ id: e.id, name: e.name })),
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
            on_plan: Boolean(marker.pageNumber && marker.bounds),
            score: Math.round(score * 100) / 100,
          });
        }
      }
      matches.sort((a, b2) => b2.score - a.score || a.name.localeCompare(b2.name));
      return { content: out({ matches: matches.slice(0, 5) }) };
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

    set_answers({ item_id: itemId, answers } = {}) {
      const b = bridge();
      writable(b);
      const marker = markerOf(b, itemId);
      const entry = categoryIndex(b.template).find(marker.moduleId, marker.categoryId);
      if (!entry) throw new ToolError('This item has no category in the template, so it has no checklist.');
      const checklist = new Map(activeChecklist(entry.category).map((item) => [item.id, item]));
      const allowed = answerSetFor(b.template).map((a) => a.value);
      const list = Array.isArray(answers) ? answers : [];
      if (!list.length) throw new ToolError('No answers given.');
      for (const a of list) {
        if (!checklist.has(a?.checklist_item_id)) throw new ToolError(`${a?.checklist_item_id} is not on the ${entry.category.name} checklist. Use get_item for its checklist ids.`);
        if (!allowed.includes(a?.value)) throw new ToolError(`"${a?.value}" is not an allowed answer. Allowed: ${allowed.join(', ')}.`);
      }
      const responses = marker.checklistResponses || {};
      const fields = list.map((a) => ({ type: 'answer', id: a.checklist_item_id, before: clone(responses[a.checklist_item_id]), after: a.value }));
      // A tap's answer can move the entity (auto-entity rule). What it moved
      // to is only known once the app re-renders: settle() fills `after`.
      fields.push({ type: 'autoEntity', before: marker.entityId || null, after: undefined });
      b.setAnswers(itemId, list.map((a) => ({ checklistItemId: a.checklist_item_id, value: a.value })));
      const label = list.map((a) => `${itemText(checklist.get(a.checklist_item_id))} = ${a.value}`).join('; ');
      return {
        content: `Set ${list.length} answer${list.length === 1 ? '' : 's'} on ${nameOf(marker)}.`,
        change: { itemId, documentId: b.documentId || null, label: `${nameOf(marker)}: ${label}`, fields },
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

    show_item({ item_id: itemId } = {}) {
      const b = bridge();
      const marker = markerOf(b, itemId);
      b.showMarker(itemId);
      return { content: `Showing ${nameOf(marker)}.` };
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
