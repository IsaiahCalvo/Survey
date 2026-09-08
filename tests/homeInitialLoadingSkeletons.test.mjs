import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveHubInitialLoading } from '../src/home/hubInitialLoadingState.js';
import { isScopedRequestCurrent } from '../src/hooks/scopedRequestGuard.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DASHBOARD = read('../src/Dashboard.jsx');
const HUB = read('../src/home/SurveyHub.jsx');
const HUB_SHELL = read('../src/home/HubShell.jsx');
const SKELETONS = read('../src/home/HubLoadingSkeletons.jsx');
const CSS = read('../src/home/hub.css');
const PREVIEW = read('../src/home/HubPreview.jsx');
const DATABASE_HOOKS = read('../src/hooks/useDatabase.js');
const TEMPLATE_HOOK = DATABASE_HOOKS.slice(
  DATABASE_HOOKS.indexOf('export const useTemplates ='),
  DATABASE_HOOKS.indexOf('// TEMPLATE UTILITY FUNCTIONS'),
);

test('home skeletons appear only during an empty first load, never a later refetch', () => {
  const cold = resolveHubInitialLoading({
    documentsInitialLoading: true,
    projectsInitialLoading: true,
    templatesInitialLoading: true,
  });
  assert.deepEqual(cold, { documents: true, projects: true, templates: true });

  const settledThenRefetching = resolveHubInitialLoading({
    documentsInitialLoading: false,
    projectsInitialLoading: false,
    templatesInitialLoading: false,
  });
  assert.deepEqual(settledThenRefetching, { documents: false, projects: false, templates: false });

  const switchedScopeWithStaleRows = resolveHubInitialLoading({
    documentsInitialLoading: true,
    projectsInitialLoading: false,
    templatesInitialLoading: true,
  });
  assert.deepEqual(switchedScopeWithStaleRows, { documents: true, projects: true, templates: true });

  assert.match(DATABASE_HOOKS, /loadedProjectScopeKey !== projectScopeKey/);
  assert.match(DATABASE_HOOKS, /loadedDocumentScopeKey !== documentScopeKey/);
  assert.match(TEMPLATE_HOOK, /const initialLoading = autoLoad && loadedTemplateReadScope !== templateReadScope;/);
  // A new actor or a disable/enable cycle owns a distinct initial-load scope;
  // a later refetch within that scope must not restore the initial skeleton.
  assert.match(TEMPLATE_HOOK, /templateReadScopeRef\.current\?\.key !== templateScopeKey\s*\|\| templateReadScopeRef\.current\?\.autoLoad !== autoLoad/);
  assert.match(DATABASE_HOOKS, /loadDocuments\(\{ coalesce: true, initialScopeKey: documentScopeKey \}\)/);
  assert.match(TEMPLATE_HOOK, /loadTemplates\(\{ coalesce: templateReadScope\.initialMount, initialScopeKey: templateScopeKey \}\)/);
  assert.match(TEMPLATE_HOOK, /initialMount: templateReadScopeRef\.current === null/);
  assert.match(DATABASE_HOOKS, /refetch: \(\) => loadDocuments\(\{ coalesce: false \}\)/);
  assert.match(DATABASE_HOOKS, /refetch: \(\) => loadTemplates\(\{ coalesce: false \}\)/);
  assert.match(DASHBOARD, /const hubInitialLoading = resolveHubInitialLoading/);
  assert.match(DASHBOARD, /documentsInitialLoading=\{hubInitialLoading\.documents\}/);
  assert.match(DASHBOARD, /projectsInitialLoading=\{hubInitialLoading\.projects\}/);
  assert.match(DASHBOARD, /templatesInitialLoading=\{hubInitialLoading\.templates\}/);
  assert.match(HUB, /documentsInitialLoading[\s\S]*projectsInitialLoading[\s\S]*templatesInitialLoading/);
  assert.match(HUB, /documentsInitialLoading\s*\?\s*\(/);
  assert.match(HUB, /projectsInitialLoading\s*\?\s*\(/);
  assert.match(HUB, /templatesInitialLoading\s*\?\s*\(/);
});

test('failed first loads render retryable tab errors instead of false empty states', () => {
  for (const name of [
    'documentsLoadError',
    'projectsLoadError',
    'templatesLoadError',
    'onRetryDocuments',
    'onRetryProjects',
    'onRetryTemplates',
  ]) {
    assert.match(DASHBOARD, new RegExp(name));
    assert.match(HUB, new RegExp(name));
  }
  assert.match(HUB, /role="alert"/);
  assert.match(HUB, />Try again</);
  assert.match(DATABASE_HOOKS, /setError\(null\)/);
});

test('a late request from an old user or project cannot replace the current scope', () => {
  const requestA = { requestId: 1, requestScopeKey: 'user-a:project-a' };
  const requestB = { requestId: 2, requestScopeKey: 'user-b:project-b' };

  assert.equal(isScopedRequestCurrent({
    ...requestB,
    latestRequestId: 2,
    currentScopeKey: 'user-b:project-b',
  }), true);
  assert.equal(isScopedRequestCurrent({
    ...requestA,
    latestRequestId: 2,
    currentScopeKey: 'user-b:project-b',
  }), false);

  const initial = { requestId: 1, requestScopeKey: 'user-b:project-b' };
  const earlyRefetch = { requestId: 2, requestScopeKey: 'user-b:project-b' };
  assert.equal(isScopedRequestCurrent({
    ...initial,
    latestRequestId: 2,
    currentScopeKey: 'user-b:project-b',
  }), false);
  assert.equal(isScopedRequestCurrent({
    ...earlyRefetch,
    latestRequestId: 2,
    currentScopeKey: 'user-b:project-b',
  }), true);
  assert.match(DATABASE_HOOKS, /if \(!isCurrentRequest\(\)\) return \[\];[\s\S]*?setDocuments\(merged\)/);
  assert.match(DATABASE_HOOKS, /if \(!isCurrentRequest\(\)\) return \[\];[\s\S]*?setTemplates\(rows\)/);
  assert.match(DATABASE_HOOKS, /setLoadedProjectScopeKey\(requestScopeKey\)/);
  assert.match(DATABASE_HOOKS, /setLoadedDocumentScopeKey\(requestScopeKey\)/);
  assert.match(TEMPLATE_HOOK, /const isCurrentScope = \(\) => templateMountedRef\.current && templateReadScopeRef\.current === templateReadScope;/);
  assert.match(TEMPLATE_HOOK, /const isCurrentRequest = \(\) => isCurrentScope\(\) && isScopedRequestCurrent\(\{/);
  assert.match(TEMPLATE_HOOK, /finally \{\s*if \(isCurrentRequest\(\)\) \{\s*setLoading\(false\);\s*setLoadedTemplateReadScope\(templateReadScope\);/);
});

test('primary tab navigation never waits on a first-visit code split', () => {
  assert.match(HUB, /import ProjectsFolderTree from '\.\/ProjectsFolderTree'/);
  assert.match(HUB, /import TemplatesEditor from '\.\/TemplatesEditor'/);
  assert.doesNotMatch(HUB, /lazy\(\(\) => import\('\.\/ProjectsFolderTree'\)\)/);
  assert.doesNotMatch(HUB, /lazy\(\(\) => import\('\.\/TemplatesEditor'\)\)/);
  assert.match(HUB, /const navigateToTab = \(nextTab\) => \{[\s\S]*?startTransition\(\(\) => setTab\(nextTab\)\)/);
  assert.match(HUB, /const common = \{ onNav: navigateToTab/);
  const shellFrameEffect = HUB_SHELL.slice(HUB_SHELL.indexOf('export const HubShell'));
  assert.match(shellFrameEffect, /useLayoutEffect\(\(\) => \{[\s\S]*?document\.documentElement\.classList\.add\(pageClass\)/);
});

test('skeletons mirror real desktop and mobile row geometry', () => {
  assert.match(SKELETONS, /documents-desktop-card/);
  assert.match(SKELETONS, /projects-desktop-layout/);
  assert.match(SKELETONS, /templates-editor-grid/);
  assert.match(SKELETONS, /mobile-doc-card/);
  assert.match(SKELETONS, /projects-mobile-folder-row drill reorderable/);
  assert.match(SKELETONS, /templates-mobile-row reorderable/);
  assert.match(SKELETONS, /const grid = '32px 54px minmax\(150px,1fr\) 124px 124px 72px'/);
  assert.match(SKELETONS, /gridTemplateColumns:\s*'260px 1fr'/);
  assert.match(SKELETONS, /gridTemplateColumns:\s*'260px 1fr 268px'/);
  assert.match(SKELETONS, /hub-loading-project-columns/);
  assert.match(SKELETONS, /hub-loading-project-files/);
  assert.match(SKELETONS, /hub-loading-project-team/);
  assert.match(SKELETONS, /hub-loading-template-content/);
  assert.match(SKELETONS, /hub-loading-entities-rail/);
  assert.doesNotMatch(SKELETONS, /projects-mobile-browser-label hub-loading-mobile-label/);
  assert.doesNotMatch(SKELETONS, /templates-mobile-label hub-loading-mobile-label/);
  assert.match(CSS, /--mobile-list-card-h:\s*64px/);
  assert.match(CSS, /\.survey-hub \.templates-editor-body\s*\{[\s\S]*?padding:\s*8px 10px 10px !important/);
  assert.match(CSS, /\.survey-hub \.hub-loading-document-row\s*\{[\s\S]*?height:\s*50px/);
  assert.match(CSS, /\.survey-hub \.hub-loading-project-columns\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 148px/);
  assert.match(CSS, /\.survey-hub \.hub-loading-project-header\s*\{[\s\S]*?min-height:\s*65px/);
  assert.match(CSS, /\.survey-hub \.hub-loading-project-file-row\s*\{[\s\S]*?height:\s*42px/);
  assert.match(CSS, /\.survey-hub \.hub-loading-template-header\s*\{[\s\S]*?min-height:\s*65px/);
  assert.match(CSS, /\.survey-hub \.hub-loading-entities-header\s*\{[\s\S]*?min-height:\s*64px/);
  assert.match(CSS, /\.survey-hub \.hub-loading-entity-row\s*\{[\s\S]*?height:\s*38px/);
});

test('loading treatment fits the app palette and accessibility settings', () => {
  assert.match(SKELETONS, /aria-busy="true"/);
  assert.match(SKELETONS, /role="status"/);
  assert.match(SKELETONS, /aria-label=\{`Loading \$\{title\.toLowerCase\(\)\}`\}/);
  assert.match(SKELETONS, /documents-mobile-summary[^>]*aria-hidden="true"/);
  assert.match(SKELETONS, /desktop-summary hub-loading-metric-cell`} aria-hidden="true"/);
  assert.doesNotMatch(SKELETONS, /var\(--gold\)|#d8a84e|#fff(?:fff)?\b/i);
  assert.match(CSS, /\.survey-hub \.hub-skeleton-block\s*\{[\s\S]*?background:\s*var\(--ink-500\)/);
  assert.match(CSS, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.survey-hub \.hub-skeleton-block[\s\S]*?animation:\s*none/);
});

test('dev preview can hold each real skeleton on screen for visual QA', () => {
  assert.match(PREVIEW, /params\.get\('hubLoading'\)/);
  assert.match(PREVIEW, /documentsInitialLoading=\{loadingFixture === 'documents'\}/);
  assert.match(PREVIEW, /projectsInitialLoading=\{loadingFixture === 'projects'\}/);
  assert.match(PREVIEW, /templatesInitialLoading=\{loadingFixture === 'templates'\}/);
});
