// The Survey agent with no signal (Nightly flag survey-agent-offline): the
// common things said on a walk are done on the device at once, by plain
// rules, instead of waiting for the server. Anything the rules can't read
// exactly still waits for the signal, as before.
//
// What it reads (English), each word accounted for or it leaves it alone:
//   "D-117 lock installed yes, card reader no"  answers by line text
//   "D-117 all yes" / "everything N/A"          every line of the item
//   "D-117 note no power at the door"           adds to the note
//   "mark D-117 complete"                       sets the entity, by its exact name
//   "D-117"                                     shows the item
//   "undo" / "undo that"                        takes back the last change
//   "camera 2 on the second floor, power yes"   a described item (below)
// With no item name, the selected item is used. An item is named by its
// exact name (normalized as the agent does: "D one seventeen" is D-117); a
// line by its exact words; an answer by its own value or the fixed spoken
// words below. Never a best guess (suite rule).
//
// Nothing here knows a trade. Lines, answers, entities (Installed, Rough-in,
// Tested ...) and kinds of device all come from the project's own template
// and items. A described item ("smoke detector 4, third floor") is found
// by the same rules as the agent's find_described: the item's own floor and
// wing when Walkthru or Plot brought them, else the sheet title's; with no
// item yet (a bare PDF), the tag printed on the plan, made an item when one
// category of the open module is that kind. When more than one fits, or a
// state word ("done") is no entity's name, it asks and changes nothing.
import { APP_ONLY_KINDS, answerSetFor, itemKind } from '../services/answerSets.js';
import { categoriesOf, checklistOf, entitiesOf, itemText, modulesOf } from '../services/templateConfigShape.js';
import { normalizeItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';
import { clearBest, projectKinds } from './surveyAgentTools.js';
import { parseDescribedTarget, templateKinds } from './spokenTag.js';
import { parsePlaceTarget } from './placeFind.js';
import { learnedStateFor } from './agentMemory.js';

// Fixed spoken forms of the usual answers, keyed by the answer's own value
// (lower case). An answer set's own values are always heard as themselves.
const SPOKEN_ANSWERS = Object.freeze({
  y: ['yes', 'yeah', 'yep'],
  yes: ['y', 'yeah', 'yep'],
  n: ['no', 'nope'],
  no: ['n', 'nope'],
  'n/a': ['n a', 'na', 'not applicable'],
  pass: ['passed', 'passes'],
  fail: ['failed', 'fails'],
});
const ALL_WORDS = [['all'], ['everything'], ['all', 'lines'], ['every', 'line'], ['all', 'of', 'it']];
const NOTE_WORDS = [['note'], ['add', 'note'], ['add', 'a', 'note'], ['add', 'to', 'note'], ['add', 'to', 'the', 'note']];
const UNDO_SAID = new Set(['undo', 'undo that', 'undo it', 'undo last', 'take that back', 'take it back']);
// Words that may sit between the parts and mean nothing on their own.
const FILLER = new Set(['set', 'mark', 'is', 'are', 'to', 'as', 'on', 'for', 'item', 'and', 'then', 'it', 'its', 'was', 'answer', 'please', 'ok', 'okay', 'so']);
const ARTICLES = new Set(['the', 'a', 'an']);
const NAME_SPAN_MAX = 6;

/** The words of a sentence with where each sits in it ("N/A" stays one word). */
export function wordsOf(text) {
  const out = [];
  const source = String(text || '');
  for (const m of source.matchAll(/n\s*\/\s*a\b|[\p{L}\p{N}]+(?:[-/.'][\p{L}\p{N}]+)*/giu)) {
    const raw = m[0].toLowerCase();
    // "D-117" and "1.5" stay one word for names; lines and answers split them.
    out.push({ w: raw.replace(/\s+/g, ''), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const plainWords = (text) => wordsOf(text).flatMap((t) => (t.w === 'n/a' ? ['n/a'] : t.w.split(/[-/.']/))).filter(Boolean);
const withoutArticles = (words) => words.filter((w) => !ARTICLES.has(w));

const choiceLines = (category) => checklistOf(category)
  .map((item, index) => (typeof item === 'string' ? { id: `item-${index}`, text: item } : item))
  .filter((item) => item && item.id && item.archived !== true && !APP_ONLY_KINDS.includes(itemKind(item)) && itemKind(item) === 'choice');

function categoryOf(template, marker) {
  let fallback = null;
  for (const module of modulesOf(template)) {
    for (const category of categoriesOf(module)) {
      if (category.id !== marker?.categoryId) continue;
      if (module.id === marker.moduleId) return category;
      fallback = fallback || category;
    }
  }
  return fallback;
}

function answerForms(template) {
  const forms = [];
  for (const { value } of answerSetFor(template)) {
    const key = String(value).toLowerCase();
    const said = [key, ...(SPOKEN_ANSWERS[key] || [])];
    for (const s of said) {
      const words = s === 'n/a' ? ['n/a'] : withoutArticles(plainWords(s));
      if (words.length) forms.push({ value, words });
    }
  }
  // The same spoken words for two answers (a set with both "Y" and "Yes"):
  // neither may use them.
  const seen = new Map();
  for (const f of forms) {
    const k = f.words.join(' ');
    seen.set(k, seen.has(k) && seen.get(k) !== f.value ? null : f.value);
  }
  return forms.filter((f) => seen.get(f.words.join(' ')) === f.value);
}

const startsWith = (words, at, seq) => seq.length > 0 && seq.every((w, i) => words[at + i] === w);

function longestAt(words, at, options) {
  let best = null;
  for (const o of options) {
    if (startsWith(words, at, o.words) && (!best || o.words.length > best.words.length)) best = o;
  }
  return best;
}

/**
 * Reads the rest of a sentence (after the item name) as answers for one
 * item: "lock installed yes card reader no", or "all yes". null when any
 * word is left over, a line repeats, or nothing was answered.
 */
function readAnswers(words, lines, answers) {
  const picked = new Map();
  let allLines = null;
  let i = 0;
  let pendingLine = null;
  while (i < words.length) {
    const w = words[i];
    if (pendingLine) {
      const answer = longestAt(words, i, answers);
      if (answer) {
        if (pendingLine === 'all') {
          if (allLines) return null;
          allLines = answer.value;
        } else {
          if (picked.has(pendingLine.id)) return null;
          picked.set(pendingLine.id, answer.value);
        }
        pendingLine = null;
        i += answer.words.length;
        continue;
      }
      if (FILLER.has(w)) { i += 1; continue; }
      return null;
    }
    const line = longestAt(words, i, lines);
    if (line) {
      if (line.ambiguous) return null;
      pendingLine = line;
      i += line.words.length;
      continue;
    }
    const all = ALL_WORDS.find((seq) => startsWith(words, i, seq) && !longestAt(words, i, lines));
    if (all) { pendingLine = 'all'; i += all.length; continue; }
    if (FILLER.has(w)) { i += 1; continue; }
    return null;
  }
  if (pendingLine || (!picked.size && !allLines)) return null;
  return { answers: [...picked].map(([id, value]) => ({ checklist_item_id: id, value })), allLines };
}

function lineOptions(category) {
  const options = [];
  const byWords = new Map();
  for (const line of choiceLines(category)) {
    const words = withoutArticles(plainWords(itemText(line)));
    if (!words.length) continue;
    const key = words.join(' ');
    const same = byWords.get(key);
    // Two lines with the same words can't be told apart by voice.
    if (same) { same.ambiguous = true; continue; }
    const option = { id: line.id, words };
    byWords.set(key, option);
    options.push(option);
  }
  return options;
}

// Item ids by normalized name; one name may sit in several modules.
function nameIndex(markers) {
  const index = new Map();
  for (const [id, marker] of Object.entries(markers || {})) {
    if (!marker?.name) continue;
    const key = normalizeItemName(marker.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(id);
  }
  return index;
}

function pickId(ids, markers, currentModuleId) {
  if (ids.length === 1) return ids[0];
  const here = ids.filter((id) => currentModuleId && markers[id]?.moduleId === currentModuleId);
  return here.length === 1 ? here[0] : null;
}

const splitWords = (tokens) => tokens.flatMap((t) => (t.w === 'n/a' ? ['n/a'] : t.w.split(/[-/.']/))).filter(Boolean);
const joinOr = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);

/**
 * What the words after an item's name ask for, on that item: show it, a
 * note, an entity by its exact name, or answers. { calls } or { ask } (a
 * question, nothing changed), or null when the words are not clear.
 * `marker` may be an item about to be added ({ name, moduleId, categoryId }).
 */
function readItemTurn({ text, template, marker, itemId, before, after, named, learned = [] }) {
  if (!marker) return null;
  const category = categoryOf(template, marker);
  // "Door D-117": the category's name just before the item's name is part of it.
  const catWords = category ? plainWords(category.name) : [];
  let head = before.map((t) => t.w);
  if (catWords.length && head.length >= catWords.length && catWords.every((w, k) => head[head.length - catWords.length + k] === w)) {
    head = head.slice(0, head.length - catWords.length);
  }
  if (withoutArticles(head).some((w) => !FILLER.has(w))) return null;
  const rest = after;
  const restWords = withoutArticles(splitWords(rest));
  if (!restWords.length || restWords.every((w) => FILLER.has(w))) {
    return named ? { calls: [{ name: 'show_item', input: { item_id: itemId } }] } : null;
  }
  // "note ..." takes the rest of what was said, as said.
  const restRaw = rest.map((t) => t.w);
  let lead = 0;
  while (lead < restRaw.length && FILLER.has(restRaw[lead]) && restRaw[lead] !== 'note') lead += 1;
  const noteSeq = NOTE_WORDS.slice().sort((a, b) => b.length - a.length).find((seq) => startsWith(restRaw, lead, seq));
  if (noteSeq) {
    const fromToken = rest[lead + noteSeq.length];
    const note = fromToken ? String(text).slice(fromToken.start).replace(/^[\s:,.-]+/, '').trim() : '';
    return note ? { calls: [{ name: 'add_note', input: { item_id: itemId, text: note.charAt(0).toUpperCase() + note.slice(1) } }] } : null;
  }
  // The rest is exactly one entity's name ("complete", "rough-in", "tested").
  const entities = entitiesOf(template).filter((e) => e?.id && e?.name);
  const saidWords = restWords.filter((w) => !FILLER.has(w));
  const said = saidWords.join(' ');
  const byName = (name) => entities.find((e) => withoutArticles(plainWords(e.name)).join(' ') === withoutArticles(plainWords(name)).join(' '));
  // Its own name, or a word this project taught ("done" is Commissioned here).
  const taught = said ? learnedStateFor(learned, said) : null;
  const entity = said && (byName(said) || (taught ? byName(taught) : null));
  if (entity) return { calls: [{ name: 'set_entity', input: { item_id: itemId, entity_id: entity.id } }] };
  if (category) {
    const read = readAnswers(restWords, lineOptions(category), answerForms(template));
    if (read) {
      return {
        calls: [{
          name: 'set_answers',
          input: { item_id: itemId, answers: read.answers.length ? read.answers : null, all_lines: read.allLines },
        }],
      };
    }
  }
  // "Mark it done" / "D-118 is finished": setting a state with a word that
  // is no entity's name. Which entity it means differs by customer, so ask,
  // listing this template's own entities. Not when the words are a line's
  // or an answer's: that is a sentence the rules could not read.
  const setting = ['mark', 'set'].includes(withoutArticles(before.map((t) => t.w))[0])
    || ['is', 'as', 'to', 'are', 'mark', 'set'].includes(withoutArticles(restRaw)[0]);
  const answerWords = new Set(answerForms(template).flatMap((f) => f.words));
  const lineWords = new Set(category ? checklistOf(category).flatMap((l) => plainWords(itemText(typeof l === 'string' ? { text: l } : l))) : []);
  if (setting && entities.length >= 2 && saidWords.length && saidWords.length <= 2
    && !saidWords.some((w) => answerWords.has(w) || lineWords.has(w) || /\d/.test(w))) {
    return {
      ask: `Which is "${said}" for ${marker.name || 'this item'}: ${joinOr(entities.map((e) => e.name))}? Nothing changed.`,
      // The answer ("commissioned") sets it and is remembered for the project.
      ...(itemId !== NEW_ITEM ? { pending: { itemId, heard: said } } : {}),
    };
  }
  return null;
}

/**
 * The tool calls one sentence stands for, or null when the rules can't read
 * it exactly. `bridge` is the Survey panel's bridge (template, markers,
 * selectedMarkerId, currentModuleId).
 * @returns {{ calls: { name: string, input: object }[] } | null}
 */
export function planOfflineTurn(text, bridge, { learned = [] } = {}) {
  const template = bridge?.template;
  const markers = bridge?.markers || {};
  if (!template) return null;
  const tokens = wordsOf(text);
  if (!tokens.length) return null;
  const flat = tokens.map((t) => t.w).join(' ');
  if (UNDO_SAID.has(flat)) return { calls: [{ name: 'undo_last_turn', input: {} }] };

  // Where an item name is said: every run of up to NAME_SPAN_MAX words whose
  // normalized form is an item's name. The longest wins where runs overlap.
  const index = nameIndex(markers);
  const spans = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = Math.min(tokens.length, i + NAME_SPAN_MAX); j > i; j -= 1) {
      const key = normalizeItemName(tokens.slice(i, j).map((t) => t.w).join(' '));
      if (index.has(key)) { spans.push({ i, j, key }); break; }
    }
  }
  const readings = [];
  const tryItem = (itemId, before, after, span) => {
    const reading = readItemTurn({ text, template, marker: markers[itemId], itemId, before, after, named: Boolean(span), learned });
    if (reading) readings.push(reading);
  };

  for (const span of spans) {
    // Runs inside a longer run are part of that name.
    if (spans.some((o) => o !== span && o.i <= span.i && o.j >= span.j && o.j - o.i > span.j - span.i)) continue;
    const id = pickId(index.get(span.key), markers, bridge.currentModuleId);
    if (!id) continue;
    tryItem(id, tokens.slice(0, span.i), tokens.slice(span.j), span);
  }
  if (bridge.selectedMarkerId && markers[bridge.selectedMarkerId]) {
    tryItem(bridge.selectedMarkerId, [], tokens, null);
  }
  // One reading only; two different ones means the words are not clear.
  const unique = [...new Map(readings.map((r) => [JSON.stringify(r), r])).values()];
  return unique.length === 1 ? unique[0] : null;
}

// Categories that are this kind of device ("camera" is the Cameras
// category), in the open module when one is open.
function categoriesOfKind(template, kind, moduleId) {
  const out = [];
  for (const module of modulesOf(template)) {
    if (moduleId && module.id !== moduleId) continue;
    for (const category of categoriesOf(module)) {
      if (templateKinds([{ name: category.name }])[0]?.kind === kind) out.push({ module, category });
    }
  }
  return out;
}

const listFits = (list) => list.slice(0, 5).map((m) => `${m.name || m.text}${m.page ? ` (page ${m.page})` : ''}`).join(', ');

/**
 * A sentence that names an item by describing it: "camera 2 on the second
 * floor power at door yes", "mark smoke detector 4 third floor tested".
 * The description is the longest run of words after the opening filler that
 * reads as kind + number (+ floor, wing), every word accounted for; the rest
 * is read as for a named item. Found through the agent's find_described, so
 * the device and the server agent pick the same item.
 * @returns {Promise<{ calls?: object[], ask?: string } | null>}
 */
export async function planDescribedTurn(text, bridge, toolbox, { learned = [] } = {}) {
  const template = bridge?.template;
  const markers = bridge?.markers || {};
  if (!template || !toolbox) return null;
  const tokens = wordsOf(text);
  let lead = 0;
  while (lead < tokens.length && (FILLER.has(tokens[lead].w) || ARTICLES.has(tokens[lead].w))) lead += 1;
  if (lead >= tokens.length) return null;
  const kinds = projectKinds(bridge);
  const found = new Map();
  const first = await describedAttempt();
  if (first) return first;
  // Nothing found, and some sheets are scans with no text yet: read them on
  // the device (the current page first), then look once more.
  const unread = [...found.values()].some((f) => f?.pages_without_text);
  if (!unread || typeof bridge.recognizePage !== 'function') return null;
  const res = await toolbox.run('read_scanned_pages', { pages: null });
  if (res?.isError || !res?.read?.length) return null;
  found.clear();
  return describedAttempt();

  async function describedAttempt() {
    for (let end = tokens.length; end > lead; end -= 1) {
      const description = String(text).slice(tokens[lead].start, tokens[end - 1].end);
      // Kind and number ("camera 2 second floor"), else kind and a place
      // printed on the plan ("the camera by stair 2").
      let target = parseDescribedTarget(description, { kinds });
      if (!target || target.number == null || !target.kind || target.leftover.length) target = null;
      const place = parsePlaceTarget(description, { kinds });
      if (place) target = place;
      if (!target) continue;
      const key = JSON.stringify(target);
      if (!found.has(key)) {
        const res = await toolbox.run('find_described', { description });
        let parsed = null;
        try { parsed = res?.isError ? null : JSON.parse(res.content); } catch { parsed = null; }
        found.set(key, parsed);
      }
      const fits = found.get(key);
      if (!fits) continue;
      const before = tokens.slice(0, lead);
      const after = tokens.slice(end);
      const items = fits.items || [];
      const plan = (fits.plan || []).filter((m) => !m.already_item || !items.some((i) => i.id === m.already_item.id));
      const onItem = (id) => readItemTurn({ text, template, marker: markers[id], itemId: id, before, after, named: true, learned });
      const pick = (list) => (fits.by_place ? list.find((m) => m.clear) || null : clearBest(list));
      const bestItem = pick(items);
      if (bestItem) {
        const reading = onItem(bestItem.id);
        if (reading) return reading;
        continue;
      }
      if (items.length >= 2) {
        if (onItem(items[0].id)) return { ask: `More than one fits "${description}": ${listFits(items)}. Which one? Nothing changed.` };
        continue;
      }
      // No item fits: a tag printed on the plan (a bare PDF, or one not added yet).
      const bestTag = pick(plan);
      if (bestTag?.already_item) {
        const reading = onItem(bestTag.already_item.id);
        if (reading) return reading;
        continue;
      }
      if (bestTag) {
        const homes = categoriesOfKind(template, target.kind, bridge.currentModuleId);
        if (homes.length !== 1) continue;
        const name = String(bestTag.text).trim();
        const fresh = { name, moduleId: homes[0].module.id, categoryId: homes[0].category.id };
        const reading = readItemTurn({ text, template, marker: fresh, itemId: NEW_ITEM, before, after, named: true, learned });
        if (!reading) continue;
        if (reading.ask) return reading;
        const create = { name: 'create_item', input: { name, category_id: homes[0].category.id, plan_match_id: bestTag.id } };
        return { calls: [create, ...reading.calls.filter((c) => c.name !== 'show_item')] };
      }
      if (plan.length >= 2) return { ask: `More than one tag on the plan fits "${description}": ${listFits(plan)}. Which one? Nothing changed.` };
    }
    return null;
  }
}

// Stands for the item create_item adds earlier in the same turn.
const NEW_ITEM = '$new';

/**
 * The answer to a question just asked ("Which is "done" for D-118:
 * Installed or Commissioned?"): exactly one entity's name, maybe with
 * filler ("commissioned", "the commissioned one" is not). Sets it and
 * remembers the word for the project. null for anything else.
 */
export function answerPending(text, bridge, pending) {
  if (!pending?.itemId || !bridge?.markers?.[pending.itemId]) return null;
  const said = withoutArticles(plainWords(text)).filter((w) => !FILLER.has(w)).join(' ');
  const entity = said && entitiesOf(bridge.template).find((e) => e?.id && withoutArticles(plainWords(e.name)).join(' ') === said);
  if (!entity) return null;
  return {
    calls: [
      { name: 'set_entity', input: { item_id: pending.itemId, entity_id: entity.id } },
      ...(bridge.projectId ? [{ name: 'remember', input: { kind: 'state', heard: pending.heard, means: entity.name } }] : []),
    ],
  };
}

/**
 * Does one sentence on the device. Returns { reply, changes } once
 * something was done or asked (a question changes nothing, and comes with
 * `pending` for the answer), or null when the rules can't read it or a
 * tool refused before any change: then the message waits for the server
 * as before. `learned`: the project's saved rows (state words);
 * `pending`: the question this chat just asked on the device.
 */
export async function runOfflineTurn({ text, toolbox, bridge, learned = [], pending = null }) {
  const plan = answerPending(text, bridge, pending)
    || planOfflineTurn(text, bridge, { learned })
    || await planDescribedTurn(text, bridge, toolbox, { learned });
  if (!plan) return null;
  if (plan.ask) return { reply: plan.ask, changes: [], calls: [], pending: plan.pending || null };
  const changes = [];
  const said = [];
  let added = null;
  for (const { name, input } of plan.calls) {
    const args = input?.item_id === NEW_ITEM ? { ...input, item_id: added } : input;
    if (args?.item_id === null) break;
    const res = await toolbox.run(name, args);
    if (res?.isError) {
      if (!changes.length) return null;
      said.push(res.content);
      break;
    }
    if (name === 'create_item') added = res?.change?.itemId || null;
    if (res?.change) changes.push(res.change);
    if (Array.isArray(res?.changes)) changes.push(...res.changes);
    if (res?.content) said.push(String(res.content).replace(/\s*\(item id [^)]+\)/g, '').replace(/,\s*id [^\s.]+/g, ''));
  }
  return { reply: said.join(' ').trim() || 'Done.', changes, calls: plan.calls };
}
