/**
 * answerSets.js — the answers a template's checklist items can take.
 *
 * Today every item is Y / N / N/A. A template may carry its own set
 * (`template.answerSet`), e.g. Pass / Fail / N/A. Each answer has a `tone`
 * that drives its colors: good (green), bad (red), neutral (grey). Good and
 * neutral answers count as "done" for the auto-entity rule, as Y and N/A do.
 */

export const ANSWER_TONES = Object.freeze(['good', 'bad', 'neutral']);

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

/** Returns a list of problems; empty means the set is usable. */
export function validateAnswerSet(set) {
  if (!Array.isArray(set) || set.length < 2 || set.length > 6) return ['answer set needs 2 to 6 answers'];
  const errors = [];
  const seen = new Set();
  set.forEach((a, i) => {
    const v = typeof a?.value === 'string' ? a.value.trim() : '';
    // Excel list validation is a comma-separated string, so no commas or quotes.
    if (!v || v.length > 20 || /[",]/.test(v)) errors.push(`answers[${i}].value must be 1-20 characters, no commas or quotes`);
    else if (seen.has(v)) errors.push(`answers[${i}].value "${v}" repeated`);
    else seen.add(v);
    if (!ANSWER_TONES.includes(a?.tone)) errors.push(`answers[${i}].tone must be good, bad or neutral`);
  });
  return errors;
}

/** The template's answer set, or Y / N / N/A when it has none or a bad one. */
export function answerSetFor(template) {
  const set = template?.answerSet;
  return set && validateAnswerSet(set).length === 0 ? set : DEFAULT_ANSWER_SET;
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
