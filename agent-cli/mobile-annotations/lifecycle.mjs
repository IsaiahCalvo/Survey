import assert from 'node:assert/strict';
import {
  annotationGeometry,
  calloutGeometry,
  waitForPersistedAbsence,
  waitForPersistedAnnotation,
  waitForPersistedAnnotationChange,
  waitForPersistedCallout,
  waitForPersistedCalloutChange,
} from './storage.mjs';
import { openRealMobileViewer, waitForMountedAnnotation, waitForMountedCallout } from './viewer.mjs';

const escapeAttribute = (value) => String(value).replace(/["\\]/g, '\\$&');
const annotationGroup = (page, id) => page.locator(`g[data-anno-id="${escapeAttribute(id)}"]`);
const calloutPart = (page, id) => page.locator(
  `[data-callout-id="${escapeAttribute(id)}"] [data-callout-part="line2"]`,
).first();

function geometryFor(kind, object) {
  return kind === 'callout' ? calloutGeometry(object) : annotationGeometry(object);
}

function rounded(value, places = 6) {
  if (typeof value === 'number') return Number(value.toFixed(places));
  if (Array.isArray(value)) return value.map((entry) => rounded(entry, places));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rounded(entry, places)]));
  }
  return value;
}

function editProjection(toolId, object) {
  if (toolId === 'callout') {
    return {
      arrowheadStyle: object?.style?.arrowheadStyle,
      lineStyle: object?.style?.lineStyle,
      lineThickness: object?.style?.lineThickness,
      text: object?.text,
    };
  }
  return {
    arrowheadStyle: object?.data?.arrowheadStyle ?? object?.arrowheadStyle,
    fill: object?.fill,
    fontFamily: object?.fontFamily,
    fontSize: object?.fontSize,
    opacity: object?.opacity,
    radius: object?.radius,
    counterSeriesId: object?.data?.seriesId,
    counterValue: object?.data?.displayNumber ?? object?.data?.number,
    stroke: object?.stroke,
    strokeDashArray: object?.strokeDashArray,
    strokeWidth: object?.strokeWidth,
    text: object?.text,
  };
}

async function activateSelect(page) {
  const select = page.getByRole('button', { name: 'Select', exact: true });
  assert.equal(await select.count(), 1, 'Exactly one Select tool must be available');
  await select.click();
}

async function targetLocator(page, toolId, id) {
  if (toolId === 'callout') {
    const line = calloutPart(page, id);
    if (await line.count()) return line;
    return page.locator(`[data-callout-id="${escapeAttribute(id)}"]`).first();
  }
  const group = annotationGroup(page, id);
  const selector = {
    arrow: '[data-shape-hit-target="line"]',
    counter: '[data-shape-hit-target="counter"]',
    ellipse: '[data-shape-hit-target="ellipse"]',
    highlighter: '[data-path-hit-target="true"]',
    line: '[data-shape-hit-target="line"]',
    pen: '[data-path-hit-target="true"]',
    rectangle: '[data-shape-hit-target="rect"]',
    text: '[data-shape-hit-target="textbox"]',
  }[toolId];
  const hitTarget = selector ? group.locator(selector).first() : group;
  return (await hitTarget.count()) ? hitTarget : group;
}

async function center(locator, label) {
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${label} must have touch geometry`);
  return { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
}

async function interactionPoint(locator, toolId, label) {
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${label} must have touch geometry`);
  if (toolId === 'rectangle') {
    return { x: box.x + box.width - 0.5, y: box.y + (box.height * 0.25) };
  }
  if (toolId === 'ellipse') {
    return { x: box.x + (box.width / 2), y: box.y + 3 };
  }
  return { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
}

