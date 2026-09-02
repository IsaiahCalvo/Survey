import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rgbToHsl = (r, g, b) => {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { hue: 0, saturation: 0, lightness: light * 100 };
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  let hue = max === rn ? ((gn - bn) / delta) % 6 : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  hue = ((hue * 60) + 360) % 360;
  return { hue, saturation: saturation * 100, lightness: light * 100 };
};
const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

const normalisePageRaster = async ({ imagePath, pageSize, width, height, fitted = false }) => {
  let image = sharp(imagePath).ensureAlpha();
  const meta = await image.metadata();
  if (fitted) {
    // BrowserPrintDocument puts each PDF.js viewport image into a letter sheet
    // with object-fit:contain. Undo that exact fit (including the landscape or
    // CropBox letterbox offset) before any region is measured.
    const fit = Math.min(meta.width / pageSize.width, meta.height / pageSize.height);
    const fittedWidth = Math.min(meta.width, Math.round(pageSize.width * fit));
    const fittedHeight = Math.min(meta.height, Math.round(pageSize.height * fit));
    const left = Math.max(0, Math.round((meta.width - fittedWidth) / 2));
    const top = Math.max(0, Math.round((meta.height - fittedHeight) / 2));
    image = image.extract({ left, top, width: fittedWidth, height: fittedHeight });
  }
  return image.resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toBuffer();
};

const cropForRegion = async (imageBuffer, bounds, pageSize) => {
  const image = sharp(imageBuffer).ensureAlpha();
  const meta = await image.metadata();
  const sx = meta.width / pageSize.width;
  const sy = meta.height / pageSize.height;
  const left = clamp(Math.floor(bounds[0] * sx), 0, meta.width - 1);
  const top = clamp(Math.floor(bounds[1] * sy), 0, meta.height - 1);
  const width = clamp(Math.ceil((bounds[2] - bounds[0]) * sx), 1, meta.width - left);
  const height = clamp(Math.ceil((bounds[3] - bounds[1]) * sy), 1, meta.height - top);
  const { data, info } = await image.extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true });
  return { data, info, left, top, width, height };
};

