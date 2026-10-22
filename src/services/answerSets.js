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
import { validateAnswerSet } from '../../supabase/functions/_shared/kitShape.js';

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
