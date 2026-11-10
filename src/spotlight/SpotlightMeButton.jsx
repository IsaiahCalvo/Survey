// "Spotlight me" in the people list (desktop footer list, phone Active users
// sheet), Nightly flag 'spotlight'. Drawboard puts it on your own avatar; one
// press starts it, no confirm. Pressed again it stops.
import { useState } from 'react';
import { isFeatureOn } from '../featureFlags.js';
import { startPresenting, stopPresenting } from '../services/annotationSpotlight.js';
import useSpotlight from './useSpotlight.js';
import './spotlight.css';

export default function SpotlightMeButton({ phone = false, onDone }) {
  const [on] = useState(() => isFeatureOn('spotlight'));
  const spotlight = useSpotlight();
  if (!on || !spotlight.documentId) return null;
  const presenting = spotlight.presenting;
  return (
    <button
      type="button"
      className={`spotlight-me${phone ? ' is-phone' : ''}${presenting ? ' is-on' : ''}`}
      data-spotlight-me={presenting ? 'on' : 'off'}
      aria-pressed={presenting}
      onClick={() => {
        if (presenting) stopPresenting();
        else startPresenting();
        onDone?.();
      }}
    >
      <span className="spotlight-me__dot" aria-hidden="true" />
      {presenting ? 'Stop spotlight' : 'Spotlight me'}
    </button>
  );
}
