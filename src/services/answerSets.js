/**
 * answerSets.js — the answers a template's checklist items can take.
 *
 * Today every item is Y / N / N/A. A template may carry its own set
 * (`template.answerSet`), e.g. Pass / Fail / N/A. Each answer has a `tone`
 * that drives its colors: good (green), bad (red), neutral (grey). Good and
 * neutral answers count as "done" for the auto-entity rule, as Y and N/A do.
 * An export kit may carry a set too (`kit.answerSet`); the template's own wins.
 */
import { getExportKit } from './exportFormats/registry.js';
import { checklistItemKind, typedAnswerFor, validateAnswerSet } from '../../supabase/functions/_shared/kitShape.js';
import { categoriesOf, checklistOf, modulesOf } from './templateConfigShape.js';

export { ANSWER_TONES, MIN_ANSWERS, MAX_ANSWERS, validateAnswerSet } from '../../supabase/functions/_shared/kitShape.js';

export const DEFAULT_ANSWER_SET = Object.freeze([
  Object.freeze({ value: 'Y', tone: 'good' }),
  Object.freeze({ value: 'N', tone: 'bad' }),
  Object.freeze({ value: 'N/A', tone: 'neutral' }),
]);

// Ready-made sets offered in the template editor.
export const ANSWER_SET_PRESETS = Object.freeze([
  Object.freeze({ id: 'yes-no-na', label: 'Y / N / N/A', answers: DEFAULT_ANSWER_SET }),
  Object.freeze({
    id: 'pass-fail-na',
    label: 'Pass / Fail / N/A',
    answers: Object.freeze([
      Object.freeze({ value: 'Pass', tone: 'good' }),
      Object.freeze({ value: 'Fail', tone: 'bad' }),
      Object.freeze({ value: 'N/A', tone: 'neutral' }),
    ]),
  }),
  Object.freeze({
    id: 'good-fair-poor-na',
    label: 'Good / Fair / Poor / N/A',
    answers: Object.freeze([
      Object.freeze({ value: 'Good', tone: 'good' }),
      Object.freeze({ value: 'Fair', tone: 'neutral' }),
      Object.freeze({ value: 'Poor', tone: 'bad' }),
      Object.freeze({ value: 'N/A', tone: 'neutral' }),
    ]),
  }),
  Object.freeze({
    id: 'installed-missing-damaged-na',
    label: 'Installed / Missing / Damaged / N/A',
    answers: Object.freeze([
      Object.freeze({ value: 'Installed', tone: 'good' }),
      Object.freeze({ value: 'Missing', tone: 'bad' }),
      Object.freeze({ value: 'Damaged', tone: 'bad' }),
      Object.freeze({ value: 'N/A', tone: 'neutral' }),
    ]),
  }),
  Object.freeze({
    id: 'works-not-working-na',
    label: 'Works / Not working / N/A',
    answers: Object.freeze([
      Object.freeze({ value: 'Works', tone: 'good' }),
      Object.freeze({ value: 'Not working', tone: 'bad' }),
      Object.freeze({ value: 'N/A', tone: 'neutral' }),
    ]),
  }),
]);

// More ready-made sets, shown only with the nightly 'custom-answers' flag.
const freezeSet = (pairs) => Object.freeze(pairs.map(([value, tone]) => Object.freeze({ value, tone })));
export const EXTRA_ANSWER_SET_PRESETS = Object.freeze([
  Object.freeze({ id: 'yes-no', label: 'Y / N', answers: freezeSet([['Y', 'good'], ['N', 'bad']]) }),
  Object.freeze({ id: 'done', label: 'Done', answers: freezeSet([['Done', 'good']]) }),
  Object.freeze({
    id: 'small-medium-large',
    label: 'Small / Medium / Large',
    answers: freezeSet([['Small', 'neutral'], ['Medium', 'neutral'], ['Large', 'neutral']]),
  }),
  Object.freeze({
    id: 'score-1-5',
    label: 'Score 1 to 5',
    answers: freezeSet([['1', 'bad'], ['2', 'bad'], ['3', 'neutral'], ['4', 'good'], ['5', 'good']]),
  }),
]);

/** The presets the template editor offers. */
export function answerSetPresets({ extras = false } = {}) {
  return extras ? [...ANSWER_SET_PRESETS, ...EXTRA_ANSWER_SET_PRESETS] : ANSWER_SET_PRESETS;
}

const setKey = (set) => JSON.stringify(set.map((a) => [a.value, a.tone]));

/** The preset id a set matches; '' when it is the template's own list. */
export function answerPresetIdOf(set, presets = ANSWER_SET_PRESETS) {
  if (!set) return 'yes-no-na';
  const key = setKey(set);
  return presets.find((p) => setKey(p.answers) === key)?.id || '';
}

/**
 * A typed-in list as it should be saved: values trimmed, nothing else kept.
 * Returns null when it is not usable yet, so the editor keeps the last good one.
 */
