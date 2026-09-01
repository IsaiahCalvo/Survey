import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  comparePrintFidelity,
  validatePrintFidelityScreenFixture,
} from '../scripts/print-fidelity-compare.mjs';

const whitePage = (width, height) => sharp({
  create: { width, height, channels: 4, background: '#ffffff' },
});

const fittedLetterPage = async (screenBuffer, sourceWidth, sourceHeight) => {
  const width = 1224; const height = 1584;
  const fit = Math.min(width / sourceWidth, height / sourceHeight);
  const fittedWidth = Math.round(sourceWidth * fit);
  const fittedHeight = Math.round(sourceHeight * fit);
  const fitted = await sharp(screenBuffer).resize(fittedWidth, fittedHeight).jpeg({ quality: 94 }).toBuffer();
  return whitePage(width, height).composite([{
    input: fitted,
    left: Math.round((width - fittedWidth) / 2),
    top: Math.round((height - fittedHeight) / 2),
  }]).png().toBuffer();
};

test('print comparator removes object-fit scale and letterbox offsets before strict metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'print-fidelity-compare-'));
  const screenDir = join(root, 'screen');
  const printDir = join(root, 'print');
  const pairsDir = join(root, 'pairs');
  await Promise.all([mkdir(screenDir), mkdir(printDir)]);

  const landscapeSvg = Buffer.from('<svg width="200" height="100"><ellipse cx="105" cy="50" rx="55" ry="24" transform="rotate(-18 105 50)" fill="#cceffc" stroke="#0ea5e9" stroke-width="4"/></svg>');
  const landscape = await whitePage(200, 100).composite([{ input: landscapeSvg }]).png().toBuffer();
  const cropSvg = Buffer.from('<svg width="100" height="120"><rect x="15" y="20" width="60" height="48" fill="#f3e8ff" stroke="#9333ea" stroke-width="4"/></svg>');
  const crop = await whitePage(100, 120).composite([{ input: cropSvg }]).png().toBuffer();
  await Promise.all([
    writeFile(join(screenDir, 'page-1.png'), landscape),
    writeFile(join(printDir, 'page-1.png'), await fittedLetterPage(landscape, 200, 100)),
    writeFile(join(screenDir, 'page-2.png'), crop),
    writeFile(join(printDir, 'page-2.png'), await fittedLetterPage(crop, 100, 120)),
  ]);

  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    pages: [
      { page: 1, rotation: 90, width: 100, height: 200 },
      { page: 2, rotation: 0, width: 140, height: 180, cropBox: [20, 30, 120, 150] },
    ],
    regions: [
      { id: 'landscape-ellipse', type: 'ellipse', page: 1, bounds: [35, 12, 175, 88], checks: ['bounds', 'fillCoverage', 'colour', 'strokeWeight', 'orientation'] },
      { id: 'cropbox-rect', type: 'rectangle', page: 2, bounds: [5, 10, 85, 80], checks: ['bounds', 'fillCoverage', 'colour', 'strokeWeight'] },
      { id: 'blank-seed', type: 'fixture-only', page: 2, bounds: [85, 90, 98, 115], checks: ['bounds'] },
    ],
  }));

  const fixture = await validatePrintFidelityScreenFixture({ manifestPath, screenDir });
  assert.equal(fixture.passed, 2);
  assert.equal(fixture.failed, 1);
  assert.equal(fixture.results.find((item) => item.id === 'blank-seed').pass, false);

  const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir: pairsDir });
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 0);
  assert.equal(report.fixtureFailed, 1);
  for (const id of ['landscape-ellipse', 'cropbox-rect']) {
    const result = report.results.find((item) => item.id === id);
    assert.equal(result.status, 'pass', `${id}: ${result.failures.join(', ')}`);
    const screenMeta = await sharp(result.screenImage).metadata();
    const printMeta = await sharp(result.printImage).metadata();
    assert.deepEqual([screenMeta.width, screenMeta.height], [printMeta.width, printMeta.height]);
  }
  assert.ok(JSON.parse(await readFile(join(pairsDir, 'report.json'), 'utf8')).fixtureFailed === 1);
});

test('print comparator allows at most three anti-aliased pixels and still catches larger moves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'print-fidelity-pixels-'));
  const screenDir = join(root, 'screen');
  const printDir = join(root, 'print');
  await Promise.all([mkdir(screenDir), mkdir(printDir)]);
  const screenSvg = Buffer.from('<svg width="120" height="80"><path d="M10 20 L50 20" stroke="#16a34a" stroke-width="2"/><path d="M10 60 L50 60" stroke="#2563eb" stroke-width="2"/></svg>');
  const printSvg = Buffer.from('<svg width="120" height="80"><path d="M12 20 L52 20" stroke="#16a34a" stroke-width="2"/><path d="M15 60 L55 60" stroke="#2563eb" stroke-width="2"/></svg>');
  const screen = await whitePage(120, 80).composite([{ input: screenSvg }]).png().toBuffer();
  const print = await whitePage(120, 80).composite([{ input: printSvg }]).png().toBuffer();
  await Promise.all([
    writeFile(join(screenDir, 'page-1.png'), screen),
    writeFile(join(printDir, 'page-1.png'), await fittedLetterPage(print, 120, 80)),
  ]);
  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    pages: [{ page: 1, rotation: 0, width: 120, height: 80 }],
    regions: [
      { id: 'two-pixel-edge', type: 'line', page: 1, bounds: [5, 10, 60, 30], checks: ['bounds', 'colour', 'strokeWeight'] },
      { id: 'five-pixel-move', type: 'line', page: 1, bounds: [5, 50, 65, 75], checks: ['bounds', 'colour', 'strokeWeight'] },
    ],
  }));
  const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir: join(root, 'pairs') });
  assert.equal(report.results.find((item) => item.id === 'two-pixel-edge').status, 'pass');
  assert.equal(report.results.find((item) => item.id === 'five-pixel-move').status, 'print-failure');
});
