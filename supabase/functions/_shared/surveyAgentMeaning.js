// What plain site talk means in each kind of survey module, so the agent
// reads "it's installed" in an installation module as every installation
// line done, and "yeah it works" in commissioning as the tests passing.
// Templates name their modules freely ("Install", "Rough-in", "Cx",
// "Testing"); the kind is a best guess from the name, and "other" falls back
// to the plain rules. Shared by the edge function (prompt) and the app
// (get_survey_context, get_item), so both say the same.

const KINDS = [
  { kind: 'installation', test: /install|rough[\s-]?in|trim[\s-]?out|prep|mount|pre[\s-]?wire|infrastructure|construction/i },
  { kind: 'commissioning', test: /commission|\bcx\b|test|programm|verif|acceptance|startup|start[\s-]?up|check[\s-]?out|punch/i },
  { kind: 'inspection', test: /inspect|survey|audit|assess|existing|site walk|walk/i },
];

export function moduleKind(name) {
  const text = String(name || '');
  return KINDS.find((k) => k.test.test(text))?.kind || 'other';
}

export const MODULE_MEANING = Object.freeze({
  installation: 'Lines here are installation steps. "Installed", "in", "done", "complete", "finished", "mounted", "pulled", "run", "prepped", "set" mean Y for the lines they cover. "Everything is installed", "it\'s all in", "fully installed" or just "D-117 installed" mean Y on every line, including lines worded differently (a cable pulled is installed). "Not installed", "missing", "not in yet", "not done" mean N. Power, function or test results ("no power", "doesn\'t work") are not installation steps: they go in the note unless a line is about them.',
  commissioning: 'Lines here are tests and checks. "Works", "working", "good", "tested", "passed", "online", "all good", "checks out", "programmed" mean Y for the lines they cover, and "it works" or "everything works" on its own means Y on every line. "Doesn\'t work", "failed", "dead", "offline", "no power" mean N for the lines they cover, and on its own means N on every line, with the reason in the note.',
  inspection: 'Lines here are what was found on site. Answer the lines the person describes: "yes", "there", "present", "good" mean Y; "no", "missing", "damaged", "none" mean N; "doesn\'t apply" or "not here" mean N/A when allowed.',
  other: 'Answer the lines the person describes by meaning: yes, done, good mean Y; no, missing, not done mean N.',
});

export const moduleMeaning = (name) => MODULE_MEANING[moduleKind(name)];

// What site talk each common answer stands for. The module rules say Y and N;
// a template with its own answer set (Installed / Missing / Damaged / N/A,
// Works / Not working / N/A, ...) needs those mapped onto its own words, and
// a set with two "no" answers needs telling apart ("busted" is Damaged, not
// Missing).
const ANSWER_WORDS = Object.freeze({
  y: 'yes, done, good',
  yes: 'yes, done, good',
  n: 'no, not done, missing',
  no: 'no, not done, missing',
  pass: 'passed, works, good, checks out',
  fail: 'failed, doesn\'t work, dead',
  good: 'good, fine, solid, like new',
  fair: 'okay, so-so, some wear, could be better',
  poor: 'bad, rough, beat up, falling apart, broken',
  installed: 'installed, in, done, mounted, pulled, run, set, prepped',
  missing: 'missing, not there, not in, not installed, not in yet, gone, never put in',
  damaged: 'damaged, busted, broken, cracked, bent, smashed, beat up, hanging off (there, but broken)',
  works: 'works, working, good, tested, passed, online, checks out',
  'not working': 'not working, doesn\'t work, dead, failed, offline, no power, won\'t release',
  open: 'still open, not fixed, still a problem, needs work',
  done: 'done, fixed, closed, taken care of, finished, sorted',
  'n/a': 'doesn\'t apply, not here, no such part, not part of this job',
});

const KNOWN_TONE = Object.freeze({
  y: 'good', yes: 'good', pass: 'good', good: 'good', installed: 'good', works: 'good', done: 'good',
  open: 'bad', n: 'bad', no: 'bad', fail: 'bad', poor: 'bad', missing: 'bad', damaged: 'bad', 'not working': 'bad',
});

const isDefaultSet = (values) => values.length === 3 && values[0] === 'Y' && values[1] === 'N' && values[2] === 'N/A';

/**
 * How to map the module rules' Y and N onto the template's own answers, or
 * null for the plain Y / N / N/A set. `set` is [{ value, tone }] or values.
 */
export function answerSetMeaning(set) {
  const list = (Array.isArray(set) ? set : []).map((a) => (typeof a === 'string' ? { value: a } : a)).filter((a) => a?.value);
  const values = list.map((a) => a.value);
  if (!values.length || isDefaultSet(values)) return null;
  const words = list.map((a) => {
    const hint = ANSWER_WORDS[String(a.value).toLowerCase()];
    return hint ? `"${a.value}" for ${hint}` : `"${a.value}"`;
  });
  const tone = (a) => a.tone || KNOWN_TONE[String(a.value).toLowerCase()];
  const good = list.find((a) => tone(a) === 'good')?.value || values[0];
  const bad = list.filter((a) => tone(a) === 'bad').map((a) => a.value);
  const mapping = `Where the rules say Y, use "${good}"${bad.length ? `; where they say N, use ${bad.map((v) => `"${v}"`).join(' or ')}` : ''}.`;
  const pick = bad.length > 1 ? ` Pick between ${bad.map((v) => `"${v}"`).join(' and ')} by their words, not by order.` : '';
  return `This survey answers with ${values.join(' / ')}: ${words.join('; ')}. ${mapping}${pick}`;
}
