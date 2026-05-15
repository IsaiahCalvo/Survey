/* Survey Hub — Projects tab.
   Folder-tree layout: a left list of every project, and a right panel showing
   the open project's files plus a roster. Ported from the Claude Design
   prototype (survey-hub/projects-new.jsx), wired to the real shapes:
     project  — { id, name, user_id, created_at }
     document — { id, name, project_id, file_size, created_at, updated_at }

   Note on the roster: the app does not store project members today, so the
   roster panel shows the owner and an empty-state hint rather than inventing
   data. "Manage Team" opens the share popup.
*/
import React, { useState, useMemo, useEffect } from 'react';
import { Icon, Avatar } from './HubShell';

const editedMs = (d) => Date.parse(d?.updated_at || d?.created_at || 0) || 0;
const shortWhen = (d) => {
  const ms = editedMs(d);
  if (!ms) return '—';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1d';
  if (days < 30) return days + 'd';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function ProjectsFolderTree({
  projects = [],
  documents = [],
  search = '',
  user = null,
  onOpenDocument,
  onShare,            // (project) => void — opens the share popup
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => !q || (p.name || '').toLowerCase().includes(q));
  }, [projects, search]);

  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    if (filtered.length && !filtered.some((p) => p.id === openId)) setOpenId(filtered[0].id);
  }, [filtered, openId]);

  const open = filtered.find((p) => p.id === openId) || filtered[0] || null;
  const filesFor = (projId) => documents.filter((d) => d.project_id === projId);

  if (!projects.length) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-200)', fontSize: 13 }}>
        No projects yet — create one to group your documents.
      </div>
    );
  }

  const ownerInitials = (user?.name || user?.email || 'You').slice(0, 2).toUpperCase();
  const ownerName = user?.name || user?.email?.split('@')[0] || 'You';
  const openFiles = open ? filesFor(open.id) : [];

  return (
    <div style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8 }}>
      {/* LEFT — project list */}
      <div className="card" style={{ padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', paddingRight: 4 }}>
          {filtered.map((p) => {
            const isOpen = open && p.id === open.id;
            const count = filesFor(p.id).length;
            return (
              <div
                key={p.id}
                onClick={() => setOpenId(p.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center',
                  padding: '8px 10px', borderRadius: 6, height: 50, boxSizing: 'border-box',
                  background: isOpen ? 'var(--ink-600)' : 'transparent',
                  borderLeft: isOpen ? '2px solid var(--gold)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</div>
                  <div className="meta" style={{ fontSize: 10, marginTop: 3 }}>{count} {count === 1 ? 'file' : 'files'}</div>
                </div>
                <Icon name="folder" size={14} color={isOpen ? 'var(--gold)' : 'var(--ink-200)'} />
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT — open project */}
      <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {open && (
          <>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-500)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 4, height: 36, background: 'var(--gold)', borderRadius: 2, flex: 'none' }}></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{open.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                <button className="btn" title="Share project" onClick={() => onShare && onShare(open)}>
                  <Icon name="users" size={12} />Manage Team
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 168px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Files */}
              <div className="slim-scroll" style={{ padding: '10px 14px', overflow: 'auto' }}>
                <div className="section-label" style={{ marginBottom: 6 }}>Files</div>
                {openFiles.length === 0 ? (
                  <div className="meta" style={{ fontSize: 11.5, padding: '12px 2px' }}>No files in this project yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 1 }}>
                    {openFiles.map((f, i) => (
                      <div
                        key={f.id}
                        onClick={() => onOpenDocument && onOpenDocument(f)}
                        style={{
                          background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)',
                          borderRadius: 6, display: 'grid', gridTemplateColumns: '16px 1fr 70px',
                          gap: 12, alignItems: 'center', padding: '8px 10px', fontSize: 12,
                          height: 36, boxSizing: 'border-box', cursor: 'pointer',
                        }}
                      >
                        <Icon name="doc" size={12} color="var(--ink-200)" />
                        <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                        <span className="mono meta" style={{ fontSize: 11, textAlign: 'right' }}>{shortWhen(f)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Roster */}
              <div className="slim-scroll" style={{ borderLeft: '1px solid var(--ink-500)', padding: '12px 12px', background: 'var(--ink-800)', overflow: 'auto' }}>
                <div className="section-label" style={{ marginBottom: 10 }}>Roster</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar initials={ownerInitials} size={22} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownerName}</div>
                    <div className="meta" style={{ fontSize: 10 }}>Owner</div>
                  </div>
                </div>
                <div className="meta" style={{ fontSize: 10.5, marginTop: 12, lineHeight: 1.5 }}>
                  No teammates yet. Use Manage Team to invite people.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