async function mobileMenuPoint(locator, toolId, label) {
  const result = await locator.evaluate((target, id) => {
    const box = target.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return { point: null, stacks: [] };
    const candidates = [[box.left + (box.width / 2), box.top + (box.height / 2)]];

    const geometryLength = target.getTotalLength?.();
    const screenMatrix = target.getScreenCTM?.();
    if (Number.isFinite(geometryLength) && geometryLength > 0 && screenMatrix) {
      for (const fraction of [0.25, 0.75, 0.35, 0.65]) {
        const geometryPoint = target.getPointAtLength(geometryLength * fraction);
        const screenPoint = new DOMPoint(geometryPoint.x, geometryPoint.y).matrixTransform(screenMatrix);
        candidates.push([screenPoint.x, screenPoint.y]);
      }
    }

    if (id === 'ellipse') {
      const radiusX = Math.max(0, (box.width / 2) - 3);
      const radiusY = Math.max(0, (box.height / 2) - 3);
      for (const degrees of [30, 60, 120, 150, 210, 240, 300, 330]) {
        const radians = degrees * (Math.PI / 180);
        candidates.push([
          box.left + (box.width / 2) + (radiusX * Math.cos(radians)),
          box.top + (box.height / 2) + (radiusY * Math.sin(radians)),
        ]);
      }
    } else if (id === 'rectangle') {
      candidates.push(
        [box.right - 3, box.top + (box.height * 0.25)],
        [box.right - 3, box.top + (box.height * 0.75)],
        [box.left + (box.width * 0.25), box.top + 3],
        [box.left + (box.width * 0.75), box.bottom - 3],
      );
    }

    const targetAnnotationId = target.closest?.('[data-anno-id]')?.getAttribute('data-anno-id');
    const targetCalloutId = target.closest?.('[data-callout-id]')?.getAttribute('data-callout-id');
    for (const [x, y] of candidates) {
      const top = document.elementFromPoint(x, y);
      if (!top || top.closest?.('[data-resize-handle], [data-rotation-handle], [data-handle-hit-pad]')) continue;
      const belongsToTarget = top === target
        || target.contains?.(top)
        || (targetAnnotationId && top.closest?.('[data-anno-id]')?.getAttribute('data-anno-id') === targetAnnotationId)
        || (targetCalloutId && top.closest?.('[data-callout-id]')?.getAttribute('data-callout-id') === targetCalloutId);
      if (belongsToTarget) return { point: { x, y }, stacks: [] };
    }
    return {
      point: null,
      stacks: candidates.slice(0, 8).map(([x, y]) => ({
        point: { x, y },
        stack: document.elementsFromPoint(x, y).slice(0, 3).map((node) => ({
          calloutId: node.closest?.('[data-callout-id]')?.getAttribute('data-callout-id') || null,
          part: node.getAttribute?.('data-callout-part') || null,
          resizeHandle: node.closest?.('[data-resize-handle]')?.getAttribute('data-resize-handle') || null,
          tag: node.tagName,
        })),
      })),
    };
  }, toolId);
  assert(result?.point, `${label} must expose an object body point outside transform handles; stacks=${JSON.stringify(result?.stacks)}`);
  return result.point;
}

async function selectObject(page, touch, toolId, id) {
  await activateSelect(page);
  const target = await targetLocator(page, toolId, id);
  const point = await interactionPoint(target, toolId, `${toolId} ${id}`);
  await touch.tap(point);
  const properties = toolId === 'callout'
    ? page.locator('[data-mobile-tool-properties="true"][aria-label="callout formatting"]')
    : page.locator('[data-mobile-tool-properties="true"]');
  await properties.waitFor({
    state: 'visible',
    timeout: 10_000,
  }).catch(async () => {
    const stack = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).slice(0, 6).map((node) => ({
      annoId: node.closest?.('[data-anno-id]')?.getAttribute('data-anno-id') || null,
      className: typeof node.className === 'string' ? node.className : null,
      hit: node.getAttribute?.('data-shape-hit-target') || node.getAttribute?.('data-path-hit-target'),
      tag: node.tagName,
    })), point);
    throw new Error(`${toolId}: touch selection did not open properties at ${JSON.stringify(point)}; stack=${JSON.stringify(stack)}`);
  });
  return targetLocator(page, toolId, id);
}

async function chooseStyledOption(page, ariaLabel, optionLabel) {
  const escapedLabel = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trigger = page.getByRole('button', { name: new RegExp(`^${escapedLabel}(?:: .+)?$`) });
  if (await trigger.count() !== 1) {
    const toolbars = await page.locator('[data-mobile-tool-properties="true"]').evaluateAll((nodes) => (
      nodes.map((node) => ({
        ariaLabel: node.getAttribute('aria-label'),
        buttons: [...node.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || button.textContent?.trim()),
      }))
    ));
    throw new Error(`${ariaLabel} control must be available; mobile properties=${JSON.stringify(toolbars)}`);
  }
  await trigger.click();
  const option = page.getByRole('option', { name: optionLabel, exact: true });
  assert.equal(await option.count(), 1, `${ariaLabel} option ${optionLabel} must be available`);
  await option.click();
}

