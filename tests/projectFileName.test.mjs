import test from 'node:test';
import assert from 'node:assert/strict';
import { freeFileName, projectFileNames } from '../src/suite/projectFileName.js';

test('a free name is kept (Survey #1612)', () => {
  assert.equal(freeFileName('South Amboy QA.pdf', ['Other.pdf']), 'South Amboy QA.pdf');
  assert.equal(freeFileName('South Amboy QA.pdf', []), 'South Amboy QA.pdf');
});

test('a taken name gets the next free number, ignoring case', () => {
  assert.equal(freeFileName('South Amboy QA.pdf', ['south amboy qa.pdf']), 'South Amboy QA (2).pdf');
  assert.equal(
    freeFileName('South Amboy QA.pdf', ['South Amboy QA.pdf', 'South Amboy QA (2).pdf']),
    'South Amboy QA (3).pdf',
  );
  assert.equal(freeFileName('Plan', ['Plan']), 'Plan (2)');
});

test('the Project lookup never throws', async () => {
  assert.deepEqual(await projectFileNames(null, 'p'), []);
  const broken = { from: () => { throw new Error('offline'); } };
  assert.deepEqual(await projectFileNames(broken, 'p'), []);
  const ok = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ name: 'A.pdf' }], error: null }) }) }) };
  assert.deepEqual(await projectFileNames(ok, 'p'), ['A.pdf']);
});
