import { test, expect } from '@playwright/test';

const marks = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find(key => key.startsWith('annotationsByPage_order-pages.pdf'));
  return key ? JSON.parse(localStorage.getItem(key))?.[1]?.objects || [] : [];
});
const idOf = mark => mark.data?.id || mark.id;
for (const axes of [['horizontal'], ['vertical'], ['horizontal', 'vertical']]) test(`mirrored ${axes.join('+')} Text, counter and paste use the original page frame`, async ({ page }) => {
  await page.route('**/*', route => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?testPdf=order-pages.pdf');
  await page.getByRole('button', { name:'Pages', exact:true }).click();
  for (const axis of axes) {
    await page.locator('[data-page-card]').first().click({ button:'right' });
    await page.getByRole('menuitem', { name:`Mirror ${axis === 'horizontal' ? 'horizontally' : 'vertically'}`, exact:true }).click();
  }
  await page.getByRole('button', { name:'Pages', exact:true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const size = await layer.evaluate(element => ({ width:element.viewBox.baseVal.width, height:element.viewBox.baseVal.height }));
  const convert = (box, x, y) => ({
    x:(axes.includes('horizontal') ? 1 - x / box.width : x / box.width) * size.width,
    y:(axes.includes('vertical') ? 1 - y / box.height : y / box.height) * size.height,
  });
  await page.keyboard.press('t');
  const box = await layer.boundingBox();
  await page.mouse.move(box.x+180,box.y+230);await page.mouse.down();await page.mouse.move(box.x+340,box.y+310,{steps:10});
  const preview = await page.locator('[data-text-preview]').first().boundingBox();
  expect(Math.abs(preview.x-box.x-180)).toBeLessThan(2); expect(Math.abs(preview.y-box.y-230)).toBeLessThan(2);
  expect(Math.abs(preview.width-160)).toBeLessThan(2);expect(Math.abs(preview.height-80)).toBeLessThan(2);
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible();await page.keyboard.insertText('ABCDE');
  const outer = await page.locator('[data-text-edit-overlay] [data-keyboard-reveal-target]').first().boundingBox();
  const editFrame=await layer.boundingBox();const start=convert(box,180,230),end=convert(box,340,310);
  const expectedX=editFrame.x+(axes.includes('horizontal')?size.width-Math.min(start.x,end.x):Math.min(start.x,end.x))*editFrame.width/size.width-(axes.includes('horizontal')?outer.width:0);
  const expectedY=editFrame.y+(axes.includes('vertical')?size.height-Math.min(start.y,end.y):Math.min(start.y,end.y))*editFrame.height/size.height-(axes.includes('vertical')?outer.height:0);
  expect(Math.abs(outer.x-expectedX)).toBeLessThan(2);expect(Math.abs(outer.y-expectedY)).toBeLessThan(2);
  await page.getByRole('button', { name:'Keep text', exact:true }).click();
  await expect.poll(async () => (await marks(page)).filter(mark => mark.text==='ABCDE').length).toBe(1);
  let text = (await marks(page)).find(mark => mark.text==='ABCDE');
  const a=convert(box,180,230),z=convert(box,340,310);
  expect(Math.abs(text.left-Math.min(a.x,z.x))).toBeLessThan(1);expect(Math.abs(text.top-Math.min(a.y,z.y))).toBeLessThan(1);
  await page.waitForTimeout(350);await page.evaluate(id => window.__fix19SelectAnnotation(id),idOf(text));await expect(page.locator('[data-selection-context-index]')).toHaveCount(1);await page.waitForTimeout(650);
  const glyphs=page.locator(`[data-annotation-id="${idOf(text)}"] foreignObject`).first();
  const glyphBox=await glyphs.boundingBox();await page.mouse.dblclick(glyphBox.x+glyphBox.width/2,glyphBox.y+glyphBox.height/2);await expect(editor).toBeVisible();
  const caret = await editor.evaluate(element => {
    const node=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode();const range=document.createRange();range.setStart(node,2);range.collapse(true);const rect=range.getBoundingClientRect();return {x:rect.x,y:rect.y+rect.height/2};
  });
  await page.mouse.click(caret.x+(axes.includes('horizontal')?-.2:.2),caret.y);await page.keyboard.insertText('X');
  await expect(editor).toHaveText('ABXCDE');await page.getByRole('button', { name:'Keep text', exact:true }).click();
  await expect.poll(async () => (await marks(page)).some(mark => mark.text==='ABXCDE')).toBe(true);
  text=(await marks(page)).find(mark => mark.text==='ABXCDE');
  expect(Math.abs(text.left-Math.min(a.x,z.x))).toBeLessThan(1);

  await page.waitForTimeout(350);await page.evaluate(()=>window.__fix19SurveyRegionHarness.setContext({}));
  await page.keyboard.press('c');await expect(page.getByRole('button',{name:'Counter',exact:true})).toHaveClass(/btn-active/);const nextBox=await layer.boundingBox();await page.mouse.move(nextBox.x+180,nextBox.y+450);await page.mouse.down();await page.mouse.move(nextBox.x+260,nextBox.y+480,{steps:10});await page.mouse.up();
  await expect.poll(async () => (await marks(page)).filter(mark => mark.data?.type==='counter').length).toBe(1);
  const counter=(await marks(page)).find(mark => mark.data?.type==='counter');const expected=convert(nextBox,260,480);
  expect(Math.abs(counter.left+counter.radius-expected.x)).toBeLessThan(1);expect(Math.abs(counter.top+counter.radius-expected.y)).toBeLessThan(1);
  await page.evaluate(id => window.__fix19SelectAnnotation(id),idOf(counter));
  const label=page.locator(`[data-annotation-id="${idOf(counter)}"] text`).first();
  const center=await label.evaluate(element => { const point=new DOMPoint(Number(element.getAttribute('x')),Number(element.getAttribute('y'))).matrixTransform(element.getScreenCTM());return {x:point.x,y:point.y}; });
  expect(Math.abs(center.x-nextBox.x-260)).toBeLessThan(2);expect(Math.abs(center.y-nextBox.y-480)).toBeLessThan(2);
  const handle=page.locator('[data-handle-hit-pad="counter-rotate"]');await expect(handle).toBeVisible();const handleBox=await handle.boundingBox();
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(center.x+45,center.y,{steps:10});await page.mouse.up();
  await page.mouse.click(nextBox.x+60,nextBox.y+430);
  await expect.poll(async () => {const mark=(await marks(page)).find(mark => idOf(mark)===idOf(counter));return ((mark.data.pointerAngle%360)+360)%360;}).toBeCloseTo(axes.includes('horizontal')?180:0,3);

  // Single-mark paste centers at the right-click point after reflection.
  await page.evaluate(id => window.__fix19SelectAnnotation(id),idOf(counter));
  await page.keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');
  await page.mouse.click(nextBox.x+420,nextBox.y+520,{button:'right'});
  const menu=page.locator('[data-annotation-context-menu]');await expect(menu).toBeVisible();
  await menu.getByRole('menuitem',{name:'Paste',exact:true}).click();
  await expect.poll(async () => (await marks(page)).filter(mark => mark.data?.type==='counter').length).toBe(2);
  const pasted=(await marks(page)).find(mark => mark.data?.type==='counter' && idOf(mark)!==idOf(counter));const target=convert(nextBox,420,520);
  expect(Math.abs(pasted.left+pasted.radius-target.x)).toBeLessThan(2);expect(Math.abs(pasted.top+pasted.radius-target.y)).toBeLessThan(2);
  // A copied group keeps its visible upper-left corner at the pointer.
  await page.evaluate(()=>window.__fix19SurveyRegionHarness.setContext({}));
  await page.evaluate(id=>window.__fix19SelectAnnotation(id),idOf(counter));
  const textBox=await page.locator(`[data-annotation-id="${idOf(text)}"] foreignObject`).first().boundingBox();
  await page.keyboard.down('Shift');await page.mouse.click(textBox.x+textBox.width/2,textBox.y+textBox.height/2);await page.keyboard.up('Shift');
  await expect(page.locator('[data-group-selection-bbox="true"]')).toHaveCount(1);
  const count=(await marks(page)).length;
  await page.keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');
  const currentBox=await layer.boundingBox();
  await page.mouse.click(currentBox.x+100,currentBox.y+160,{button:'right'});
  await page.locator('[data-annotation-context-menu]').getByRole('menuitem',{name:'Paste',exact:true}).click();
  await expect.poll(async ()=>(await marks(page)).length).toBe(count+2);
  const pastedGroup=await page.locator('[data-group-selection-hitbox="true"]').boundingBox();
  const latestBox=await layer.boundingBox();
  expect(Math.abs(pastedGroup.x-latestBox.x-100)).toBeLessThan(3);
  expect(Math.abs(pastedGroup.y-latestBox.y-160)).toBeLessThan(3);
  expect(errors).toEqual([]);
});
