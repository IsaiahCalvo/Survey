// What people say on site, and what the survey should hold after the agent
// hears it. One door template with the same doors in three modules, like
// Isaiah's: installation lines worded as steps ("Cables Pulled"),
// commissioning lines as tests, existing conditions as what was found.
// expect: { <marker id>: { <line id>: 'Y' | 'N' | 'N/A' | 'set' | 'not-Y' | 'unset' } }
//   any line left out may be anything. note: a RegExp the note must match,
//   or false when no note should be added. ask: the agent should ask, and
//   change nothing.

export const TEMPLATE = {
  name: 'Doors',
  modules: [
    { id: 'mod-inst', name: 'Installation', categories: [{ id: 'cat-door', name: 'Door', checklist: [
      { id: 'cable', text: 'Cables Pulled' },
      { id: 'frame', text: 'Frame Installed & Prepped' },
      { id: 'door', text: 'Door Installed & Prepped' },
      { id: 'stub', text: 'Stub-ups Installed' },
    ] }] },
    { id: 'mod-cx', name: 'Commissioning', categories: [{ id: 'cat-door', name: 'Door', checklist: [
      { id: 'reader', text: 'Card reader reads' },
      { id: 'rex', text: 'REX releases' },
      { id: 'dps', text: 'Door position switch' },
      { id: 'lock', text: 'Lock releases' },
    ] }] },
    { id: 'mod-ex', name: 'Existing conditions', categories: [{ id: 'cat-door', name: 'Door', checklist: [
      { id: 'present', text: 'Door present' },
      { id: 'hardware', text: 'Hardware in good condition' },
      { id: 'sign', text: 'Signage present' },
    ] }] },
  ],
};

