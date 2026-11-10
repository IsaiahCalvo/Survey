// The spotlight's state for a view (annotationSpotlight.js has the rules).
import { useSyncExternalStore } from 'react';
import { getSpotlightSnapshot, subscribeSpotlight } from '../services/annotationSpotlight.js';

export default function useSpotlight() {
  return useSyncExternalStore(subscribeSpotlight, getSpotlightSnapshot, getSpotlightSnapshot);
}
