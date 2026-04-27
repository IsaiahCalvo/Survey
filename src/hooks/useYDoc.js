// src/hooks/useYDoc.js
// Phase 27 — React hook exposing the active Y.Doc + lifecycle state to consumers.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Pattern 1 (locked interface).
//
// UX: returns a frozen null shape when called outside <YDocProvider> (or before docId
// becomes truthy). Components calling useYDoc() unconditionally render gracefully
// without binding to Y.Doc events or showing the banner.

import { useContext } from 'react';
import { YDocContext } from '../components/collab/YDocProvider.jsx';

const NULL_VALUE = Object.freeze({
  ydoc: null,
  isHydrating: false,
  storageState: null,
  role: 'unknown',
  isCRDTEnabled: false,
  dismissBanner: () => {},
});

/**
 * Read the active Y.Doc context.
 *
 * @returns {{
 *   ydoc: import('yjs').Doc | null,
 *   isHydrating: boolean,
 *   storageState: { code: string, role?: string, error?: Error } | null,
 *   role: 'leader' | 'loser' | 'unknown',
 *   isCRDTEnabled: boolean,
 *   dismissBanner: () => void,
 * }}
 */
export function useYDoc() {
  const ctx = useContext(YDocContext);
  return ctx ?? NULL_VALUE;
}

export default useYDoc;
