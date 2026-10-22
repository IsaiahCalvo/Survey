/**
 * SurveyMarkerModeTools — the Survey Marker group in the desktop tool bar.
 *
 * Owner 2026-10-13: "in the top toolbar, to the right of the tool groups (just
 * like where we show pen, highlighter, and eraser), we're going to show
 * different types of drawing survey markers": Rectangle (the marquee box,
 * default), Freehand (a highlighter-like stroke) and Smart fill (hidden until
 * its provider registers — markerShapeProviders.js). Same 28px
 * .chrome-subcontrol buttons, same gutter and gold armed glyph as the Draw
 * group's tools and the Areas tools. The last pick is remembered.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import Icon from '../Icons';
import {
  setMarkerDrawMode,
  setMarkerModeToolsShown,
  useShownMarkerDrawMode,
} from './markerDrawMode.js';
import { getMarkerShapeProviders, subscribeMarkerShapeProviders } from './markerShapeProviders.js';
import { latestSmartFillSample } from './smartFillSamples.js';
import {
  getSmartFillTemplateShapes,
  setSmartFillTeachArmed,
  SMART_FILL_SHAPES_CHANGED_EVENT,
  useSmartFillTeachArmed,
} from './smartFillTemplateShapes.js';
import { showToast, dismissToast } from '../utils/toast';

// Test-only fake Smart fill (dev server + ?fakeSmartFill=1). Never in a
// production build: Vite folds import.meta.env.DEV to false and drops this.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  try {
    if (new URLSearchParams(window.location.search).get('fakeSmartFill') === '1') {
      import('./devFakeSmartFillProvider.js').then((m) => m.registerDevFakeSmartFillProvider());
    }
  } catch { /* no URL */ }
}

const BUILT_IN_MODES = [
  { mode: 'rectangle', label: 'Rectangle marker', icon: 'selectionPlus' },
  { mode: 'freehand', label: 'Freehand marker', icon: 'brush' },
];

export default function SurveyMarkerModeTools({ chromeTip, glyphSize }) {
  const shown = useShownMarkerDrawMode();
  const providers = useSyncExternalStore(subscribeMarkerShapeProviders, getMarkerShapeProviders, getMarkerShapeProviders);
  const smartFill = providers.find((provider) => provider.id === 'smartFill') || null;
  // While this group is on screen the page draws in the picked mode; with no
  // group (the phone, or the tool not armed) every marker is a rectangle.
  useEffect(() => {
    setMarkerModeToolsShown(true);
    return () => setMarkerModeToolsShown(false);
  }, []);
  // Owner 2026-10-20 (beta): once a Smart fill tag has been applied, a search
  // button next to the modes finds tags like it on the pages in view — on
  // this drawing or any other (the sample is remembered in this browser).
  // Owner 2026-10-22: taught tag shapes (the open template's) count too.
  const hasAnySample = () => Boolean(latestSmartFillSample()) || getSmartFillTemplateShapes().length > 0;
  const [hasSample, setHasSample] = useState(hasAnySample);
  useEffect(() => {
    const refresh = () => setHasSample(hasAnySample());
    window.addEventListener('smart-fill-samples-changed', refresh);
    window.addEventListener(SMART_FILL_SHAPES_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('smart-fill-samples-changed', refresh);
      window.removeEventListener(SMART_FILL_SHAPES_CHANGED_EVENT, refresh);
    };
  }, []);
  const showFindSimilar = Boolean(smartFill) && shown === 'smartFill' && hasSample;
  // Owner 2026-10-22: "Teach a tag shape" — the next drag boxes a tag Smart
  // fill missed; it is saved in the template so it is not missed again.
  const teachArmed = useSmartFillTeachArmed();
  const showTeach = Boolean(smartFill) && shown === 'smartFill';
  useEffect(() => {
    if (!showTeach) setSmartFillTeachArmed(false);
  }, [showTeach]);
  useEffect(() => () => setSmartFillTeachArmed(false), []);
  const modes = smartFill
    ? [...BUILT_IN_MODES, { mode: 'smartFill', label: smartFill.label, icon: smartFill.icon }]
    : BUILT_IN_MODES;
  return (
    <div
      data-marker-draw-modes="true"
      role="group"
      aria-label="Survey marker drawing"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-tool-gap)' }}
    >
      {modes.map(({ mode, label, icon }) => {
        const selected = shown === mode;
        return (
          <button
            key={mode}
            type="button"
            className={`btn chrome-subcontrol ${selected ? 'btn-active' : 'btn-ghost'}`}
            aria-pressed={selected}
            data-marker-draw-mode={mode}
            data-morph-icon={icon}
            data-tool-switch="true"
            onClick={() => setMarkerDrawMode(mode)}
            {...(chromeTip ? chromeTip(label, 'below') : {})}
            aria-label={label}
          >
            <Icon name={icon} size={glyphSize} />
          </button>
        );
      })}
      {showTeach && (
        <button
          type="button"
          className={`btn chrome-subcontrol ${teachArmed ? 'btn-active' : 'btn-ghost'}`}
          aria-pressed={teachArmed}
          data-smart-fill-teach="true"
          onClick={() => {
            const next = !teachArmed;
            setSmartFillTeachArmed(next);
            if (next) {
              showToast('Drag a box around a tag Smart fill missed. It will learn that shape.', 'info', { id: 'smart-fill-no-match', duration: 8000 });
            } else {
              dismissToast('smart-fill-no-match');
            }
          }}
          {...(chromeTip ? chromeTip('Teach a tag shape', 'below') : {})}
          aria-label="Teach a tag shape"
        >
          <Icon name="template" size={glyphSize} />
        </button>
      )}
      {showFindSimilar && (
        <button
          type="button"
          className="btn chrome-subcontrol btn-ghost"
          data-smart-fill-find-similar="true"
          onClick={() => {
            // Pages that find matches replace this with their count.
            dismissToast('smart-fill-find');
            showToast('Looking for tags like your Smart fill shapes on the pages in view…', 'info', { id: 'smart-fill-find', duration: 30000 });
            window.dispatchEvent(new CustomEvent('smart-fill-find-similar'));
          }}
          {...(chromeTip ? chromeTip('Find tags like your Smart fill shapes', 'below') : {})}
          aria-label="Find tags like your Smart fill shapes"
        >
          <Icon name="search" size={glyphSize} />
        </button>
      )}
    </div>
  );
}
