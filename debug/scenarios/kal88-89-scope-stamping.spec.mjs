// KAL-88 / KAL-89 residuals — live-app verification of survey scope stamping
// and the eraser's survey-mode gate, on the same surveyTransitionE2E fixture
// kal436-survey-transition.spec.mjs uses (local test PDF, seam templates,
// no cloud auth).
//
// KAL-88: a Text and a Counter created while survey mode (module
// "Existing Survey Data") is active must be survey-scoped — visible in the
// creating module, hidden in the other module, hidden in standard mode —
// while standard-mode content stays canvas-scoped (hidden in survey mode,
// visible in standard mode).
//
// KAL-89: with survey mode active, an eraser sweep straight across the
// survey-HIDDEN standard content must be refused; every standard mark
// survives, bit-identical, back in standard mode.
//
// The fixture PDF carries imported native annotations that materialize into
// the page JSON around the first commit, so assertions compare the WHOLE
// standard-mode id set before and after, rather than tracking a single id
// through a baseline diff.
import { test, expect } from '@playwright/test';

const FIXTURE = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

const uniqueAnnotationIds = (page) => page.evaluate(() => [...new Set(
  [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
    .map((node) => node.getAttribute('data-anno-id'))
    .filter(Boolean),
)].sort());

// Serialized geometry of every annotation node — the "nothing was erased or
// carved" fingerprint (partial erase mutates path data even when it keeps
// the id). Numbers are normalized to 2dp: float re-serialization jitters
// the last digits of path data across re-renders (observed: one digit in a
// ~5000-char path after a survey-mode round trip, all 253 coordinates
// identical to 2dp), so a byte-strict compare false-positives while a real
// carve moves coordinates by whole units.
// Hit-target elements flip pointer-events ("none" while a draw tool is
// active, "all"/"stroke" under select) — interaction state, not geometry,
// so it is excluded from the fingerprint too.
const layerGeometry = (page) => page.evaluate(() => [
  ...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]'),
].map((node) => {
  const normalized = node.innerHTML
    .replace(/-?\d+\.\d+(?:e-?\d+)?/g, (num) => Number(num).toFixed(2))
    .replace(/pointer-events="[^"]*"/g, '');
  return `${node.getAttribute('data-anno-id')}:${normalized}`;
}).sort().join('\n'));

test('KAL-88/89: text + counter creations stamp survey scope; eraser refuses survey-hidden marks', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(FIXTURE);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const annotationLayer = page.locator('[data-svg-annotation-layer="1"]');
  await expect(annotationLayer).toBeVisible({ timeout: 30_000 });

  // ---- Standard mode: one canvas-scoped pen stroke (the KAL-89 victim). ----
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const box = await annotationLayer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + 260, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 250, { steps: 8 });
  await page.mouse.up();
  // The commit also materializes the fixture's imported annotations into the
  // page JSON — wait for the id set to settle, then snapshot ALL standard
  // content (imported marks + the pen stroke alike are canvas-scoped).
  await expect.poll(async () => (await uniqueAnnotationIds(page)).length, {
    timeout: 30_000,
  }).toBeGreaterThan(0);
  let previousCount = -1;
  await expect.poll(async () => {
    const count = (await uniqueAnnotationIds(page)).length;
    const stable = count === previousCount;
    previousCount = count;
    return stable;
  }, { intervals: [1_000], timeout: 30_000 }).toBe(true);
  const standardIds = await uniqueAnnotationIds(page);
  const standardGeometry = await layerGeometry(page);
  expect(standardIds.length).toBeGreaterThan(0);

  // ---- Enter survey mode (module: Existing Survey Data). ----
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Existing Survey Data' })).toBeVisible();
  await page.getByRole('button', { name: /Walls/ }).click();
  // Owner 2026-10-07 (Drawboard rail + Survey chip): no "Expand / Close Survey
  // panel" chevrons and no "Exit Survey" any more. The Survey tab opens and
  // closes the panel; the Survey chip's "Leave Survey" leaves Survey.
  await expect(page.getByRole('button', { name: 'Leave Survey' })).toBeVisible();
  // Survey mode hides ALL canvas-scoped content — same assertion as KAL-436.
  await expect.poll(() => uniqueAnnotationIds(page)).toEqual([]);

  // ---- KAL-89: eraser sweep straight across the hidden standard content. ----
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: /Partial erase|Full stroke erase/ }).click();
  await page.mouse.move(box.x + 240, box.y + 210);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 260, { steps: 12 });
  await page.mouse.up();

  // ---- KAL-88 (text): create a Text annotation while survey mode is on. ----
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box.x + 420, box.y + 160);
  await page.keyboard.type('Survey scoped text');
  // Tool switch commits the text (unmount = commit).
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  // The committed text is survey-scoped -> visible in the active module
  // (before the KAL-88 fix it committed canvas-scoped and hid instantly).
  await expect.poll(async () => (await uniqueAnnotationIds(page)).length).toBe(1);
  const [textId] = await uniqueAnnotationIds(page);
  expect(standardIds).not.toContain(textId);

  // ---- KAL-88 (counter): drop a Counter pin while survey mode is on. ----
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  // The counter overlay intentionally swallows pointerdowns within 300ms of
  // an edit commit (editModeCooldownRef runaway-pin guard) — let it lapse.
  await page.waitForTimeout(400);
  await page.mouse.move(box.x + 480, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 484, box.y + 304, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => (await uniqueAnnotationIds(page)).length).toBe(2);
  const surveyIds = await uniqueAnnotationIds(page);
  const counterId = surveyIds.find((id) => id !== textId);
  expect(counterId).toBeTruthy();
  expect(standardIds).not.toContain(counterId);

  // (Cross-module hiding is not re-driven here: the "Survey module" select
  // only exists while the survey sub-toolbar is open, which the Draw/Text/
  // Shapes tool clicks above replaced. The scope proof doesn't need it —
  // visible-in-survey AND absent-in-standard (asserted below) is only
  // satisfiable by a matching-module survey scope, and cross-module hiding
  // of survey content is covered by kal436-survey-transition.spec.mjs plus
  // the isAnnotationVisibleInSurveyMode unit tests.)

  // ---- Back to standard mode: the Survey chip's x (owner 2026-10-07). ----
  await page.getByRole('button', { name: 'Leave Survey' }).click();
  await expect(page.getByRole('button', { name: 'Survey', exact: true })).toBeVisible();

  // KAL-89: the survey-mode sweep erased NOTHING — the standard id set is
  // exactly what it was, and no geometry was carved.
  await expect.poll(() => uniqueAnnotationIds(page)).toEqual(standardIds);
  expect(await layerGeometry(page)).toBe(standardGeometry);
  // KAL-88: the survey-scoped text + counter do NOT appear in standard mode.
  const backToStandardIds = await uniqueAnnotationIds(page);
  expect(backToStandardIds).not.toContain(textId);
  expect(backToStandardIds).not.toContain(counterId);

  // ---- Control: the SAME sweep in standard mode does touch content, ----
  // proving the survey-mode refusal above was the gate, not a dead eraser.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: /Partial erase|Full stroke erase/ }).click();
  await page.mouse.move(box.x + 240, box.y + 210);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 260, { steps: 12 });
  await page.mouse.up();
  await expect.poll(
    async () => (await layerGeometry(page)) !== standardGeometry,
    { timeout: 15_000 },
  ).toBe(true);
});