const analyseCrop = ({ data, info }) => {
  const coloured = [];
  let dark = 0;
  let painted = 0;
  let saturated = 0;
  let sumX = 0; let sumY = 0; let sumXX = 0; let sumYY = 0; let sumXY = 0;
  let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1;
  const mask = new Uint8Array(info.width * info.height);
  const lightnessByPixel = new Float32Array(info.width * info.height);
  const observedLightness = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
      const hsl = rgbToHsl(r, g, b);
      const minChannel = Math.min(r, g, b);
      const maxChannel = Math.max(r, g, b);
      const chroma = maxChannel - minChannel;
      const whiteDistance = 255 - minChannel;
      // BrowserPrintDocument uses JPEG page images. Near-white JPEG noise can
      // have a high HSL saturation even when channels differ by only 1. Use a
      // real distance from white so compression speckle never becomes paint.
      const nonBackground = whiteDistance > 12 && (minChannel < 243 || chroma > 10);
      if (!nonBackground) continue;
      mask[y * info.width + x] = 1;
      lightnessByPixel[y * info.width + x] = hsl.lightness;
      observedLightness.push(hsl.lightness);
      painted += 1;
      sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (hsl.lightness < 45) dark += 1;
      if (hsl.saturation >= 30 && hsl.lightness > 8 && hsl.lightness < 97) {
        saturated += 1;
        coloured.push({ ...hsl, chroma, x, y });
      }
    }
  }
  observedLightness.sort((a, b) => a - b);
  const minLightness = observedLightness[0] ?? 100;
  const maxLightness = observedLightness.at(-1) ?? 100;
  // A filled shape normally has a light interior and a darker outline. When
  // those clusters are distinct, measure only the outline. A flat pen or
  // highlighter has no such split, so its whole paint mask is the stroke.
  const strokeLightnessLimit = maxLightness - minLightness > 12
    ? minLightness + Math.min(12, (maxLightness - minLightness) * 0.4)
    : maxLightness;
  const strokeMask = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    strokeMask[index] = mask[index] && lightnessByPixel[index] <= strokeLightnessLimit ? 1 : 0;
  }
  // One- and two-pixel anti-aliased edges are not stable stroke samples.
  // Measure only short cross-stroke runs that are at least 3px wide.
  const strokeRuns = [];
  const recordRuns = (length, read, maxRun) => {
    let run = 0;
    for (let index = 0; index <= length; index += 1) {
      if (index < length && read(index)) run += 1;
      else {
        if (run >= 3 && run <= maxRun) strokeRuns.push(run);
        run = 0;
      }
    }
  };
  const maxHorizontalRun = Math.max(12, Math.round(info.width * 0.18));
  const maxVerticalRun = Math.max(12, Math.round(info.height * 0.18));
  for (let y = 0; y < info.height; y += 1) {
    recordRuns(info.width, (x) => strokeMask[y * info.width + x], maxHorizontalRun);
  }
  for (let x = 0; x < info.width; x += 1) {
    recordRuns(info.height, (y) => strokeMask[y * info.width + x], maxVerticalRun);
  }
  // Pick the largest saturated paint cluster. Hue plus lightness keeps a pale
  // fill separate from its dark anti-aliased edge.
  const sortedChroma = coloured.map((pixel) => pixel.chroma).sort((a, b) => a - b);
  const chromaFloor = sortedChroma.length
    ? Math.max(12, sortedChroma[Math.floor(sortedChroma.length * 0.75)] - 2)
    : 12;
  // HSL saturation is unstable near white: a one-channel JPEG fringe may be
  // reported as 100% saturated. Chroma keeps the dominant cluster on the
  // annotation's real interior or stroke paint.
  const paintCoverage = painted / Math.max(1, info.width * info.height);
  const dominantCandidates = paintCoverage > 0.15
    ? coloured.filter((pixel) => pixel.chroma >= 12)
    : coloured.filter((pixel) => pixel.chroma >= chromaFloor);
  const colourBins = new Map();
  dominantCandidates.forEach((pixel) => {
    const key = `${Math.floor(pixel.hue / 15) % 24}:${Math.floor(pixel.lightness / 10)}`;
    const bin = colourBins.get(key) || { pixels: [], score: 0 };
    bin.pixels.push(pixel);
    bin.score += 1;
    colourBins.set(key, bin);
  });
  const dominantColours = [...colourBins.values()].reduce((best, bin) => bin.score > best.score ? bin : best, { pixels: [], score: 0 }).pixels;
  dominantColours.sort((a, b) => a.hue - b.hue);
  const runCounts = new Map();
  strokeRuns.forEach((run) => runCounts.set(run, (runCounts.get(run) || 0) + 1));
  const dominantRun = [...runCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
  const median = (list, key) => list.length ? list[Math.floor(list.length / 2)][key] : null;
  let orientation = null;
  if (painted > 1) {
    const meanX = sumX / painted; const meanY = sumY / painted;
    const covarianceXX = sumXX / painted - meanX * meanX;
    const covarianceYY = sumYY / painted - meanY * meanY;
    const covarianceXY = sumXY / painted - meanX * meanY;
    orientation = ((Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY) * 90 / Math.PI) + 180) % 180;
  }
  return {
    paintedPixels: painted,
    coverage: painted / Math.max(1, info.width * info.height),
    darkCoverage: dark / Math.max(1, info.width * info.height),
    saturatedCoverage: saturated / Math.max(1, info.width * info.height),
    pixelSize: { width: info.width, height: info.height },
    bounds: painted ? { left: minX / info.width, top: minY / info.height, right: (maxX + 1) / info.width, bottom: (maxY + 1) / info.height } : null,
    colour: dominantColours.length ? { hue: median(dominantColours, 'hue'), saturation: median(dominantColours, 'saturation'), lightness: median(dominantColours, 'lightness') } : null,
    strokeWeight: painted && maxLightness - minLightness <= 12 && painted / Math.max(1, info.width * info.height) > 0.15 ? 0 : dominantRun,
    strokeSampleCount: painted && maxLightness - minLightness <= 12 && painted / Math.max(1, info.width * info.height) > 0.15 ? 0 : strokeRuns.length,
    orientation,
  };
};

const orientationDistance = (a, b) => {
  const delta = Math.abs(a - b) % 180;
  return Math.min(delta, 180 - delta);
};

