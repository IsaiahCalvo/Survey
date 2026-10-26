import { useCallback, useEffect, useState } from 'react';
import { isFeatureOn } from '../featureFlags';
import { readPolylineCurve, subscribeAnnotationPreferences, writePolylineCurve } from '../utils/annotationPreferences';

/**
 * Polyline "Curve" switch (Nightly, flag 'spline-polyline'). Returns
 * { available, on, set }: `on` is false whenever the flag is off, so a
 * stable build always draws straight polylines.
 */
export function usePolylineCurve() {
  const available = isFeatureOn('spline-polyline');
  const [pref, setPref] = useState(() => readPolylineCurve());
  useEffect(() => subscribeAnnotationPreferences(() => setPref(readPolylineCurve())), []);
  const set = useCallback((value) => setPref(writePolylineCurve(value)), []);
  return { available, on: available && pref, set };
}
