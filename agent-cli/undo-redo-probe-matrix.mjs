// agent-cli/undo-redo-probe-matrix.mjs — w37: the per-tool part of
// undo-redo-probe.mjs (imported by it). Every tool the keyboard arms draws a
// mark in the real app, a few marks are moved, recoloured, pasted, deleted and
// erased, then Undo walks the whole history back and Redo walks it forward:
// each press must land exactly on the page as it was before / after the
// matching gesture (one gesture = one step), one press past either end must
// change nothing, and a new action must clear Redo.

// Page 1 as the screen shows it: id -> hash of the whole mark (keys sorted).
export const fullSnapshot = (page) => page.evaluate(() => {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined || key.startsWith('__')) continue;
        out[key] = canonical(value[key]);
      }
      return out;
    }
    return value;
  };
  const objects = window.__diagState?.annotationsByPage?.[1]?.objects || [];
  const out = {};
  for (const object of objects) {
    const id = String(object?.data?.id ?? object?.id ?? '');
    const text = JSON.stringify(canonical(object));
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) | 0;
    out[id] = `${object.type}:${hash}`;
  }
  return out;
});

const sameState = (l, r) => JSON.stringify(Object.entries(l).sort()) === JSON.stringify(Object.entries(r).sort());
const describeDiff = (expected, actual) => ({
  missing: Object.keys(expected).filter((k) => !(k in actual)),
  extra: Object.keys(actual).filter((k) => !(k in expected)),
  changed: Object.keys(expected).filter((k) => k in actual && expected[k] !== actual[k]),
});