const compareMetrics = (screen, print, checks, tolerance = {}) => {
  const failures = [];
  const boundTol = tolerance.bounds ?? 0.02;
  if (checks.includes('bounds')) {
    if (!screen.bounds || !print.bounds) failures.push('missing painted bounds');
    else for (const edge of ['left', 'top', 'right', 'bottom']) {
      const axisPixels = edge === 'left' || edge === 'right' ? screen.pixelSize.width : screen.pixelSize.height;
      const boundsPixels = tolerance.boundsPixels ?? 3;
      const edgeTolerance = Math.max(boundTol, boundsPixels / Math.max(1, axisPixels));
      const delta = Math.abs(screen.bounds[edge] - print.bounds[edge]);
      if (delta > edgeTolerance + 1e-6) failures.push(`${edge} delta ${delta.toFixed(4)} > ${edgeTolerance.toFixed(4)} (max 2%, ${boundsPixels}px)`);
    }
  }
  if (checks.includes('colour')) {
    if (!screen.colour || !print.colour) failures.push('missing dominant colour');
    else {
      const hue = hueDistance(screen.colour.hue, print.colour.hue);
      const light = Math.abs(screen.colour.lightness - print.colour.lightness);
      const thinPaint = Math.min(screen.coverage, print.coverage) < 0.05;
      const lightnessTolerance = tolerance.lightness ?? (thinPaint ? 42 : 20);
      if (hue > (tolerance.hue ?? 12)) failures.push(`hue delta ${hue.toFixed(1)}`);
      if (light > lightnessTolerance) failures.push(`lightness delta ${light.toFixed(1)} > ${lightnessTolerance}`);
    }
  }
  if (checks.includes('fillCoverage')) {
    const delta = Math.abs(screen.coverage - print.coverage);
    if (delta > (tolerance.coverage ?? 0.12)) failures.push(`coverage delta ${delta.toFixed(4)}`);
  }
  if (checks.includes('strokeWeight')) {
    if (screen.strokeSampleCount > 0 && print.strokeSampleCount > 0) {
      const denom = Math.max(1, screen.strokeWeight);
      const delta = Math.abs(screen.strokeWeight - print.strokeWeight) / denom;
      if (delta > (tolerance.strokeWeight ?? 0.45)) failures.push(`stroke delta ${(delta * 100).toFixed(1)}%`);
    }
  }
  if (checks.includes('orientation')) {
    if (!Number.isFinite(screen.orientation) || !Number.isFinite(print.orientation)) failures.push('missing orientation');
    else {
      const delta = orientationDistance(screen.orientation, print.orientation);
      if (delta > (tolerance.orientation ?? 8)) failures.push(`orientation delta ${delta.toFixed(1)}°`);
    }
  }
  if (checks.includes('textPresence')) {
    const screenSignal = screen.darkCoverage + screen.saturatedCoverage;
    const printSignal = print.darkCoverage + print.saturatedCoverage;
    if (screenSignal < (tolerance.textSignal ?? 0.002) || printSignal < (tolerance.textSignal ?? 0.002)) {
      failures.push(`text missing screen=${screenSignal.toFixed(4)} print=${printSignal.toFixed(4)}`);
    }
  }
  return failures;
};

export async function comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mkdir(outputDir, { recursive: true });
  const results = [];
  const normalisedDir = join(outputDir, '_normalised-pages');
  await mkdir(normalisedDir, { recursive: true });
  const normalisedPages = new Map();
  for (const page of manifest.pages) {
    const pageSize = pageViewportSize(page);
    const screenPath = join(screenDir, `page-${page.page}.png`);
    const printPath = join(printDir, `page-${page.page}.png`);
    const screenMeta = await sharp(screenPath).metadata();
    const common = { width: screenMeta.width, height: screenMeta.height };
    const screenRaster = await normalisePageRaster({ imagePath: screenPath, pageSize, ...common });
    const printRaster = await normalisePageRaster({ imagePath: printPath, pageSize, ...common, fitted: true });
    await writeFile(join(normalisedDir, `page-${page.page}-screen.png`), screenRaster);
    await writeFile(join(normalisedDir, `page-${page.page}-print.png`), printRaster);
    normalisedPages.set(page.page, { pageSize, screenRaster, printRaster, common });
  }
  for (const item of manifest.regions) {
    const normalised = normalisedPages.get(item.page);
    if (!normalised) throw new Error(`Missing page ${item.page} in print-fidelity manifest`);
    const { pageSize, screenRaster, printRaster } = normalised;
    const screenCrop = await cropForRegion(screenRaster, item.bounds, pageSize);
    const printCrop = await cropForRegion(printRaster, item.bounds, pageSize);
    if (screenCrop.width !== printCrop.width || screenCrop.height !== printCrop.height) {
      throw new Error(`${item.id}: screen and print crop grids differ`);
    }
    const screen = analyseCrop(screenCrop);
    const print = analyseCrop(printCrop);
    const fixtureMinimum = item.fixtureMinPaintedPixels ?? Math.max(8, Math.round(screenCrop.width * screenCrop.height * 0.0005));
    const expectedScreenAbsent = item.tolerance?.expectedScreenAbsent === true;
    const fixtureFailures = expectedScreenAbsent
      ? (screen.paintedPixels > fixtureMinimum
        ? [`screen paintedPixels ${screen.paintedPixels} > absent maximum ${fixtureMinimum}`]
        : [])
      : screen.paintedPixels < fixtureMinimum
        ? [`screen paintedPixels ${screen.paintedPixels} < fixture minimum ${fixtureMinimum}`]
        : [];
    const expectedPrintAbsent = item.tolerance?.expectedPrintAbsent === true;
    const maxAbsentPixels = item.tolerance?.maxAbsentPixels
      ?? Math.max(8, Math.round(printCrop.width * printCrop.height * 0.0005));
    const failures = fixtureFailures.length
      ? []
      : expectedPrintAbsent
        ? (print.paintedPixels > maxAbsentPixels
          ? [`print paintedPixels ${print.paintedPixels} > absent maximum ${maxAbsentPixels}`]
          : [])
        : compareMetrics(screen, print, item.checks || ['bounds', 'colour'], item.tolerance);
    if (
      !fixtureFailures.length
      && !expectedPrintAbsent
      && Number.isFinite(item.tolerance?.minPrintLightness)
      && (!print.colour || print.colour.lightness < item.tolerance.minPrintLightness)
    ) {
      failures.push(`print lightness ${print.colour?.lightness ?? 'missing'} < ${item.tolerance.minPrintLightness}`);
    }
    const safe = item.id.replace(/[^a-z0-9_.-]+/gi, '-');
    const beforePath = join(outputDir, `${safe}-screen.png`);
    const afterPath = join(outputDir, `${safe}-print.png`);
    await sharp(screenRaster).extract({ left: screenCrop.left, top: screenCrop.top, width: screenCrop.width, height: screenCrop.height }).png().toFile(beforePath);
    await sharp(printRaster).extract({ left: printCrop.left, top: printCrop.top, width: printCrop.width, height: printCrop.height }).png().toFile(afterPath);
    const status = item.knownUnsupported
      ? 'known-unsupported'
      : fixtureFailures.length ? 'fixture-failure' : failures.length ? 'print-failure' : 'pass';
    results.push({ id: item.id, type: item.type, page: item.page, status, pass: status === 'pass', fixtureFailures, failures, cropSize: { width: screenCrop.width, height: screenCrop.height }, screen, print, screenImage: beforePath, printImage: afterPath });
  }
  const report = {
    generatedAt: new Date().toISOString(), manifest: basename(manifestPath),
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'print-failure').length,
    fixtureFailed: results.filter((r) => r.status === 'fixture-failure').length,
    results,
  };
  await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const PAGE_WIDTH = (page) => page.cropBox ? page.cropBox[2] - page.cropBox[0] : Number(page.width) || 612;
