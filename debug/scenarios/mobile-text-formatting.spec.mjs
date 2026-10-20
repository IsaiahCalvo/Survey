import { test, expect } from '@playwright/test';

const state = (page) => page.getByTestId('formatting-state').evaluate((node) => JSON.parse(node.textContent));

test('mobile live text formatting drives every control through app-styled menus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mobileTextFormattingHarness=1');
  await page.getByRole('toolbar', { name: 'Text formatting' }).waitFor();

  await page.getByRole('button', { name: /^Font:/ }).click();
  await expect(page.getByRole('listbox', { name: 'Font' })).toBeVisible();
  await page.getByRole('option', { name: 'Helvetica' }).click();

  await page.getByRole('button', { name: /^Font size:/ }).click();
  await page.getByRole('option', { name: '28 pt', exact: true }).click();
  for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
    const toggle = page.getByRole('button', { name });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByRole('button', { name: 'Text alignment', exact: true }).click();
  await page.getByRole('button', { name: 'Center horizontal alignment', exact: true }).click();
  await page.getByRole('button', { name: 'Center vertical alignment', exact: true }).click();
  await page.getByRole('button', { name: 'Close text formatting', exact: true }).click({ position: { x: 5, y: 5 } });

  await expect.poll(() => state(page)).toMatchObject({
    fontFamily: 'Helvetica',
    fontSize: 28,
    bold: true,
    italic: true,
    underline: true,
    strike: true,
    verticalAlign: 'middle',
    textAlign: 'center',
  });

  await page.getByRole('button', { name: 'Font color' }).click();
  await expect(page.getByRole('dialog', { name: 'Font color picker' })).toBeVisible();
  await page.getByRole('tab', { name: 'Color spectrum' }).click();
  await expect(page.locator('[data-color-picker-spectrum="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Font color picker' })).toHaveCount(0);
});

test('styled Font menu preserves inside actions and consumes first outside tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mobileTextFormattingHarness=1');
  const font = page.getByRole('button', { name: /^Font:/ });
  await font.click();
  await page.locator('[data-testid="formatting-state"]').click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('listbox', { name: 'Font' })).toHaveCount(0);
  await expect(font).toHaveText(/Arial/);
});

test('mobile live text controls expose measured 44px hit boxes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mobileTextFormattingHarness=1');
  const controls = page.getByRole('toolbar', { name: 'Text formatting' }).locator('button, input');
  await expect(controls).toHaveCount(8);
  for (let index = 0; index < await controls.count(); index += 1) {
    const geometry = await controls.nth(index).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const pseudo = getComputedStyle(element, '::after');
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom + 8);
      return {
        height: rect.height - (Number.parseFloat(pseudo.top) || 0) - (Number.parseFloat(pseudo.bottom) || 0),
        hitBelow: hit === element || element.contains(hit),
      };
    });
    // Compact adjacent buttons keep their own width; their vertical pads
    // must reach the full touch target without overlapping their neighbors.
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.hitBelow).toBe(true);
  }
});

test('styled select keyboard model focuses, navigates, selects, escapes, and restores', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mobileTextFormattingHarness=1');
  const trigger = page.getByRole('button', { name: /^Font:/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'Arial' })).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Helvetica' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
  await expect.poll(() => state(page)).toMatchObject({ fontFamily: 'Helvetica' });

  await page.keyboard.press('Space');
  await expect(page.getByRole('option', { name: 'Helvetica' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Verdana' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(trigger).toBeFocused();
  await expect.poll(() => state(page)).toMatchObject({ fontFamily: 'Verdana' });

  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('option', { name: 'Verdana' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: 'Arial' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Font' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => state(page)).toMatchObject({ fontFamily: 'Verdana' });

  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'Verdana' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox', { name: 'Font' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Font size:/ })).toBeFocused();
  await expect(trigger).toHaveAccessibleName('Font: Verdana');
});

test('eraser, shape, and arrow strips keep compact visuals with unclipped 44px select targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [tool, labels] of [
    ['eraser', ['Eraser size']],
    ['rect', ['Line style']],
    ['arrow', ['Line style']],
  ]) {
    await page.goto(`/?mobileTextFormattingHarness=${tool}`);
    const toolbar = page.getByRole('toolbar', { name: `${tool} settings` });
    await expect(toolbar).toBeVisible();
    expect((await toolbar.boundingBox()).height).toBe(44);
    expect(await toolbar.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');

    for (const label of labels) {
      const trigger = page.getByRole('button', { name: label });
      const geometry = await trigger.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const pseudo = getComputedStyle(element, '::after');
        const top = Number.parseFloat(pseudo.top) || 0;
        const bottom = Number.parseFloat(pseudo.bottom) || 0;
        const hitBelow = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom + 8);
        return {
          visualHeight: rect.height,
          effectiveHeight: rect.height - top - bottom,
          hitBelow: hitBelow === element || element.contains(hitBelow),
        };
      });
      expect(geometry.visualHeight).toBe(20);
      expect(geometry.effectiveHeight).toBeGreaterThanOrEqual(44);
      expect(geometry.hitBelow).toBe(true);
    }
    if (tool === 'arrow') {
      await page.getByRole('button', { name: 'More Arrow settings', exact: true }).click();
      const heads = page.getByRole('radiogroup', { name: 'Arrowhead', exact: true });
      await heads.getByRole('radio', { name: 'Square', exact: true }).click();
      await expect(heads.getByRole('radio', { name: 'Square', exact: true })).toBeChecked();
      await expect.poll(() => state(page)).toMatchObject({ arrowheadStyle: 'square' });
    }
  }
});
