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
