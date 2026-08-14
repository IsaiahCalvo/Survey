export async function activate(locator, touch, device) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  if (device === 'desktop') {
    await locator.click();
    return;
  }
  const box = await locator.boundingBox();
  if (!box || box.width < 1 || box.height < 1) throw new Error('Touch target has no usable geometry');
  await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

export async function openProject(page, touch, device, projectId) {
  const row = page.locator(`[data-project-id="${projectId}"]:visible`).first();
  await activate(row, touch, device);
  const title = device === 'mobile' ? 'Tap to rename' : 'Click to rename';
  await page.getByTitle(title).waitFor({ state: 'visible', timeout: 10_000 });
}

export async function openDocumentMenu(page, touch, device, documentId) {
  const row = page.locator(`[data-document-id="${documentId}"]:visible`).first();
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  await activate(row.getByTitle('More'), touch, device);
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
}

export async function chooseFilesFromButton({ button, device, files, page, touch }) {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
  await activate(button, touch, device);
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}
