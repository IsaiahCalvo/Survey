const ZOOM_PREFERENCE_STORAGE_KEY = 'pdfViewerZoomPreference';

export const ZOOM_MODES = {
  FIT_PAGE: 'fitPage',
  FIT_WIDTH: 'fitWidth',
  FIT_HEIGHT: 'fitHeight',
  MANUAL: 'manual'
};

export const DEFAULT_ZOOM_PREFERENCES = {
  mode: ZOOM_MODES.FIT_PAGE,
  manualScale: 1.0
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 5.0;
const SCALE_EPSILON = 0.0001;

export const clampScale = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_ZOOM_PREFERENCES.manualScale;
  }
  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
};

const isValidMode = (mode) => Object.values(ZOOM_MODES).includes(mode);

export const loadZoomPreferences = () => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_ZOOM_PREFERENCES };
  }

  try {
    const raw = window.localStorage.getItem(ZOOM_PREFERENCE_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_ZOOM_PREFERENCES };
    }

    const parsed = JSON.parse(raw);
    const mode = isValidMode(parsed?.mode) ? parsed.mode : DEFAULT_ZOOM_PREFERENCES.mode;
    const manualScale = clampScale(parsed?.manualScale);

    return { mode, manualScale };
  } catch (error) {
    console.warn('[zoomController] Failed to load zoom preferences:', error);
    return { ...DEFAULT_ZOOM_PREFERENCES };
  }
};

export const saveZoomPreferences = (preferences) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const safePreferences = {
      mode: isValidMode(preferences?.mode) ? preferences.mode : DEFAULT_ZOOM_PREFERENCES.mode,
      manualScale: clampScale(preferences?.manualScale)
    };
    window.localStorage.setItem(ZOOM_PREFERENCE_STORAGE_KEY, JSON.stringify(safePreferences));
  } catch (error) {
    console.warn('[zoomController] Failed to save zoom preferences:', error);
  }
};

const safeDivide = (numerator, denominator) => {
  if (!denominator || Number.isNaN(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
};

const computeScaleForMode = (mode, viewport, pageSize) => {
  if (!viewport || !pageSize) {
    return DEFAULT_ZOOM_PREFERENCES.manualScale;
  }

  const widthScale = safeDivide(viewport.width, pageSize.width);
  const heightScale = safeDivide(viewport.height, pageSize.height);

  switch (mode) {
    case ZOOM_MODES.FIT_WIDTH:
      return clampScale(widthScale ?? DEFAULT_ZOOM_PREFERENCES.manualScale);
    case ZOOM_MODES.FIT_HEIGHT:
      return clampScale(heightScale ?? DEFAULT_ZOOM_PREFERENCES.manualScale);
    case ZOOM_MODES.FIT_PAGE:
    default: {
      if (widthScale === null && heightScale === null) {
        return DEFAULT_ZOOM_PREFERENCES.manualScale;
      }
      if (widthScale === null) {
        return clampScale(heightScale);
      }
      if (heightScale === null) {
        return clampScale(widthScale);
      }
      return clampScale(Math.min(widthScale, heightScale));
    }
  }
};

export function createZoomController({
  initialMode,
  initialManualScale,
  getContainer,
  getViewportSize,
  getPageSize,
  getCurrentScale,
  setScale,
  onModeChange,
  onManualScaleChange,
  persistPreferences
} = {}) {
  let mode = isValidMode(initialMode) ? initialMode : DEFAULT_ZOOM_PREFERENCES.mode;
  let manualScale = clampScale(typeof initialManualScale === 'number' ? initialManualScale : DEFAULT_ZOOM_PREFERENCES.manualScale);

  const notifyModeChange = (nextMode, context) => {
    if (typeof onModeChange === 'function') {
      onModeChange(nextMode, context);
    }
  };

  const notifyManualScaleChange = (nextScale, context) => {
    if (typeof onManualScaleChange === 'function') {
      onManualScaleChange(nextScale, context);
    }
  };

  const persist = (overrides = {}) => {
    if (typeof persistPreferences === 'function') {
      persistPreferences({
        mode,
        manualScale,
        ...overrides
      });
    }
  };

  const applyScale = (nextScale, context = {}) => {
    if (typeof setScale === 'function') {
      setScale(nextScale, context);
    }
    return nextScale;
  };

  const controller = {
    getMode: () => mode,
    getManualScale: () => manualScale,
    getScale: () => (typeof getCurrentScale === 'function' ? getCurrentScale() : manualScale),

    setMode: (nextMode, context = {}) => {
      if (!isValidMode(nextMode)) {
        return controller.getScale();
      }

      const modeChanged = nextMode !== mode;
      mode = nextMode;

      if (mode === ZOOM_MODES.MANUAL && typeof context.scale === 'number') {
        const nextScale = clampScale(context.scale);
        if (Math.abs(nextScale - manualScale) > SCALE_EPSILON) {
          manualScale = nextScale;
          notifyManualScaleChange(manualScale, context);
        }
      }

      if (modeChanged) {
        notifyModeChange(mode, context);
      }

      if (context.persist !== false) {
        persist();
      }

      if (context.skipApply) {
        return controller.getScale();
      }

      return controller.applyZoom(context);
    },

    setScale: (nextScale, context = {}) => {
      const safeScale = clampScale(nextScale);
      const modeChanged = mode !== ZOOM_MODES.MANUAL;
      const scaleChanged = Math.abs(manualScale - safeScale) > SCALE_EPSILON;

      manualScale = safeScale;
      mode = ZOOM_MODES.MANUAL;

      if (scaleChanged) {
        notifyManualScaleChange(manualScale, context);
      }
      if (modeChanged) {
        notifyModeChange(mode, context);
      }

      if (context.persist !== false) {
        persist();
      }

      return applyScale(manualScale, context);
    },

    applyZoom: (context = {}) => {
      if (context.mode && isValidMode(context.mode)) {
        controller.setMode(context.mode, { ...context, skipApply: true });
      }

      let targetScale = manualScale;

      if (mode !== ZOOM_MODES.MANUAL) {
        const viewport = typeof getViewportSize === 'function'
          ? getViewportSize(getContainer?.())
          : null;
        const pageSize = typeof getPageSize === 'function' ? getPageSize() : null;
        targetScale = computeScaleForMode(mode, viewport, pageSize);
      } else if (typeof context.scale === 'number') {
        const safeManual = clampScale(context.scale);
        if (Math.abs(safeManual - manualScale) > SCALE_EPSILON) {
          manualScale = safeManual;
          notifyManualScaleChange(manualScale, context);
        }
        targetScale = manualScale;
      }

      if (context.persist !== false) {
        persist();
      }

      return applyScale(targetScale, context);
    }
  };

  return controller;
}

