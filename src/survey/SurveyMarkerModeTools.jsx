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
import { useEffect, useSyncExternalStore } from 'react';
import Icon from '../Icons';
import {
  setMarkerDrawMode,
  setMarkerModeToolsShown,
  useShownMarkerDrawMode,
} from './markerDrawMode.js';
import { getMarkerShapeProviders, subscribeMarkerShapeProviders } from './markerShapeProviders.js';

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
    </div>
  );
}
