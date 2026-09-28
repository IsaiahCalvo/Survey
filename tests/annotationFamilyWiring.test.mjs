// w52 (2026-09-28) — "one annotation family" wiring. Source assertions (the
// repo's pattern for JSX / hooks that need a DOM) proving each selection path
// calls the shared rule in annotationFamilyRules.js instead of its own copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

const count = (source, needle) => source.split(needle).length - 1;

test('bug 1: every group-move / group-transform snapshot uses canMoveAnnotation', () => {
  // annotation pointerdown group move, callout pointerdown group move,
  // empty-space-inside-group move, group rotate/resize member snapshot.
  assert.ok(count(hook, 'canMoveAnnotation(selObj)') >= 3, 'three group-move snapshot sites');
  assert.match(hook, /if \(!canMoveAnnotation\(obj\)\) \{\s*if \(aabb\) memberWorldAABBs\.push\(aabb\);\s*continue;/);
  // the old text-markup + transform-lock-only copies are gone
  assert.doesNotMatch(hook, /selObj\?\.data\?\.type !== 'text-markup'\s*&& !isTransformLockedAnnotation\(selObj\)/);
});

test('bug 4: both counter-orbit entry points are lock-gated', () => {
  assert.match(hook, /e\.shiftKey\s*&& canOrbitCounter\(_obj_precheck\)/);
  assert.match(hook, /if \(e\.shiftKey && canOrbitCounter\(mvObj\)\)/);
  assert.doesNotMatch(hook, /_obj_precheck\?\.data\?\.type === 'counter'/);
});

test('bug 2: marquee and lasso only see selectable callouts', () => {
  assert.equal(
    count(hook, 'callouts: filterSelectableCallouts(callouts, isCalloutSelectable)'),
    2,
    'resolveMarqueeHits + resolveLassoHits',
  );
  assert.match(layer, /isCalloutSelectable,\n/);
  assert.match(layer, /selectableCalloutIdsRef\.current = filteredCallouts\?\.selectableCalloutIds/);
});

test('bug 3: callouts obey the active-space interactivity rule', () => {
  assert.match(layer, /const calloutInteractive = isAnnotationInteractiveInActiveSpace\(\{/);
  assert.match(layer, /if \(calloutInteractive\) selectableIds\.add\(String\(callout\.id\)\)/);
  // inert callouts render chrome only, with pointer events off
  assert.match(layer, /data-callout-inert="true"\s*pointerEvents="none"/);
  // shapes use the same shared rule
  assert.match(layer, /const isObjectInteractive = isInteractiveForActiveSpace\(\{/);
  // defence in depth in the hook: click + double-click refuse inert callouts
  assert.ok(count(hook, '!isCalloutSelectable(calloutId)') >= 2);
});

test('bug 5: multi-selection z-order hotkeys restack the whole selection', () => {
  assert.match(layer, /const direction = zOrderDirectionForKey\(e\);/);
  assert.match(layer, /reorderSelectionInStack\(objects, picked, direction\)/);
  assert.match(layer, /action: 'reorder-group',\s*checkpointPolicy: 'normal'/);
  // the single-shape handler yields when a callout on this page is also selected
  assert.match(layer, /\(isBracketRight \|\| isBracketLeft\) && countPageSelectedCallouts\(\) > 0\) return;/);
});

test('bug 6: arrow-key nudge previews live and commits once with normal', () => {
  // RULED w57 (2026-09-28, owner task "a burst of auto-repeat must not write
  // one DB row per keypress"): the w52 assertion here pinned a 'nudge-preview'
  // save with checkpointPolicy 'skip' on EVERY press — that save is exactly
  // the per-press Supabase row w57 removes (~30 rows per second of a held
  // key, measured live). The preview is now the drag's render-time translate
  // (no save), so the assertion is inverted deliberately, not to pass.
  assert.doesNotMatch(hook, /action: 'nudge-preview'/);
  assert.match(hook, /setVisualTransform\(nudgePreviewTransform\(burst\)\);/);
  assert.match(hook, /action: 'nudge',\s*checkpointPolicy: 'normal'/);
  assert.match(hook, /latest\.onUpdateCalloutLive\(calloutId, nudgeCalloutPatch\(/);
  assert.match(hook, /latest\.onUpdateCallout\(calloutId, \{\}\)/);
  // one burst = one step: commit on idle timeout, blur, selection change and
  // teardown — NOT on each key release (taps in a row are one move; verified
  // live 2026-09-28)
  assert.doesNotMatch(hook, /if \(burst\.keysDown\.size === 0\) commitNudgeBurst\(\);/);
  assert.doesNotMatch(layer, /if \(burst\.keysDown\.size === 0\) commitSurveyMarkerNudge\(\);/);
  assert.match(hook, /NUDGE_IDLE_COMMIT_MS\)/);
  // guards: typing targets, read-only, active gestures, nothing movable
  assert.match(hook, /if \(isTypingTarget\(document\.activeElement\)\) return;/);
  assert.match(hook, /data-readonly'\) === 'true'\) return;/);
  assert.match(hook, /if \(!burst\) return; \/\/ nothing movable here/);
  // locks respected via the shared movable rule
  assert.match(hook, /if \(canMoveAnnotation\(object\)\) startObjects\[index\] = deepClone\(object\);/);
  // the layer switches it off while an inline editor owns the keys
  assert.match(layer, /keyboardNudgeEnabled: editingAnnotationIndex == null && !editingCalloutId/);
  // Survey Markers get the same nudge through their own bounds update
  assert.match(layer, /onUpdateSurveyMarkerBounds\?\.\(pageNumber, burst\.annotationId, \{/);
});

test('w57: any other input saves a running nudge burst first, synchronously', () => {
  // family nudge (hook) and lone Survey Marker nudge (layer)
  assert.match(hook, /const onPointerDown = \(\) => \{\s*if \(nudgeBurstRef\.current\) commitNudgeBurst\(\{ sync: true \}\);/);
  assert.match(hook, /if \(nudgeBurstRef\.current && !isArrowKey\(e\.key\) && e\.key !== 'Shift'\) commitNudgeBurst\(\{ sync: true \}\);/);
  assert.match(hook, /if \(sync\) flushSync\(run\);/);
  assert.match(layer, /if \(surveyMarkerNudgeRef\.current\) commitSurveyMarkerNudge\(\{ sync: true \}\);/);
  assert.match(layer, /commitSurveyMarkerNudge\(\{ sync: true \}\);\s*\}\s*return;/);
  // the open right-click menu owns the arrows in both paths
  assert.match(hook, /if \(isArrowOwningPopoverOpen\(document\)\) return;/);
  assert.match(layer, /if \(isArrowOwningPopoverOpen\(document\)\) return;/);
});
