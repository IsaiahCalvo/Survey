import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..', '..');
const fixtureRoot = join(root, 'debug', 'fixtures', 'e2e');
const outputRoot = join(root, 'debug', 'artifacts', 'e2e-batch1');

const cases = [
  {
    file: 'prog-01-drawing-markup.pdf',
    pages: [1],
    regions: [
      { page: 1, id: 'multistroke-ink', bounds: [195, 100, 350, 170], maxMae: 30 },
      { page: 1, id: 'multistroke-highlighter', bounds: [375, 110, 580, 165], maxMae: 32 },
      { page: 1, id: 'transparent-and-dashed-shapes', bounds: [35, 190, 575, 290], maxMae: 30 },
    ],
  },
  {
    file: 'acrobat-authored-annotations.pdf',
    pages: [1, 2],
    regions: [
      { page: 1, id: 'acrobat-highlight', bounds: [130, 128, 350, 165], maxMae: 28 },
      { page: 2, id: 'acrobat-highlighter-ink', bounds: [55, 105, 440, 145], maxMae: 30 },
      { page: 2, id: 'acrobat-transparent-shapes', bounds: [55, 275, 405, 380], maxMae: 30 },
      { page: 2, id: 'acrobat-callout', bounds: [235, 585, 585, 720], maxMae: 34 },
    ],
  },
  {
    file: 'prog-02-text-markup.pdf',
    pages: [1],
    regions: [
      { page: 1, id: 'prog02-highlights', bounds: [45, 78, 505, 290], maxMae: 30 },
      { page: 1, id: 'prog02-callout', bounds: [100, 470, 545, 635], maxMae: 34 },
    ],
  },
  {
    file: 'prog-04-rotated-pages.pdf',
    pages: [1, 2, 3, 4],
    regions: [
      { page: 1, id: 'rotate-0', bounds: [45, 135, 570, 610], maxMae: 25 },
      { page: 2, id: 'rotate-90', bounds: [105, 45, 655, 565], maxMae: 25 },
      { page: 3, id: 'rotate-180', bounds: [40, 105, 570, 655], maxMae: 25 },
      { page: 4, id: 'rotate-270', bounds: [135, 40, 610, 570], maxMae: 25 },
    ],
  },
  {
    file: 'prog-05-cropbox-offset.pdf',
    pages: [1, 2],
    regions: [
      { page: 1, id: 'cropbox-top-and-text', bounds: [0, 0, 335, 255], maxMae: 28 },
      { page: 1, id: 'cropbox-highlight-and-shapes', bounds: [0, 280, 612, 550], maxMae: 28 },
      { page: 2, id: 'negative-crop-origin', bounds: [0, 60, 390, 460], maxMae: 28 },
    ],
  },
];

const cropMetrics = async (left, right, bounds, pageWidth, pageHeight) => {
  const width = Math.max(1, Math.round(bounds[2] - bounds[0]));
  const height = Math.max(1, Math.round(bounds[3] - bounds[1]));
  const extract = {
    left: Math.max(0, Math.round(bounds[0])),
    top: Math.max(0, Math.round(bounds[1])),
    width: Math.min(width, pageWidth - Math.max(0, Math.round(bounds[0]))),
    height: Math.min(height, pageHeight - Math.max(0, Math.round(bounds[1]))),
  };
  const [leftRaw, rightRaw] = await Promise.all([
    sharp(left).ensureAlpha().extract(extract).raw().toBuffer(),
    sharp(right).ensureAlpha().extract(extract).raw().toBuffer(),
  ]);
  let sum = 0;
  let strong = 0;
  for (let index = 0; index < leftRaw.length; index += 4) {
    const delta = (
      Math.abs(leftRaw[index] - rightRaw[index])
      + Math.abs(leftRaw[index + 1] - rightRaw[index + 1])
      + Math.abs(leftRaw[index + 2] - rightRaw[index + 2])
    ) / 3;
    sum += delta;
    if (delta > 48) strong += 1;
  }
  const pixels = leftRaw.length / 4;
  return { mae: sum / pixels, strongDiffRatio: strong / pixels };
};

