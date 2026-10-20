import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto('/?testPdf=order-pages.pdf');
  await expect(page.locator('.survey-pdfjs-page-div').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1000);
});

const pageMenu = async (page, index) => {
  await page.locator('[data-page-card]').nth(index).click({ button: 'right' });
  return page.getByRole('menu', { name: `Page ${index + 1} actions`, exact: true });
};

test('page deletion uses app confirmation; Cut pastes and saves', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); dialog.dismiss(); });
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await pageMenu(page, 0);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete page 1?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(nativeDialogs).toEqual([]);
  await expect(page.locator('[data-page-card]')).toHaveCount(8);
  await pageMenu(page, 0);
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await pageMenu(page, 2);
  await page.getByRole('menuitem', { name: 'Paste below', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__surveyPageOps?.savedCount || 0)).toBe(1);
  expect(await page.evaluate(() => window.__surveyPageOps.failedCount)).toBe(0);
  await expect(page.locator('[data-page-card]')).toHaveCount(8);
});

test('right-click empty selected shape interior opens mark actions', async ({ page }) => {
  await page.keyboard.press('o');
  const svg = page.locator('[data-svg-annotation-layer="1"]');
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + 180, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 350, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 180, box.y + 290);
  await expect(page.locator('[data-selection-context-index]')).toHaveCount(1);
  await page.mouse.click(box.x + 270, box.y + 290, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu]')).toBeVisible();
  await expect(page.locator('[data-annotation-context-menu]')).toContainText('Arrange');
  await expect(page.locator('[data-annotation-context-menu]')).not.toContainText('Blank page');
});

test('selected PDF words reopen markup actions on right-click', async ({ page }) => {
  await page.goto('/?testPdf=text-selection-rotation-matrix.pdf');
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Shift+v');
  const text = page.locator('.survey-pdfjs-page-div[data-page-number="1"] .pdfjsTextLayer span').nth(1);
  await expect(text).toBeVisible();
  const rect = await text.boundingBox();
  await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height / 2, { steps: 14 });
  await page.mouse.up();
  await expect(page.locator('[data-text-selection-quick-menu][data-visible="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await text.click({ button: 'right' });
  await expect(page.locator('[data-text-selection-quick-menu][data-visible="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Add underline on selected text', exact: true }).click();
  await expect(page.locator('[data-shape-kind="text-markup-underline"]')).toHaveCount(1);
});

test('polyline midsegment handle adds a point, drag moves it, and Undo restores', async ({ page }) => {
  await page.keyboard.press('k');
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  // Keep every point inside the actual page on narrower tablet screens.
  const width = Math.min(box.width, 600), height = Math.min(box.height, 800);
  for (const [x, y] of [[width * .30, height * .29], [width * .59, height * .32], [width * .70, height * .44]]) await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await expect(page.locator('[data-add-vertex]')).toHaveCount(2);
  const handle = await page.locator('[data-add-vertex="0"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-add-vertex]')).toHaveCount(3);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('[data-add-vertex]')).toHaveCount(2);
});