async function closeColorPicker(page, title) {
  const dialog = page.getByRole('dialog', { name: `${title} picker`, exact: true });
  const backdrop = page.getByRole('button', { name: `Close ${title} picker`, exact: true });
  if (await dialog.count() === 0 || !await dialog.isVisible().catch(() => false)) return;
  const box = await backdrop.boundingBox();
  assert(box, `${title} picker backdrop must have touch geometry`);
  await page.touchscreen.tap(box.x + 4, box.y + 4);
  await dialog.waitFor({ state: 'detached', timeout: 5_000 });
}

async function editShape(page, toolId) {
  const width = page.getByRole('textbox', { name: 'Stroke width', exact: true });
  if (await width.count()) {
    await width.fill('7');
    await width.press('Tab');
  }
  if (['line', 'arrow', 'rectangle', 'ellipse', 'callout'].includes(toolId)) {
    await chooseStyledOption(page, 'Border style', 'Dotted');
  }
  if (toolId === 'arrow' || toolId === 'callout') {
    await chooseStyledOption(page, 'Arrowhead style', 'Open Circle');
  }

  const swatchName = ['rectangle', 'ellipse', 'counter'].includes(toolId)
    ? (toolId === 'counter' ? 'Counter colors' : 'Fill and border colors')
    : 'Stroke color';
  const swatch = page.getByRole('button', { name: swatchName, exact: true });
  if (await swatch.count()) {
    await swatch.click();
    if (['rectangle', 'ellipse', 'counter'].includes(toolId)) {
      const fillColor = page.getByRole('button', { name: 'Set Fill color #FF8A3D', exact: true });
      assert.equal(await fillColor.count(), 1, `${toolId} persisted fill color preset must be available`);
      await fillColor.click();
      await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
      const fillPicker = page.getByRole('dialog', { name: 'Fill color picker', exact: true });
      const fillOpacity = fillPicker.locator('input[type="number"]');
      assert.equal(await fillOpacity.count(), 1, `${toolId} fill opacity control must be available`);
      await fillOpacity.fill('45');
      await closeColorPicker(page, 'Fill color');
      const strokeTab = page.getByRole('tab', { name: 'Stroke color', exact: true });
      if (await strokeTab.count()) await strokeTab.click();
    }
    const color = page.getByRole('button', { name: 'Set Stroke color #4A90E2', exact: true });
    assert.equal(await color.count(), 1, `${toolId} persisted stroke color preset must be available`);
    await color.click();
    if (toolId === 'highlighter') {
      await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Stroke color picker', exact: true });
      const opacity = picker.locator('input[type="number"]');
      assert.equal(await opacity.count(), 1, 'Highlighter opacity control must be available');
      await opacity.fill('55');
      await closeColorPicker(page, 'Stroke color');
    }
    await page.getByRole('button', { name: 'Close annotation settings', exact: true }).click();
  }
}

