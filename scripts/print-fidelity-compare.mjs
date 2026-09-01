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

const cropForRegion = async (imagePath, bounds, pageSize) => {
  const image = sharp(imagePath).ensureAlpha();
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
  let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1;
  const mask = new Uint8Array(info.width * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
      const hsl = rgbToHsl(r, g, b);
      const nonBackground = hsl.saturation > 5 || hsl.lightness < 88;
      if (!nonBackground) continue;
      mask[y * info.width + x] = 1;
      painted += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (hsl.lightness < 45) dark += 1;
      if (hsl.saturation > 18 && hsl.lightness > 8 && hsl.lightness < 94) coloured.push(hsl);
    }
  }
  let edgeRuns = [];
  for (let y = 0; y < info.height; y += 1) {
    let run = 0;
    for (let x = 0; x < info.width; x += 1) {
      if (mask[y * info.width + x]) run += 1;
      else if (run) { if (run <= Math.max(20, info.width * 0.18)) edgeRuns.push(run); run = 0; }
    }
    if (run && run <= Math.max(20, info.width * 0.18)) edgeRuns.push(run);
  }
  edgeRuns.sort((a, b) => a - b);
  coloured.sort((a, b) => a.hue - b.hue);
  const median = (list, key) => list.length ? list[Math.floor(list.length / 2)][key] : null;
  return {
    paintedPixels: painted,
    coverage: painted / Math.max(1, info.width * info.height),
    darkCoverage: dark / Math.max(1, info.width * info.height),
    bounds: painted ? { left: minX / info.width, top: minY / info.height, right: (maxX + 1) / info.width, bottom: (maxY + 1) / info.height } : null,
    colour: coloured.length ? { hue: median(coloured, 'hue'), saturation: median(coloured, 'saturation'), lightness: median(coloured, 'lightness') } : null,
    strokeWeight: edgeRuns.length ? edgeRuns[Math.floor(edgeRuns.length / 2)] : 0,
  };
};

const compareMetrics = (screen, print, checks, tolerance = {}) => {
  const failures = [];
  const boundTol = tolerance.bounds ?? 0.02;
  if (checks.includes('bounds')) {
    if (!screen.bounds || !print.bounds) failures.push('missing painted bounds');
    else for (const edge of ['left', 'top', 'right', 'bottom']) {
      const delta = Math.abs(screen.bounds[edge] - print.bounds[edge]);
      if (delta > boundTol) failures.push(`${edge} delta ${delta.toFixed(4)} > ${boundTol}`);
    }
  }
  if (checks.includes('colour')) {
    if (!screen.colour || !print.colour) failures.push('missing dominant colour');
    else {
      const hue = hueDistance(screen.colour.hue, print.colour.hue);
      const light = Math.abs(screen.colour.lightness - print.colour.lightness);
      if (hue > (tolerance.hue ?? 12)) failures.push(`hue delta ${hue.toFixed(1)}`);
      if (light > (tolerance.lightness ?? 14)) failures.push(`lightness delta ${light.toFixed(1)}`);
    }
  }
  if (checks.includes('fillCoverage')) {
    const delta = Math.abs(screen.coverage - print.coverage);
    if (delta > (tolerance.coverage ?? 0.12)) failures.push(`coverage delta ${delta.toFixed(4)}`);
  }
  if (checks.includes('strokeWeight')) {
    const denom = Math.max(1, screen.strokeWeight);
    const delta = Math.abs(screen.strokeWeight - print.strokeWeight) / denom;
    if (delta > (tolerance.strokeWeight ?? 0.45)) failures.push(`stroke delta ${(delta * 100).toFixed(1)}%`);
  }
  if (checks.includes('textPresence') && (screen.darkCoverage < 0.002 || print.darkCoverage < 0.002)) {
    failures.push(`text missing screen=${screen.darkCoverage.toFixed(4)} print=${print.darkCoverage.toFixed(4)}`);
  }
  return failures;
};

export async function comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mkdir(outputDir, { recursive: true });
  const results = [];
  for (const item of manifest.regions) {
    const page = manifest.pages.find((entry) => entry.page === item.page) || { page: item.page };
    const pageSize = page.rotation === 90 || page.rotation === 270
      ? { width: PAGE_HEIGHT(page), height: PAGE_WIDTH(page) }
      : page.cropBox ? { width: page.cropBox[2] - page.cropBox[0], height: page.cropBox[3] - page.cropBox[1] } : { width: 612, height: 792 };
    const screenPath = join(screenDir, `page-${item.page}.png`);
    const printPath = join(printDir, `page-${item.page}.png`);
    const screenCrop = await cropForRegion(screenPath, item.bounds, pageSize);
    const printCrop = await cropForRegion(printPath, item.bounds, pageSize);
    const screen = analyseCrop(screenCrop);
    const print = analyseCrop(printCrop);
    const failures = compareMetrics(screen, print, item.checks || ['bounds', 'colour'], item.tolerance);
    const safe = item.id.replace(/[^a-z0-9_.-]+/gi, '-');
    const beforePath = join(outputDir, `${safe}-screen.png`);
    const afterPath = join(outputDir, `${safe}-print.png`);
    await sharp(screenPath).extract({ left: screenCrop.left, top: screenCrop.top, width: screenCrop.width, height: screenCrop.height }).png().toFile(beforePath);
    await sharp(printPath).extract({ left: printCrop.left, top: printCrop.top, width: printCrop.width, height: printCrop.height }).png().toFile(afterPath);
    results.push({ id: item.id, type: item.type, page: item.page, pass: failures.length === 0, failures, screen, print, screenImage: beforePath, printImage: afterPath });
  }
  const report = { generatedAt: new Date().toISOString(), manifest: basename(manifestPath), passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results };
  await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const PAGE_WIDTH = (page) => page.cropBox ? page.cropBox[2] - page.cropBox[0] : 612;
const PAGE_HEIGHT = (page) => page.cropBox ? page.cropBox[3] - page.cropBox[1] : 792;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, screenDir, printDir, outputDir] = process.argv.slice(2);
  if (!manifestPath || !screenDir || !printDir || !outputDir) {
    console.error('Usage: node scripts/print-fidelity-compare.mjs <manifest> <screen-dir> <print-dir> <output-dir>');
    process.exitCode = 2;
  } else {
    const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir });
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: join(outputDir, 'report.json') }));
    if (report.failed) process.exitCode = 1;
  }
}