test('shortcut field captures and runs a new key and rejects a conflict', async ({ page }) => {
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Shortcut for Arrow', exact: true });
  await field.click();
  await page.keyboard.press('p');
  await expect(page.getByRole('alert')).toContainText('already used');
  await page.keyboard.press('b');
  await expect(field).toHaveValue('B');
  await page.getByRole('button', { name: 'Close keyboard shortcuts', exact: true }).click();
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Arrow', exact: true })).toHaveClass(/btn-active/);
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page.getByRole('button', { name: 'Reset shortcut for Arrow', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Shortcut for Arrow', exact: true })).toHaveValue('A');
});

test('bend handle stays on the tightest part of an off-centre line curve', async ({ page }) => {
  await page.keyboard.press('l');
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  await page.mouse.move(box.x + 180, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 260, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('v');
  const handle = page.locator('circle[data-handle="midpoint"]');
  await expect(handle).toBeVisible();
  const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 405, box.y + 340, { steps: 12 });
  await page.mouse.up();
  const error = await page.evaluate(() => {
    const circle = document.querySelector('circle[data-handle="midpoint"]');
    const path = [...document.querySelectorAll('[data-svg-annotation-layer="1"] path')].find(element => /Q/.test(element.getAttribute('d') || ''));
    const numbers = path.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    const [x1,y1,cx,cy,x2,y2] = numbers;
    const ax = x2 - 2 * cx + x1, ay = y2 - 2 * cy + y1;
    const t = Math.max(0, Math.min(1, -((cx-x1)*ax+(cy-y1)*ay)/(ax*ax+ay*ay)));
    const px = (1-t)**2*x1+2*(1-t)*t*cx+t*t*x2;
    const py = (1-t)**2*y1+2*(1-t)*t*cy+t*t*y2;
    return Math.hypot(Number(circle.getAttribute('cx'))-px, Number(circle.getAttribute('cy'))-py);
  });
  expect(error).toBeLessThan(0.1);
});

const bendCenter = async handle => { const b=await handle.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2}; };
const bendGeometry = page => page.evaluate(()=>{
  const handle=document.querySelector('circle[data-handle="midpoint"]');
  const endpoints=[...handle.parentElement.querySelectorAll(':scope > circle')].slice(0,2).map(circle=>{const p=new DOMPoint(Number(circle.getAttribute('cx')),Number(circle.getAttribute('cy'))).matrixTransform(circle.getScreenCTM());return{x:p.x,y:p.y};});
  const path=[...document.querySelectorAll('[data-svg-annotation-layer="1"] path')].find(element=>/Q/.test(element.getAttribute('d')||''));
  return {endpoints,d:path?.getAttribute('d'),heads:document.querySelectorAll('[data-svg-annotation-layer="1"] polygon').length};
});
for (const [tool,key] of [['line','l'],['arrow','a']]) test(`off-centre ${tool} peak follows a second drag, keeps endpoints and supports Undo`,async({page})=>{
  await page.keyboard.press(key);
  const box=await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  await page.mouse.move(box.x+180,box.y+230);await page.mouse.down();await page.mouse.move(box.x+420,box.y+260,{steps:8});await page.mouse.up();
  await page.keyboard.press('v');
  const handle=page.locator('circle[data-handle="midpoint"]');await expect(handle).toBeVisible();
  const straight=await bendCenter(handle);
  await page.mouse.move(straight.x,straight.y);await page.mouse.down();await page.mouse.move(box.x+390,box.y+335,{steps:12});await page.mouse.up();
  const before=await bendGeometry(page),start=await bendCenter(handle);
  if(tool==='arrow')expect(before.heads).toBeGreaterThan(0);
  const grab={x:2,y:-1};
  await page.mouse.move(start.x+grab.x,start.y+grab.y);await page.mouse.down();
  for(const delta of [{x:-10,y:5},{x:-25,y:15},{x:-40,y:20},{x:20,y:-10},{x:50,y:-15}]) {
    const target={x:start.x+delta.x,y:start.y+delta.y};await page.mouse.move(target.x+grab.x,target.y+grab.y,{steps:4});
    await expect.poll(async()=>{const current=await bendCenter(handle);return Math.hypot(current.x-target.x,current.y-target.y);}).toBeLessThan(1.2);
  }
  const chord={x:(before.endpoints[0].x+before.endpoints[1].x)/2,y:(before.endpoints[0].y+before.endpoints[1].y)/2};
  await page.mouse.move(chord.x+grab.x,chord.y+grab.y,{steps:8});
  await expect.poll(async()=>{const current=await bendCenter(handle);return Math.hypot(current.x-chord.x,current.y-chord.y);}).toBeLessThan(1.2);
  const finalTarget={x:box.x+405,y:box.y+300};
  await page.mouse.move(finalTarget.x+grab.x,finalTarget.y+grab.y,{steps:12});
  await expect.poll(async()=>{const current=await bendCenter(handle);return Math.hypot(current.x-finalTarget.x,current.y-finalTarget.y);}).toBeLessThan(1.2);
  await page.mouse.up();
  const final=await bendCenter(handle),after=await bendGeometry(page);
  expect(Math.hypot(final.x-finalTarget.x,final.y-finalTarget.y)).toBeLessThan(1.2);
  before.endpoints.forEach((point,index)=>expect(Math.hypot(after.endpoints[index].x-point.x,after.endpoints[index].y-point.y)).toBeLessThan(0.5));
  expect(after.heads).toBe(before.heads);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=>(await bendGeometry(page)).d).toBe(before.d);
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect.poll(async()=>(await bendGeometry(page)).d).toBe(after.d);
});

