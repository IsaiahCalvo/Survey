import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveHubInitialLoading } from '../src/home/hubInitialLoadingState.js';
import { isScopedRequestCurrent } from '../src/hooks/scopedRequestGuard.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DASHBOARD = read('../src/Dashboard.jsx');
const HUB = read('../src/home/SurveyHub.jsx');
const HUB_SHELL = read('../src/home/HubShell.jsx');
const LOADING = read('../src/home/HubLoading.jsx');
const QUIET = read('../src/components/QuietLoading.jsx');
const CSS = read('../src/home/hub.css');
const PREVIEW = read('../src/home/HubPreview.jsx');
const DATABASE_HOOKS = read('../src/hooks/useDatabase.js');

test('home loading state appears only during an empty first load, never a later refetch', () => {
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
  assert.match(DATABASE_HOOKS, /loadedTemplateScopeKey !== templateScopeKey/);
  assert.match(DATABASE_HOOKS, /loadDocuments\(\{ coalesce: true, initialScopeKey: documentScopeKey \}\)/);
  assert.match(DATABASE_HOOKS, /loadTemplates\(\{ coalesce: true, initialScopeKey: templateScopeKey \}\)/);
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
  assert.match(DATABASE_HOOKS, /setLoadedTemplateScopeKey\(requestScopeKey\)/);
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

// Owner 2026-10-04: one calm loading state everywhere. The pulsing grey
// placeholder rows are gone; the list area shows the app's one quiet line and
// the header keeps the real controls' room with invisible spacers.
test('first load shows the one quiet line, not placeholder rows, and keeps the header still', () => {
  assert.match(LOADING, /<QuietLoading label=\{`Loading \$\{title\.toLowerCase\(\)\}…`\} \/>/);
  assert.match(LOADING, /className="hub-loading-region" aria-busy="true"/);
  assert.doesNotMatch(LOADING, /DocumentsSkeleton|ProjectsSkeleton|TemplatesSkeleton|hub-skeleton-block/);
  assert.match(LOADING, /hub-loading-space/);
  assert.match(CSS, /\.survey-hub \.hub-loading-space\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(CSS, /\.survey-hub \.hub-loading-region\s*\{[\s\S]*?position:\s*relative/);
  assert.doesNotMatch(CSS, /hubSkeletonPulse|hub-skeleton-block/);
  assert.doesNotMatch(CSS, /hub-loading-(?:document-row|mobile-panel|mobile-row|sidebar|project-|template-|entit)/,
    'the old placeholder-row rules are removed with the rows');
});

test('loading treatment fits the app palette and accessibility settings', () => {
  assert.match(LOADING, /documents-mobile-summary[^>]*aria-hidden="true"/);
  assert.match(LOADING, /desktop-summary hub-loading-metric-cell`} aria-hidden="true"/);
  assert.doesNotMatch(LOADING, /var\(--gold\)|#d8a84e|#fff(?:fff)?\b/i);
  assert.match(QUIET, /role="status"/);
  assert.match(QUIET, /aria-live="polite"/);
  assert.match(QUIET, /color: var\(--text-3\)/);
  assert.match(QUIET, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(QUIET, /infinite/, 'nothing pulses or spins');
});

test('dev preview can hold each loading state on screen for visual QA', () => {
  assert.match(PREVIEW, /params\.get\('hubLoading'\)/);
  assert.match(PREVIEW, /documentsInitialLoading=\{loadingFixture === 'documents'\}/);
  assert.match(PREVIEW, /projectsInitialLoading=\{loadingFixture === 'projects'\}/);
  assert.match(PREVIEW, /templatesInitialLoading=\{loadingFixture === 'templates'\}/);
});
