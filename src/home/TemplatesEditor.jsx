/* Survey Hub — Templates tab.
   Three-panel template editor, ported from the Claude Design prototype
   (survey-hub/templates-new.jsx, Templates_Editor):
     LEFT   — list of every template, each with its entity color swatches.
     MIDDLE — the open template: title, a row of module tabs, and the open
              module's categories, each expandable to its checklist items.
     RIGHT  — the open template's entities (name + color swatch).

   Wired to the real template shape. The app nests:
     template -> modules -> categories -> checklist items
   and carries entities (formerly "Ball in Court") at the template level.
   Reading is defensive because older templates store this under `spaces`
   and/or a `config` blob.

   This is the structural/reading build. In-place editing (rename, add,
   reorder, color-pick, bulk select) carries over from the design as a
   follow-up and is not wired here yet.
*/
import React, { useState, useMemo, useEffect } from 'react';
import { HubShell, Icon, Search } from './HubShell';

/* Defensive readers — templates may store structure at the top level,
   under a legacy `spaces` key, or inside a `config` blob. */
const modulesOf = (t) => t?.modules || t?.spaces || t?.config?.modules || t?.config?.spaces || [];
const entitiesOf = (t) => t?.ballInCourtEntities || t?.config?.ballInCourtEntities || [];
const categoriesOf = (m) => m?.categories || [];
const checklistOf = (c) => c?.checklist || c?.items || [];

