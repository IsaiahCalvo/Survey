import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSurveyModuleStep } from '../src/utils/surveyModuleNav.js';

// Previous/Next module is its own navigator (resolveSurveyModuleStep →
// selectSurveyModule). U-01 "stamp + filter" clicked the Walls *category*
// after picking KAL-436. Live proof:
// debug/scenarios/e2e-survey-module-nav.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const KAL436 = [
  { id: 'kal436-module', name: 'Existing Survey Data' },
  { id: 'kal436-other-module', name: 'Other Survey Data' },
];

test('Previous/Next step is not a category click and ignores first/last', () => {
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: KAL436,
      selectedModuleId: 'kal436-module',
      direction: 'next',
    }),
    { kind: 'select', moduleId: 'kal436-other-module' },
  );
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: KAL436,
      selectedModuleId: 'kal436-other-module',
      direction: 'previous',
    }),
    { kind: 'select', moduleId: 'kal436-module' },
  );

  // First Previous and last Next are no-ops — not a wrap.
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: KAL436,
      selectedModuleId: 'kal436-module',
      direction: 'previous',
    }),
    { kind: 'ignore' },
  );
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: KAL436,
      selectedModuleId: 'kal436-other-module',
      direction: 'next',
    }),
    { kind: 'ignore' },
  );

  // 1-module and empty / unknown stay ignore.
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: [KAL436[0]],
      selectedModuleId: 'kal436-module',
      direction: 'next',
    }),
    { kind: 'ignore' },
  );
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: [],
      selectedModuleId: 'kal436-module',
      direction: 'next',
    }),
    { kind: 'ignore' },
  );
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: KAL436,
      selectedModuleId: 'missing',
      direction: 'next',
    }),
    { kind: 'ignore' },
  );
  assert.deepEqual(
    resolveSurveyModuleStep({
      modules: KAL436,
      selectedModuleId: 'kal436-module',
      direction: 'sideways',
    }),
    { kind: 'ignore' },
  );
});

test('Survey rail Previous/Next wires resolveSurveyModuleStep; Walls is a category', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /resolveSurveyModuleStep\(/);
  assert.match(rail, /aria-label="Previous module"/);
  assert.match(rail, /aria-label="Next module"/);
  assert.match(rail, /previousModuleAction\.kind === 'select'/);
  assert.match(rail, /nextModuleAction\.kind === 'select'/);
  assert.match(rail, /selectSurveyModule\(previousModuleAction\.moduleId\)/);
  assert.match(rail, /selectSurveyModule\(nextModuleAction\.moduleId\)/);
  assert.doesNotMatch(
    rail,
    /selectSurveyModule\(surveyModuleOptions\[selectedModuleIndex [+-] 1\]/,
  );

  const fixture = read('src/DevTestRoute.jsx');
  assert.match(fixture, /name: 'Existing Survey Data'/);
  assert.match(fixture, /name: 'Other Survey Data'/);
  assert.match(fixture, /name: 'Walls'/);
  assert.match(fixture, /name: 'Doors'/);

  // Category pick is a different control (U-01 stamp path).
  assert.match(rail, /setSelectedCategoryId/);
});
