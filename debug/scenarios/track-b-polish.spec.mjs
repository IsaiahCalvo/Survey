import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { weightFixture } from './track-b-weight-fixture.mjs';
import { expect, test } from '@playwright/test';
async function open(page, fixture='e2e/prog-02-text-markup.pdf') {
  await page.goto(`/?testPdf=${fixture}`);
  await page.locator('[data-shape-kind="text-markup-highlight"]').first().waitFor();
}
const trigger = page => page.locator('[data-select-mode-trigger="true"]');
const handles = page => page.locator('[data-resize-handle]');
async function clickMark(page, id='9R', modifiers=[]) {
  const b=await page.locator(`[data-shape-id="${id}"]`).first().boundingBox();
  expect(b).not.toBeNull();
  for(const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
  for(const key of modifiers.reverse()) await page.keyboard.up(key);
}
test('B1 B2 B3: mode names, checked row and shortcut dismissal', async({page})=>{
  await open(page); await page.keyboard.press('v');
  await expect(trigger(page)).toHaveAttribute('aria-label','Rectangle Select');
  await trigger(page).hover();
  await expect(page.locator('body > div[aria-hidden="true"]').filter({hasText:'Rectangle Select'})).toBeVisible();
  await trigger(page).click();
  const row=page.getByRole('menuitemradio',{name:/Rectangle Select/});
  await expect(row).toHaveAttribute('aria-checked','true');
  await expect(row).toContainText('✓');
  await expect(row).toHaveCSS('background-color','rgb(49, 55, 72)');
  await page.keyboard.press('p');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger(page).click();
  await expect(page.getByRole('menuitemradio',{name:/Lasso Select/})).toBeVisible();
});
test('B4 B5: removed toolbar hints clear and Survey uses the shared hint',async({page})=>{
  await open(page); await page.keyboard.press('p');
  const button=page.getByLabel('Pen',{exact:true});
  await button.hover();
  const hints=page.locator('body > div[aria-hidden="true"]');
  await expect(hints.filter({hasText:/^Pen$/})).toBeVisible();
  await page.keyboard.press('t');
  await expect(hints.filter({hasText:/^Pen$/})).toHaveCount(0);
  await page.getByRole('button',{name:'Survey',exact:true}).hover();
  const survey=hints.filter({hasText:/^Survey$/});
  await expect(survey).toHaveCSS('border-radius','6px');
  await expect(survey).toHaveCSS('font-size','11.5px');
  await page.getByRole('button',{name:'Survey',exact:true}).click();
  await expect(survey).toHaveCount(0);
});
for(const [mode,key] of [['Rectangle','v'],['Lasso','Alt+v'],['Text','Shift+v']]) {
  test(`B6 B7 ${mode}: Escape, backdrop and mark modifiers`,async({page})=>{
    await open(page); await page.keyboard.press(key);
    await clickMark(page); await expect(handles(page)).not.toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(handles(page)).toHaveCount(0);
    await clickMark(page); await expect(handles(page)).not.toHaveCount(0);
    const b=await page.locator('.survey-pdfjs-page-div').first().boundingBox();
    await page.mouse.click(b.x-15,b.y+100); await expect(handles(page)).toHaveCount(0);
    await clickMark(page); await clickMark(page,'11R',['Shift']);
    await clickMark(page,'9R',['Alt']);
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-shape-id="11R"]')).toHaveCount(0);
    await expect(page.locator('[data-shape-id="9R"]')).toHaveCount(1);
  });
}
test('B8 B9: tool switch cancels marquee; lasso Space stays two-state',async({page})=>{
  await open(page); await page.keyboard.press('v');
  const b=await page.locator('.survey-pdfjs-page-div').first().boundingBox();
  await page.mouse.move(b.x+30,b.y+30); await page.mouse.down();
  await page.mouse.move(b.x+150,b.y+90,{steps:6});
  await expect(page.locator('[data-marquee-selection-preview]')).toHaveCount(1);
  await page.keyboard.press('p');
  await expect(page.locator('[data-marquee-selection-preview]')).toHaveCount(0);
  await page.mouse.up(); await page.keyboard.press('Alt+v');
  await page.mouse.move(b.x+30,b.y+30); await page.mouse.down();
  await page.mouse.move(b.x+150,b.y+90,{steps:6});
  const trail=page.locator('[data-lasso-selection-trail]');
  await expect(trail).toHaveAttribute('data-lasso-mode','window');
  await page.keyboard.press('Space'); await expect(trail).toHaveAttribute('data-lasso-mode','crossing');
  await page.keyboard.press('Space'); await expect(trail).toHaveAttribute('data-lasso-mode','window');
  await page.keyboard.press('p'); await expect(trail).toHaveCount(0); await page.mouse.up();
});
test('B10: scrollbar corner gap follows visible axes after window resize',async({page})=>{
  await open(page);
  await page.getByLabel('Edit zoom percentage').click();
  await page.getByRole('textbox',{name:'Zoom percentage'}).fill('150');
  await page.getByRole('textbox',{name:'Zoom percentage'}).press('Enter');
  await page.setViewportSize({width:1400,height:500});
  const vertical=page.getByLabel('Viewport vertical scroll bar');
  const horizontal=page.getByLabel('Viewport horizontal scroll bar');
  await expect(vertical).toHaveCount(1); await expect(horizontal).toHaveCount(0);
  await expect(vertical).toHaveCSS('bottom','0px');
  await page.setViewportSize({width:950,height:500});
  await expect(horizontal).toHaveCount(1); await expect(vertical).toHaveCSS('bottom','12px');
  await expect(horizontal).toHaveCSS('right','12px');
  await page.setViewportSize({width:1400,height:500});
  await expect(horizontal).toHaveCount(0); await expect(vertical).toHaveCSS('bottom','0px');
});
test('B12: duplicate text-mark paste explains the rejection',async({page})=>{
  await open(page); await page.keyboard.press('v'); await clickMark(page);
  await page.keyboard.press('ControlOrMeta+c'); await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByText('That mark is already here',{exact:true})).toBeVisible();
  await expect(page.locator('[data-shape-id="9R"]')).toHaveCount(1);
});