const PAGE_HEIGHT = (page) => page.cropBox ? page.cropBox[3] - page.cropBox[1] : Number(page.height) || 792;

const pageViewportSize = (page) => page.rotation === 90 || page.rotation === 270
  ? { width: PAGE_HEIGHT(page), height: PAGE_WIDTH(page) }
  : page.cropBox
    ? { width: page.cropBox[2] - page.cropBox[0], height: page.cropBox[3] - page.cropBox[1] }
    : { width: PAGE_WIDTH(page), height: PAGE_HEIGHT(page) };

export async function validatePrintFidelityScreenFixture({ manifestPath, screenDir }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const pages = new Map();
  for (const page of manifest.pages) {
    const pageSize = pageViewportSize(page);
    const screenPath = join(screenDir, `page-${page.page}.png`);
    const meta = await sharp(screenPath).metadata();
    const screenRaster = await normalisePageRaster({ imagePath: screenPath, pageSize, width: meta.width, height: meta.height });
    pages.set(page.page, { pageSize, screenRaster });
  }
  const results = [];
  for (const item of manifest.regions) {
    const page = pages.get(item.page);
    const crop = await cropForRegion(page.screenRaster, item.bounds, page.pageSize);
    const screen = analyseCrop(crop);
    const minimum = item.fixtureMinPaintedPixels ?? Math.max(8, Math.round(crop.width * crop.height * 0.0005));
    const expectedScreenAbsent = item.tolerance?.expectedScreenAbsent === true;
    const failures = expectedScreenAbsent
      ? (screen.paintedPixels > minimum
        ? [`screen paintedPixels ${screen.paintedPixels} > absent maximum ${minimum}`]
        : [])
      : screen.paintedPixels < minimum
        ? [`screen paintedPixels ${screen.paintedPixels} < fixture minimum ${minimum}`]
        : [];
    if (item.knownUnsupported) {
      // Documented gap (e.g. /Stamp import unsupported): report, never fail.
      results.push({ id: item.id, type: item.type, page: item.page, pass: true, knownUnsupported: item.knownUnsupported, failures: [], screen });
      continue;
    }
    results.push({ id: item.id, type: item.type, page: item.page, pass: failures.length === 0, failures, screen });
  }
  return { passed: results.filter((item) => item.pass).length, failed: results.filter((item) => !item.pass).length, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, screenDir, printDir, outputDir] = process.argv.slice(2);
  if (!manifestPath || !screenDir || !printDir || !outputDir) {
    console.error('Usage: node scripts/print-fidelity-compare.mjs <manifest> <screen-dir> <print-dir> <output-dir>');
    process.exitCode = 2;
  } else {
    const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir });
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, fixtureFailed: report.fixtureFailed, report: join(outputDir, 'report.json') }));
    if (report.failed || report.fixtureFailed) process.exitCode = 1;
  }
}
