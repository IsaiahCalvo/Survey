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

export { ANSWER_TONES, validateAnswerSet } from '../../supabase/functions/_shared/kitShape.js';

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
]);

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
