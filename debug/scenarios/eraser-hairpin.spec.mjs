import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

test('back-and-forth hairpins including collinear reversals erase the full contact area', async ({ page }) => {
  const warnings = [];
  page.on('console', msg => {
    if (/Eraser polygon .* (skipped|rejected)|EraserAuditViolation/.test(msg.text())) warnings.push(msg.text());
  });
  await page.goto('/?testPdf=spike-120-pages.pdf&eraserLifecycleE2E=1');
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await surface.waitFor();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  const box = await surface.boundingBox();
  // Keep only the rendered annotation ink in the screenshot oracle.
  await page.addStyleTag({ content: '.survey-pdfjs-page-div canvas,.pdfjsTextLayer{opacity:0!important}.survey-pdfjs-page-div{background:#fff!important}' });
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const size = page.getByRole('textbox', { name: /^(Width|Size)$/ });
  await size.fill('40'); await size.press('Tab');
  async function gesture(points, steps) {
    await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps });
    await page.mouse.up();
    await page.mouse.move(10, 10);
  }
  await gesture(Array.from({length:61}, (_,i) => [60+i*8,300+55*Math.sin(i/3.2)]),2);
  await expect(page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
  await page.locator('[data-diag-eraser-wrapper="1"]').waitFor();
  await size.fill('60'); await size.press('Tab');
  let k=0;
  for (const gap of [4,8,14,24,0]) for (const steps of (gap===0 ? [2] : [1,2,8])) {
    const x = gap===0 ? 80 : 120+k++*36;
    const points=[[x,230],[x,360],[x+gap,360],[x+gap,230]];
    const before = PNG.sync.read(await surface.screenshot());
    const stored = () => page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]').evaluateAll(nodes => nodes.map(g => window.__phase35GetAnnotationById(g.dataset.annoId)));
    const original = JSON.stringify(await stored());
    await gesture(points,steps);
    await expect.poll(async () => JSON.stringify(await stored())).not.toBe(original);
    await page.waitForTimeout(350);
    const after = PNG.sync.read(await surface.screenshot());
    const ink = (png,x,y) => {
      const i=(png.width*y+x)*4;
      return 765-png.data[i]-png.data[i+1]-png.data[i+2]>110;
    };
    let survivors=0,lost=0,added=0,removed=0;
    for(let y=210;y<380;y++)for(let px=30;px<580;px++) {
      const d=Math.min(...points.slice(1).map((b,i)=>{
        const a=points[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
        const t=l?Math.max(0,Math.min(1,((px+0.5-a[0])*dx+(y+0.5-a[1])*dy)/l)):0;
        return Math.hypot(px+0.5-a[0]-t*dx,y+0.5-a[1]-t*dy);
      }));
      const was=ink(before,px,y), now=ink(after,px,y);
      if(was&&!now)removed++;
      if(d<28.5&&now)survivors++;
      if(d>32.5&&was&&!now)lost++;
      if(d>32.5&&!was&&now)added++;
    }
    expect(removed,`gap=${gap}, steps=${steps}`).toBeGreaterThan(0);
    expect({survivors,lost,added},`gap=${gap}, steps=${steps}`).toEqual({survivors:0,lost:0,added:0});
  }
  expect(warnings).toEqual([]);
  const diagnostics = await page.evaluate(() => window.__eraserDiagnostics.entries);
  expect(diagnostics.length).toBeGreaterThanOrEqual(13);
  for (const entry of diagnostics) {
    expect(Array.isArray(entry.failedStages)).toBe(true);
    for (const failure of entry.failedStages) {
      expect(failure.recovered).toBe(true);
      expect(Object.keys(failure.failedStages).length).toBeGreaterThan(0);
    }
  }
});
