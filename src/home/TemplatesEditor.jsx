/* Survey Hub — Templates tab.
   Faithful port of the Claude Design prototype (survey-hub/templates-new.jsx,
   Templates_Editor — the T1 editor) folded onto the warm-dark theme.

   Three-panel layout:
     LEFT   — list of every template, each with its entity color swatches
              and an entity count; select-mode for bulk actions.
     MIDDLE — the open template: an editable title, a draggable row of module
              tabs, and the open module's categories, each expandable to its
              checklist items.
     RIGHT  — the open template's entities (name + color swatch) with a
              full fill/border colour picker.

   The prototype scoped an editorial "paper-and-ink" palette via an inline
   `.ed-scope` stylesheet injected into <head> at runtime. Survey Hub v2.html
   then overrode it to warm-dark. Here those overrides are folded straight
   into the injected stylesheet, so the end result is warm-dark on its own.

   Real data shape (defensive reads — older templates store modules under
   `spaces` or inside a `config` blob, and entities inside `config`):
     template -> modules -> categories -> checklist items
     template.ballInCourtEntities  (the right-panel "Entities")

   Interaction behaviours (select templates/modules, expand categories, the
   edit/select modes, colour pickers, drag-reorder) run on local component
   state exactly as the prototype does — they are not persisted to a backend
   in this pass. "New Template" calls the onCreateTemplate prop.
*/
import React, { useState, useMemo, useEffect } from 'react';
import { HubShell, Icon, Search } from './HubShell';

/* ============================================================
   Inline scoped stylesheet — the prototype's `.ed-scope` editorial
   sheet with Survey Hub v2.html's warm-dark overrides folded in,
   so it renders warm-dark without a separate override sheet.
   ============================================================ */
const _edScopeCSS = `
.ed-scope {
  background:
    radial-gradient(circle at 0% 0%, rgba(216,168,78,0.06), transparent 35%),
    #0d0f14;
  color: #f4f1ea;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  letter-spacing: -0.005em;
  --paper: #0d0f14; --paper-deep: #12151c; --paper-card: #181c24;
  --ink: #f4f1ea; --ink-soft: #e8e2d4; --ink-muted: #8d96a6; --ink-quiet: #5a6473;
  --rule: #2a3140; --rule-strong: #3a4252;
  --accent: #d8a84e; --accent-soft: #b6904a;
  /* warm-dark aliases used by some prototype inline styles */
  --ink-700: #181c24; --ink-600: #232834; --ink-500: #2a3140;
  --ink-300: #5a6473; --ink-200: #8d96a6; --bone-100: #f4f1ea;
}
.ed-scope * { box-sizing: border-box; min-width: 0; }
.ed-scope .mono,
.ed-scope .micro,
.ed-scope .micro-mid,
.ed-scope .pin,
.ed-scope .pill-mono { font-family: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace; }
.ed-scope .micro {
  font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase;
  color: #8d96a6; font-weight: 700;
}
.ed-scope .micro-mid {
  font-size: 10.5px; letter-spacing: 0.10em; text-transform: uppercase;
  color: #8d96a6; font-weight: 600;
}
.ed-scope .meta { color: var(--ink-muted); }

/* Cards */
.ed-scope .card { background: #181c24; border: 1px solid #2a3140; border-radius: 10px; }
.ed-scope .card-line { background: #12151c; border: 1px solid #2a3140; border-radius: 6px; }

/* Buttons */
.ed-scope .btn-ink {
  background: #d8a84e; color: #15110a; border: 1px solid #d8a84e;
  border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 600;
  height: 28px; box-sizing: border-box; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 4px;
}
.ed-scope .btn-line {
  background: #181c24; color: #f4f1ea; border: 1px solid #2a3140;
  border-radius: 6px; padding: 4px 8px; font-size: 11px;
  cursor: pointer; font-family: inherit;
}
.ed-scope .btn-ghost {
  background: transparent; color: #8d96a6; border: 0;
  padding: 4px 8px; font-size: 11px; cursor: pointer; font-family: inherit;
}
.ed-scope .btn-ghost:hover { color: #f4f1ea; }

/* Inputs / editable feel */
.ed-scope .inline-edit {
  background: transparent; border: 0; border-bottom: 1px solid transparent;
  color: var(--ink); font: inherit; font-size: 13px; padding: 4px 0;
  width: 100%; outline: none;
}
.ed-scope .inline-edit:hover { border-bottom-color: var(--rule); }
.ed-scope .inline-edit:focus { border-bottom-color: #d8a84e; }
.ed-scope .cat-title { cursor: text; border-bottom: 1px dashed transparent; }
.ed-scope .cat-title:hover { border-bottom-color: var(--rule-strong); }
.ed-scope .cat-title:focus { border-bottom: 1px solid #d8a84e; }

/* Prevent horizontal scrolling anywhere inside the editor */
.ed-scope .slim-scroll { overflow-x: hidden; }

/* Overlay range inputs (hue + opacity) — transparent track, pill thumb */
.ed-scope .picker-hue-range, .ed-scope .picker-op-range {
  appearance: none; -webkit-appearance: none; background: transparent; padding: 0;
}
.ed-scope .picker-hue-range::-webkit-slider-runnable-track,
.ed-scope .picker-op-range::-webkit-slider-runnable-track { background: transparent; height: 100%; }
.ed-scope .picker-hue-range::-moz-range-track,
.ed-scope .picker-op-range::-moz-range-track { background: transparent; height: 100%; }
.ed-scope .picker-hue-range::-webkit-slider-thumb,
.ed-scope .picker-op-range::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none;
  width: 4px; height: 14px; border-radius: 2px;
  background: #f6f4ef; border: 1px solid rgba(0,0,0,0.65);
  box-shadow: 0 1px 3px rgba(0,0,0,0.55); cursor: pointer;
}
.ed-scope .picker-hue-range::-moz-range-thumb {
  width: 4px; height: 14px; border-radius: 2px;
  background: #f6f4ef; border: 1px solid rgba(0,0,0,0.65);
  box-shadow: 0 1px 3px rgba(0,0,0,0.55); cursor: pointer;
}
.ed-scope .picker-op-range::-moz-range-thumb {
  width: 4px; height: 14px; border-radius: 2px;
  background: #f6f4ef; border: 1px solid rgba(0,0,0,0.65);
  box-shadow: 0 1px 3px rgba(0,0,0,0.55); cursor: pointer;
}
`;
if (typeof document !== 'undefined' && !document.getElementById('ed-style')) {
  const s = document.createElement('style');
  s.id = 'ed-style';
  s.textContent = _edScopeCSS;
  document.head.appendChild(s);
}

