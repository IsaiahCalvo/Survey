import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const surveyRail = await readFile(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const pdfSidebar = await readFile(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const mobileChrome = await readFile(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const pdfViewer = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('SurveySpacesRail mobile exits go through dismissSurveySheet / requestClose', () => {
  assert.match(surveyRail, /requestClose:\s*requestSurveySheetClose/);
  assert.match(surveyRail, /const dismissSurveySheet = useCallback/);
  assert.match(surveyRail, /onClick=\{dismissSurveySheet\}/);
  assert.match(surveyRail, /if \(collapseRequestKey > 0\) dismissSurveySheet\(\)/);
  assert.match(surveyRail, /afterSurveyHideRef\.current = doExit/);
  assert.match(surveyRail, /dismissSurveySheet\(\)/);
  assert.doesNotMatch(
    surveyRail,
    /mobileMode && !isSurveyPanelCollapsed && \(\s*<button[\s\S]*?setIsSurveyPanelCollapsed\(true\)/,
    'mobile backdrop must not hard-set collapsed',
  );
});

test('PDFSidebar mobile exits go through closePanel → requestSheetClose', () => {
  assert.match(pdfSidebar, /requestClose:\s*requestSheetClose/);
  assert.match(pdfSidebar, /requestClose:\s*closePanel/);
  assert.match(pdfSidebar, /if \(mobileMode\) \{\s*requestSheetClose\(\)/);
  assert.match(pdfSidebar, /onClick=\{closePanel\}/);
  assert.match(pdfSidebar, /if \(mobileMode && !isCollapsed\) \{\s*closePanel\(\)/);
  assert.equal(
    (pdfSidebar.match(/onClick=\{requestSheetClose\}/g) || []).length,
    0,
    'direct requestSheetClose clicks were folded into closePanel so already-closed is a no-op',
  );
});

test('AppShell chrome closes the document sheet via requestClose', () => {
  assert.match(appShell, /const closeMobileDocumentSheet = useCallback/);
  assert.match(appShell, /rail\?\.requestClose/);
  assert.match(appShell, /closeMobileDocumentSheet\(\)/);
  assert.doesNotMatch(
    appShell,
    /leftRailApi\?\.ref\?\.current\?\.closePanel\?\.\(\)/,
    'AppShell must not hard-call closePanel once requestClose is on the rail handle',
  );
});

test('MobilePdfViewerChrome tool/presence exits use requestClose, not setOpen(false)', () => {
  assert.match(mobileChrome, /requestClose:\s*requestTextSheetClose/);
  assert.match(mobileChrome, /requestClose:\s*requestUsersSheetClose/);
  assert.match(mobileChrome, /if \(textDefaultsOpenRef\.current\) requestTextSheetClose\(\)/);
  assert.match(mobileChrome, /const dismissUsersSheet = \(\) => \{/);
  assert.match(mobileChrome, /if \(presenceOpen\) dismissUsersSheet\(\)/);
  assert.doesNotMatch(
    mobileChrome,
    /setTextDefaultsOpen\(false\);\s*\n\s*\}, \[tool\]/,
    'tool-change must not hard-hide the text sheet',
  );
  assert.doesNotMatch(
    mobileChrome,
    /setMoreOpen\(\(open\) => !open\); setPresenceOpen\(false\)/,
    'More rail must not hard-hide the users sheet',
  );
});

test('PDFViewer.jsx has no mobile-sheet close leftovers to migrate here', () => {
  assert.doesNotMatch(pdfViewer, /useMobileSheetMotion/);
  assert.doesNotMatch(pdfViewer, /requestClose/);
  assert.doesNotMatch(pdfViewer, /setIsSurveyPanelCollapsed\(true\)/);
});
