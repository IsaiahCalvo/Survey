import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
test.use({ baseURL: process.env.SURVEY_UI_URL || 'http://127.0.0.1:5204', headless: true, viewport: { width: 1000, height: 800 } });
test('document rails, shrinking tabs, history paging, and safe account access', async ({ page }) => {
  test.setTimeout(90000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let olderAttemptsA = 0;
let heldOlderA = null;
let heldOlderB = null;
let holdFirstOlderB = true;
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (route.request().method() === 'GET'
    && url.pathname === '/rest/v1/document_history_events'
    && ['eq.session-history', 'eq.history-error-a', 'eq.history-error-b'].includes(url.searchParams.get('document_id'))) {
    const doc = url.searchParams.get('document_id');
    const older = url.searchParams.has('occurred_at') || url.searchParams.has('or');
    if (doc === 'eq.history-error-a' && older) {
      olderAttemptsA++;
      if (olderAttemptsA > 1) { heldOlderA = route; return; }
      await route.fulfill({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ code: 'XX000', message: 'Synthetic older page failure' }) });
      return;
    }
    if (doc === 'eq.history-error-b' && older && holdFirstOlderB) {
      holdFirstOlderB = false; heldOlderB = route; return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: '42P01', message: 'relation "public.document_history_events" does not exist' }),
    });
    return;
  }
  if (url.hostname === '127.0.0.1') await route.continue();
  else await route.abort();
});
await page.goto('/?testPdf=clickable-link-test.pdf');
await page.waitForSelector('[data-app-tab]');
await page.evaluate(async () => {
  const { React, createRoot } = await import('/debug/scenarios/document-session-ui-harness.js');
  const host = document.createElement('div'); host.id = 'session-check';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '20000', background: 'var(--surface-0)' });
  document.body.append(host);
  window.checkReact = React; window.checkRoot = createRoot(host);
  window.checkRender = (component, props) => window.checkRoot.render(React.createElement(component, props));
  window.checkTabs = (await import('/src/TabBar.jsx')).default;
  window.tabs = Array.from({length: 6}, (_, i) => ({ id: `test-${i}`, name: i ? `Document ${i} with a long name.pdf` : 'Home', isHome: i === 0 }));
  window.checkRender(window.checkTabs, { tabs: window.tabs, activeTabId: 'test-1', onTabClick() {}, onTabClose() {}, onTabReorder() {} });
});
await page.waitForTimeout(200);
let sizes = await page.locator('#session-check [data-app-tab]').evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
assert.ok(sizes[1] < 220 && sizes[1] >= 96, JSON.stringify(sizes));
assert.equal(sizes[0], 40);
await page.setViewportSize({ width: 500, height: 800 });
await page.waitForTimeout(200);
assert.ok(await page.locator('#session-check [data-tab-strip-overflow]').isVisible());
sizes = await page.locator('#session-check [data-pdf-tab-id]').evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
assert.ok(sizes.every(n => n >= 96));
await page.evaluate(() => { const el = document.querySelector('#session-check [data-tab-strip-scroller]'); el.scrollLeft = 100; });
assert.ok(await page.locator('#session-check [data-tab-strip-scroller]').evaluate(el => el.scrollLeft > 0));
await page.setViewportSize({ width: 1000, height: 800 });
await page.evaluate(async () => {
  const { default: Sidebar } = await import('/src/PDFSidebar.jsx');
  const { writePanelLayout } = await import('/src/sidebar/panelLayoutStore.js');
  writePanelLayout(localStorage, 'session-test-user', { open: true, panel: 'spaces' }, 'doc-a');
  window.Sidebar = Sidebar;
  window.renderSidebar = id => window.checkRoot.render(window.checkReact.createElement(Sidebar, { key: id, documentId: id.startsWith('local-') ? null : id, tabId: id, currentUserId: 'session-test-user', numPages: 1, pageNum: 1, spaces: [], bookmarks: [], features: {}, onNavigateToPage() {}, onPanelStateChange: state => { window.lastPanel = state; } }));
  window.renderSidebar('doc-a');
});
await page.waitForTimeout(300);
assert.ok(await page.getByRole('heading', { name: 'Spaces', exact: true }).isVisible());
await page.evaluate(() => window.renderSidebar('doc-b'));
await page.waitForTimeout(300);
assert.ok(!await page.getByRole('heading', { name: 'Spaces', exact: true }).isVisible());
await page.evaluate(() => window.renderSidebar('doc-a'));
await page.waitForTimeout(300);
assert.ok(await page.getByRole('heading', { name: 'Spaces', exact: true }).isVisible());
await page.evaluate(() => window.renderSidebar('local-a'));
await page.waitForTimeout(200);
await page.locator('#session-check').getByRole('button', {name:'Spaces', exact:true}).click();
await page.waitForTimeout(300);
assert.ok(await page.getByRole('heading', {name:'Spaces', exact:true}).isVisible());
await page.evaluate(() => window.renderSidebar('local-b'));
await page.waitForTimeout(300);
assert.ok(!await page.getByRole('heading', {name:'Spaces', exact:true}).isVisible());
await page.evaluate(() => window.renderSidebar('local-a'));
await page.waitForTimeout(300);
assert.ok(await page.getByRole('heading', {name:'Spaces', exact:true}).isVisible());
await page.evaluate(async () => {
  window.RightRail = (await import('/src/SurveySpacesRail.jsx')).default;
  window.rightStates = {};
  window.renderRight = (id, collapsed) => window.checkRoot.render(window.checkReact.createElement(window.RightRail, {
    key: id, pdfFile: {id}, initialCollapsed: collapsed, expandRequestKey: 4,
    selectedTemplate: {id:'session-template',name:'Work Survey',modules:[],entities:[]}, selectedModuleId: null,
    showSurveyPanel: true, surveyMarkers: {}, annotationsByPage: {}, spaces: [], items: {}, features: {},
    expandedCategories: {}, expandedSurveyMarkers: {}, selectedCategories: new Set(), selectedItemsInCategory: {},
    onCollapseChange: value => { window.rightStates[id] = value; },
  }));
  window.renderRight('right-a', false);
});
await page.waitForTimeout(300);
assert.equal(await page.locator('#session-check button[aria-label="Survey"]').getAttribute('aria-expanded'), 'true');
await page.evaluate(() => window.renderRight('right-b', true));
await page.waitForTimeout(300);
assert.equal(await page.locator('#session-check button[aria-label="Survey"]').getAttribute('aria-expanded'), 'false');
await page.evaluate(() => window.renderRight('right-a', window.rightStates['right-a']));
await page.waitForTimeout(300);
assert.equal(await page.locator('#session-check button[aria-label="Survey"]').getAttribute('aria-expanded'), 'true');
await page.evaluate(async () => {
  const mod = await import('/src/components/QuietLoading.jsx');
  window.checkRender(mod.default, { label: 'Opening Site plan…' });
});
await page.waitForTimeout(700);
assert.equal(await page.locator('#session-check .quiet-loading-page').count(), 1);
await page.screenshot({ path: '/tmp/survey-session-loading.png' });
// History uses only isolated local rows. No authentication or remote data.
await page.evaluate(async () => {
  const now = Date.now();
  const rows = Array.from({length: 110}, (_, i) => ({ id: `test-history-${i}`, client_event_id: `test-history-${i}`, __local: true, document_id: 'session-history', user_id: 'session-user', annotation_id: `mark-${i}`, page_number: 1, event_type: i % 4 === 2 ? 'annotation_deleted' : 'local_annotation_history_added', summary: `Test User changed mark ${i}`, payload: { actionType: ['create','move','delete','restore'][i % 4], annotationType: 'rect', restoredFromHistory: i % 4 === 3 }, occurred_at: new Date(now - i * 1000).toISOString(), created_at: new Date(now - i * 1000).toISOString() }));
  localStorage.setItem('survey_document_history_events_v1', JSON.stringify({'session-history': rows}));
  const { default: History } = await import('/src/components/revisions/RevisionsPanel.jsx');
  window.renderHistory = id => window.checkRoot.render(window.checkReact.createElement('div', { style: { width: 260, height: 700 } }, window.checkReact.createElement(History, { documentId: id, user: { id: 'session-user' }, embedded: true, isActive: true, getHistoryMarkIndex: () => new Map() })));
  window.renderHistory('session-history');
});
await page.waitForSelector('[data-testid="document-history-legend"] button');
const top = await page.locator('[data-testid="document-history-legend"] button').evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
assert.ok(top.every(n => n === top[0]));
await page.getByRole('button', {name: 'Added', exact:true}).click();
await page.getByRole('button', {name: 'Restored', exact:true}).click();
assert.equal(await page.locator('[data-testid="document-history-legend"] [aria-pressed=true]').count(), 2);
await page.getByRole('button', {name: 'Added', exact:true}).click();
await page.getByRole('button', {name: 'Restored', exact:true}).click();
for (let i = 0; i < 4; i++) {
  await page.locator('[data-testid="document-history-list"]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(250);
}
const count = await page.locator('.dh-row').count();
assert.ok(count >= 110, `history rows=${count}`);
await page.screenshot({path:'/tmp/survey-session-history.png'});
// A real older-page error exposes Retry. A subsequent stale error/finally
// must not stop the next document's pending page or leave it in error.
await page.evaluate(() => {
  const store = JSON.parse(localStorage.getItem('survey_document_history_events_v1'));
  for (const id of ['history-error-a', 'history-error-b']) store[id] = store['session-history'].map(row => ({...row, document_id:id}));
  localStorage.setItem('survey_document_history_events_v1', JSON.stringify(store));
  window.renderHistory('history-error-a');
});
await expect.poll(() => page.locator('.dh-row').count()).toBe(50);
await page.getByTestId('document-history-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
await expect(page.getByTestId('document-history-load-older')).toBeVisible();
await page.getByTestId('document-history-load-older').click();
await expect.poll(() => Boolean(heldOlderA)).toBe(true);
await page.evaluate(() => window.renderHistory('history-error-b'));
await expect.poll(() => page.locator('.dh-row').count()).toBe(50);
await page.getByTestId('document-history-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
await expect.poll(() => Boolean(heldOlderB)).toBe(true);
await heldOlderA.fulfill({ status:500, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({code:'XX000',message:'Synthetic stale page failure'}) });
await page.waitForTimeout(100);
await expect(page.getByTestId('document-history-load-older')).toHaveCount(0);
await expect(page.locator('.dh-more[role="status"]')).toHaveText('Loading…');
await heldOlderB.fulfill({ status:404, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({code:'42P01',message:'relation "public.document_history_events" does not exist'}) });
await expect.poll(() => page.locator('.dh-row').count()).toBe(100);
await page.getByTestId('document-history-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
await expect.poll(() => page.locator('.dh-row').count()).toBe(110);
await expect(page.getByTestId('document-history-load-older')).toHaveCount(0);
await page.evaluate(async () => {
  const { AccountSettings } = await import('/src/components/AccountSettings.jsx');
  const { AuthContext } = await import('/src/contexts/AuthContext.jsx');
  const { MSGraphContext } = await import('/src/contexts/MSGraphContext.jsx');
  const R = window.checkReact;
  window.deleteCalls = 0;
  window.checkRoot.render(R.createElement(AuthContext.Provider, { value: { user: { id: 'session-fake-user', email: 'session-test@example.invalid', user_metadata: { first_name: 'Test', last_name: 'User' } }, deleteAccount: async () => { window.deleteCalls++; }, updateProfile: async () => {}, signOut: async () => {} } }, R.createElement(MSGraphContext.Provider, { value: {} }, R.createElement(AccountSettings, { isOpen: true, onClose() {} }))));
});
await page.getByRole('button', {name: 'Edit name and profile', exact:true}).click();
assert.ok(await page.getByLabel('First name', {exact:true}).isVisible());
await page.getByRole('button', {name:'Cancel', exact:true}).click();
await page.waitForTimeout(300);
await page.getByRole('button', {name:'Delete account', exact:true}).click();
await page.waitForTimeout(300);
await page.getByLabel('Type DELETE to continue', {exact:true}).fill('delete');
await page.getByRole('button', {name:'Continue', exact:true}).click();
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.deleteCalls), 0);
await page.getByRole('button', {name:'Delete account', exact:true}).click();
await page.waitForTimeout(300);
await page.getByLabel('Type DELETE to continue', {exact:true}).fill('DELETE');
await page.getByRole('button', {name:'Continue', exact:true}).click();
await page.waitForTimeout(300);
await page.getByRole('button', {name:'Cancel', exact:true}).click();
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.deleteCalls), 0);
await page.getByRole('button', {name:'Delete account', exact:true}).click();
await page.waitForTimeout(300);
await page.getByLabel('Type DELETE to continue', {exact:true}).fill('DELETE');
await page.getByRole('button', {name:'Continue', exact:true}).click();
await page.waitForTimeout(300);
await page.screenshot({path:'/tmp/survey-session-account-confirm.png'});
await page.getByRole('dialog').filter({hasText:'This cannot be undone.'}).getByRole('button', {name:'Delete account', exact:true}).click();
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => window.deleteCalls), 1);
assert.deepEqual(errors, []);
console.log(JSON.stringify({passed:true, sizes, historyRows:count, errors}));
});