// The answer sets templates can carry instead of Y / N / N/A (answerSets.js).
export const ANSWER_SETS = {
  imd: [{ value: 'Installed', tone: 'good' }, { value: 'Missing', tone: 'bad' }, { value: 'Damaged', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
  works: [{ value: 'Works', tone: 'good' }, { value: 'Not working', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
};

/** The template a case runs on: TEMPLATE, with the case's answer set if it has one. */
export const templateFor = (c) => (c.answerSet ? { ...TEMPLATE, answerSet: ANSWER_SETS[c.answerSet] } : TEMPLATE);

const MODULE_OF = { i: 'mod-inst', c: 'mod-cx', e: 'mod-ex' };
const LINES = Object.fromEntries(TEMPLATE.modules.map((m) => [m.id, m.categories[0].checklist.map((c) => c.id)]));

// D-1-17 and D-1-18 in each module: i117, c117, e117, i118, c118, e118.
export function startMarkers() {
  const markers = {};
  for (const [k, moduleId] of Object.entries(MODULE_OF)) {
    for (const n of ['117', '118']) {
      markers[`${k}${n}`] = { name: `D-1-${n.slice(1)}`, moduleId, categoryId: 'cat-door', checklistResponses: {}, note: {} };
    }
  }
  return markers;
}

const all = (id, value) => Object.fromEntries(LINES[MODULE_OF[id[0]]].map((l) => [l, value]));

export const CASES = [
  // Installation module open.
  { id: 'inst-installed', module: 'mod-inst', said: 'D-1-17 is installed', expect: { i117: all('i117', 'Y') }, note: false },
  { id: 'inst-all-in', module: 'mod-inst', said: "D one seventeen, everything's in", expect: { i117: all('i117', 'Y') } },
  { id: 'inst-no-power', module: 'mod-inst', said: 'D-1-17 installed but it has no power', expect: { i117: all('i117', 'Y') }, note: /power/i },
  { id: 'inst-isaiah', module: 'mod-inst', said: 'I want a note D-1-17 to be installed, it has no power', expect: { i117: all('i117', 'Y') }, note: /power/i },
  { id: 'inst-cable-only', module: 'mod-inst', said: "D-1-17 cable's pulled, nothing else yet", expect: { i117: { cable: 'Y', frame: 'N', door: 'N', stub: 'N' } } },
  { id: 'inst-partial', module: 'mod-inst', said: 'D-1-17 frame and door are in, still waiting on the stub ups', expect: { i117: { frame: 'Y', door: 'Y', stub: 'N' } } },
  { id: 'inst-not', module: 'mod-inst', said: 'D-1-17 is not installed', expect: { i117: all('i117', 'N') } },
  { id: 'inst-done-note', module: 'mod-inst', said: "D-1-17 is done, note that the closer's loose", expect: { i117: all('i117', 'Y') }, note: /closer/i },
  { id: 'inst-good-to-go', module: 'mod-inst', said: 'D-1-17 good to go', expect: { i117: all('i117', 'Y') } },
  { id: 'inst-mixed', module: 'mod-inst', said: "on D-1-17 the cable's run but the frame isn't prepped", expect: { i117: { cable: 'Y', frame: 'N' } } },
  { id: 'inst-two', module: 'mod-inst', said: "D-1-18 is installed, D-1-17 isn't", expect: { i118: all('i118', 'Y'), i117: all('i117', 'N') } },
  { id: 'inst-missing-door', module: 'mod-inst', said: "D-1-17's missing the door", expect: { i117: { door: 'N' } } },
  // Commissioning module open.
  { id: 'cx-works', module: 'mod-cx', said: 'D-1-17 works', expect: { c117: all('c117', 'Y') }, note: false },
  { id: 'cx-yeah', module: 'mod-cx', said: 'yeah D-1-17, it works', expect: { c117: all('c117', 'Y') } },
  { id: 'cx-tested', module: 'mod-cx', said: 'D-1-17 tested, all good', expect: { c117: all('c117', 'Y') } },
  { id: 'cx-no-power', module: 'mod-cx', said: "D-1-17 doesn't work, no power", expect: { c117: all('c117', 'N') }, note: /power/i },
  { id: 'cx-partial', module: 'mod-cx', said: "D-1-17 card reader reads but the REX doesn't release", expect: { c117: { reader: 'Y', rex: 'N' } } },
  { id: 'cx-except', module: 'mod-cx', said: 'D-1-17 everything passed except the door position switch', expect: { c117: { reader: 'Y', rex: 'Y', dps: 'N', lock: 'Y' } } },
  { id: 'cx-dead', module: 'mod-cx', said: 'D-1-17 is dead', expect: { c117: all('c117', 'N') } },
  { id: 'cx-installed', module: 'mod-cx', said: 'D-1-17 is installed', expect: { c117: all('c117', 'not-Y'), i117: {} } },
  { id: 'cx-checks-out', module: 'mod-cx', said: 'D-1-17 checks out', expect: { c117: all('c117', 'Y') } },
  { id: 'cx-offline', module: 'mod-cx', said: 'D-1-17 is offline', expect: { c117: all('c117', 'N') } },
  // Existing conditions open.
  { id: 'ex-mixed', module: 'mod-ex', said: "D-1-17 door's there, the hardware is beat up, and there's no sign", expect: { e117: { present: 'Y', hardware: 'N', sign: 'N' } } },
  { id: 'ex-all-good', module: 'mod-ex', said: 'D-1-17 all good', expect: { e117: all('e117', 'Y') } },
  { id: 'ex-no-sign', module: 'mod-ex', said: 'D-1-17 no signage', expect: { e117: { sign: 'N', present: 'not-N', hardware: 'not-N' } } },
  // Templates with their own answers.
  { id: 'imd-installed', module: 'mod-inst', answerSet: 'imd', said: 'D-1-17 is installed', expect: { i117: all('i117', 'Installed') }, note: false },
  { id: 'imd-busted', module: 'mod-inst', answerSet: 'imd', said: "D-1-17's all in but the door is busted", expect: { i117: { cable: 'Installed', frame: 'Installed', door: 'Damaged', stub: 'Installed' } } },
  { id: 'imd-missing', module: 'mod-inst', answerSet: 'imd', said: "D-1-17's missing the frame", expect: { i117: { frame: 'Missing' } } },
  { id: 'imd-two-bad', module: 'mod-inst', answerSet: 'imd', said: 'D-1-17 frame is cracked and there are no stub ups', expect: { i117: { frame: 'Damaged', stub: 'Missing' } } },
  { id: 'wnw-works', module: 'mod-cx', answerSet: 'works', said: 'D-1-17 works', expect: { c117: all('c117', 'Works') } },
  { id: 'wnw-dead', module: 'mod-cx', answerSet: 'works', said: 'D-1-17 is dead', expect: { c117: all('c117', 'Not working') } },
  { id: 'wnw-rex', module: 'mod-cx', answerSet: 'works', said: "D-1-17 reader's good but the REX won't release", expect: { c117: { reader: 'Works', rex: 'Not working' } } },
  // Unclear: ask, change nothing.
  { id: 'ask-name-only', module: 'mod-inst', said: 'D-1-17', ask: true },
  { id: 'ask-no-item', module: 'mod-inst', said: "it's installed", ask: true },
  // Spanish.
  { id: 'es-no-power', module: 'mod-inst', lang: 'es', said: 'D-1-17 está instalada pero no tiene corriente', expect: { i117: all('i117', 'Y') }, note: /corriente|power|energ/i },
  { id: 'es-works', module: 'mod-cx', lang: 'es', said: 'D-1-17 funciona', expect: { c117: all('c117', 'Y') } },
];

// The case's verdict from what the survey holds afterwards.
export function grade(c, markers, { asked = false } = {}) {
  const fails = [];
  const start = startMarkers();
  const changed = Object.keys(markers).filter((id) => JSON.stringify(markers[id].checklistResponses) !== JSON.stringify(start[id].checklistResponses)
    || (markers[id].note?.text || '') !== '');
  if (c.ask) {
    if (changed.length) fails.push(`changed ${changed.join(', ')} instead of asking`);
    if (!asked) fails.push('did not ask a question');
    return { ok: !fails.length, fails };
  }
  for (const [id, lines] of Object.entries(c.expect || {})) {
    const got = markers[id]?.checklistResponses || {};
    for (const [line, want] of Object.entries(lines)) {
      const v = got[line]?.selection || null;
      const ok = want === 'set' ? Boolean(v)
        : want === 'unset' ? !v
          : want === 'not-Y' ? v !== 'Y'
            : want === 'not-N' ? v !== 'N'
              : v === want;
      if (!ok) fails.push(`${id}.${line}: wanted ${want}, got ${v || 'blank'}`);
    }
  }
  const touched = new Set(Object.keys(c.expect || {}));
  for (const id of changed) if (!touched.has(id)) fails.push(`changed the wrong item ${id}`);
  const noteOf = (id) => markers[id]?.note?.text || '';
  const main = Object.keys(c.expect || {})[0];
  if (c.note instanceof RegExp && !Object.keys(c.expect).some((id) => c.note.test(noteOf(id)))) fails.push(`note "${noteOf(main)}" does not match ${c.note}`);
  if (c.note === false && noteOf(main)) fails.push(`added a note "${noteOf(main)}" when none was needed`);
  return { ok: !fails.length, fails };
}