export function cleanAnswerSet(draft) {
  if (!Array.isArray(draft)) return null;
  const set = draft.map((a) => ({ value: String(a?.value ?? '').trim(), tone: a?.tone }));
  return validateAnswerSet(set).length ? null : set;
}

/** One plain sentence for the first problem in a typed-in list, or ''. */
export function answerSetProblem(draft) {
  if (!Array.isArray(draft) || draft.length === 0) return 'Add at least one answer.';
  const values = draft.map((a) => String(a?.value ?? '').trim());
  if (values.some((v) => !v)) return 'Every answer needs a name.';
  if (values.some((v) => /[",]/.test(v))) return 'Answers can\'t have commas or quotes (Excel lists break on them).';
  if (values.some((v) => v.length > 20)) return 'Keep each answer to 20 characters.';
  if (new Set(values).size !== values.length) return 'Two answers have the same name.';
  return cleanAnswerSet(draft) ? '' : 'This list can\'t be used.';
}

/** True when two sets have the same answers and tones in the same order. */
export function sameAnswerSet(a, b) {
  return Boolean(a) && Boolean(b) && setKey(a) === setKey(b);
}

const usable = (set) => Boolean(set) && validateAnswerSet(set).length === 0;

/**
 * The template's answer set, else its export kit's, else Y / N / N/A.
 * A bad set is skipped like a missing one.
 */
export function answerSetFor(template) {
  if (usable(template?.answerSet)) return template.answerSet;
  const kitSet = template?.exportKitId ? getExportKit(template.exportKitId)?.answerSet : null;
  return usable(kitSet) ? kitSet : DEFAULT_ANSWER_SET;
}

export function answerTone(set, value) {
  return set.find((a) => a.value === value)?.tone || null;
}

/** Good and neutral answers count as done (today: Y and N/A). */
export function isDoneAnswer(set, value) {
  const tone = answerTone(set, value);
  return tone === 'good' || tone === 'neutral';
}

/** The Excel dropdown list for the set, e.g. '"Y,N,N/A"'. */
export function excelAnswerListFormula(set) {
  return `"${set.map((a) => a.value).join(',')}"`;
}

/*
 * Item kinds (nightly 'custom-answers'). A checklist item is pick-one by
 * default (the template's answer set). `item.kind` 'text' or 'number' makes
 * it take a typed answer instead, with an optional `item.unit` ("ft", "V").
 * Answers stay plain strings in `selection`, so sync, import, history and the
 * row fingerprints need no change.
 */
export const ITEM_KINDS = Object.freeze(['choice', 'text', 'number']);
export const ITEM_UNIT_MAX = 12;
export { TYPED_ANSWER_MAX } from '../../supabase/functions/_shared/kitShape.js';

export const itemKind = checklistItemKind;

/**
 * A typed answer as it should be saved: '' for blank, the trimmed text, or a
 * plain number ("1,200" -> "1200"). null when a number item gets no number.
 */
export function typedAnswer(item, raw) {
  return typedAnswerFor(itemKind(item), raw);
}

/** Whether an item's answer counts as done (drives the auto Complete entity). */
export function isItemDone(item, set, value) {
  const kind = itemKind(item);
  if (kind === 'choice') return isDoneAnswer(set, value);
  const typed = typedAnswer(item, value);
  return typed !== null && typed !== '';
}

/** Whether an item's answer is an issue: only a pick-one answer marked bad. */
export function isItemIssue(item, set, value) {
  return itemKind(item) === 'choice' && answerTone(set, value) === 'bad';
}

/** The Excel cell rule for an item's column, or null for none (text). */
export function excelValidationFor(item, set) {
  const kind = itemKind(item);
  if (kind === 'text') return null;
  if (kind === 'number') {
    return {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [-1e15, 1e15],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Invalid number',
      error: `Please enter a number${item?.unit ? ` (${item.unit})` : ''}`,
    };
  }
  return {
    type: 'list',
    allowBlank: true,
    formulae: [excelAnswerListFormula(set)],
    showErrorMessage: true,
    errorStyle: 'error',
    errorTitle: 'Invalid selection',
    error: set === DEFAULT_ANSWER_SET
      ? 'Please select Y, N, or N/A'
      : `Please select ${set.map((a) => a.value).join(', ')}`,
  };
}

const TONE_FILL = Object.freeze({ good: 'FFCEEED0', bad: 'FFF6C9CE', neutral: 'FFA6A6A6' });

/** Excel cell fills per answer, by tone (Y green, N red, N/A grey). */
export function excelAnswerFills(set) {
  return set.map((a) => ({ value: a.value, argb: TONE_FILL[a.tone] || TONE_FILL.neutral }));
}

/** True when any checklist item in the template is a text or number item. */
export function templateHasTypedItems(template) {
  return modulesOf(template).some((m) => categoriesOf(m).some((c) => checklistOf(c).some((it) => itemKind(it) !== 'choice')));
}
