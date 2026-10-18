import { test, expect } from '@playwright/test';
import { installCloudMocks } from './warm-tabs-cloud-mock.mjs';
test.use({ baseURL: process.env.SURVEY_UI_URL || 'http://127.0.0.1:5206', headless: true, viewport: { width: 1400, height: 900 } });
for (const cloud of [false, true]) test(`warm ${cloud ? 'cloud-shaped' : 'local'} tabs retain real PDF and annotation overlays`, async ({ page }) => {
 test.setTimeout(90000);
 const errors=[];page.on('pageerror', error=>{errors.push(error.message);console.error(error.message);});
 await page.route('**/*', route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
 if(cloud) await installCloudMocks(page);
 await page.goto(`/debug/scenarios/warm-tabs-harness.html${cloud ? '?cloud=1' : ''}`);
 const dismiss=page.getByRole('button',{name:'Continue without an account',exact:true});
 if(await dismiss.count()) await dismiss.click();
 await page.locator('.survey-pdfjs-page-div:visible').first().waitFor();
 if(cloud) await expect.poll(()=>page.evaluate(()=>window.warmOpens)).toEqual({'warm-cloud-A':1,'warm-cloud-B':1});
 await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe(null);
 await page.getByRole('button',{name:'A.pdf',exact:true}).click();
 await page.locator('[data-svg-annotation-layer]:visible').first().waitFor();
 if(cloud) await expect.poll(()=>page.evaluate(()=>window.warmReads)).toEqual({A:2,B:2});
 const readsBeforeSwitch=await page.evaluate(()=>({...window.warmReads}));
 const marksBefore=await page.locator('[data-svg-annotation-layer]:visible').first().locator('[data-annotation-index]').count();
 await page.getByRole('button',{name:'Draw',exact:true}).click();
 const layer=page.locator('[data-svg-annotation-layer]:visible').first();
 await expect(page.getByRole('button',{name:'Draw',exact:true})).toHaveClass(/btn-active/);
 await page.waitForTimeout(300);
 const box=await layer.boundingBox();
 await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();
 await page.mouse.move(box.x+box.width*.6,box.y+box.height*.55,{steps:8});await page.mouse.up();
 await expect.poll(()=>layer.locator('[data-annotation-index]').count()).toBeGreaterThan(marksBefore);
 await page.getByRole('button',{name:'Pan',exact:true}).click();
 await page.locator('.survey-pdfjs-viewer:visible').evaluate(viewer=>{viewer.scrollTop=120;});
 await page.waitForTimeout(80);
 await page.evaluate(()=>{
  window.warmNodes=[...document.querySelectorAll('.survey-pdfjs-viewer')].map(viewer=>({viewer,page:viewer.querySelector('.survey-pdfjs-page-div'),svg:viewer.querySelector('[data-svg-annotation-layer]'),canvas:viewer.querySelector('canvas'),scrollTop:viewer.scrollTop}));
 });
 for(let n=0;n<5;n++) {
  await page.getByRole('button',{name:'B.pdf',exact:true}).click();
  await page.locator('[data-tool-group][aria-label="Text"]').click();
  await expect(page.locator('[data-tool-group][aria-label="Text"]')).toHaveClass(/btn-active/);
  await page.getByRole('button',{name:'A.pdf',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pan',exact:true})).toHaveClass(/btn-active/);
  expect(await page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe(null);
 }
 expect(await page.evaluate(()=>window.warmReads)).toEqual(readsBeforeSwitch);
 expect(await page.evaluate(()=>window.warmNodes.map(node=>({svg:node.svg?.isConnected,canvas:node.canvas?.isConnected,page:node.page.isConnected,scroll:node.viewer.scrollTop===node.scrollTop})))).toEqual([{svg:true,canvas:true,page:true,scroll:true},{svg:true,canvas:true,page:true,scroll:true}]);
 await expect(page.locator('[data-svg-annotation-layer]:visible').first().locator('[data-annotation-index]')).not.toHaveCount(0);
 if(cloud) {
  expect(await page.evaluate(()=>window.warmOpens)).toEqual({'warm-cloud-A':1,'warm-cloud-B':1});
  expect(await page.evaluate(()=>window.warmDestroys)).toEqual({});
  // A hidden document's lock must not dim its active sibling.
  await page.evaluate(()=>window.warmLock['warm-cloud-B']({lockedAt:new Date().toISOString()}));
  expect(await page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe(null);
  await page.getByRole('button',{name:'B.pdf',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe('true');
  await page.evaluate(()=>window.warmLock['warm-cloud-B'](null));
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe(null);
  await page.evaluate(()=>window.warmRole['warm-cloud-B']('viewer'));
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe('true');
  await page.getByRole('button',{name:'A.pdf',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe(null);
  await page.evaluate(()=>window.warmRevoke['warm-cloud-A'](true));
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe('true');
  await page.getByRole('button',{name:'B.pdf',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe('true');
  await page.evaluate(()=>window.warmRole['warm-cloud-B']('owner'));
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe(null);
  await page.getByRole('button',{name:'A.pdf',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.body.getAttribute('data-readonly'))).toBe('true');
  await page.getByRole('button',{name:'Close B.pdf',exact:true}).click();
  const discard=page.getByRole('button',{name:'Close without saving',exact:true});
  if(await discard.count()) await discard.click();
  await expect.poll(()=>page.evaluate(()=>window.warmDestroys['warm-cloud-B'])).toBe(1);
  expect(await page.evaluate(()=>window.warmDestroys['warm-cloud-A']||0)).toBe(0);
 }
 expect(errors).toEqual([]);
});
