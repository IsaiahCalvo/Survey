/* Survey Hub — Projects tab.
   Faithful port of the Claude Design prototype (survey-hub/projects-new.jsx,
   Projects_FolderTree): a Finder-style tree — a left list of every project,
   a right panel showing the open project's files plus a roster.

   The markup, styling, spacing, columns, select-mode toolbars and per-row
   menus mirror the mockup element for element. Only the data is swapped.

   Teammate data: the hub feeds a `members` directory of
   { id, name, role, color, online }. Each project carries members:[memberId]
   and each document carries owner:memberId — so the left avatar stacks, the
   roster panel and the "Last edited by" column render the true prototype
   behavior. All fall back gracefully when member data is absent.
*/
import React, { useState, useMemo, useEffect } from 'react';
import { HubShell, Icon, Avatar, AvatarStack, Search } from './HubShell';

const editedMs = (d) => Date.parse(d?.updated_at || d?.created_at || 0) || 0;
const shortWhen = (d) => {
  const ms = editedMs(d);
  if (!ms) return '—';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 30) return days + 'd ago';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function ProjectsFolderTree({
  projects = [],
  documents = [],
  members = [],
  user = null,
  templatesLocked = false,
  onNav,
  onOpenDocument,
  onCreateProject,
  onShare,
}) {
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(projects[0]?.id ?? null);
  const [menuFor, setMenuFor] = useState(null);
  const [teamMenu, setTeamMenu] = useState(null);
  const [jobsEdit, setJobsEdit] = useState(false);
  const [selProj, setSelProj] = useState(() => new Set());
  const [fileSelect, setFileSelect] = useState(false);
  const [selFiles, setSelFiles] = useState(() => new Set());

  const toggleFileSel = (i) => setSelFiles((prev) => {
    const n = new Set(prev);
    n.has(i) ? n.delete(i) : n.add(i);
    return n;
  });
  const toggleProjSel = (id) => setSelProj((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selCount = selProj.size;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => !q || (p.name || '').toLowerCase().includes(q));
  }, [projects, search]);

  useEffect(() => {
    if (filtered.length && !filtered.some((p) => p.id === openId)) setOpenId(filtered[0].id);
  }, [filtered, openId]);

  const open = filtered.find((p) => p.id === openId) || filtered[0] || null;
  const filesFor = (projId) => documents.filter((d) => d.project_id === projId);
  const openFiles = open ? filesFor(open.id) : [];

  // Member directory lookup — resolves a memberId to its { name, role, color,
  // online } record so avatars/roster render the prototype's true behavior.
  const memberById = useMemo(() => {
    const map = new Map();
    members.forEach((m) => { if (m && m.id != null) map.set(m.id, m); });
    return map;
  }, [members]);
  const lookupMember = (id) => memberById.get(id) || null;

  const subtitle = (
    <span><b>{filtered.length}</b> projects · expand any to see its files and roster</span>
  );
  const actions = <Search placeholder="Search Projects..." value={search} onChange={setSearch} />;

  return (
    <HubShell
      tab="projects"
      onNav={onNav}
      title="Projects"
      subtitle={subtitle}
      actions={actions}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div style={{ padding: '0 8px 8px 8px', display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, flex: 1, minHeight: 0 }}>
        {/* LEFT — tree */}
        <div className="card" style={{ padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="btn primary"
              style={{ padding: '4px 8px', fontSize: 11, gap: 4, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}
              onClick={() => onCreateProject && onCreateProject()}
            >
              <Icon name="plus" size={11} />New Project
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'nowrap', height: 22, overflow: 'hidden' }}>
              <button
                onClick={() => { const next = !jobsEdit; setJobsEdit(next); if (!next) setSelProj(new Set()); }}
                style={{ background: 'transparent', border: 0, color: 'var(--gold)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1 }}
              >
                {jobsEdit ? 'Done' : 'Select'}
              </button>
              {jobsEdit && (
                <>
                  {(() => {
                    const allSel = selCount === filtered.length && filtered.length > 0;
                    return (
                      <button
                        onClick={() => setSelProj(allSel ? new Set() : new Set(filtered.map((p) => p.id)))}
                        style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: 'var(--bone-100)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >{allSel ? 'None' : 'All'}</button>
                    );
                  })()}
                  <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: selCount ? 'var(--bone-100)' : 'var(--ink-300)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Duplicate</button>
                  <button
                    disabled={!selCount}
                    onClick={() => { const first = filtered.find((p) => selProj.has(p.id)); if (first) onShare && onShare(first); }}
                    style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: selCount ? 'var(--bone-100)' : 'var(--ink-300)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                    title="Share"
                  ><Icon name="share" size={11} /></button>
                  <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: selCount ? '#cf6f6f' : 'var(--ink-300)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={11} /></button>
                </>
              )}
            </div>
          </div>
          <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', paddingRight: 4 }}>
            {filtered.length === 0 && (
              <div className="meta" style={{ fontSize: 11.5, padding: '14px 8px' }}>
                {projects.length === 0 ? 'No projects yet — create one to group your documents.' : 'No projects match your search.'}
              </div>
            )}
            {filtered.map((p) => {
              const isOpen = open && p.id === open.id;
              const isSel = selProj.has(p.id);
              const projMembers = Array.isArray(p.members) ? p.members : [];
              return (
                <div key={p.id} style={{ position: 'relative' }} draggable={jobsEdit}>
                  <div
                    onClick={() => { if (jobsEdit) toggleProjSel(p.id); else setOpenId(p.id); }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '14px 1fr auto',
                      gap: 8, alignItems: 'center',
                      padding: '8px 8px', borderRadius: 6,
                      background: jobsEdit ? (isSel ? 'var(--ink-600)' : 'transparent') : (isOpen ? 'var(--ink-600)' : 'transparent'),
                      cursor: 'pointer',
                      borderLeft: !jobsEdit && isOpen ? '2px solid var(--gold)' : '2px solid transparent',
                      height: 50, boxSizing: 'border-box',
                    }}
                  >
                    {/* Drag handle — drag-to-reorder is a visual affordance only;
                        the prototype shows it in both modes. */}
                    {jobsEdit ? (
                      <span title="Drag to reorder" style={{ color: 'var(--ink-200)', fontSize: 11, cursor: 'grab', userSelect: 'none', lineHeight: 1, textAlign: 'center' }}>⋮⋮</span>
                    ) : (
                      <span style={{ color: 'var(--ink-200)', fontSize: 11, userSelect: 'none', lineHeight: 1, textAlign: 'center' }}>⋮⋮</span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</div>
                      {/* Member-avatar stack (first 3) + member count — the
                          prototype's true behavior; empty stack if no members. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <AvatarStack members={projMembers.slice(0, 3)} size={14} />
                        <span className="mono meta" style={{ fontSize: 9.5 }}>{projMembers.length}</span>
                      </div>
                    </div>
                    {jobsEdit ? (
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleProjSel(p.id); }}
                        style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--gold)' : 'var(--ink-300)'}`, background: isSel ? 'var(--gold)' : 'transparent', borderRadius: 2, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                      >
                        {isSel && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setTeamMenu(teamMenu === p.id ? null : p.id); }}
                        style={{ background: 'transparent', border: 0, color: 'var(--ink-200)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
                        title="More"
                      >⋯</button>
                    )}
                  </div>
                  {teamMenu === p.id && (
                    <div
                      onMouseLeave={() => setTeamMenu(null)}
                      style={{
                        position: 'absolute', right: 4, top: 32, zIndex: 20,
                        background: 'var(--ink-700)', border: '1px solid var(--ink-500)', borderRadius: 8,
                        padding: 4, minWidth: 170, boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
                      }}
                    >
                      {[
                        ['users', 'Add member'],
                        ['arrow-r', 'Get link to team'],
                        ['upload', 'Upload files'],
                        ['pin', 'Pin team'],
                        ['more', 'Manage team'],
                      ].map(([ic, label]) => (
                        <button
                          key={label}
                          onClick={() => {
                            setTeamMenu(null);
                            // Member/team actions route to the share flow — the
                            // only project-team surface the app exposes today.
                            if (label === 'Add member' || label === 'Manage team' || label === 'Get link to team') {
                              onShare && onShare(p);
                            }
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                            background: 'transparent', border: 0, color: 'var(--bone-100)',
                            padding: '7px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          <Icon name={ic} size={12} color="var(--ink-200)" />{label}
                        </button>
                      ))}
                    </div>
                  )}
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
                  {/* Inline rename field — renaming is not wired to a backend
                      action yet, so this is a visual affordance only. */}
                  <input
                    key={open.id}
                    defaultValue={open.name}
                    title="Click to rename"
                    onDoubleClick={(e) => e.currentTarget.select()}
                    style={{
                      background: 'transparent', color: 'var(--bone-100)',
                      border: 0, borderBottom: '1px dashed transparent',
                      padding: '2px 0', fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em',
                      outline: 'none', width: '100%', cursor: 'text', fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = 'var(--ink-500)'; }}
                    onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderBottomColor = 'transparent'; }}
                    onFocus={(e) => { e.currentTarget.style.borderBottom = '1px solid var(--gold)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderBottom = '1px dashed transparent'; }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                  <button className="btn"><Icon name="upload" size={12} />Add files</button>
                  <button className="btn" onClick={() => onShare && onShare(open)}><Icon name="users" size={12} />Manage Team</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 148px', gap: 0, flex: 1, overflow: 'hidden' }}>
                {/* Files */}
                <div className="slim-scroll" style={{ padding: '10px 14px', overflow: 'auto', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 22, marginBottom: 4, overflow: 'hidden', flexWrap: 'nowrap', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10.5, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--ink-200)', fontWeight: 700 }}>Files</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                      {fileSelect && (() => {
                        const c = selFiles.size;
                        const allSel = c === openFiles.length && openFiles.length > 0;
                        const baseBtn = { background: 'transparent', border: '1px solid var(--ink-500)', borderRadius: 2, padding: '1px 7px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', height: 18, lineHeight: 1, boxSizing: 'border-box' };
                        return (
                          <>
                            <button
                              onClick={() => setSelFiles(allSel ? new Set() : new Set(openFiles.map((_, i) => i)))}
                              style={{ ...baseBtn, color: 'var(--bone-100)' }}
                            >{allSel ? 'None' : 'All'}</button>
                            <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--bone-100)' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed' }}>Duplicate</button>
                            <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--bone-100)' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed' }}>Move/Copy</button>
                            <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--bone-100)' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={11} /></button>
                            <button disabled={!c} style={{ ...baseBtn, color: c ? '#cf6f6f' : 'var(--ink-300)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={11} /></button>
                          </>
                        );
                      })()}
                      <button
                        onClick={() => { const next = !fileSelect; setFileSelect(next); if (!next) setSelFiles(new Set()); }}
                        style={{ background: 'transparent', border: 0, color: 'var(--gold)', borderRadius: 2, padding: '2px 5px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1 }}
                      >
                        {fileSelect ? 'Done' : 'Select'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 90px 90px 28px', gap: 12, padding: '0 10px 6px', fontSize: 10, color: 'var(--ink-200)', letterSpacing: 0.06, textTransform: 'uppercase' }}>
                    <span></span><span>Name</span><span>Last edited by</span><span>Edited</span><span></span>
                  </div>
                  {openFiles.length === 0 ? (
                    <div className="meta" style={{ fontSize: 11.5, padding: '12px 10px' }}>No files in this project yet.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 1 }}>
                      {openFiles.map((f, i) => {
                        const isChecked = selFiles.has(i);
                        const owner = lookupMember(f.owner);
                        const ownerInitials = (owner?.id || f.owner || '—');
                        const ownerFirst = owner?.name?.split(' ')[0] || (f.owner != null ? String(f.owner) : '—');
                        return (
                          <div
                            key={f.id}
                            draggable={fileSelect}
                            onClick={() => { if (fileSelect) { toggleFileSel(i); return; } onOpenDocument && onOpenDocument(f); }}
                            style={{
                              background: fileSelect && isChecked ? 'rgba(216,168,78,0.10)' : (i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                              borderRadius: 6,
                              display: 'grid', gridTemplateColumns: '16px 1fr 90px 90px 28px',
                              gap: 12, alignItems: 'center', padding: '8px 10px', fontSize: 12,
                              height: 36, boxSizing: 'border-box',
                              cursor: 'pointer',
                            }}
                          >
                            <span title="Drag to reorder" style={{ color: 'var(--ink-200)', fontSize: 11, cursor: 'grab', userSelect: 'none', lineHeight: 1, textAlign: 'center' }}>⋮⋮</span>
                            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                            {/* "Last edited by" — file's owner resolved against
                                the member directory: avatar + first name. */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              <Avatar initials={ownerInitials} size={18} color={owner?.color} />
                              <span className="meta" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownerFirst}</span>
                            </div>
                            <span className="mono meta" style={{ fontSize: 11 }}>{shortWhen(f)}</span>
                            {fileSelect ? (
                              <span
                                onClick={(e) => { e.stopPropagation(); toggleFileSel(i); }}
                                style={{ width: 14, height: 14, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--ink-300)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                              >
                                {isChecked && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
                              </span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === i ? null : i); }}
                                style={{ background: 'transparent', border: 0, color: 'var(--ink-200)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 4, position: 'relative' }}
                                title="More"
                              >⋯</button>
                            )}
                            {!fileSelect && menuFor === i && (
                              <div
                                onMouseLeave={() => setMenuFor(null)}
                                style={{
                                  position: 'absolute', right: 18, marginTop: 28,
                                  background: 'var(--ink-700)', border: '1px solid var(--ink-500)', borderRadius: 8,
                                  padding: 4, minWidth: 150, boxShadow: '0 12px 30px rgba(0,0,0,0.45)', zIndex: 10,
                                }}
                              >
                                {['Copy', 'Paste', 'Share', 'Details'].map((it) => (
                                  <button
                                    key={it}
                                    onClick={() => {
                                      setMenuFor(null);
                                      if (it === 'Share') onShare && onShare(open);
                                      else if (it === 'Details') onOpenDocument && onOpenDocument(f);
                                    }}
                                    style={{
                                      display: 'block', width: '100%', textAlign: 'left',
                                      background: 'transparent', border: 0, color: 'var(--bone-100)',
                                      padding: '7px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >{it}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Roster — project members resolved against the member
                    directory: avatar + name + role + online status dot. */}
                <div className="slim-scroll" style={{ borderLeft: '1px solid var(--ink-500)', padding: '12px 12px', background: 'var(--ink-800)', overflow: 'auto' }}>
                  <div className="section-label" style={{ marginBottom: 10 }}>Roster</div>
                  {(() => {
                    const roster = Array.isArray(open.members) ? open.members : [];
                    if (roster.length === 0) {
                      return (
                        <div className="meta" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
                          No teammates yet. Use Manage Team to invite people.
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {roster.map((m) => {
                          const mem = lookupMember(m);
                          return (
                            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Avatar initials={m} size={22} color={mem?.color} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mem?.name || m}</div>
                                <div className="meta" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: mem?.online ? 'var(--green)' : 'var(--ink-300)', flex: 'none' }}></span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mem?.role || ''}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
          {!open && (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-200)', fontSize: 13 }}>
              No projects yet — create one to group your documents.
            </div>
          )}
        </div>
      </div>
    </HubShell>
  );
}
