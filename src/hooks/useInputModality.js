import { useSyncExternalStore } from 'react';
import {
  detectInitialInputModality,
  getInputModality,
  subscribeInputModality,
} from '../utils/inputModality.js';

/**
 * The input the user is using right now: 'mouse' | 'pen' | 'touch'
 * (last press, or a hovering mouse / pen; see utils/inputModality.js).
 * Re-renders only when it changes. Before any press it follows the primary
 * pointer media, exactly like useCoarsePointer.
 */
export default function useInputModality() {
  return useSyncExternalStore(subscribeInputModality, getInputModality, () => detectInitialInputModality());
}