/* ============================================================
   Defensive readers — templates may carry structure at the top
   level, under a legacy `spaces` key, or inside a `config` blob.
   ============================================================ */
const modulesOf = (t) => t?.modules || t?.spaces || t?.config?.modules || t?.config?.spaces || [];
const entitiesOf = (t) => t?.ballInCourtEntities || t?.config?.ballInCourtEntities || [];
const categoriesOf = (m) => m?.categories || m?.cats || [];
const checklistOf = (c) => c?.checklist || c?.items || [];
const itemText = (it) => (typeof it === 'string' ? it : (it?.text ?? it?.name ?? ''));

/* Accent ribbon — templates may not store an accent colour. */
const ACCENTS = ['#e07a5e', '#7ab7e6', '#c293e6', '#a6e07a', '#d8a84e', '#9aa3b2'];

/* Normalise a colour value (entities may store an rgba string or a hex). */
const toHex6 = (color) => {
  if (!color) return '#8c8c8a';
  const c = String(color).trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return ('#' + c.slice(1).split('').map((ch) => ch + ch).join('')).toLowerCase();
  }
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
  if (m) {
    const hx = (n) => Number(n).toString(16).padStart(2, '0');
    return ('#' + hx(m[1]) + hx(m[2]) + hx(m[3])).toLowerCase();
  }
  return '#8c8c8a';
};

