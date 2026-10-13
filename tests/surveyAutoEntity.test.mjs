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
