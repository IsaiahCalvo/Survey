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
// With no item name, the selected item is used. An item is named by its
// exact name (normalized as the agent does: "D one seventeen" is D-117); a
// line by its exact words; an answer by its own value or the fixed spoken
// words below. Never a best guess (suite rule).
import { APP_ONLY_KINDS, answerSetFor, itemKind } from '../services/answerSets.js';
import { categoriesOf, checklistOf, entitiesOf, itemText, modulesOf } from '../services/templateConfigShape.js';
import { normalizeItemName } from '../../supabase/functions/_shared/surveyAgentSpec.js';

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

/**
 * The tool calls one sentence stands for, or null when the rules can't read
 * it exactly. `bridge` is the Survey panel's bridge (template, markers,
 * selectedMarkerId, currentModuleId).
 * @returns {{ calls: { name: string, input: object }[] } | null}
 */
export function planOfflineTurn(text, bridge) {
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
    const marker = markers[itemId];
    if (!marker) return;
    const category = categoryOf(template, marker);
    // "Door D-117": the category's name just before the item's name is part of it.
    const catWords = category ? plainWords(category.name) : [];
    let head = before.map((t) => t.w);
    if (catWords.length && head.length >= catWords.length && catWords.every((w, k) => head[head.length - catWords.length + k] === w)) {
      head = head.slice(0, head.length - catWords.length);
    }
    if (withoutArticles(head).some((w) => !FILLER.has(w))) return;
    const rest = after;
    const restWords = withoutArticles(rest.flatMap((t) => (t.w === 'n/a' ? ['n/a'] : t.w.split(/[-/.']/))).filter(Boolean));
    if (!restWords.length || restWords.every((w) => FILLER.has(w))) {
      if (span) readings.push({ calls: [{ name: 'show_item', input: { item_id: itemId } }] });
      return;
    }
    // "note ..." takes the rest of what was said, as said.
    const restRaw = rest.map((t) => t.w);
    let lead = 0;
    while (lead < restRaw.length && FILLER.has(restRaw[lead]) && restRaw[lead] !== 'note') lead += 1;
    const noteSeq = NOTE_WORDS.slice().sort((a, b) => b.length - a.length).find((seq) => startsWith(restRaw, lead, seq));
    if (noteSeq) {
      const fromToken = rest[lead + noteSeq.length];
      const note = fromToken ? String(text).slice(fromToken.start).replace(/^[\s:,.-]+/, '').trim() : '';
      if (note) readings.push({ calls: [{ name: 'add_note', input: { item_id: itemId, text: note.charAt(0).toUpperCase() + note.slice(1) } }] });
      return;
    }
    // The rest is exactly one entity's name ("complete", "subcontractor").
    const said = restWords.filter((w) => !FILLER.has(w)).join(' ');
    const entity = said && entitiesOf(template).find((e) => withoutArticles(plainWords(e?.name)).join(' ') === said);
    if (entity) {
      readings.push({ calls: [{ name: 'set_entity', input: { item_id: itemId, entity_id: entity.id } }] });
      return;
    }
    if (!category) return;
    const read = readAnswers(restWords, lineOptions(category), answerForms(template));
    if (!read) return;
    readings.push({
      calls: [{
        name: 'set_answers',
        input: { item_id: itemId, answers: read.answers.length ? read.answers : null, all_lines: read.allLines },
      }],
    });
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
  const unique = [...new Map(readings.map((r) => [JSON.stringify(r.calls), r])).values()];
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Does one sentence on the device. Returns { reply, changes } once
 * something was done (or the tools said why not, after a change), or null
 * when the rules can't read it or a tool refused before any change: then
 * the message waits for the server as before.
 */
export async function runOfflineTurn({ text, toolbox, bridge }) {
  const plan = planOfflineTurn(text, bridge);
  if (!plan) return null;
  const changes = [];
  const said = [];
  for (const { name, input } of plan.calls) {
    const res = await toolbox.run(name, input);
    if (res?.isError) {
      if (!changes.length) return null;
      said.push(res.content);
      break;
    }
    if (res?.change) changes.push(res.change);
    if (Array.isArray(res?.changes)) changes.push(...res.changes);
    if (res?.content) said.push(String(res.content).replace(/\s*\(item id [^)]+\)/g, ''));
  }
  return { reply: said.join(' ').trim() || 'Done.', changes, calls: plan.calls };
}