export default function TemplatesEditor({ templates = [], user = null, templatesLocked = false, onNav, onCreateTemplate }) {
  const [search, setSearch] = useState('');

  const shell = (body) => (
    <HubShell
      tab="templates"
      onNav={onNav}
      title="Templates"
      subtitle={<span><b>{templates.length}</b> templates · reusable category + checklist sets</span>}
      actions={<Search placeholder="Search Templates..." value={search} onChange={setSearch} />}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      {body}
    </HubShell>
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => !q || (t.name || '').toLowerCase().includes(q));
  }, [templates, search]);

  const [selId, setSelId] = useState(null);
  const [openModIdx, setOpenModIdx] = useState(0);
  const [openCatId, setOpenCatId] = useState(null);

  useEffect(() => {
    if (filtered.length && !filtered.some((t) => t.id === selId)) {
      setSelId(filtered[0].id);
      setOpenModIdx(0);
      setOpenCatId(null);
    }
  }, [filtered, selId]);

  if (!templates.length) {
    return shell(
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-200)', fontSize: 13 }}>
        No templates yet — create one to define modules, categories, and checklists.
      </div>
    );
  }

  const tpl = filtered.find((t) => t.id === selId) || filtered[0] || null;
  const mods = tpl ? modulesOf(tpl) : [];
  const entities = tpl ? entitiesOf(tpl) : [];
  const openMod = mods[openModIdx] || mods[0] || null;
  const cats = openMod ? categoriesOf(openMod) : [];

  const swatch = (color, key) => (
    <span key={key} style={{ width: 9, height: 16, background: color || 'var(--ink-400)', borderRadius: 2, flex: 'none', border: '1px solid rgba(0,0,0,0.35)' }} />
  );

  return shell(
    <div style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '248px 1fr 248px', gap: 8 }}>
      {/* LEFT — template list */}
      <div className="card" style={{ padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <button className="btn primary" style={{ alignSelf: 'flex-start', marginBottom: 6 }} onClick={() => onCreateTemplate && onCreateTemplate()}>
          <Icon name="plus" size={11} />New Template
        </button>
        <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', paddingRight: 4 }}>
          {filtered.map((t) => {
            const isOpen = tpl && t.id === tpl.id;
            const ents = entitiesOf(t);
            return (
              <div
                key={t.id}
                onClick={() => { setSelId(t.id); setOpenModIdx(0); setOpenCatId(null); }}
                style={{
                  padding: '8px 10px', borderRadius: 6, minHeight: 50, boxSizing: 'border-box',
                  background: isOpen ? 'var(--ink-600)' : 'transparent',
                  borderLeft: isOpen ? '2px solid var(--gold)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{t.name || 'Untitled template'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5 }}>
                  {ents.slice(0, 6).map((e, i) => swatch(e.color, i))}
                  <span className="mono meta" style={{ fontSize: 9.5, marginLeft: 2 }}>{ents.length}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MIDDLE — open template */}
      <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tpl && (
          <>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-500)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 4, height: 36, background: 'var(--gold)', borderRadius: 2, flex: 'none' }}></span>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.name || 'Untitled template'}</div>
              <span className="meta" style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>{mods.length} {mods.length === 1 ? 'module' : 'modules'}</span>
            </div>

            {/* Module tabs */}
            <div style={{ padding: '8px 18px 0' }}>
              <div className="section-label" style={{ marginBottom: 4 }}>Module</div>
              {mods.length === 0 ? (
                <div className="meta" style={{ fontSize: 11.5, padding: '6px 0 12px' }}>This template has no modules yet.</div>
              ) : (
                <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--ink-500)' }}>
                  {mods.map((m, mi) => {
                    const on = mi === openModIdx;
                    return (
                      <div
                        key={m.id || mi}
                        onClick={() => { setOpenModIdx(mi); setOpenCatId(null); }}
                        style={{
                          padding: '6px 12px', marginBottom: -1, cursor: 'pointer',
                          fontSize: 12, fontWeight: on ? 600 : 400,
                          color: on ? 'var(--bone-100)' : 'var(--ink-200)',
                          borderBottom: on ? '2px solid var(--gold)' : '2px solid transparent',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.name || `Module ${mi + 1}`}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Categories + checklists */}
            <div className="slim-scroll" style={{ padding: '10px 18px 16px', overflow: 'auto', flex: 1 }}>
              {cats.length === 0 ? (
                <div className="meta" style={{ fontSize: 11.5, padding: '6px 0' }}>No categories in this module yet.</div>
              ) : (
                cats.map((c, ci) => {
                  const cid = c.id || `c${ci}`;
                  const items = checklistOf(c);
                  const expanded = openCatId === cid;
                  return (
                    <div key={cid} className="card" style={{ background: 'var(--ink-800)', marginBottom: 6, overflow: 'hidden' }}>
                      <div
                        onClick={() => setOpenCatId(expanded ? null : cid)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer' }}
                      >
                        <span style={{ color: 'var(--ink-200)', fontSize: 10, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name || `Category ${ci + 1}`}</span>
                        <span className="mono meta" style={{ marginLeft: 'auto', fontSize: 10 }}>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
                      </div>
                      {expanded && (
                        <div style={{ borderTop: '1px solid var(--ink-500)', padding: '6px 12px 8px' }}>
                          {items.length === 0 ? (
                            <div className="meta" style={{ fontSize: 11, padding: '4px 0' }}>No checklist items.</div>
                          ) : (
                            items.map((it, ii) => (
                              <div key={it.id || ii} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
                                <span style={{ width: 13, height: 13, border: '1.4px solid var(--ink-300)', borderRadius: 3, flex: 'none' }} />
                                <span>{it.text || it.name || 'Untitled item'}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* RIGHT — entities */}
      <div className="card" style={{ padding: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="section-label" style={{ marginBottom: 10 }}>Entities</div>
        <div className="slim-scroll" style={{ display: 'grid', gap: 6, overflow: 'auto' }}>
          {entities.length === 0 ? (
            <div className="meta" style={{ fontSize: 11.5 }}>No entities defined for this template.</div>
          ) : (
            entities.map((e, i) => (
              <div key={e.id || i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', background: 'var(--ink-800)', borderRadius: 6 }}>
                <span style={{ width: 14, height: 14, background: e.color || 'var(--ink-400)', borderRadius: 3, flex: 'none', border: '1px solid rgba(0,0,0,0.35)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name || 'Untitled entity'}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