test('imported PDF marks match independent pdftoppm renders by region', async ({ page }) => {
  await mkdir(outputRoot, { recursive: true });
  const report = [];

  for (const fixture of cases) {
    // surveyTransitionE2E=1 is the dev seam that opens a test PDF straight into
    // the viewer without the home/auth flow (same as print-fidelity.spec).
    await page.goto(`/?testPdf=${encodeURIComponent(`e2e/${fixture.file}`)}&surveyTransitionE2E=1`);
    await page.locator('.survey-pdfjs-page-div[data-page-number]').first().waitFor({
      state: 'visible',
      timeout: 60_000,
    });
    await page.keyboard.press('v');

    if (fixture.file === 'prog-02-text-markup.pdf') {
      await expect(page.locator('[data-callout-id]').filter({ hasText: 'Callout: two-segment' })).toHaveCount(1);
    }
    if (fixture.file === 'prog-01-drawing-markup.pdf') {
      const moves = async (id) => page.locator(`[data-pdf-annotation-id="${id}"] path`).first()
        .getAttribute('d')
        .then((pathData) => (pathData?.match(/\bM\b/g) || []).length);
      await expect.poll(() => moves('11R')).toBeGreaterThanOrEqual(3);
      await expect.poll(() => moves('13R')).toBeGreaterThanOrEqual(2);
    }

    for (const pageNumber of fixture.pages) {
      const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
      await pageEl.scrollIntoViewIfNeeded();
      await expect(pageEl).toBeVisible();
      await page.waitForTimeout(350);

      const stem = fixture.file.replace(/\.pdf$/i, '');
      const screenPath = join(outputRoot, `${stem}-p${pageNumber}-app.png`);
      const referencePath = join(outputRoot, `${stem}-p${pageNumber}-reference.png`);
      const pairPath = join(outputRoot, `${stem}-p${pageNumber}-pair.png`);
      await pageEl.screenshot({ path: screenPath, animations: 'disabled' });
      await execFileAsync('pdftoppm', [
        '-png', '-r', '72', '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile',
        join(fixtureRoot, fixture.file),
        referencePath.replace(/\.png$/i, ''),
      ]);

      const screenMeta = await sharp(screenPath).metadata();
      const reference = await sharp(referencePath)
        .resize(screenMeta.width, screenMeta.height, { fit: 'fill' })
        .png()
        .toBuffer();
      await writeFile(referencePath, reference);
      await sharp({
        create: {
          width: screenMeta.width * 2,
          height: screenMeta.height,
          channels: 4,
          background: '#ffffff',
        },
      }).composite([
        { input: await readFile(screenPath), left: 0, top: 0 },
        { input: reference, left: screenMeta.width, top: 0 },
      ]).png().toFile(pairPath);

      for (const region of fixture.regions.filter((entry) => entry.page === pageNumber)) {
        const scaleX = screenMeta.width / (pageNumber > 1 && fixture.file === 'prog-04-rotated-pages.pdf' && pageNumber % 2 === 0 ? 792 : 612);
        const nominalHeight = fixture.file === 'prog-04-rotated-pages.pdf' && pageNumber % 2 === 0 ? 612 : 792;
        const scaleY = screenMeta.height / nominalHeight;
        const scaledBounds = [
          region.bounds[0] * scaleX,
          region.bounds[1] * scaleY,
          region.bounds[2] * scaleX,
          region.bounds[3] * scaleY,
        ];
        const metrics = await cropMetrics(
          screenPath,
          referencePath,
          scaledBounds,
          screenMeta.width,
          screenMeta.height,
        );
        report.push({ ...region, file: fixture.file, pairPath, ...metrics });
        expect(metrics.mae, `${region.id} mean pixel error`).toBeLessThanOrEqual(region.maxMae);
        expect(metrics.strongDiffRatio, `${region.id} large pixel mismatch`).toBeLessThanOrEqual(0.22);
      }
    }
  }

  await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
});
