import { test, expect } from '@playwright/test';
// The counts list (flag 'counter-list', owner 2026-11-09 round): a slim list,
// the count's own pin shape, Escape in a rename keeps the list open, the
// colour picker at the app's normal picker size, and "Start at" renumbering
// every pin of a count (one Undo step). Desktop and phone.
test.use({ baseURL: process.env.SURVEY_UI_URL || 'http://127.0.0.1:5212', headless: true });
for (const phone of [false, true]) test(`counts look ${phone ? 'phone' : 'desktop'}`, async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: phone ? { width:390, height:844 } : { width:1400, height:900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 2 });
  const page = await context.newPage(); await page.addInitScript(()=>{try{localStorage.setItem('survey.flag.counter-list','1')}catch{}});
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
  await place(1); await expect.poll(async()=> (await snapshot()).length).toBe(2); await open();
  await page.waitForTimeout(400);
  await page.screenshot({path:test.info().outputPath(`list-${phone?'phone':'desktop'}.png`)});
  // Escape in a rename drops the edit; the list stays open.
  await page.getByRole('button',{name:'Rename Count 1',exact:true}).click();
  await page.getByRole('textbox',{name:'Count name',exact:true}).fill('Zzz');
  await page.getByRole('textbox',{name:'Count name',exact:true}).press('Escape');
  await expect(page.getByRole('button',{name:'Continue Count 1, 2 pins',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Colours of Count 1',exact:true}).click();
  await page.waitForTimeout(600);
  await page.screenshot({path:test.info().outputPath(`colors-${phone?'phone':'desktop'}.png`)});
  const start = page.getByRole('textbox',{name:'Start number of Count 1',exact:true});
  await expect(start).toHaveValue('1');
  await start.fill('5'); await start.press('Enter');
  await page.waitForTimeout(500);
  await expect.poll(async()=> (await snapshot()).map(p=>p.data.displayNumber).sort()).toEqual([5,6]);
  await page.waitForTimeout(300);
  await page.screenshot({path:test.info().outputPath(`start5-${phone?'phone':'desktop'}.png`)});
  await start.evaluate(el => el.blur());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-counter-list]')).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForTimeout(800);
  await expect.poll(async()=> (await snapshot()).map(p=>p.data.displayNumber).sort()).toEqual([1,2]);
  expect(errors).toEqual([]);
  await context.close();
});
