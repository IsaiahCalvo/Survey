import { spawnSync } from 'node:child_process';

const stages = [
  {
    name: '1/3 bounded Y.Doc lanes and geometry rebasing',
    tests: [
      'tests/annotationDocStore.test.mjs',
      'tests/pageSpaceEraser.test.mjs',
      'tests/eraserTwoClientRace.test.mjs',
    ],
  },
  {
    name: '2/3 mounted route and exact preview handoff',
    tests: [
      'tests/eraserMountedRaceHarness.test.mjs',
      'tests/eraserPresentation.test.mjs',
    ],
  },
  {
    name: '3/3 WAL and reconnect compatibility',
    tests: [
      'tests/annotationDocConcurrency.test.mjs',
      'tests/annotationDocSyncCatchup.test.mjs',
    ],
  },
];

for (const stage of stages) {
  console.log(`\n[eraser-race] ${stage.name}`);
  const result = spawnSync(
    process.execPath,
    ['--test', ...stage.tests],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('\n[eraser-race] integration order verified');
