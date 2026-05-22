// KAL-48 — Revisions panel (v1).
//
// Minimum-viable UI for first-class document revisions. Mounts as a sibling of
// <PDFViewer> inside the YDocProvider tree so App.jsx stays nearly diff-free.
// Renders its own floating launcher button + drawer; no other component needs
// to know about it.
//
// Behaviour:
//   - "Revisions (N)" launcher at viewport bottom-right while a document is
//     open. Clicking opens the drawer.
//   - Drawer lists revisions newest-first. Each row shows:
//       v<N> · <label> · <yyyy-mm-dd hh:mm> · <annotation count>
//     and three actions: "Open read-only", "Restore" (owner-only), "Copy id".
//   - Bottom of drawer: "Save as Revision" button (owner-only). Prompts for an
//     optional label using window.prompt — fine for v1; a styled modal can
//     come later.
//   - "Open read-only" sets body[data-readonly="true"] (same mechanism as
//     ReadOnlyGate, so the existing toolbar dim CSS applies) and shows a
//     banner along the top of the viewport: "Viewing revision N (created ...).
//     Return to current."
//
// Ownership check is done with a single supabase select against
// `documents.user_id` — matches the helper logic and avoids touching
// useYDoc state.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  createRevision,
  listRevisions,
  getRevision,
  restoreRevision,
} from '../../services/documentRevisionService';

const DRAWER_WIDTH = 360;

