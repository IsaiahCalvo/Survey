// src/hooks/useYDoc.js
// Phase 27 — React hook exposing the active Y.Doc + lifecycle state to consumers.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Pattern 1 (locked interface).
//
// UX: returns a frozen null shape when called outside <YDocProvider> (or before docId
// becomes truthy). Components calling useYDoc() unconditionally render gracefully
// without binding to Y.Doc events or showing the banner.

import { useContext } from 'react';
import { YDocContext } from '../components/collab/YDocContext.js';

const NULL_VALUE = Object.freeze({
  ydoc: null,
  isHydrating: false,
  storageState: null,
  role: 'unknown',
  isCRDTEnabled: false,
  localCloseRequired: false,
  localCloseSession: null,
  dismissBanner: () => {},
  // Phase 28 fields (kept on the null shape so callers can safely destructure
  // without branching on "is the provider mounted").
  accessRevoked: false,
  // 2026-07-01 — effective document role ('owner'|'editor'|'viewer'|null).
  // null on the null shape = fail open (read-write presentation).
  docRole: null,
  transportState: 'connecting',
  isDocShared: null,
  loginExpired: false,
  // Phase 29 additions — undoManager / undoCtx are null until YDocProvider's
  // per-user UndoManager mount effect resolves. Plan 29-04's App.jsx Cmd+Z
  // handler short-circuits when either is null (no-op on empty/uninitialized
  // state matches UI-SPEC empty-stack-silent contract).
  undoManager: null,
  undoCtx: null,
  // KAL-274 — typed awareness accessor (null shape: no provider, no awareness).
  getAwareness: () => null,
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
 *   accessRevoked: boolean,
 *   docRole: 'owner' | 'editor' | 'viewer' | null,
 *   transportState: 'connecting' | 'connected' | 'offline' | string,
 *   isDocShared: boolean | null,
 *   loginExpired: boolean,
 *   undoManager: import('yjs').UndoManager | null,
 *   undoCtx: { userId: string, deviceId: string, sessionId: string, clientID: number } | null,
 *   getAwareness: () => import('y-protocols/awareness').Awareness | null,
 * }}
 */
export function useYDoc() {
  const ctx = useContext(YDocContext);
  return ctx ?? NULL_VALUE;
}