async function editText(page, touch, toolId) {
  const format = page.getByRole('button', { name: 'Text formatting', exact: true });
  assert.equal(await format.count(), 1, `${toolId} Text formatting control must be available`);
  await format.click();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.fill(toolId === 'callout'
    ? 'Mobile callout lifecycle edited'
    : 'Mobile text lifecycle edited');
  const font = page.getByRole('combobox', { name: 'Font', exact: true });
  if (await font.count()) await font.selectOption('Helvetica');
  const fontSize = page.getByRole('textbox', { name: 'Font size', exact: true });
  if (await fontSize.count()) await fontSize.fill('18');
  const fontColor = page.getByRole('button', { name: 'Font color', exact: true });
  if (await fontColor.count()) {
    await fontColor.click();
    const picker = page.getByRole('dialog', { name: 'Font color picker', exact: true });
    await picker.getByTitle('#0080FF', { exact: true }).click();
    await closeColorPicker(page, 'Font color');
  }
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  if (toolId === 'callout' || await editor.isVisible().catch(() => false)) {
    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const box = await layer.boundingBox();
    assert(box, `${toolId} editor commit surface must have geometry`);
    await touch.tap({ x: box.x + (box.width * 0.88), y: box.y + (box.height * 0.9) });
  }
  await editor.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function editObject(page, touch, toolId, id, before, storageKeys) {
  await selectObject(page, touch, toolId, id);
  if (toolId === 'callout') {
    await editShape(page, toolId);
    await editText(page, touch, toolId);
  } else if (toolId === 'text') {
    await editText(page, touch, toolId);
  } else await editShape(page, toolId);

  const edited = toolId === 'callout'
    ? await waitForPersistedCalloutChange(page, storageKeys.callouts, id, before)
    : await waitForPersistedAnnotationChange(page, storageKeys.annotations, id, before);
  assert.notDeepEqual(editProjection(toolId, edited), editProjection(toolId, before),
    `${toolId}: edit must change persisted model properties`);
  return edited;
}

async function moveObject(page, touch, toolId, id, edited, storageKeys) {
  let target;
  if (toolId === 'callout') {
    await activateSelect(page);
    target = await targetLocator(page, toolId, id);
  } else {
    target = await selectObject(page, touch, toolId, id);
  }
  // Callout connector segments can cross pre-existing PDF annotations. Use an
  // exposed, hit-tested point on the exact callout instead of assuming the
  // segment midpoint is the topmost interactive element.
  const start = toolId === 'callout'
    ? await mobileMenuPoint(target, toolId, `${toolId} move target`)
    : await interactionPoint(target, toolId, `${toolId} move target`);
  const end = { x: start.x + 18, y: start.y + 16 };
  await touch.drag(start, end, { steps: 9 });
  const moved = toolId === 'callout'
    ? await waitForPersistedCalloutChange(page, storageKeys.callouts, id, edited)
    : await waitForPersistedAnnotationChange(page, storageKeys.annotations, id, edited);
  assert.notDeepEqual(geometryFor(toolId === 'callout' ? 'callout' : 'annotation', moved),
    geometryFor(toolId === 'callout' ? 'callout' : 'annotation', edited),
    `${toolId}: touch move must change persisted geometry`);
  return moved;
}

async function historyButton(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  assert.equal(await button.count(), 1, `Exactly one ${name} button must be available`);
  assert.equal(await button.isEnabled(), true, `${name} must be enabled`);
  await button.click();
}

async function deleteWithMobileMenu(page, touch, toolId, id) {
  let target;
  if (toolId === 'callout') {
    await activateSelect(page);
    target = await targetLocator(page, toolId, id);
  } else {
    target = await selectObject(page, touch, toolId, id);
  }
  const deletePoint = await mobileMenuPoint(target, toolId, `${toolId} delete target`);
  await touch.longPress(deletePoint);
  const menu = page.locator('[data-annotation-context-menu]');
  await menu.waitFor({ state: 'visible', timeout: 3_000 }).catch(async () => {
    const stack = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).slice(0, 6).map((node) => ({
      annoId: node.closest?.('[data-anno-id]')?.getAttribute('data-anno-id') || null,
      className: typeof node.className === 'string' ? node.className : null,
      hit: node.getAttribute?.('data-shape-hit-target') || node.getAttribute?.('data-path-hit-target'),
      resizeHandle: node.closest?.('[data-resize-handle]')?.getAttribute('data-resize-handle') || null,
      rotationHandle: node.closest?.('[data-rotation-handle]')?.getAttribute('data-rotation-handle') || null,
      tag: node.tagName,
    })), deletePoint);
    throw new Error(`${toolId}: long-press exposed no mobile annotation action menu; stack=${JSON.stringify(stack)}`);
  });
  const deleteAction = menu.getByText('Delete', { exact: true });
  if (await deleteAction.count() !== 1) {
    throw new Error(`${toolId}: mobile annotation action menu has no Delete action`);
  }
  await touch.tap(await center(deleteAction, `${toolId} mobile Delete action`));
}

async function waitForModel(page, kind, key, id, expected) {
  await page.waitForFunction(({ expectedJson, objectId, objectKind, storageKey }) => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || (objectKind === 'callout' ? '[]' : '{}'));
      const object = objectKind === 'callout'
        ? stored.find((candidate) => candidate?.id === objectId)
        : Object.values(stored).flatMap((entry) => entry?.objects || []).find((candidate) => (
          candidate?.id === objectId || candidate?.data?.id === objectId
        ));
      return Boolean(object && JSON.stringify(object) === expectedJson);
    } catch {
      return false;
    }
  }, {
    expectedJson: JSON.stringify(expected),
    objectId: id,
    objectKind: kind,
    storageKey: key,
  }, { timeout: 10_000 });
  return kind === 'callout'
    ? waitForPersistedCallout(page, key, id)
    : waitForPersistedAnnotation(page, key, id);
}