export async function runMatrixSequence(page, { log, pageBox, drag, line, failures, pace = 700 }) {
  const box = await pageBox(page);
  const P = (fx, fy) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });
  const settle = () => page.waitForTimeout(pace);
  const states = [await fullSnapshot(page)];
  const labels = ['start'];
  const skipped = [];
  const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(250); };
  const act = async (label, run) => {
    const before = states[states.length - 1];
    try {
      await run();
    } catch (error) {
      log(`matrix: ${label} threw ${error.message}`);
    }
    await settle();
    // Leave any editor / selection before measuring.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const after = await fullSnapshot(page);
    if (sameState(before, after)) {
      skipped.push(label);
      log(`matrix: ${label}: nothing changed on the page (automation did not reach it) - not a step`);
      return false;
    }
    states.push(after);
    labels.push(label);
    log(`matrix: ${label}: ${JSON.stringify(describeDiff(before, after))}`);
    return true;
  };
  const selectAt = async (point) => {
    await key('v');
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(250);
  };
  // ONE colour change: the first swatch that changes the selection (each
  // swatch click is its own step, so clicking several would be several).
  const clickSwatch = async () => {
    const swatch = page.locator('button[aria-label="Blue"], button[aria-label="Red"], button[aria-label="Black"]').filter({ visible: true });
    const count = await swatch.count();
    const before = await fullSnapshot(page);
    for (let index = 0; index < count; index += 1) {
      await swatch.nth(index).click({ timeout: 1_500 }).catch(() => {});
      await page.waitForTimeout(300);
      if (!sameState(before, await fullSnapshot(page))) return;
    }
  };

  // --- create one mark per tool --------------------------------------------
  const penA = [P(0.08, 0.12), P(0.28, 0.14)];
  await act('pen: create', async () => { await key('p'); await drag(page, line(penA[0], penA[1]), 350); });
  await act('highlighter: create', async () => { await key('h'); await drag(page, line(P(0.08, 0.2), P(0.28, 0.2)), 350); });
  await act('rectangle: create', async () => { await key('r'); await drag(page, line(P(0.36, 0.1), P(0.5, 0.22), 10), 300); });
  await act('ellipse: create', async () => { await key('o'); await drag(page, line(P(0.56, 0.1), P(0.7, 0.22), 10), 300); });
  await act('line: create', async () => { await key('l'); await drag(page, line(P(0.08, 0.3), P(0.28, 0.36), 10), 300); });
  await act('arrow: create', async () => { await key('a'); await drag(page, line(P(0.36, 0.3), P(0.5, 0.36), 10), 300); });
  await act('polygon: create', async () => {
    await key('g');
    for (const point of [P(0.56, 0.3), P(0.7, 0.3), P(0.63, 0.4)]) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('Enter');
  });
  await act('polyline: create', async () => {
    await key('k');
    for (const point of [P(0.76, 0.3), P(0.84, 0.36), P(0.92, 0.3)]) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('Enter');
  });
  await act('counter: create', async () => { await key('c'); await page.mouse.click(P(0.1, 0.5).x, P(0.1, 0.5).y); });
  await act('text box: create + type', async () => {
    await key('t');
    const at = P(0.36, 0.48);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
    await page.keyboard.type('Hello w37');
    await page.waitForTimeout(200);
    await page.mouse.click(P(0.95, 0.95).x, P(0.95, 0.95).y);
  });
  await act('callout: create + type', async () => {
    await key('q');
    await drag(page, line(P(0.6, 0.62), P(0.72, 0.5), 10), 300);
    await page.waitForTimeout(400);
    await page.keyboard.type('Call w37');
    await page.waitForTimeout(200);
    await page.mouse.click(P(0.95, 0.95).x, P(0.95, 0.95).y);
  });

  // A new callout abandoned with Esc must leave nothing (and no Undo step).
  const escOk = await act('callout: create then Esc (expect no change, no step)', async () => {
    await key('q');
    await drag(page, line(P(0.8, 0.8), P(0.9, 0.7), 10), 300);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
  });
  if (escOk) {
    log('FAIL callout: create then Esc left something on the page');
    failures.push({ label: 'callout Esc left a mark' });
  }

  // --- edit a few ----------------------------------------------------------
  await act('text box: edit text', async () => {
    await key('v');
    const at = P(0.37, 0.485);
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForTimeout(400);
    await page.keyboard.press('End');
    await page.keyboard.type(' more');
    await page.waitForTimeout(200);
    await page.mouse.click(P(0.95, 0.95).x, P(0.95, 0.95).y);
  });
  const penMid = { x: (penA[0].x + penA[1].x) / 2, y: (penA[0].y + penA[1].y) / 2 };
  await act('pen: move', async () => {
    await selectAt(penMid);
    await drag(page, line(penMid, { x: penMid.x + 30, y: penMid.y + 25 }, 10), 300);
  });
  const penMoved = { x: penMid.x + 30, y: penMid.y + 25 };
  await act('pen: recolour', async () => { await selectAt(penMoved); await clickSwatch(); });
  const rectEdge = P(0.36, 0.16);
  await act('rectangle: move', async () => {
    await selectAt(rectEdge);
    await drag(page, line(rectEdge, { x: rectEdge.x + 20, y: rectEdge.y + 40 }, 10), 300);
  });
  await act('line: recolour', async () => { await selectAt(P(0.18, 0.33)); await clickSwatch(); });
  await act('counter: move', async () => {
    const at = P(0.1, 0.5);
    await selectAt(at);
    await drag(page, line(at, { x: at.x + 40, y: at.y + 10 }, 10), 300);
  });
  await act('pen: copy + paste', async () => {
    await selectAt(penMoved);
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+v');
  });
  await act('arrow: delete', async () => { await selectAt(P(0.43, 0.33)); await page.keyboard.press('Delete'); });
  await act('multi-select: marquee delete (polygon + polyline)', async () => {
    await key('v');
    await drag(page, line(P(0.54, 0.26), P(0.97, 0.44), 12), 350);
    await page.waitForTimeout(250);
    await page.keyboard.press('Delete');
  });
  await act('eraser: partial across highlighter', async () => {
    await key('e');
    await page.getByRole('button', { name: 'Partial erase' }).first().click({ timeout: 2_000 }).catch(() => {});
    const at = P(0.18, 0.2);
    await drag(page, line({ x: at.x, y: at.y - 30 }, { x: at.x, y: at.y + 30 }), 300);
  });
  await act('eraser: whole across line and highlighter', async () => {
    await page.getByRole('button', { name: 'Full stroke erase' }).first().click({ timeout: 2_000 }).catch(() => {});
    const top = P(0.12, 0.17);
    await drag(page, line(top, P(0.12, 0.36), 16), 350);
    await page.getByRole('button', { name: 'Partial erase' }).first().click({ timeout: 2_000 }).catch(() => {});
  });

  log(`matrix: ${states.length - 1} steps recorded; not reached: ${JSON.stringify(skipped)}`);
  await key('v');
  await page.keyboard.press('Escape');

  // --- walk back and forward -----------------------------------------------
  const check = (label, expected, actual) => {
    if (sameState(expected, actual)) return true;
    const diff = describeDiff(expected, actual);
    log(`FAIL ${label}: ${JSON.stringify(diff)}`);
    failures.push({ label, ...diff });
    return false;
  };
  for (let index = states.length - 1; index > 0; index -= 1) {
    await page.keyboard.press('ControlOrMeta+z');
    await settle();
    check(`undo "${labels[index]}"`, states[index - 1], await fullSnapshot(page));
  }
  await page.keyboard.press('ControlOrMeta+z');
  await settle();
  check('undo past the start changes nothing', states[0], await fullSnapshot(page));
  for (let index = 1; index < states.length; index += 1) {
    await page.keyboard.press(index % 2 ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+y');
    await settle();
    check(`redo "${labels[index]}"`, states[index], await fullSnapshot(page));
  }
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await settle();
  check('redo past the end changes nothing', states[states.length - 1], await fullSnapshot(page));

  // Undo two, a new action, then Redo must do nothing.
  await page.keyboard.press('ControlOrMeta+z');
  await settle();
  await page.keyboard.press('ControlOrMeta+z');
  await settle();
  await key('p');
  await drag(page, line(P(0.3, 0.8), P(0.5, 0.82)), 300);
  await settle();
  const afterNew = await fullSnapshot(page);
  await key('v');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await settle();
  check('redo after a new action changes nothing', afterNew, await fullSnapshot(page));
  await page.keyboard.press('ControlOrMeta+z');
  await settle();
  check('undo of the new stroke = the state two undos back', states[states.length - 3], await fullSnapshot(page));
  log(`matrix walk: ${failures.length} failure(s) over ${states.length - 1} steps`);
  return { steps: labels.slice(1), skipped };
}