export default function TemplatesEditor({
  templates = [],
  user = null,
  templatesLocked = false,
  onNav,
  onCreateTemplate,
}) {
  /* Map every real template into the rich shape the editor markup expects. */
  const RICH = useMemo(() => templates.map((t, i) => {
    const mods = modulesOf(t).map((m, mi) => ({
      raw: m,
      id: m?.id ?? `m${mi}`,
      name: m?.name || `Module ${mi + 1}`,
      categories: categoriesOf(m).map((c, ci) => ({
        raw: c,
        id: c?.id ?? `c${ci}`,
        name: c?.name || `Category ${ci + 1}`,
        items: checklistOf(c).map((it) => itemText(it)),
      })),
    }));
    const roster = entitiesOf(t).map((e, ei) => ({
      raw: e,
      id: e?.id ?? `e${ei}`,
      role: e?.name || e?.role || `Entity ${ei + 1}`,
      color: toHex6(e?.color),
    }));
    return {
      raw: t,
      id: t?.id ?? `t${i}`,
      name: t?.name || 'Untitled Template',
      accent: t?.accent || ACCENTS[i % ACCENTS.length],
      modules: mods,
      roster,
    };
  }), [templates]);

  /* ---- selection / edit state ---- */
  const [selectedId, setSelected] = useState(null);
  const [openCat, setOpenCat] = useState(-1);
  const [tplEdit, setTplEdit] = useState(false);
  const [selTpls, setSelTpls] = useState(() => new Set());
  const toggleTplSel = (id) => setSelTpls((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const tplSelCount = selTpls.size;
  const [tplMenu, setTplMenu] = useState(null);
  const [entityMenu, setEntityMenu] = useState(null);
  const [moduleOrders, setModuleOrders] = useState({});
  const [dragMod, setDragMod] = useState(null);
  const [extraMods, setExtraMods] = useState({}); // { tplId: [{ name, categories }] }
  const [entityEdit, setEntityEdit] = useState(false);
  const [selEntities, setSelEntities] = useState(() => new Set());
  const toggleEntitySel = (role) => setSelEntities((prev) => { const n = new Set(prev); n.has(role) ? n.delete(role) : n.add(role); return n; });
  const [openColor, setOpenColor] = useState(null);
  const [roleColors, setRoleColors] = useState({});
  const [openMod, setOpenMod] = useState(0);
  const [modEdit, setModEdit] = useState(false);
  const [modRename, setModRename] = useState(null);
  const [selMods, setSelMods] = useState(() => new Set());
  const toggleModSel = (mi) => setSelMods((prev) => { const n = new Set(prev); n.has(mi) ? n.delete(mi) : n.add(mi); return n; });
  const [catEdit, setCatEdit] = useState(false);
  const [selCats, setSelCats] = useState(() => new Set());
  const toggleCatSel = (i) => setSelCats((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const [moveModal, setMoveModal] = useState(null);
  const [colorTab, setColorTab] = useState({});
  const [layerTab, setLayerTab] = useState({}); // { role: 'fill' | 'border' }
  const [borderColors, setBorderColors] = useState({});
  const [matchFill, setMatchFill] = useState({}); // { role: bool }

  /* ---- colour math (carried verbatim from the prototype) ---- */
  const hexToHsl = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return { h: 0, s: 0, l: 50 };
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  };
  const hslToHex = (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  };

  const PALETTE = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#64748b',
  ];

  /* Default the open template to the first one once data arrives. */
  useEffect(() => {
    if (selectedId == null && RICH.length) setSelected(RICH[0].id);
  }, [RICH, selectedId]);

  const tpl = RICH.find((t) => t.id === selectedId) || RICH[0] || null;

  /* Modules for the open template: real modules + any added in this session. */
  const baseMods = tpl ? tpl.modules : [];
  const allMods = useMemo(
    () => (tpl ? [...baseMods, ...(extraMods[tpl.id] || [])] : []),
    [baseMods, extraMods, tpl],
  );
  const orderedMods = useMemo(() => {
    if (!tpl) return [];
    const order = moduleOrders[tpl.id];
    if (!order) return allMods;
    const byName = Object.fromEntries(allMods.map((m) => [m.name, m]));
    return order.map((n) => byName[n]).filter(Boolean).concat(allMods.filter((m) => !order.includes(m.name)));
  }, [moduleOrders, tpl, allMods]);

  const addModule = () => {
    if (!tpl) return;
    const existing = orderedMods.map((m) => m.name);
    let n = 1;
    let name;
    do { name = `Module ${n++}`; } while (existing.includes(name));
    setExtraMods((prev) => ({ ...prev, [tpl.id]: [...(prev[tpl.id] || []), { name, categories: [] }] }));
    // Focus the new tab
    setTimeout(() => {
      setOpenMod(orderedMods.length);
      setModRename(orderedMods.length);
    }, 0);
  };
  const reorderMods = (from, to) => {
    if (from === to || from == null || to == null || !tpl) return;
    setModuleOrders((prev) => {
      const order = (prev[tpl.id] || orderedMods.map((m) => m.name)).slice();
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return { ...prev, [tpl.id]: order };
    });
    if (openMod === from) setOpenMod(to);
    else if (from < openMod && to >= openMod) setOpenMod(openMod - 1);
    else if (from > openMod && to <= openMod) setOpenMod(openMod + 1);
  };

  const subtitle = (
    <span><b>{RICH.length}</b> templates · reusable category + checklist sets</span>
  );
  const actions = <><Search placeholder="Search Templates..." /></>;

  /* Categories shown for the open module. */
  const activeMod = orderedMods[openMod] || orderedMods[0] || { categories: [] };
  const visibleCats = categoriesOf(activeMod);

  return (
    <>
    <HubShell
      tab="templates"
      onNav={onNav}
      title="Templates"
      subtitle={subtitle}
      actions={actions}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div className="ed-scope" style={{ width: 'auto', height: 'calc(100% - 65px)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ padding: '0 8px 8px 8px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Three columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 268px', gap: 8, height: '100%' }}>

          {/* ---------- LEFT: Templates ---------- */}
          <aside style={{
            overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%',
            background: '#181c24', border: '1px solid #2a3140', borderRadius: 10, padding: 8,
          }}>
            <div style={{ padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                className="btn-ink"
                onClick={() => onCreateTemplate && onCreateTemplate()}
                style={{ padding: '4px 8px', fontSize: 11, gap: 4, display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
              >
                <Icon name="plus" size={11} />New Template
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'nowrap', height: 22, overflow: 'hidden' }}>
                <button
                  onClick={() => { const next = !tplEdit; setTplEdit(next); if (!next) setSelTpls(new Set()); }}
                  style={{ background: 'transparent', border: 0, color: 'var(--accent)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1 }}
                >
                  {tplEdit ? 'Done' : 'Select'}
                </button>
                {tplEdit && (
                  <>
                    {(() => {
                      const allSel = tplSelCount === RICH.length && RICH.length > 0;
                      return (
                        <button
                          onClick={() => setSelTpls(allSel ? new Set() : new Set(RICH.map((t) => t.id)))}
                          style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: 'var(--ink-soft)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >{allSel ? 'None' : 'All'}</button>
                      );
                    })()}
                    <button disabled={!tplSelCount} style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: tplSelCount ? 'var(--ink-soft)' : 'var(--ink-quiet)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: tplSelCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Duplicate</button>
                    <button disabled={!tplSelCount} style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: tplSelCount ? 'var(--ink-soft)' : 'var(--ink-quiet)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: tplSelCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={11} /></button>
                    <button disabled={!tplSelCount} style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: tplSelCount ? '#cf6f6f' : 'var(--ink-quiet)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: tplSelCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={11} /></button>
                  </>
                )}
              </div>
            </div>
            <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
              {RICH.length === 0 && (
                <div className="meta" style={{ padding: '20px 8px', fontSize: 11.5 }}>No templates yet — create one to get started.</div>
              )}
              {RICH.map((t) => {
                const active = t.id === selectedId;
                const isSel = selTpls.has(t.id);
                return (
                  <div key={t.id} style={{ position: 'relative' }} draggable={tplEdit}>
                    <div
                      onClick={() => { if (tplEdit) toggleTplSel(t.id); else { setSelected(t.id); setOpenCat(-1); setOpenMod(0); } }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '14px 1fr auto',
                        gap: 8, alignItems: 'center',
                        padding: '8px 8px', borderRadius: 6,
                        height: 50, boxSizing: 'border-box',
                        background: tplEdit ? (isSel ? 'var(--ink-600)' : 'transparent') : (active ? 'var(--ink-600)' : 'transparent'),
                        cursor: 'pointer',
                        borderLeft: !tplEdit && active ? '2px solid var(--accent)' : '2px solid transparent',
                      }}
                    >
                      <span
                        title={tplEdit ? 'Drag to reorder' : undefined}
                        style={{ color: 'var(--ink-200)', fontSize: 11, cursor: tplEdit ? 'grab' : 'default', userSelect: 'none', lineHeight: 1, textAlign: 'center' }}
                      >⋮⋮</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{t.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {t.roster.slice(0, 3).map((r) => (
                              <span key={r.id} style={{ width: 14, height: 14, borderRadius: '50%', background: r.color + '59', border: `1.5px solid ${r.color}` }}></span>
                            ))}
                          </div>
                          <span className="mono meta" style={{ fontSize: 9.5 }}>{t.roster.length}</span>
                        </div>
                      </div>
                      {tplEdit ? (
                        <span
                          onClick={(e) => { e.stopPropagation(); toggleTplSel(t.id); }}
                          style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--rule-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                        >
                          {isSel && <span style={{ color: 'var(--paper)', fontSize: 10, lineHeight: 1 }}>✓</span>}
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setTplMenu(tplMenu === t.id ? null : t.id); }}
                          style={{ background: 'transparent', border: 0, color: 'var(--ink-200)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
                          title="More"
                        >⋯</button>
                      )}
                    </div>
                    {tplMenu === t.id && (
                      <div onMouseLeave={() => setTplMenu(null)} style={{
                        position: 'absolute', right: 4, top: 32, zIndex: 20,
                        background: '#181c24', border: '1px solid #2a3140', borderRadius: 8,
                        padding: 4, minWidth: 170, boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
                      }}>
                        {['Copy', 'Rename', 'Share', 'Delete'].map((label) => (
                          <button key={label} onClick={() => setTplMenu(null)} style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            background: 'transparent', border: 0, color: label === 'Delete' ? '#cf6f6f' : 'var(--bone-100)',
                            padding: '7px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                          }}>{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ---------- MIDDLE: Modules + expandable category checklists ---------- */}
          <section style={{
            minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            background: '#181c24', border: '1px solid #2a3140', borderRadius: 10,
          }}>
            {!tpl ? (
              <div className="meta" style={{ padding: '24px 18px', fontSize: 12 }}>Select a template to edit.</div>
            ) : (
            <>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 4, height: 36, background: tpl.accent, borderRadius: 2, flex: 'none' }}></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  key={tpl.id}
                  className="inline-edit cat-title"
                  defaultValue={tpl.name}
                  title="Click to rename"
                  onDoubleClick={(e) => e.currentTarget.select()}
                  style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.2, width: '100%' }}
                />
              </div>
              <div className="micro" style={{ textAlign: 'right' }}>
                <div>{orderedMods.length} {orderedMods.length === 1 ? 'module' : 'modules'}</div>
              </div>
            </div>

            <div style={{ padding: '6px 18px 14px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

              {/* Module tabs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p className="micro" style={{ margin: 0 }}>Module</p>
                  <button
                    onClick={() => { setModEdit(true); setSelMods(new Set()); }}
                    style={{ background: 'transparent', border: 0, color: 'var(--accent)', borderRadius: 2, padding: '2px 6px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                  >
                    Select
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderBottom: '1px solid var(--rule)', minHeight: 26 }}>
                  {orderedMods.map((mod, mi) => {
                    const isOn = openMod === mi;
                    const catCount = categoriesOf(mod).length;
                    return (
                      <div
                        key={mod.name + '-' + mi}
                        draggable
                        onDragStart={() => setDragMod(mi)}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => { e.preventDefault(); reorderMods(dragMod, mi); setDragMod(null); }}
                        onDragEnd={() => setDragMod(null)}
                        style={{
                          display: 'flex', alignItems: 'center', marginBottom: -1,
                          borderBottom: isOn ? '2px solid var(--ink)' : '2px solid transparent',
                          opacity: dragMod === mi ? 0.4 : 1,
                          cursor: 'grab',
                          flex: '1 1 0', minWidth: 32, maxWidth: 140,
                          overflow: 'hidden',
                        }}
                      >
                        {modRename === mi ? (
                          <input
                            className="inline-edit"
                            defaultValue={mod.name}
                            autoFocus
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={(e) => {
                              const v = e.currentTarget.value.trim();
                              if (v && v !== mod.name) {
                                // Rename in extraMods if applicable, otherwise track via moduleOrders
                                setExtraMods((prev) => {
                                  const list = prev[tpl.id] || [];
                                  const idx = list.findIndex((m) => m.name === mod.name);
                                  if (idx >= 0) {
                                    const next = list.slice();
                                    next[idx] = { ...next[idx], name: v };
                                    return { ...prev, [tpl.id]: next };
                                  }
                                  return prev;
                                });
                                setModuleOrders((prev) => {
                                  const order = prev[tpl.id];
                                  if (!order) return prev;
                                  return { ...prev, [tpl.id]: order.map((n) => (n === mod.name ? v : n)) };
                                });
                              }
                              setModRename(null);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setModRename(null); }}
                            style={{ background: 'transparent', border: 0, padding: '3px 6px', fontSize: 12, fontWeight: isOn ? 500 : 400, color: isOn ? 'var(--ink)' : 'var(--ink-muted)', width: '100%', borderBottom: '1px solid var(--accent)', outline: 'none' }}
                          />
                        ) : (
                          <button
                            onClick={() => { setOpenMod(mi); setOpenCat(-1); }}
                            onDoubleClick={() => setModRename(mi)}
                            title={`${mod.name} · drag to reorder · double-click to rename`}
                            style={{
                              background: 'transparent', border: 0, padding: '3px 6px',
                              fontFamily: 'inherit', color: isOn ? 'var(--ink)' : 'var(--ink-muted)',
                              fontSize: 12, fontWeight: isOn ? 500 : 400, cursor: 'grab',
                              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
                            }}
                          >{mod.name}</button>
                        )}
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-quiet)', padding: '0 6px 0 2px', flex: 'none' }}>{catCount}</span>
                      </div>
                    );
                  })}
                  <button
                    onClick={addModule}
                    title="New module"
                    style={{
                      marginLeft: 4, marginBottom: 2,
                      background: 'transparent',
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                      borderRadius: 4,
                      padding: 0,
                      fontSize: 12, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
                      width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flex: 'none', alignSelf: 'center',
                    }}
                  ><span style={{ display: 'block', lineHeight: 1, transform: 'translateY(-0.5px)' }}>+</span></button>
                </div>
              </div>

              {/* Categories header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 8, gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                  <p className="micro" style={{ margin: 0 }}>Categories</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, overflow: 'hidden', flexWrap: 'nowrap' }}>
                    <button
                      onClick={() => { const next = !catEdit; setCatEdit(next); if (!next) setSelCats(new Set()); }}
                      style={{ background: 'transparent', border: 0, color: 'var(--accent)', borderRadius: 2, padding: '2px 5px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1, flex: 'none' }}
                    >
                      {catEdit ? 'Done' : 'Select'}
                    </button>
                    {catEdit && (() => {
                      const c = selCats.size;
                      const allSel = c === visibleCats.length && visibleCats.length > 0;
                      const baseBtn = { background: 'transparent', border: '1px solid var(--rule-strong)', borderRadius: 2, padding: '1px 7px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', height: 18, lineHeight: 1, boxSizing: 'border-box', flex: 'none' };
                      return (
                        <>
                          <button onClick={() => setSelCats(allSel ? new Set() : new Set(visibleCats.map((_, i) => i)))} style={{ ...baseBtn, color: 'var(--ink-soft)' }}>{allSel ? 'None' : 'All'}</button>
                          <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Duplicate</button>
                          <button disabled={!c} onClick={() => setMoveModal({ count: c })} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Move/Copy</button>
                          <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={11} /></button>
                          <button disabled={!c} style={{ ...baseBtn, color: c ? '#cf6f6f' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={11} /></button>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <button className="btn-ink" style={{ padding: '4px 8px', fontSize: 11, gap: 4, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: 'none' }}>
                  <Icon name="plus" size={11} />New Category
                </button>
              </div>

              {/* Expandable category list */}
              <div className="slim-scroll" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4, flex: 1, minHeight: 0 }}>
                {visibleCats.length === 0 && (
                  <div className="meta" style={{ padding: '16px 4px', fontSize: 11.5 }}>This module has no categories yet.</div>
                )}
                {visibleCats.map((c, i) => {
                  const items = checklistOf(c).map((it) => itemText(it));
                  const open = openCat === i;
                  return (
                    <div key={(c.id ?? c.name ?? '') + '-' + i} className="card-line" style={{ overflow: 'hidden', flexShrink: 0 }}>
                      {/* Row header */}
                      <div
                        onClick={() => { if (catEdit) toggleCatSel(i); }}
                        style={{
                          width: '100%', display: 'grid', gridTemplateColumns: catEdit ? '14px 20px 1fr auto 16px' : '14px 20px 1fr auto', gap: 8,
                          alignItems: 'center', padding: '3px 10px',
                          cursor: catEdit ? 'pointer' : 'default',
                          background: catEdit && selCats.has(i) ? 'rgba(216,168,78,0.08)' : 'transparent',
                        }}
                      >
                        <span title="Drag to reorder" style={{ color: 'var(--ink-muted)', fontSize: 11, cursor: 'grab', userSelect: 'none', lineHeight: 1, textAlign: 'center' }}>⋮⋮</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenCat(open ? -1 : i); }}
                          title={open ? 'Collapse' : 'Expand'}
                          style={{
                            background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                            color: 'var(--ink-muted)', fontSize: 13, lineHeight: 1, fontFamily: 'inherit',
                            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                            width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >›</button>
                        <input
                          className="inline-edit cat-title"
                          defaultValue={c.name}
                          title="Click to rename"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.currentTarget.select()}
                          style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2, width: 'max-content', maxWidth: '100%', minWidth: 40 }}
                        />
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-quiet)', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{items.length} items</span>
                        {catEdit && (
                          <span
                            onClick={(e) => { e.stopPropagation(); toggleCatSel(i); }}
                            style={{ width: 14, height: 14, border: `1.4px solid ${selCats.has(i) ? 'var(--accent)' : 'var(--rule-strong)'}`, background: selCats.has(i) ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            {selCats.has(i) && <span style={{ color: 'var(--paper)', fontSize: 10, lineHeight: 1 }}>✓</span>}
                          </span>
                        )}
                      </div>

                      {/* Expanded body — checklist items */}
                      {open && (
                        <div style={{ padding: '4px 14px 12px 50px', borderTop: '1px solid var(--rule)', background: 'var(--paper-deep)' }}>
                          <div style={{ display: 'grid', gap: 1, marginTop: 6 }}>
                            {items.length === 0 && (
                              <div className="meta" style={{ fontSize: 11, padding: '3px 0' }}>No checklist items yet.</div>
                            )}
                            {items.map((it, j) => (
                              <div
                                key={j}
                                style={{
                                  display: 'grid', gridTemplateColumns: '14px 1fr 16px',
                                  alignItems: 'center', gap: 6, padding: '3px 0',
                                  borderBottom: j === items.length - 1 ? 0 : '1px dashed var(--rule)',
                                }}
                              >
                                <span style={{ color: 'var(--ink-muted)', fontSize: 11, cursor: 'grab' }}>⋮⋮</span>
                                <input className="inline-edit" defaultValue={it} />
                                <button
                                  title="Delete item"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#cf6f6f'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-quiet)'; }}
                                  style={{ background: 'transparent', border: 0, color: 'var(--ink-quiet)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
                                >×</button>
                              </div>
                            ))}
                            <button style={{
                              width: '100%', padding: '6px 10px', marginTop: 6,
                              border: '1px dashed var(--rule-strong)', background: 'transparent',
                              color: 'var(--ink-muted)', borderRadius: 2, fontSize: 11.5,
                              cursor: 'pointer', fontFamily: 'inherit',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}>
                              <span style={{ fontSize: 13 }}>+</span> Add Checklist Item
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            </>
            )}
          </section>

          {/* ---------- RIGHT: Entities rail ---------- */}
          <aside style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ padding: '8px 8px 8px 8px', borderBottom: '1px solid var(--rule)', flex: 'none', minHeight: 64, boxSizing: 'border-box', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <p className="micro" style={{ margin: 0 }}>Entities <span className="mono" style={{ fontSize: 10, color: 'var(--ink-quiet)', letterSpacing: 0, fontWeight: 500, marginLeft: 4 }}>{tpl ? tpl.roster.length : 0}</span></p>
                </div>
                <button className="btn-ink" style={{ padding: '4px 8px', fontSize: 11, gap: 4, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: 'none' }}>
                  <Icon name="plus" size={11} />New Entity
                </button>
              </div>
              <div style={{ padding: '6px 8px 4px', display: 'flex', alignItems: 'center', gap: 2, height: 28, flexWrap: 'nowrap', flex: 'none' }}>
                <button
                  onClick={() => { const next = !entityEdit; setEntityEdit(next); if (!next) setSelEntities(new Set()); }}
                  style={{ background: 'transparent', border: 0, color: 'var(--accent)', borderRadius: 2, padding: '0 4px 0 0', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600, lineHeight: 1, flex: 'none' }}
                >
                  {entityEdit ? 'Done' : 'Select'}
                </button>
                {entityEdit && tpl && (() => {
                  const c = selEntities.size;
                  const allSel = c === tpl.roster.length && tpl.roster.length > 0;
                  const baseBtn = { background: 'transparent', border: '1px solid var(--rule-strong)', borderRadius: 2, padding: '1px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', height: 18, lineHeight: 1, boxSizing: 'border-box', flex: 'none' };
                  return (
                    <>
                      <button onClick={() => setSelEntities(allSel ? new Set() : new Set(tpl.roster.map((r) => r.role)))} style={{ ...baseBtn, color: 'var(--ink-soft)' }}>{allSel ? 'None' : 'All'}</button>
                      <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Duplicate</button>
                      <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Move/Copy</button>
                      <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={10} /></button>
                      <button disabled={!c} style={{ ...baseBtn, color: c ? '#cf6f6f' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={10} /></button>
                    </>
                  );
                })()}
              </div>

              <div className="slim-scroll" style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1, minHeight: 0 }}>
                {(!tpl || tpl.roster.length === 0) && (
                  <div className="meta" style={{ fontSize: 11.5, padding: '12px 2px' }}>No entities on this template yet.</div>
                )}
                {tpl && tpl.roster.map((r) => {
                  const c = roleColors[r.role]?.color || r.color || '#8c8c8a';
                  const op = roleColors[r.role]?.opacity ?? 0.35;
                  const alpha = Math.round(op * 255).toString(16).padStart(2, '0');
                  const isOpen = openColor === r.role;
                  return (
                    <div key={r.id}>
                      <div className="card-line" style={{
                        display: 'grid', gridTemplateColumns: '14px 18px 1fr 16px', gap: 10,
                        padding: '8px 10px', alignItems: 'center',
                        height: 38, boxSizing: 'border-box',
                      }}>
                        <span style={{ color: 'var(--ink-muted)', fontSize: 12, cursor: 'grab', userSelect: 'none', lineHeight: 1 }}>⋮⋮</span>
                        <button
                          onClick={() => setOpenColor(isOpen ? null : r.role)}
                          title="Edit color"
                          style={{
                            width: 18, height: 18, borderRadius: '50%',
                            background: c + alpha, border: `1.5px solid ${c}`,
                            cursor: 'pointer', padding: 0,
                          }}
                        ></button>
                        <input
                          className="inline-edit cat-title"
                          defaultValue={r.role}
                          onDoubleClick={(e) => e.currentTarget.select()}
                          style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}
                        />
                        {!isOpen && (
                          entityEdit ? (
                            <span
                              onClick={(e) => { e.stopPropagation(); toggleEntitySel(r.role); }}
                              style={{ width: 14, height: 14, border: `1.4px solid ${selEntities.has(r.role) ? 'var(--accent)' : 'var(--rule-strong)'}`, background: selEntities.has(r.role) ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                            >
                              {selEntities.has(r.role) && <span style={{ color: 'var(--paper)', fontSize: 10, lineHeight: 1 }}>✓</span>}
                            </span>
                          ) : (
                            <div style={{ position: 'relative' }}>
                              <button
                                title="More"
                                onClick={(e) => { e.stopPropagation(); setEntityMenu(entityMenu === r.role ? null : r.role); }}
                                style={{ background: 'transparent', border: 0, color: 'var(--ink-muted)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', lineHeight: 1, fontFamily: 'inherit', borderRadius: 4 }}
                              >⋯</button>
                              {entityMenu === r.role && (
                                <div onMouseLeave={() => setEntityMenu(null)} style={{
                                  position: 'absolute', right: 0, top: 22, zIndex: 20,
                                  background: 'var(--paper-card)', border: '1px solid var(--rule-strong)', borderRadius: 8,
                                  padding: 4, minWidth: 140, boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
                                }}>
                                  {['Duplicate', 'Move/Copy', 'Share', 'Rename', 'Delete'].map((label) => (
                                    <button key={label} onClick={(e) => { e.stopPropagation(); setEntityMenu(null); }} style={{
                                      display: 'block', width: '100%', textAlign: 'left',
                                      background: 'transparent', border: 0, color: label === 'Delete' ? '#cf6f6f' : 'var(--ink-soft)',
                                      padding: '7px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                                    }}>{label}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                      {isOpen && (() => {
                        const tab = colorTab[r.role] || 'presets';
                        const layer = layerTab[r.role] || 'fill';
                        const match = !!matchFill[r.role];
                        const fillData = { color: c, opacity: op };
                        const borderData = borderColors[r.role] || { color: c, opacity: op };
                        const isBorderMatched = layer === 'border' && match;
                        const activeData = isBorderMatched ? fillData : (layer === 'border' ? borderData : fillData);
                        const activeColor = activeData.color;
                        const activeOp = activeData.opacity;
                        const setColor = (color) => {
                          if (isBorderMatched) return;
                          if (layer === 'border') setBorderColors({ ...borderColors, [r.role]: { color, opacity: borderData.opacity } });
                          else setRoleColors({ ...roleColors, [r.role]: { color, opacity: op } });
                        };
                        const setOpacity = (opacity) => {
                          if (isBorderMatched) return;
                          if (layer === 'border') setBorderColors({ ...borderColors, [r.role]: { color: borderData.color, opacity } });
                          else setRoleColors({ ...roleColors, [r.role]: { color: c, opacity } });
                        };
                        return (
                          <div style={{
                            margin: '-4px 0 6px', padding: 0,
                            background: 'var(--paper-deep)', border: '1px solid var(--rule)', borderTop: 0, borderRadius: '0 0 4px 4px',
                            display: 'flex', flexDirection: 'column',
                            overflow: 'hidden',
                          }}>
                            {/* Fill / Border tabs */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--rule)' }}>
                              {[['fill', 'Fill'], ['border', 'Border']].map(([k, label], i) => (
                                <button
                                  key={k}
                                  onClick={() => setLayerTab({ ...layerTab, [r.role]: k })}
                                  style={{
                                    position: 'relative', padding: '7px 0', fontSize: 11,
                                    background: layer === k ? 'rgba(20,30,43,0.65)' : 'rgba(12,18,27,0.35)',
                                    color: layer === k ? 'var(--ink)' : 'var(--ink-muted)',
                                    fontWeight: 600, border: 0,
                                    borderRight: i === 0 ? '1px solid var(--rule)' : 0,
                                    cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >{label}
                                  {layer === k && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--accent)' }} />}
                                </button>
                              ))}
                            </div>
                            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {/* Header: title + view toggle */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', textTransform: 'capitalize' }}>{tab}</span>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    onClick={() => setColorTab({ ...colorTab, [r.role]: 'presets' })}
                                    title="Presets"
                                    style={{
                                      width: 22, height: 22, borderRadius: 4, padding: 0,
                                      border: `1px solid ${tab === 'presets' ? 'var(--accent)' : 'var(--rule-strong)'}`,
                                      background: tab === 'presets' ? 'rgba(216,168,78,0.12)' : 'transparent',
                                      color: tab === 'presets' ? 'var(--accent)' : 'var(--ink-muted)',
                                      cursor: 'pointer', display: 'grid', placeItems: 'center', fontFamily: 'inherit',
                                    }}
                                  >
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                                  </button>
                                  <button
                                    onClick={() => setColorTab({ ...colorTab, [r.role]: 'custom' })}
                                    title="Custom"
                                    style={{
                                      width: 22, height: 22, borderRadius: 4, padding: 0,
                                      border: `1px solid ${tab === 'custom' ? 'var(--accent)' : 'var(--rule-strong)'}`,
                                      background: tab === 'custom' ? 'rgba(216,168,78,0.12)' : 'transparent',
                                      color: tab === 'custom' ? 'var(--accent)' : 'var(--ink-muted)',
                                      cursor: 'pointer', display: 'grid', placeItems: 'center', fontFamily: 'inherit',
                                      fontSize: 12, lineHeight: 1,
                                    }}
                                  >✦</button>
                                </div>
                              </div>
                              {/* Match Fill row — only on Border tab */}
                              {layer === 'border' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                                  <input
                                    type="checkbox"
                                    checked={match}
                                    onChange={(e) => setMatchFill({ ...matchFill, [r.role]: e.target.checked })}
                                    style={{ width: 13, height: 13, margin: 0, accentColor: 'var(--accent)' }}
                                  />
                                  <span style={{ fontSize: 11, fontWeight: 600, color: match ? 'var(--ink)' : 'var(--ink-soft)' }}>Match Fill</span>
                                  {match && <span style={{ fontSize: 10, color: 'var(--ink-muted)', marginLeft: 'auto' }}>using fill color &amp; opacity</span>}
                                </label>
                              )}
                              {/* Controls — dimmed/disabled when border + match */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: isBorderMatched ? 0.4 : 1, pointerEvents: isBorderMatched ? 'none' : 'auto' }}>
                                {tab === 'presets' ? (
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
                                    {PALETTE.map((p) => {
                                      const isPicked = activeColor.toLowerCase() === p.toLowerCase();
                                      return (
                                        <button
                                          key={p}
                                          onClick={() => setColor(p)}
                                          style={{
                                            width: '100%', aspectRatio: '1 / 1', borderRadius: '50%',
                                            background: p, border: '1px solid rgba(0,0,0,0.4)',
                                            outline: isPicked ? '2px solid var(--ink)' : 'none', outlineOffset: 2,
                                            cursor: 'pointer', padding: 0,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                          }}
                                        ></button>
                                      );
                                    })}
                                  </div>
                                ) : (() => {
                                  const hsl = hexToHsl(activeColor);
                                  const onSquare = (e, target) => {
                                    const rect = (target || e.currentTarget).getBoundingClientRect();
                                    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                                    setColor(hslToHex(Math.round(x * 360), Math.round((1 - y) * 100), hsl.l || 50));
                                  };
                                  const darkness = 100 - hsl.l;
                                  const pureAtL50 = hslToHex(hsl.h, hsl.s, 50);
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      {/* HS square — x: hue, y: saturation (top saturated, bottom white) */}
                                      <div
                                        onMouseDown={(e) => {
                                          const el = e.currentTarget;
                                          onSquare(e, el);
                                          const move = (ev) => onSquare(ev, el);
                                          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                                          window.addEventListener('mousemove', move);
                                          window.addEventListener('mouseup', up);
                                        }}
                                        style={{
                                          width: '100%', aspectRatio: '5 / 3', borderRadius: 4, position: 'relative',
                                          background: 'linear-gradient(to bottom, transparent 0%, #fff 100%), linear-gradient(to right, #ff0000, #ff7a00, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                                          cursor: 'crosshair', border: '1px solid var(--rule-strong)',
                                        }}
                                      >
                                        <div style={{
                                          position: 'absolute',
                                          left: `${(hsl.h / 360) * 100}%`, top: `${100 - hsl.s}%`,
                                          width: 10, height: 10, marginLeft: -5, marginTop: -5,
                                          borderRadius: '50%', background: 'transparent',
                                          border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
                                          pointerEvents: 'none',
                                        }} />
                                      </div>
                                      {/* Lightness slider — left: white → middle: pure → right: black */}
                                      <div style={{ position: 'relative', height: 14 }}>
                                        <div style={{
                                          position: 'absolute', inset: 0, borderRadius: 7,
                                          background: `linear-gradient(to right, #ffffff 0%, ${pureAtL50} 50%, #000000 100%)`,
                                          border: '1px solid var(--rule-strong)',
                                        }} />
                                        <input
                                          type="range" min={0} max={100} value={darkness}
                                          onChange={(e) => setColor(hslToHex(hsl.h, hsl.s, 100 - parseInt(e.target.value)))}
                                          className="picker-hue-range"
                                          style={{ position: 'absolute', inset: 0, width: '100%', margin: 0, appearance: 'none', background: 'transparent', cursor: 'pointer' }}
                                        />
                                      </div>
                                      {/* Hex */}
                                      <input
                                        value={activeColor.toUpperCase()}
                                        onChange={(e) => { const v = e.target.value.trim(); const hex = v.startsWith('#') ? v : '#' + v; if (/^#[0-9a-f]{6}$/i.test(hex)) setColor(hex.toLowerCase()); }}
                                        onBlur={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v.toLowerCase()); }}
                                        style={{ width: '100%', background: 'var(--paper-card)', border: '1px solid var(--rule-strong)', color: 'var(--ink)', borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'ui-monospace, monospace', outline: 'none', letterSpacing: 0.5 }}
                                      />
                                    </div>
                                  );
                                })()}
                                {/* Divider */}
                                <div style={{ height: 1, background: 'var(--rule)', margin: '2px 0' }} />
                                {/* Opacity row */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>Opacity</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={Math.round(activeOp * 100)}
                                        onChange={(e) => { const v = parseInt(e.target.value.replace(/\D/g, '') || '0'); if (!isNaN(v) && v >= 0 && v <= 100) setOpacity(v / 100); }}
                                        style={{ width: 38, height: 22, background: 'var(--paper-card)', border: '1px solid var(--rule-strong)', color: 'var(--ink)', borderRadius: 4, padding: '0 6px', fontSize: 11, fontFamily: 'ui-monospace, monospace', outline: 'none', textAlign: 'center' }}
                                      />
                                      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-muted)', fontWeight: 600 }}>%</span>
                                    </div>
                                  </div>
                                  <div style={{ position: 'relative', height: 4 }}>
                                    <div style={{
                                      position: 'absolute', inset: 0, borderRadius: 2,
                                      background: `linear-gradient(to right, var(--ink-300) 0%, var(--ink-300) ${Math.round(activeOp * 100)}%, var(--rule) ${Math.round(activeOp * 100)}%, var(--rule) 100%)`,
                                    }} />
                                    <input
                                      type="range" min={0} max={100} value={Math.round(activeOp * 100)}
                                      onChange={(e) => setOpacity(parseInt(e.target.value) / 100)}
                                      className="picker-op-range"
                                      style={{ position: 'absolute', inset: '-6px 0', width: '100%', margin: 0, appearance: 'none', background: 'transparent', cursor: 'pointer', height: 16 }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

        </div>
        </div>
      </div>
    </HubShell>

    {/* Edit modules modal */}
    {modEdit && tpl && (() => {
      const mods = orderedMods;
      const selCount = selMods.size;
      return (
        <div
          onClick={() => setModEdit(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(13, 15, 20, 0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 400, maxHeight: 'calc(100vh - 80px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#181c24', border: '1px solid #2a3140', borderRadius: 10 }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #2a3140', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '-0.025em', flex: 'none', color: '#f4f1ea', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>Edit modules</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0d0f14', border: '1px solid #2a3140', borderRadius: 6, padding: '4px 8px', height: 26, boxSizing: 'border-box', flex: 1, maxWidth: 220 }}>
                <Icon name="search" size={12} color="#8d96a6" />
                <input
                  placeholder="Search modules..."
                  style={{ background: 'transparent', border: 0, outline: 'none', color: '#f4f1ea', fontFamily: 'inherit', fontSize: 11.5, flex: 1, width: '100%', padding: 0 }}
                />
              </div>
            </div>
            <div className="slim-scroll" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto', flex: '0 1 auto', minHeight: 0 }}>
              {mods.map((mod, mi) => {
                const isSel = selMods.has(mi);
                return (
                  <div key={mod.name + '-' + mi} draggable style={{
                    display: 'grid', gridTemplateColumns: '14px 14px 1fr auto', gap: 10,
                    alignItems: 'center', padding: '7px 8px', borderRadius: 6,
                    background: isSel ? '#181c24' : '#12151c',
                    border: '1px solid #2a3140',
                  }}>
                    <span title="Drag" style={{ color: '#8d96a6', cursor: 'grab', lineHeight: 1, textAlign: 'center', fontSize: 11 }}>⋮⋮</span>
                    <span onClick={() => toggleModSel(mi)} style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? '#d8a84e' : '#3a4252'}`, background: isSel ? '#d8a84e' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isSel && <span style={{ color: '#0d0f14', fontSize: 10, lineHeight: 1 }}>✓</span>}
                    </span>
                    <input
                      defaultValue={mod.name}
                      style={{ background: 'transparent', border: 0, borderBottom: '1px solid transparent', color: '#f4f1ea', font: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '4px 0', width: '100%', outline: 'none' }}
                    />
                    <span style={{ fontSize: 10, color: '#5a6473', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{categoriesOf(mod).length}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '0 10px 8px', flex: 'none' }}>
              <button style={{ width: '100%', padding: '6px 10px', border: '1px dashed #3a4252', background: 'transparent', color: '#8d96a6', borderRadius: 2, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>+</span> New Module
              </button>
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid #2a3140', background: '#12151c', display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
              <button onClick={() => { const allSel = selMods.size === mods.length; setSelMods(allSel ? new Set() : new Set(mods.map((_, i) => i))); }} style={{ background: 'transparent', border: '1px solid #3a4252', color: '#e8e2d4', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{selMods.size === mods.length && mods.length > 0 ? 'None' : 'All'}</button>
              <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Duplicate</button>
              <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Move/Copy</button>
              <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={12} /></button>
              <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#cf6f6f' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={12} /></button>
              <span style={{ flex: 1 }} />
              <button onClick={() => setModEdit(false)} style={{ background: '#d8a84e', border: '1px solid #d8a84e', color: '#15110a', borderRadius: 4, padding: '5px 16px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Done</button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* Move/Copy modal */}
    {moveModal && tpl && (
      <div
        onClick={() => setMoveModal(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: 420, overflow: 'hidden', background: '#181c24', border: '1px solid #2a3140', borderRadius: 10 }}
        >
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a3140', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8d96a6', fontWeight: 700, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>Move/Copy</p>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '2px 0 0', color: '#f4f1ea', letterSpacing: '-0.025em', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>{moveModal.count} item{moveModal.count === 1 ? '' : 's'}</h3>
            </div>
            <button onClick={() => setMoveModal(null)} style={{ background: 'transparent', border: 0, color: '#8d96a6', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#8d96a6' }}>Destination template</label>
            <select style={{ background: 'transparent', border: 0, borderBottom: '1px solid #3a4252', color: '#f4f1ea', font: 'inherit', fontSize: 13, padding: '6px 0', outline: 'none' }}>
              {RICH.map((t) => <option key={t.id} value={t.id} style={{ background: '#181c24' }}>{t.name}</option>)}
            </select>
            <label style={{ fontSize: 12, color: '#8d96a6', marginTop: 6 }}>Destination category</label>
            <select style={{ background: 'transparent', border: 0, borderBottom: '1px solid #3a4252', color: '#f4f1ea', font: 'inherit', fontSize: 13, padding: '6px 0', outline: 'none' }}>
              {visibleCats.map((c, i) => <option key={(c.id ?? c.name) + '-' + i} style={{ background: '#181c24' }}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ padding: '12px 14px', borderTop: '1px solid #2a3140', background: '#12151c', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setMoveModal(null)} style={{ background: 'transparent', color: '#8d96a6', border: 0, padding: '4px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={() => setMoveModal(null)} style={{ background: 'transparent', color: '#8d96a6', border: 0, padding: '4px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Copy</button>
            <button onClick={() => setMoveModal(null)} style={{ background: '#d8a84e', color: '#15110a', border: '1px solid #d8a84e', borderRadius: 6, fontSize: 12, padding: '6px 12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Move</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