export async function runObjectLifecycle({
  artifacts,
  created,
  page,
  storageKeys,
  toolId,
  touch,
}) {
  const kind = created.kind === 'callout' ? 'callout' : 'annotation';
  const key = kind === 'callout' ? storageKeys.callouts : storageKeys.annotations;
  const initial = kind === 'callout'
    ? await waitForPersistedCallout(page, key, created.id)
    : await waitForPersistedAnnotation(page, key, created.id);
  const compatibilityInitial = kind === 'callout'
    ? await waitForPersistedAnnotation(page, storageKeys.annotations, created.id)
    : null;
  if (toolId === 'counter') {
    assert.equal(typeof initial?.data?.seriesId, 'string', 'Counter seriesId must persist at create');
    assert(Number.isFinite(initial?.data?.displayNumber), 'Counter displayNumber must persist at create');
  }

  const edited = await artifacts.time(`${toolId}:edit`, () => (
    editObject(page, touch, toolId, created.id, initial, storageKeys)
  ));
  const compatibilityEdited = kind === 'callout'
    ? await waitForPersistedAnnotationChange(
      page,
      storageKeys.annotations,
      created.id,
      compatibilityInitial,
    )
    : null;
  const moved = await artifacts.time(`${toolId}:touch-move`, () => (
    moveObject(page, touch, toolId, created.id, edited, storageKeys)
  ));
  const compatibilityMoved = kind === 'callout'
    ? await waitForPersistedAnnotationChange(
      page,
      storageKeys.annotations,
      created.id,
      compatibilityEdited,
    )
    : null;

  await historyButton(page, 'Undo');
  await waitForModel(page, kind, key, created.id, edited);
  if (kind === 'callout') {
    await waitForModel(
      page,
      'annotation',
      storageKeys.annotations,
      created.id,
      compatibilityEdited,
    );
  }
  await historyButton(page, 'Redo');
  await waitForModel(page, kind, key, created.id, moved);
  if (kind === 'callout') {
    await waitForModel(
      page,
      'annotation',
      storageKeys.annotations,
      created.id,
      compatibilityMoved,
    );
  }

  await deleteWithMobileMenu(page, touch, toolId, created.id);
  await waitForPersistedAbsence(page, key, created.id, kind);
  if (kind === 'callout') {
    await waitForPersistedAbsence(page, storageKeys.annotations, created.id, 'annotation');
  }
  await historyButton(page, 'Undo');
  await waitForModel(page, kind, key, created.id, moved);
  if (kind === 'callout') {
    await waitForModel(
      page,
      'annotation',
      storageKeys.annotations,
      created.id,
      compatibilityMoved,
    );
  }

  await artifacts.screenshot(page, `${toolId}-lifecycle-complete`);
  await artifacts.time(`${toolId}:hard-reload`, async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await openRealMobileViewer(page, null, { navigate: false });
  });
  if (kind === 'callout') await waitForMountedCallout(page, created.id);
  else await waitForMountedAnnotation(page, created.id);
  const reloaded = await waitForModel(page, kind, key, created.id, moved);
  if (kind === 'callout') {
    const compatibilityReloaded = await waitForPersistedAnnotation(
      page,
      storageKeys.annotations,
      created.id,
    );
    const legacyCallout = compatibilityReloaded?.data?.legacyCallout;
    assert(legacyCallout, 'Callout compatibility projection must retain legacyCallout after reload');
    assert.deepEqual(rounded(calloutGeometry(legacyCallout)), rounded(calloutGeometry(moved)),
      'Callout compatibility projection geometry must survive hard reload');
    assert.equal(legacyCallout.text, moved.text,
      'Callout compatibility projection text must survive hard reload');
  }
  assert.deepEqual(geometryFor(kind, reloaded), geometryFor(kind, moved),
    `${toolId}: final moved geometry must survive hard reload`);
  assert.deepEqual(editProjection(toolId, reloaded), editProjection(toolId, moved),
    `${toolId}: final edited model must survive hard reload`);

  return { geometry: geometryFor(kind, reloaded), object: reloaded };
}
