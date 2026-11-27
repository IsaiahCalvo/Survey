import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

describe('Read-only open sync hygiene (#1791) and desktop toast clearance (#1788)', () => {
  it('seeds lastSyncedAnnotationsRef on Y.Doc/Realtime/initial survey-marker hydration (#1791)', () => {
    const viewer = fs.readFileSync(path.join(root, 'src/PDFViewer.jsx'), 'utf8');

    assert.match(viewer, /const lastSyncedAnnotationsRef = useRef\(JSON\.stringify\(\{\}\)\);/);
    assert.match(viewer, /const setSurveyMarkersFromHydration = useCallback\(/);
    assert.match(viewer, /setSurveyMarkers:\s*setSurveyMarkersFromHydration,/);
    assert.match(viewer, /setSurveyMarkersFromHydration\(loadedSurveyMarkers\);/);
  });

  it('lifts desktop toasts above .sheet-set-bar using --app-toast-bottom (#1788)', () => {
    const jsx = fs.readFileSync(path.join(root, 'src/components/ToastHost.jsx'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'src/components/ToastHost.css'), 'utf8');

    assert.match(jsx, /DESKTOP_BOTTOM_CHROME_SELECTORS\s*=\s*\[[^\]]*\.sheet-set-bar/);
    assert.match(jsx, /--app-toast-bottom/);
    assert.match(css, /bottom:\s*var\(--app-toast-bottom,\s*24px\);/);
  });
});
