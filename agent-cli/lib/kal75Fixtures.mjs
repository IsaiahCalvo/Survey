// agent-cli/lib/kal75Fixtures.mjs — deterministic fixtures for the KAL-75
// lock-document e2e (PLAN-KAL75-LOCK-E2E.md).
//
// Four documents:
//   DOC_OWNED   — owned (user_id null → stamped), unlocked, 3 mutually
//                 OVERLAPPING fabric rects on page 1 (z-order hotkeys only act
//                 on overlapping neighbors — non-overlap would make the bracket
//                 gates vacuous; overlap also feeds the delete/drag/resize
//                 differentials).
//   DOC_PROJ    — owned, unlocked, inside PROJ_ID (Projects-page parity + the
//                 lock-prompt cancel probe).
//   DOC_FOREIGN — owned by FOREIGN_UUID (explicit, never stamped), LOCKED, and
//                 reaches the signed-in user's ledger via a document_collaborators
//                 row (the collaborator probe merge in useDatabase) — the
//                 headless non-owner scenario.
//   DOC_DEL     — owned, unlocked, sacrificial target for the delete-safety case.
//
// Lock/unlock RPC handlers mirror the KAL-49 migration SQL exactly
// (20260522000000_kal49_document_lock_state.sql):
//   lock:   owner-only (42501 otherwise); locked_at = COALESCE(existing, now);
//           locked_by = COALESCE(existing, caller); locked_label overwritten
//           only when the label argument is non-null. Returns the full row.
//   unlock: owner-only; nulls all three. Returns the full row.

import * as Y from 'yjs';
import { syncByPageToDoc } from '../../src/services/annotationDocStore.js';

function bytesToPgHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

export const DOC_OWNED_ID = '7a75e000-0000-4000-8000-00000000a0a0';
export const DOC_PROJ_ID = '7a75e000-0000-4000-8000-00000000b0b0';
export const DOC_FOREIGN_ID = '7a75e000-0000-4000-8000-00000000c0c0';
export const DOC_DEL_ID = '7a75e000-0000-4000-8000-00000000d0d0';
export const PROJ_ID = '7a75e000-0000-4000-8000-00000000ee75';
export const FOREIGN_UUID = '7a75ffff-0000-4000-8000-0000000000ff';

export const DOC_OWNED_NAME = 'KAL75 Owned.pdf';
export const DOC_PROJ_NAME = 'KAL75 In Project.pdf';
export const DOC_FOREIGN_NAME = 'KAL75 Foreign Locked.pdf';
export const DOC_DEL_NAME = 'KAL75 Sacrificial.pdf';
export const PROJ_NAME = 'KAL75 Project';
export const FOREIGN_LOCK_LABEL = 'Sealed v1';
export const FOREIGN_LOCKED_AT = '2026-06-05T12:00:00.000Z';

const NOW = '2026-06-01T00:00:00.000Z';

// Three mutually overlapping rects: a 3-step diagonal cascade where each rect
// overlaps the next (and 1 overlaps 3 a little), so Cmd+]/Cmd+[ always has an
// overlapping neighbor to swap with.
function overlappingRect(id, i) {
  return {
    type: 'rect',
    left: 120 + i * 50,
    top: 120 + i * 40,
    width: 140,
    height: 100,
    fill: 'transparent',
    stroke: ['#cc3333', '#33cc33', '#3333cc'][i % 3],
    strokeWidth: 2,
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    id,
    data: { id },
  };
}

function buildWalHex(rectCount) {
  const doc = new Y.Doc();
  const byPage = { 1: { objects: [] } };
  for (let i = 0; i < rectCount; i += 1) {
    byPage[1].objects.push(overlappingRect(`kal75-fab-${String(i + 1).padStart(2, '0')}`, i));
  }
  syncByPageToDoc(doc, byPage, { origin: 'seed' });
  return bytesToPgHex(Y.encodeStateAsUpdate(doc));
}

function documentRow(id, name, { userId = null, projectId = null, locked = false } = {}) {
  return {
    id,
    name,
    user_id: userId, // null → stamped with the real signed-in user by the mock
    project_id: projectId,
    archived: false,
    file_path: `kal75/${id}.pdf`,
    file_size: 102400,
    page_count: 1,
    created_at: NOW,
    updated_at: NOW,
    last_opened_at: null,
    locked_at: locked ? FOREIGN_LOCKED_AT : null,
    locked_by: locked ? FOREIGN_UUID : null,
    locked_label: locked ? FOREIGN_LOCK_LABEL : null,
    tool_preferences: null,
    annotations_changed_at: null,
    cutover_completed_at: null,
    embedded_import_completed_at: NOW, // embedded import must NOT run (KAL-92 lesson)
    content_sha256: null,
  };
}

export function buildFixtures() {
  const docOwned = {
    row: documentRow(DOC_OWNED_ID, DOC_OWNED_NAME),
    walRows: [{ document_id: DOC_OWNED_ID, seq: 1, data: buildWalHex(3) }],
    annotationRows: [],
  };
  const docProj = {
    row: documentRow(DOC_PROJ_ID, DOC_PROJ_NAME, { projectId: PROJ_ID }),
    walRows: [],
    annotationRows: [],
  };
  const docForeign = {
    row: documentRow(DOC_FOREIGN_ID, DOC_FOREIGN_NAME, { userId: FOREIGN_UUID, locked: true }),
    walRows: [],
    annotationRows: [],
  };
  const docDel = {
    row: documentRow(DOC_DEL_ID, DOC_DEL_NAME),
    walRows: [],
    annotationRows: [],
  };

  return {
    documents: [docOwned.row, docProj.row, docForeign.row, docDel.row],
    projects: [{ id: PROJ_ID, user_id: null, name: PROJ_NAME, created_at: NOW, updated_at: NOW }],
    templates: [],
    documentCollaborators: [{
      id: 'kal75-collab-0001',
      document_id: DOC_FOREIGN_ID,
      user_id: null, // stamped → the signed-in user is an active collaborator
      status: 'active',
      role: 'editor',
      created_at: NOW,
    }],
    docsById: {
      [DOC_OWNED_ID]: docOwned,
      [DOC_PROJ_ID]: docProj,
      [DOC_FOREIGN_ID]: docForeign,
      [DOC_DEL_ID]: docDel,
    },
  };
}

// --- KAL-49 lock RPC handlers (semantics mirror the migration SQL) -----------
export function buildLockRpcHandlers(fixtures) {
  const findDoc = (docId) => fixtures.documents.find((d) => d.id === docId);
  const notOwner = () => ({
    status: 403,
    json: { code: '42501', message: 'Only the document owner can change its lock state', details: null, hint: null },
  });
  const notFound = () => ({
    status: 404,
    json: { code: 'PGRST116', message: 'document not found', details: null, hint: null },
  });

  return {
    kal49_lock_document: (body, ctx) => {
      const row = findDoc(body?.doc_id);
      if (!row) return notFound();
      if (row.user_id !== ctx.sniffedUserId) return notOwner();
      const label = body?.label ?? null;
      row.locked_at = row.locked_at ?? new Date().toISOString();
      row.locked_by = row.locked_by ?? ctx.sniffedUserId;
      if (label !== null) row.locked_label = label;
      return { status: 200, json: { ...row } };
    },
    kal49_unlock_document: (body, ctx) => {
      const row = findDoc(body?.doc_id);
      if (!row) return notFound();
      if (row.user_id !== ctx.sniffedUserId) return notOwner();
      row.locked_at = null;
      row.locked_by = null;
      row.locked_label = null;
      return { status: 200, json: { ...row } };
    },
  };
}