const drawSelectedPolygon = async (page) => {
  await page.keyboard.press('g');
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  const width = Math.min(box.width, 600), height = Math.min(box.height, 800);
  for (const [x, y] of [[.30, .25], [.70, .25], [.70, .50], [.30, .50]]) await page.mouse.click(box.x + width * x, box.y + height * y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await page.mouse.click(box.x + width * .5, box.y + height * .375);
  await expect(page.locator('[data-add-vertex]')).toHaveCount(4);
};
const screenCenter = async (locator) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }; };
const vertexDot = (page, i) => page.locator(`circle[data-resize-handle="vertex-${i}"]:not([data-handle-hit-pad])`);

test('polygon add-point grabber stays put under the pointer and the new corner follows the drag', async ({ page }) => {
  await drawSelectedPolygon(page);
  const plus = await screenCenter(page.locator('[data-add-vertex="0"] circle').nth(1));
  // Press a little off the dot, as a finger or a quick click does.
  await page.mouse.move(plus.x + 4, plus.y + 3);
  await page.mouse.down();
  // The new corner shows at the press, and the side grabbers step aside.
  await expect(vertexDot(page, 1)).toHaveCount(1);
  await expect(page.locator('[data-add-vertex]')).toHaveCount(0);
  const atPress = await screenCenter(vertexDot(page, 1));
  expect(Math.abs(atPress.x - plus.x)).toBeLessThan(1);
  expect(Math.abs(atPress.y - plus.y)).toBeLessThan(1);
  await page.mouse.move(plus.x + 4 + 30, plus.y + 3 - 50, { steps: 8 });
  const dragged = await screenCenter(vertexDot(page, 1));
  expect(Math.abs(dragged.x - (plus.x + 30))).toBeLessThan(1.5);
  expect(Math.abs(dragged.y - (plus.y - 50))).toBeLessThan(1.5);
  await page.mouse.up();
  await expect(page.locator('[data-add-vertex]')).toHaveCount(5);
});

test('a corner grabbed off-centre moves by the pointer travel, without a jump', async ({ page }) => {
  await drawSelectedPolygon(page);
  const start = await screenCenter(vertexDot(page, 2));
  // Off the dot but on its grab pad.
  await page.mouse.move(start.x + 6, start.y + 4);
  await page.mouse.down();
  await page.mouse.move(start.x + 7, start.y + 5);
  // Before, the corner leapt to the pointer (7 px here) on the first move.
  const nudged = await screenCenter(vertexDot(page, 2));
  expect(Math.hypot(nudged.x - start.x, nudged.y - start.y)).toBeLessThan(2);
  await page.mouse.move(start.x + 46, start.y + 24, { steps: 6 });
  await page.mouse.up();
  const end = await screenCenter(vertexDot(page, 2));
  expect(Math.hypot(end.x - (start.x + 40), end.y - (start.y + 20))).toBeLessThan(1.5);
});

test('polygon grabbers keep one screen size and stay on their corners through a pinch zoom', async ({ page }) => {
  await drawSelectedPolygon(page);
  const at = await screenCenter(vertexDot(page, 0));
  await page.evaluate(() => {
    window.__grabberSamples = [];
    const svgPoint = (svg, x, y) => new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    const sample = () => {
      const dot = document.querySelector('circle[data-resize-handle="vertex-0"]:not([data-handle-hit-pad])');
      if (dot) {
        const r = dot.getBoundingClientRect();
        const svg = dot.ownerSVGElement;
        const p = svgPoint(svg, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
        window.__grabberSamples.push({ r: r.width / 2, off: Math.hypot(r.x + r.width / 2 - p.x, r.y + r.height / 2 - p.y) });
      }
      if (window.__grabberSamples.length < 90) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // A trackpad pinch arrives as Ctrl+wheel with no key down.
  for (const deltaY of [...Array(10).fill(-10), ...Array(16).fill(10)]) {
    await page.evaluate(([x, y, d]) => document.elementFromPoint(x, y).dispatchEvent(new WheelEvent('wheel', { deltaY: d, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [at.x, at.y, deltaY]);
    await page.waitForTimeout(16);
  }
  await expect.poll(() => page.evaluate(() => window.__grabberSamples.length), { timeout: 10000 }).toBeGreaterThanOrEqual(90);
  const samples = await page.evaluate(() => window.__grabberSamples);
  const radii = samples.map(s => s.r);
  expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.75);
  expect(Math.max(...samples.map(s => s.off))).toBeLessThan(1);
});
