// Owner ruling 2026-10-01 (auto entity): "When every checklist answer is Y or
// N/A, set the entity to Complete by itself, but never undo it."
// The rule is src/utils/surveyAutoEntity.js; SurveySpacesRail's shared
// checklist handler (desktop row + phone open marker) is the only caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  autoCompleteOn,
  findCompleteEntity,
  isChecklistAllYesOrNA,
  resolveAutoCompleteEntity,
} from '../src/utils/surveyAutoEntity.js';

const COMPLETE = { id: 'e-done', name: 'Complete', color: '#548c71' };
const PENDING = { id: 'e-pend', name: 'Pending', color: '#f0883e' };
const ENTITIES = [PENDING, COMPLETE];
const CHECKLIST = [{ id: 'a' }, { id: 'b' }, { id: 'old', archived: true }];
const answers = (a, b) => ({ a: { selection: a }, b: { selection: b } });

test('all active items Y or N/A sets the Complete entity', () => {
  assert.equal(resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: answers('Y', 'N/A'), entities: ENTITIES, currentEntityId: 'e-pend' }), COMPLETE);
  assert.equal(resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: answers('Y', 'Y'), entities: ENTITIES, currentEntityId: null }), COMPLETE);
});

test('archived items do not gate it (KAL-44)', () => {
  assert.equal(isChecklistAllYesOrNA(CHECKLIST, answers('Y', 'Y')), true);
});

test('any N or any unanswered item leaves the entity alone', () => {
  assert.equal(resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: answers('Y', 'N'), entities: ENTITIES, currentEntityId: 'e-pend' }), null);
  assert.equal(resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: { a: { selection: 'Y' } }, entities: ENTITIES, currentEntityId: 'e-pend' }), null);
});

test('never undone: an N after Complete returns null (keep Complete), never None', () => {
  const after = resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: answers('Y', 'N'), entities: ENTITIES, currentEntityId: 'e-done' });
  assert.equal(after, null, 'null means "leave the entity as it is" - the caller never clears it');
});

test('already Complete: nothing to write', () => {
  assert.equal(resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: answers('Y', 'Y'), entities: ENTITIES, currentEntityId: 'e-done' }), null);
});

test('no checklist, or no Complete entity: nothing happens', () => {
  assert.equal(resolveAutoCompleteEntity({ checklist: [], responses: {}, entities: ENTITIES }), null);
  assert.equal(resolveAutoCompleteEntity({ checklist: CHECKLIST, responses: answers('Y', 'Y'), entities: [PENDING] }), null);
});

test('the Complete entity is found robustly', () => {
  assert.equal(findCompleteEntity([PENDING, { id: 'x', name: '  COMPLETE ' }]).id, 'x');
  assert.equal(findCompleteEntity([PENDING, { id: 'flag', name: 'Done', isComplete: true }, COMPLETE]).id, 'flag');
  assert.equal(findCompleteEntity([{ id: 'p', name: '100% Complete' }]).id, 'p', 'the default roster calls it "100% Complete"');
  assert.equal(findCompleteEntity([{ id: 'i', name: 'Incomplete' }, { id: 'n', name: 'Not complete' }]), null);
  assert.equal(findCompleteEntity([{ id: 'i', name: 'Incomplete' }, COMPLETE]).id, 'e-done');
  assert.equal(findCompleteEntity(null), null);
});

const railSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'SurveySpacesRail.jsx'), 'utf8');
const handlerStart = railSrc.indexOf('const applyChecklistResponseSelection = ');
const handlerEnd = railSrc.indexOf('// The open Survey Marker\'s note, edited inline', handlerStart);
const handler = railSrc.slice(handlerStart, handlerEnd);

test('the shared checklist handler uses the rule and no longer needs a Space', () => {
  assert.ok(handlerStart > 0 && handlerEnd > handlerStart, 'applyChecklistResponseSelection block not found');
  assert.match(handler, /resolveAutoCompleteEntity\(/);
  assert.ok(!handler.includes('selectedSpaceId'), 'auto-Complete must not depend on a selected Space');
  assert.ok(!/entityId:\s*undefined/.test(handler), 'the handler must never clear the entity');
  assert.match(handler, /applyEntitySelectionForMarker\([^)]*\{ automatic: true \}\)/, 'an automatic pick is not remembered as the user\'s last entity');
});

test('a negated or pending status is never taken for Complete', () => {
  const pending = [{ id: 'p', name: 'Pending' }, { id: 'n', name: 'Not yet complete' }, { id: 'w', name: 'Pending - complete later' }];
  assert.equal(findCompleteEntity(pending), null);
  assert.equal(findCompleteEntity([...pending, { id: 'c', name: '100% Complete' }]).id, 'c');
});

test('every preset answer set: good and neutral answers count toward Complete, bad ones never do', async () => {
  const { ANSWER_SET_PRESETS } = await import('../src/services/answerSets.js');
  const checklist = [{ id: 'a' }, { id: 'b' }];
  for (const preset of ANSWER_SET_PRESETS) {
    for (const answer of preset.answers) {
      const responses = { a: { selection: answer.value }, b: { selection: answer.value } };
      assert.equal(
        isChecklistAllYesOrNA(checklist, responses, preset.answers),
        answer.tone !== 'bad',
        `${preset.label}: "${answer.value}" (${answer.tone})`,
      );
    }
  }
  assert.ok(ANSWER_SET_PRESETS.some((p) => p.id === 'installed-missing-damaged-na'));
  assert.ok(ANSWER_SET_PRESETS.some((p) => p.id === 'works-not-working-na'));
});

// Owner 2026-10-27: "auto-mark as complete is a toggle". A template stores
// `autoComplete: false` to turn it off; unset means on. Off only stops the
// automatic pick; nothing ever takes Complete away.
test('the template switch: unset or true is on, false is off', () => {
  assert.equal(autoCompleteOn({}), true);
  assert.equal(autoCompleteOn(null), true);
  assert.equal(autoCompleteOn({ autoComplete: true }), true);
  assert.equal(autoCompleteOn({ autoComplete: false }), false);
});

test('the shared checklist handler skips the rule when the switch is off', () => {
  const guard = handler.indexOf('if (!autoCompleteOn(liveTemplate)) return;');
  assert.match(handler, /const liveTemplate = surveyTemplates\.find\(/, 'the switch comes from the live template, not the version the document kept');
  assert.ok(guard > 0, 'the handler must check the template switch');
  assert.ok(guard < handler.indexOf('resolveAutoCompleteEntity('), 'the switch is checked before the rule picks Complete');
  assert.ok(guard > handler.indexOf('setSurveyMarkers('), 'the answer itself is still saved when the switch is off');
});

test('the template editor saves the switch and counts it as a change', async () => {
  const { fingerprintTemplates } = await import('../src/home/templatesEditorReload.js');
  const base = { id: 't1', name: 'T', modules: [], roster: [] };
  const on = fingerprintTemplates([base]).t1;
  const off = fingerprintTemplates([{ ...base, autoComplete: false }]).t1;
  assert.notEqual(on, off, 'turning it off is an unsaved change');
  assert.equal(fingerprintTemplates([{ ...base, autoComplete: true }]).t1, on, 'on is the same as unset, so older templates print the same');
  const editorSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'home', 'TemplatesEditor.jsx'), 'utf8');
  assert.match(editorSrc, /\.\.\.\(r\.autoComplete === false \? \{ autoComplete: false \} : \{\}\)/, 'the save keeps autoComplete: false');
  assert.match(editorSrc, /autoComplete: _oldAuto/, 'turning it back on drops the stored false');
});
