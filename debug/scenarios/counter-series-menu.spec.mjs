import { test, expect } from '@playwright/test';
test.use({ baseURL: process.env.SURVEY_UI_URL || 'http://127.0.0.1:5212', headless: true });
for (const phone of [false, true]) test(`count continue rename delete and Undo on ${phone ? 'phone' : 'desktop'}`, async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: phone ? { width:390, height:844 } : { width:1400, height:900 }, hasTouch: phone, isMobile: phone });
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  // Observe the unchanged real annotation source, not a mock writer or API.
  await page.route('**/src/PDFViewer.jsx*', async route => {
    const response=await route.fetch(); const source=await response.text();
    const needle='() => getCounterSeriesList(annotationsByPage),'; expect(source).toContain(needle);
    let observed=source.replace(needle,'() => { window.counterSnapshot = annotationsByPage; return getCounterSeriesList(annotationsByPage); },');
    for(const [needle,record] of [
      ['const handleSaveAnnotations = useCallback((pageNumber, json, saveContext = null) => {','window.counterSaveCalls = (window.counterSaveCalls || 0) + 1;'],
      ['const pushLocalAnnotationHistoryAction = useCallback((action) => {','window.counterHistoryCalls = (window.counterHistoryCalls || 0) + 1;'],
    ]) { expect(observed).toContain(needle); observed=observed.replace(needle,needle+' '+record); }
    // A local incoming-state adapter models another editor locking a pin
    // while this client has its whole-count confirmation open. It performs
    // no save/history action and leaves the real guarded writers unchanged.
    const bridge='handleDeleteCounterSeriesRef.current = handleDeleteCounterSeries;';
    expect(observed).toContain(bridge);
    observed=observed.replace(bridge,bridge+` window.counterReceiveLocks = ids => setAnnotationsByPage(current => Object.fromEntries(Object.entries(current).map(([page,value]) => [page,{...value,objects:(value.objects || []).map(pin => {
      if (pin.data?.type !== 'counter') return pin;
      const {lockedBy,...data}=pin.data;
      return {...pin,data:{...data,...(ids.includes(pin.id || pin.data.id) ? {lockedBy:'dev-test-user'} : {})}};
    })}])));`);
    await route.fulfill({response,body:observed});
  });
  await page.goto('/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1');
  await page.locator('.survey-pdfjs-page-div:visible').first().waitFor();
  await page.getByRole('button',{name:'Shapes',exact:true}).click();
  await page.getByRole('button',{name:'Counter',exact:true}).click();
  const snapshot = () => page.evaluate(() => Object.values(window.counterSnapshot || {}).flatMap(page => page.objects || []).filter(obj => obj.data?.type === 'counter'));
  const place = async () => {
    await expect(page.locator('[data-counter-overlay]:visible').first()).toBeVisible();
    // The placement tool deliberately ignores pins placed within 200ms.
    await page.waitForTimeout(210);
    const layer=page.locator('[data-svg-annotation-layer]:visible').first(); await layer.waitFor();
    const point=await layer.evaluate(async svg => {
      const {classifyPagePress}=await import('/src/utils/toolPressRouting.js');
      const box=svg.getBoundingClientRect(), view=svg.closest('.survey-pdfjs-viewer').getBoundingClientRect();
      const top=Math.max(box.top,view.top)+60, bottom=Math.min(box.bottom,view.bottom)-20;
      const pageNumber=Number(svg.closest('[data-page-number]').dataset.pageNumber);
      for(const y of [.25,.6,.85])for(const x of [.25,.45,.65,.8]){
        const p={x:box.left+box.width*x,y:top+(bottom-top)*y};
        const target=document.elementFromPoint(p.x,p.y);
        const hit=classifyPagePress({target,clientX:p.x,clientY:p.y},{pageNumber,objects:window.counterSnapshot[pageNumber]?.objects,tool:'counter'});
        if(hit.target==='empty'&&target?.closest('[data-counter-overlay]'))return p;
      }
      throw new Error('No empty visible counter placement point');
    });
    expect(await layer.evaluate((svg,p)=>svg.closest('.survey-pdfjs-page-div').contains(document.elementFromPoint(p.x,p.y)),point)).toBe(true);
    if(phone) await page.touchscreen.tap(point.x,point.y); else await page.mouse.click(point.x,point.y);
  };
  const open = () => page.getByRole('button',{name:'Counter series',exact:true}).click();
  await place(0); await expect.poll(async()=> (await snapshot()).length).toBe(1);
  await place(1); await expect.poll(async()=> (await snapshot()).length).toBe(2);
  const fill=(await snapshot())[0].fill;
  await open(); await page.getByRole('button',{name:'Rename Count 1',exact:true}).click();
  await page.getByRole('textbox',{name:'Count name',exact:true}).fill('   ');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a name.');
  await page.getByRole('textbox',{name:'Count name',exact:true}).fill('  Doors  ');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue Doors, 2 pins',exact:true})).toBeVisible();
  expect((await snapshot()).map(pin=>pin.data.seriesName)).toEqual(['Doors','Doors']);
  await page.getByRole('button',{name:'Continue Doors, 2 pins',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=> (await snapshot()).filter(pin=>pin.data.seriesName).length).toBe(0);
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect.poll(async()=> (await snapshot()).filter(pin=>pin.data.seriesName==='Doors').length).toBe(2);
  await open();
  const menu=page.locator('[data-counter-series-menu][role=dialog]');
  const bounds=await menu.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(phone?390:1400);
  await expect(menu).toHaveCSS('opacity','1');
  await page.screenshot({path:test.info().outputPath(`counts-${phone?'phone':'desktop'}.png`)});
  await page.getByRole('button',{name:'New count',exact:true}).click();
  await place(2); await expect.poll(async()=> (await snapshot()).length).toBe(3);
  await open(); await page.getByRole('button',{name:'Continue Doors, 2 pins',exact:true}).click();
  await place(3); await expect.poll(async()=> (await snapshot()).length).toBe(4);
  const doors=(await snapshot()).filter(pin=>pin.data.seriesName==='Doors');
  expect(doors.map(pin=>pin.data.displayNumber).sort()).toEqual([1,2,3]); expect(doors.every(pin=>pin.fill===fill)).toBe(true);
  await open(); await page.getByRole('button',{name:'Delete Doors',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delete Doors?',exact:true})).toBeVisible();
  await expect(page.getByText('This will delete all 3 pins in this count across the document. This can be undone.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); expect((await snapshot()).length).toBe(4);
  await open(); await page.getByRole('button',{name:'Delete Doors',exact:true}).click();
  await page.getByRole('button',{name:'Delete count',exact:true}).click();
  await expect.poll(async()=> (await snapshot()).length).toBe(1);
  expect((await snapshot())[0].data.seriesName).not.toBe('Doors');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=> (await snapshot()).length).toBe(4);
  expect((await snapshot()).filter(pin=>pin.data.seriesName==='Doors').length).toBe(3);
  const doorsIds=(await snapshot()).filter(pin=>pin.data.seriesName==='Doors').map(pin=>pin.id || pin.data.id);
  await open(); await page.getByRole('button',{name:'Delete Doors',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delete Doors?',exact:true})).toBeVisible();
  await page.evaluate(ids=>window.counterReceiveLocks([ids[0]]),doorsIds);
  await expect.poll(async()=> (await snapshot()).filter(pin=>pin.data.lockedBy).length).toBe(1);
  const writesBefore=await page.evaluate(()=>[window.counterSaveCalls,window.counterHistoryCalls]);
  await page.getByRole('button',{name:'Delete count',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delete Doors?',exact:true})).toHaveCount(0);
  expect((await snapshot()).length).toBe(4);
  expect(await page.evaluate(()=>[window.counterSaveCalls,window.counterHistoryCalls])).toEqual(writesBefore);
  for(const ids of [[doorsIds[0]],doorsIds]){
    await page.evaluate(ids=>window.counterReceiveLocks(ids),ids);
    await expect.poll(async()=> (await snapshot()).filter(pin=>pin.data.lockedBy).length).toBe(ids.length);
    await open(); await page.getByRole('button',{name:'Rename Doors',exact:true}).click();
    await page.getByRole('textbox',{name:'Count name',exact:true}).fill('Must not save');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveText('Unlock all pins in this count before renaming it.');
    expect((await snapshot()).filter(pin=>pin.data.seriesName==='Doors').length).toBe(3);
    expect(await page.evaluate(()=>[window.counterSaveCalls,window.counterHistoryCalls])).toEqual(writesBefore);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Continue Doors, 3 pins',exact:true}).click();
  }
  expect(errors).toEqual([]); await context.close();
});