test('B1 mobile: rectangle name and checked mode match desktop',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage(); await open(page);
 await page.getByRole('button',{name:'Selection mode',exact:true}).click();
 const row=page.getByRole('menuitemradio',{name:'Rectangle Select',exact:true});
 await expect(row).toBeVisible(); await row.click();
 await expect(page.getByRole('button',{name:'Rectangle Select',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Selection mode',exact:true}).click();
 await expect(row).toHaveAttribute('aria-checked','true');
 await context.close();
});
test('B11: authored text-mark weights paint and survive the export button',async({page})=>{
 const bytes=await weightFixture();
 await page.route('**/debug-fixtures/track-b-weight.pdf',route=>route.fulfill({contentType:'application/pdf',body:Buffer.from(bytes)}));
 await page.goto('/?testPdf=track-b-weight.pdf');
 for(const [type,width] of [['underline',3],['strikeout',5],['squiggly',0.5]]) {
   await expect(page.locator(`[data-shape-kind="text-markup-${type}"]`)).toHaveAttribute('stroke-width',String(width));
 }
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export annotated PDF',exact:true}).click();
 const pdf=await PDFDocument.load(await readFile(await (await download).path()));
 const annotations=pdf.getPage(0).node.Annots();
 const weights=Array.from({length:annotations.size()},(_,i)=>annotations.lookup(i))
   .filter(d=>['/Underline','/StrikeOut','/Squiggly'].includes(d.get(PDFName.of('Subtype'))?.toString()))
   .map(d=>d.lookup(PDFName.of('BS'))?.lookup(PDFName.of('W'))?.asNumber()
      ?? d.lookup(PDFName.of('Border'))?.lookup(2)?.asNumber());
 expect(weights).toEqual([3,5,0.5]);
});
for(const [mode,key] of [['Rectangle','v'],['Lasso','Alt+v'],['Text','Shift+v']]) {
 test(`B7 ${mode}: Shift adds shapes, Alt removes without moving them`,async({page})=>{
  await open(page); await page.keyboard.press('p');
  const ids=[];
  for(const y of [650,720]) {
   const before=await page.locator('[data-annotation-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.annotationId));
   await page.mouse.move(500,y);await page.mouse.down();await page.mouse.move(650,y,{steps:12});await page.mouse.up();
   await expect.poll(()=>page.locator('[data-annotation-id]').count()).toBeGreaterThan(before.length);
   ids.push(await page.locator('[data-annotation-id]').evaluateAll((nodes,old)=>nodes.map(n=>n.dataset.annotationId).find(id=>!old.includes(id)),before));
  }
  const clickShape = async(id,modifier=null) => {
    const box=await page.locator(`[data-annotation-id="${id}"]`).boundingBox();
    if(modifier) await page.keyboard.down(modifier);
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    if(modifier) await page.keyboard.up(modifier);
  };
  await page.keyboard.press(key);
  await clickShape(ids[0]);await clickShape(ids[1],'Shift');
  await clickShape(ids[1],'Shift'); // adding an already-selected shape must not subtract it
  await clickShape(ids[0],'Alt');
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-annotation-id="${ids[0]}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-annotation-id="${ids[1]}"]`)).toHaveCount(0);
 });
}

for (const [mode,key,preview] of [['Rectangle','v','[data-marquee-selection-preview]'],['Lasso','Alt+v','[data-lasso-selection-trail]'],['Text','Shift+v',null]]) {
 test(`R1 Escape ${mode}: cancel drag preserves selection; second Escape clears`,async({page})=>{
  await open(page); await page.keyboard.press(key); await clickMark(page);
  const count=await handles(page).count(); expect(count).toBeGreaterThan(0);
  const b=await page.locator('.survey-pdfjs-page-div').first().boundingBox();
  await page.mouse.move(b.x+30,b.y+30); await page.mouse.down();
  await page.mouse.move(b.x+150,b.y+90,{steps:6});
  if(preview) await expect(page.locator(preview)).toHaveCount(1);
  await page.keyboard.press('Escape');
  if(preview) await expect(page.locator(preview)).toHaveCount(0);
  await expect(handles(page)).toHaveCount(count);
  await page.mouse.up(); await expect(handles(page)).toHaveCount(count);
  await page.keyboard.press('Escape'); await expect(handles(page)).toHaveCount(0);
 });
}
for (const density of [1,2]) {
 test(`R1 chrome ${density}x: checked state differs from hover and shortcut`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:1400,height:900},deviceScaleFactor:density});
  const page=await context.newPage(); await open(page); await page.keyboard.press('v'); await trigger(page).click();
  const selected=page.getByRole('menuitemradio',{name:/Rectangle Select/});
  const other=page.getByRole('menuitemradio',{name:/Lasso Select/}); await other.hover();
  await expect(selected).toHaveCSS('background-color','rgb(42, 34, 24)');
  await expect(selected).toHaveCSS('color','rgb(216, 168, 78)');
  await expect(selected).toHaveCSS('font-weight','600');
  await expect(other).toHaveCSS('background-color','rgb(31, 36, 48)');
  await expect(selected.locator('[data-select-mode-check]')).toHaveText('✓');
  await expect(selected.locator('span').filter({hasText:/^V$/})).toHaveCount(1);
  await page.screenshot({path:`debug/audit-scratch/round-1-codex/menu-${density}x.png`});
  await selected.hover(); await expect(selected).toHaveCSS('background-color','rgb(42, 34, 24)');
  await page.keyboard.press('p');
  await page.getByRole('button',{name:'Shapes',exact:true}).hover();
  const top=page.getByRole('button',{name:'Shapes',exact:true});
  await expect(top).toHaveCSS('background-color','rgba(255, 255, 255, 0.05)');
  const style=await top.evaluate(n=>{const s=getComputedStyle(n);return [s.backgroundColor,s.borderColor,s.boxShadow]});
  const sub=page.getByRole('button',{name:'Highlighter',exact:true}); await sub.hover();
  await expect.poll(()=>sub.evaluate(n=>{const s=getComputedStyle(n);return [s.backgroundColor,s.borderColor,s.boxShadow]})).toEqual(style);
  await context.close();
 });
 test(`R1 mobile ${density}x: centred cream glyph, bright caret and eraser name`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:density});
  const page=await context.newPage(); await open(page);
  const select=page.locator('.mobile-pdf-tools__select-family .mobile-pdf-tools__button');
  await expect(select).toHaveCSS('color','rgb(232, 226, 212)');
  await expect(select.locator('span[aria-hidden]')).toHaveCSS('transform','none');
  const caret=page.locator('.mobile-pdf-tools__select-caret svg');
  await expect(caret).toHaveAttribute('width','8');
  await expect(caret.locator('path')).toHaveAttribute('stroke','#e8e2d4');
  await page.screenshot({path:`debug/audit-scratch/round-1-codex/mobile-${density}x.png`});
  await select.click(); await expect(caret.locator('path')).toHaveAttribute('stroke','#e8e2d4');
  await page.getByRole('button',{name:'Draw',exact:true}).click();
  await expect(page.getByRole('button',{name:'Partial erase',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Eraser',exact:true})).toHaveCount(0);
  await context.close();
 });
 test(`R1 resize ${density}x: document open never flashes a scrollbar`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:1400,height:900},deviceScaleFactor:density});
  const page=await context.newPage();
  await page.addInitScript(()=>{
   window.railSamples=[];
   const sample=()=>{
    for(const n of document.querySelectorAll('[aria-label="Viewport vertical scroll bar"]')) window.railSamples.push(Number(getComputedStyle(n).opacity));
    requestAnimationFrame(sample);
   }; requestAnimationFrame(sample);
  });
  await open(page); await page.waitForTimeout(1200);
  expect(await page.evaluate(()=>Math.max(0,...window.railSamples))).toBe(0);
  await page.setViewportSize({width:1400,height:500});
  await expect(page.getByLabel('Viewport vertical scroll bar')).toBeVisible();
  await expect.poll(()=>page.getByLabel('Viewport vertical scroll bar').evaluate(n=>Number(getComputedStyle(n).opacity))).toBeGreaterThan(0);
  await context.close();
 });
}

test('R1 Text Select: a new native text drag still commits after cancellation',async({page})=>{
 await open(page); await page.keyboard.press('Shift+v'); await clickMark(page);
 const line=page.locator('.pdfjsTextLayer span').filter({hasText:'This sentence is underlined in blue beneath five consecutive words.'}).first();
 const b=await line.boundingBox(); expect(b).not.toBeNull();
 const drag=async()=>{await page.mouse.move(b.x+2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-2,b.y+b.height/2,{steps:8});};
 await drag(); await page.keyboard.press('Escape'); await page.mouse.up();
 await expect(handles(page)).not.toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>String(window.getSelection()))).toBe('');
 await drag(); await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>String(window.getSelection()))).toContain('underlined');
 await expect(handles(page)).toHaveCount(0);
});