function originBadge(origin) {
  if (origin === 'auto-pre-restore') {
    return { label: 'auto', color: '#8a8a8a' };
  }
  if (origin === 'sign-off') {
    return { label: 'sign-off', color: '#7ea8ff' };
  }
  return { label: 'manual', color: '#5fbf7f' };
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

export default function RevisionsPanel({ documentId, user }) {
  const [open, setOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [viewingRevision, setViewingRevision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  // Resolve ownership once per (documentId, user) — matches the open-coded
  // owner check in _kal48_can_access: project owner OR document creator.
  useEffect(() => {
    let cancelled = false;
    setIsOwner(false);
    if (!documentId || !user?.id) return;
    (async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('user_id, project_id, projects!documents_project_id_fkey(user_id)')
        .eq('id', documentId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setIsOwner(false);
        return;
      }
      const creatorOwner = data.user_id === user.id && !data.project_id;
      const projectOwner = data?.projects?.user_id === user.id;
      setIsOwner(Boolean(creatorOwner || projectOwner || data.user_id === user.id));
    })();
    return () => { cancelled = true; };
  }, [documentId, user?.id]);

  // Load list when drawer opens, or after a mutation.
  const refresh = useCallback(async () => {
    if (!documentId) { setRevisions([]); return; }
    setLoading(true);
    setErr(null);
    try {
      const rows = await listRevisions(documentId);
      setRevisions(rows);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // body[data-readonly] mirroring — set when viewing a prior revision.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (viewingRevision) {
      document.body?.setAttribute('data-readonly', 'true');
      return () => document.body?.removeAttribute('data-readonly');
    }
    return undefined;
  }, [viewingRevision]);

  const handleSave = useCallback(async () => {
    if (!documentId || busy) return;
    const label = window.prompt('Label for this revision (optional):', '');
    if (label === null) return; // user cancelled
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await createRevision(documentId, { label: label || null });
      setStatusMsg(`Saved revision v${row.revision_number}.`);
      await refresh();
    } catch (e) {
      setStatusMsg(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [documentId, refresh, busy]);

  const handleOpenReadOnly = useCallback(async (rev) => {
    if (busy) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const full = await getRevision(rev.id);
      setViewingRevision({
        ...rev,
        snapshot: full?.snapshot_json || null,
      });
    } catch (e) {
      setStatusMsg(`Open failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleReturnToCurrent = useCallback(() => {
    setViewingRevision(null);
  }, []);

  const handleRestore = useCallback(async (rev) => {
    if (busy) return;
    const ok = window.confirm(
      `Restore v${rev.revisionNumber}? The current state will be saved as an auto revision first, then overwritten by this snapshot.`,
    );
    if (!ok) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const pre = await restoreRevision(rev.id);
      setStatusMsg(
        `Restored v${rev.revisionNumber}. Previous state saved as v${pre.revision_number}.`,
      );
      setViewingRevision(null);
      await refresh();
    } catch (e) {
      setStatusMsg(`Restore failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  if (!documentId) return null;

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        data-testid="kal48-revisions-launcher"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          right: 14,
          bottom: 80,
          zIndex: 9000,
          background: '#2d2d2d',
          color: '#e9e6df',
          border: '1px solid #444',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}
        title="Document revisions (KAL-48)"
      >
        Revisions{revisions.length ? ` (${revisions.length})` : ''}
      </button>

      {/* Banner — visible while viewing a prior revision */}
      {viewingRevision && (
        <div
          data-testid="kal48-readonly-banner"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            background: '#5e4a1f',
            color: '#fff8dd',
            padding: '8px 16px',
            zIndex: 9100,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #7e6630',
          }}
        >
          <span>
            Viewing revision v{viewingRevision.revisionNumber}
            {viewingRevision.label ? ` — ${viewingRevision.label}` : ''} · created {formatDate(viewingRevision.createdAt)} · {viewingRevision.snapshot?.annotations?.length ?? viewingRevision.annotationCount} annotation(s). Edits disabled.
          </span>
          <button
            type="button"
            data-testid="kal48-return-to-current"
            onClick={handleReturnToCurrent}
            style={{
              background: 'transparent',
              color: '#fff8dd',
              border: '1px solid #fff8dd',
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Return to current
          </button>
        </div>
      )}

      {/* Drawer */}
      {open && (
        <div
          data-testid="kal48-revisions-panel"
          style={{
            position: 'fixed',
            right: 0,
            top: 0,
            bottom: 0,
            width: DRAWER_WIDTH,
            background: '#1a1a1a',
            color: '#e9e6df',
            zIndex: 9050,
            boxShadow: '-4px 0 16px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid #333',
          }}
        >
          <div
            style={{
              padding: 14,
              borderBottom: '1px solid #333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <strong style={{ fontSize: 14 }}>Revisions</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: 'transparent',
                color: '#bbb',
                border: '1px solid #444',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
              }}
              aria-label="Close revisions panel"
            >
              ×
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {loading && <div style={{ padding: 10, fontSize: 12, color: '#999' }}>Loading…</div>}
            {err && <div style={{ padding: 10, color: '#ff8a8a', fontSize: 12 }}>Error: {err}</div>}
            {!loading && !err && revisions.length === 0 && (
              <div style={{ padding: 10, color: '#999', fontSize: 12 }}>
                No revisions yet. Save your first revision below to capture the current state.
              </div>
            )}
            {revisions.map((rev) => {
              const badge = originBadge(rev.origin);
              return (
                <div
                  key={rev.id}
                  data-testid={`kal48-revision-row-${rev.revisionNumber}`}
                  style={{
                    padding: 10,
                    marginBottom: 6,
                    borderRadius: 6,
                    border: '1px solid #333',
                    background: '#222',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>v{rev.revisionNumber}</span>
                    <span
                      style={{
                        fontSize: 10,
                        background: badge.color,
                        color: '#111',
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontWeight: 600,
                      }}
                    >
                      {badge.label}
                    </span>
                    {rev.label && <span style={{ fontSize: 12, color: '#cfcfcf' }}>{rev.label}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                    {formatDate(rev.createdAt)} · {rev.annotationCount} annotation(s)
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      data-testid={`kal48-open-v${rev.revisionNumber}`}
                      onClick={() => handleOpenReadOnly(rev)}
                      disabled={busy}
                      style={{
                        fontSize: 11,
                        background: '#2d2d2d',
                        color: '#e9e6df',
                        border: '1px solid #444',
                        borderRadius: 4,
                        padding: '3px 8px',
                        cursor: busy ? 'wait' : 'pointer',
                      }}
                    >
                      Open read-only
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        data-testid={`kal48-restore-v${rev.revisionNumber}`}
                        onClick={() => handleRestore(rev)}
                        disabled={busy}
                        style={{
                          fontSize: 11,
                          background: '#3a2e2e',
                          color: '#ffdada',
                          border: '1px solid #6e3e3e',
                          borderRadius: 4,
                          padding: '3px 8px',
                          cursor: busy ? 'wait' : 'pointer',
                        }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: '1px solid #333', padding: 10 }}>
            {statusMsg && (
              <div data-testid="kal48-status" style={{ fontSize: 11, color: '#9ec', marginBottom: 6 }}>
                {statusMsg}
              </div>
            )}
            {isOwner && (
              <button
                type="button"
                data-testid="kal48-save-revision"
                onClick={handleSave}
                disabled={busy}
                style={{
                  width: '100%',
                  background: '#3c5a3c',
                  color: '#e9f5e9',
                  border: '1px solid #4e7e4e',
                  borderRadius: 4,
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                Save as Revision
              </button>
            )}
            {!isOwner && (
              <div style={{ fontSize: 11, color: '#888' }}>
                Only the document owner can save or restore revisions.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
