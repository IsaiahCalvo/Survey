import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';

// Local storage adapter for the production file descriptor, page hook, left
// Pages rail and AppShell save callback. No auth or external service request.
async function cloudFixture(page, {secondTab=false}={}) {
  await page.route('**/*',route=>/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url())?route.continue():route.abort());
  await page.route('**/src/DevTestRoute.jsx*',async route=>{
    const response=await route.fetch();let body=await response.text();
    expect(body).toContain('window.__devTestPdf = file;');
    // Only storage is synthetic; this fixture has no collaboration session.
    expect(body).toMatch(/cloudSync:\s*true/);body=body.replace(/cloudSync:\s*true,/, 'cloudSync: false,');
    body=body.replace('window.__devTestPdf = file;',`${secondTab?"window.__pageCutSecondPdf=new File([await (await fetch('/debug-fixtures/clickable-link-test.pdf')).blob()],'Synthetic B.pdf',{type:'application/pdf'});":""}window.__pageCutStorage={stored:blob,saves:[],block:false};window.__devTestPdf={id:'synthetic-cloud-document',name:file.name,size:file.size,filePath:'synthetic/cloud.pdf',supabaseFilePath:'synthetic/cloud.pdf',user_id:'dev-test-user',contentSha256:'synthetic-original',_surveyPdfId:'synthetic-cloud-pdf'};${secondTab?'window.__devTestPdfs=[window.__devTestPdf,window.__pageCutSecondPdf];':''}`);
    await route.fulfill({response,body});
  });
  await page.route('**/src/hooks/useDatabase.js*',async route=>{
    const response=await route.fetch();let body=await response.text();expect(body).toContain('export const useStorage = () => {');
    body=body.replace('export const useStorage = () => {','const realUseStorage = () => {');
    body+=`\nexport const useStorage=()=>{const storage=realUseStorage();return {...storage,downloadDocument:async path=>path==='synthetic/cloud.pdf'?window.__pageCutStorage.stored:null,replaceDocument:async(file,path,options)=>{const model=window.__pageCutStorage;const bytes=await file.arrayBuffer();if(model.block){model.pending=options.documentId;await new Promise(resolve=>model.release=resolve);}model.stored=new Blob([bytes],{type:'application/pdf'});model.saves.push({id:options.documentId,path,bytes:Array.from(new Uint8Array(bytes))});return{filePath:path,contentSha256:'synthetic-'+model.saves.length};}}};\n`;
    await route.fulfill({response,body});
  });
  await page.route('**/src/PDFViewer.jsx*',async route=>{
    const response=await route.fetch();let body=await response.text();
    expect(body).toContain('readPageMutationPdfBytes');
    expect(body).toMatch(/readPdfBytes:\s*readPageMutationPdfBytes/);
    await route.fulfill({response,body});
  });
  await page.goto('/?testPdf=order-pages.pdf');
  if(secondTab)await page.getByRole('button',{name:'order-pages.pdf',exact:true}).click();
  await expect(page.locator('.survey-pdfjs-page-div').first()).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Pages',exact:true}).click();
  await expect(page.locator('[data-page-card]')).toHaveCount(8);
}
const menu=async(page,index)=>{await page.locator('[data-page-card]').nth(index).click({button:'right'});};
const savedWidths=async page=>{
  const bytes=await page.evaluate(()=>window.__pageCutStorage.saves.at(-1)?.bytes);const pdf=await PDFDocument.load(new Uint8Array(bytes));return pdf.getPages().map(p=>p.getWidth());
};
test('cloud descriptor Pages Cut/Paste saves and Undo/Redo restore actual page bytes',async({page})=>{
  const errors=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await cloudFixture(page);
  await page.keyboard.press('r');const box=await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  await page.mouse.move(box.x+80,box.y+180);await page.mouse.down();await page.mouse.move(box.x+160,box.y+220,{steps:8});await page.mouse.up();await page.keyboard.press('v');
  await expect(page.locator('[data-svg-annotation-layer="1"] [data-shape-hit-target="rect"]')).toHaveCount(1);
  await menu(page,0);await page.getByRole('menuitem',{name:'Cut',exact:true}).click();
  await menu(page,2);await page.getByRole('menuitem',{name:'Paste below',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__pageCutStorage.saves.length)).toBe(1);
  expect(await savedWidths(page)).toEqual([620,640,600,660,680,700,720,740]);
  await expect(page.locator('[data-svg-annotation-layer="3"] [data-shape-hit-target="rect"]')).toHaveCount(1);
  await expect(page.getByText(/Couldn't save the page/)).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__pageCutStorage.saves.length)).toBe(2);
  expect(await savedWidths(page)).toEqual([600,620,640,660,680,700,720,740]);
  await expect(page.locator('[data-svg-annotation-layer="1"] [data-shape-hit-target="rect"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__pageCutStorage.saves.length)).toBe(3);
  expect(await savedWidths(page)).toEqual([620,640,600,660,680,700,720,740]);
  await expect(page.locator('[data-svg-annotation-layer="3"] [data-shape-hit-target="rect"]')).toHaveCount(1);
  expect(errors.filter(message=>/arrayBuffer|Error saving page change/.test(message))).toEqual([]);
});


test('queued cloud Cut/Paste persists document A after switching to B without changing B',async({page})=>{
  await cloudFixture(page,{secondTab:true});await page.evaluate(()=>window.__pageCutStorage.block=true);
  await menu(page,0);await page.getByRole('menuitem',{name:'Cut',exact:true}).click();await menu(page,2);await page.getByRole('menuitem',{name:'Paste below',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__pageCutStorage.pending)).toBe('synthetic-cloud-document');
  await page.getByRole('button',{name:'Synthetic B.pdf',exact:true}).click();
  await expect(page.locator('.survey-pdfjs-page-div:visible')).toHaveCount(1);
  const before=await page.locator('.survey-pdfjs-page-div:visible').boundingBox();
  await page.evaluate(()=>window.__pageCutStorage.release());await expect.poll(()=>page.evaluate(()=>window.__pageCutStorage.saves.length)).toBe(1);
  expect(await savedWidths(page)).toEqual([620,640,600,660,680,700,720,740]);
  expect(await page.evaluate(()=>window.__pageCutStorage.saves[0].id)).toBe('synthetic-cloud-document');
  await expect(page.locator('.survey-pdfjs-page-div:visible')).toHaveCount(1);
  const after=await page.locator('.survey-pdfjs-page-div:visible').boundingBox();expect(after.width).toBeCloseTo(before.width,1);
  await page.getByRole('button',{name:'order-pages.pdf',exact:true}).click();
  await expect(page.locator('[data-page-card]')).toHaveCount(8);await expect(page.getByText(/Couldn't save the page/)).toHaveCount(0);
});
