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

   Interaction model
   -----------------
   The prototype's `RICH` was a frozen module-level constant — most of its
   buttons were visual only. This port keeps a *mutable* local copy of the
   normalised data (`rich` state) seeded from the `templates` prop, so every
   interactive control actually mutates state: New Module / New Category /
   New Entity, the Select/edit bulk actions (Duplicate / Delete), inline
   rename of templates, modules, categories, entities and checklist items,
   drag-reorder of module tabs, the per-entity colour picker, and the per-row
   "more" menus. None of this is persisted to a backend in this pass — exactly
   as the prototype intended. "New Template" still calls the onCreateTemplate
   prop (template creation is owned by the host).

   The two per-row "more" menus (template rows, entity rows) are rendered into
   a document.body portal at fixed coordinates measured from the trigger, so
   the parent panels' `overflow: hidden` can never clip them or spawn
   scrollbars.
*/
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

/* "More" popup — rendered into a document.body portal at fixed coords so
   the panels' overflow:hidden can never clip it. Literal hex colours
   because the portal renders outside the .ed-scope CSS-variable root. */
.ed-tpl-menu {
  position: fixed; z-index: 4000;
  background: #181c24; border: 1px solid #3a4252; border-radius: 8px;
  padding: 4px; box-shadow: 0 12px 30px rgba(0,0,0,0.55);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.ed-tpl-menu button {
  display: block; width: 100%; text-align: left;
  background: transparent; border: 0; color: #f4f1ea;
  padding: 7px 10px; font-size: 12px; border-radius: 4px;
  cursor: pointer; font-family: inherit;
}
.ed-tpl-menu button:hover { background: #232834; }
.ed-tpl-menu button.danger { color: #cf6f6f; }
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

/* Entity colours cycled through when a brand-new entity is created. */
const ENTITY_COLORS = [
  '#e07a5e', '#7ab7e6', '#c293e6', '#a6e07a', '#d8a84e', '#ec8a9a',
  '#5fc7b0', '#9aa3b2',
];

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

/* Monotonic id generator — every new module/category/item/entity gets a
   stable unique React key so renames and reorders don't churn the tree. */
let _uid = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(_uid++).toString(36)}`;

/* Normalise the `templates` prop into the editor's mutable working shape. */
const buildRich = (templates) => templates.map((t, i) => {
  const mods = modulesOf(t).map((m, mi) => ({
    id: m?.id ?? newId('m'),
    name: m?.name || `Module ${mi + 1}`,
    categories: categoriesOf(m).map((c, ci) => ({
      id: c?.id ?? newId('c'),
      name: c?.name || `Category ${ci + 1}`,
      items: checklistOf(c).map((it) => ({ id: newId('i'), text: itemText(it) })),
    })),
  }));
  const roster = entitiesOf(t).map((e, ei) => ({
    id: e?.id ?? newId('e'),
    role: e?.name || e?.role || `Entity ${ei + 1}`,
    color: toHex6(e?.color),
  }));
  return {
    id: t?.id ?? `t${i}`,
    name: t?.name || 'Untitled Template',
    accent: t?.accent || ACCENTS[i % ACCENTS.length],
    modules: mods,
    roster,
  };
});

/* ============================================================
   Fixed-position "more" menu, portalled to document.body.
   `anchorRect` is the trigger's getBoundingClientRect(); the menu
   pins its top-right corner just under the trigger, then flips
   above / leftwards if it would overflow the viewport.
   ============================================================ */
function MoreMenu({ anchorRect, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  /* Close on outside click / Escape / scroll — same dismiss feel as the
     prototype's onMouseLeave, but robust now that it floats over the page. */
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  /* Measure the menu once mounted, then place it inside the viewport. */
  useEffect(() => {
    if (!ref.current || !anchorRect) return;
    const mw = ref.current.offsetWidth || 170;
    const mh = ref.current.offsetHeight || 40;
    let left = anchorRect.right - mw;
    let top = anchorRect.bottom + 4;
    if (left < 8) left = 8;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
    if (top + mh > window.innerHeight - 8) top = anchorRect.top - mh - 4;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [anchorRect]);

  if (!anchorRect) return null;

  return createPortal(
    <div
      ref={ref}
      className="ed-tpl-menu"
      style={{
        minWidth: 150,
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {items.map(({ label, danger, onClick }) => (
        <button
          key={label}
          className={danger ? 'danger' : undefined}
          onClick={() => { onClick(); onClose(); }}
        >
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default function TemplatesEditor({
  templates = [],
  user = null,
  templatesLocked = false,
  onNav,
  onCreateTemplate,
}) {
  /* ---- mutable working data ----
     Seeded from the `templates` prop, then owned locally so every editor
     action below actually mutates it. Re-seeded whenever the prop identity
     changes (e.g. the host adds a template via onCreateTemplate). */
  const [rich, setRich] = useState(() => buildRich(templates));
  useEffect(() => { setRich(buildRich(templates)); }, [templates]);

  /* ---- selection / edit state ---- */
  const [selectedId, setSelected] = useState(null);
  const [openCat, setOpenCat] = useState(-1);
  const [tplEdit, setTplEdit] = useState(false);
  const [selTpls, setSelTpls] = useState(() => new Set());
  const toggleTplSel = (id) => setSelTpls((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const tplSelCount = selTpls.size;
  const [tplMenu, setTplMenu] = useState(null);       // { id, rect }
  const [entityMenu, setEntityMenu] = useState(null); // { id, rect }
  const [dragMod, setDragMod] = useState(null);
  const [entityEdit, setEntityEdit] = useState(false);
  const [selEntities, setSelEntities] = useState(() => new Set());
  const toggleEntitySel = (id) => setSelEntities((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [openColor, setOpenColor] = useState(null);   // entity id whose picker is open
  const [roleColors, setRoleColors] = useState({});   // { entityId: { color, opacity } } picker fill state
  const [openMod, setOpenMod] = useState(0);
  const [modEdit, setModEdit] = useState(false);
  const [modRename, setModRename] = useState(null);   // module index in rename mode
  const [selMods, setSelMods] = useState(() => new Set());
  const toggleModSel = (mi) => setSelMods((prev) => { const n = new Set(prev); n.has(mi) ? n.delete(mi) : n.add(mi); return n; });
  const [catEdit, setCatEdit] = useState(false);
  const [selCats, setSelCats] = useState(() => new Set());
  const toggleCatSel = (id) => setSelCats((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [moveModal, setMoveModal] = useState(null);
  const [colorTab, setColorTab] = useState({});
  const [layerTab, setLayerTab] = useState({});       // { entityId: 'fill' | 'border' }
  const [borderColors, setBorderColors] = useState({});
  const [matchFill, setMatchFill] = useState({});     // { entityId: bool }

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

  /* Default the open template to the first one once data arrives, and keep
     `selectedId` valid if the open template gets deleted. */
  useEffect(() => {
    if (!rich.length) { if (selectedId != null) setSelected(null); return; }
    if (selectedId == null || !rich.some((t) => t.id === selectedId)) {
      setSelected(rich[0].id);
      setOpenMod(0);
      setOpenCat(-1);
    }
  }, [rich, selectedId]);

  const tpl = rich.find((t) => t.id === selectedId) || rich[0] || null;
  const orderedMods = tpl ? tpl.modules : [];

  /* ============================================================
     Mutators — every one returns a fresh `rich` array. They are the
     single source of truth for "make every button function".
     ============================================================ */

  /* Map over one template by id and replace it with `fn`'s result. */
  const mutateTpl = useCallback((tid, fn) => {
    setRich((prev) => prev.map((t) => (t.id === tid ? fn(t) : t)));
  }, []);

  /* --- template-level --- */
  const renameTemplate = (tid, name) => {
    const v = name.trim();
    if (!v) return;
    mutateTpl(tid, (t) => (t.name === v ? t : { ...t, name: v }));
  };
  const duplicateTemplates = (ids) => {
    setRich((prev) => {
      const out = [];
      prev.forEach((t) => {
        out.push(t);
        if (ids.has(t.id)) {
          out.push({
            ...t,
            id: newId('t'),
            name: `${t.name} copy`,
            modules: t.modules.map((m) => ({
              ...m, id: newId('m'),
              categories: m.categories.map((c) => ({
                ...c, id: newId('c'),
                items: c.items.map((it) => ({ ...it, id: newId('i') })),
              })),
            })),
            roster: t.roster.map((r) => ({ ...r, id: newId('e') })),
          });
        }
      });
      return out;
    });
  };
  const deleteTemplates = (ids) => {
    setRich((prev) => prev.filter((t) => !ids.has(t.id)));
  };

  /* --- module-level --- */
  const addModule = () => {
    if (!tpl) return;
    const existing = orderedMods.map((m) => m.name);
    let n = 1, name;
    do { name = `Module ${n++}`; } while (existing.includes(name));
    mutateTpl(tpl.id, (t) => ({ ...t, modules: [...t.modules, { id: newId('m'), name, categories: [] }] }));
    /* Focus + open the brand-new tab and drop it straight into rename mode. */
    const newIndex = orderedMods.length;
    setTimeout(() => { setOpenMod(newIndex); setOpenCat(-1); setModRename(newIndex); }, 0);
  };
  const renameModule = (mi, name) => {
    const v = name.trim();
    if (!v || !tpl) { setModRename(null); return; }
    mutateTpl(tpl.id, (t) => {
      const modules = t.modules.slice();
      if (modules[mi] && modules[mi].name !== v) modules[mi] = { ...modules[mi], name: v };
      return { ...t, modules };
    });
    setModRename(null);
  };
  const reorderMods = (from, to) => {
    if (from === to || from == null || to == null || !tpl) return;
    mutateTpl(tpl.id, (t) => {
      const modules = t.modules.slice();
      const [moved] = modules.splice(from, 1);
      modules.splice(to, 0, moved);
      return { ...t, modules };
    });
    if (openMod === from) setOpenMod(to);
    else if (from < openMod && to >= openMod) setOpenMod(openMod - 1);
    else if (from > openMod && to <= openMod) setOpenMod(openMod + 1);
  };
  const deleteModules = (indices) => {
    if (!tpl || !indices.size) return;
    mutateTpl(tpl.id, (t) => ({ ...t, modules: t.modules.filter((_, i) => !indices.has(i)) }));
    setSelMods(new Set());
    setOpenMod(0);
    setOpenCat(-1);
  };
  const duplicateModules = (indices) => {
    if (!tpl || !indices.size) return;
    mutateTpl(tpl.id, (t) => {
      const out = [];
      t.modules.forEach((m, i) => {
        out.push(m);
        if (indices.has(i)) {
          out.push({
            ...m, id: newId('m'), name: `${m.name} copy`,
            categories: m.categories.map((c) => ({
              ...c, id: newId('c'),
              items: c.items.map((it) => ({ ...it, id: newId('i') })),
            })),
          });
        }
      });
      return { ...t, modules: out };
    });
    setSelMods(new Set());
  };

  /* --- category-level (always scoped to the open module) --- */
  const mutateOpenModule = (fn) => {
    if (!tpl) return;
    mutateTpl(tpl.id, (t) => {
      const modules = t.modules.slice();
      if (!modules[openMod]) return t;
      modules[openMod] = fn(modules[openMod]);
      return { ...t, modules };
    });
  };
  const addCategory = () => {
    if (!tpl || !orderedMods[openMod]) return;
    const existing = (orderedMods[openMod].categories || []).map((c) => c.name);
    let n = 1, name;
    do { name = `Category ${n++}`; } while (existing.includes(name));
    mutateOpenModule((m) => ({
      ...m,
      categories: [...m.categories, { id: newId('c'), name, items: [] }],
    }));
    /* Open the new category so its (empty) checklist is immediately visible. */
    setTimeout(() => setOpenCat((orderedMods[openMod].categories || []).length), 0);
  };
  const renameCategory = (ci, name) => {
    const v = name.trim();
    if (!v) return;
    mutateOpenModule((m) => {
      const categories = m.categories.slice();
      if (categories[ci] && categories[ci].name !== v) categories[ci] = { ...categories[ci], name: v };
      return { ...m, categories };
    });
  };
  const deleteCategories = (ids) => {
    if (!ids.size) return;
    mutateOpenModule((m) => ({ ...m, categories: m.categories.filter((c) => !ids.has(c.id)) }));
    setSelCats(new Set());
    setOpenCat(-1);
  };
  const duplicateCategories = (ids) => {
    if (!ids.size) return;
    mutateOpenModule((m) => {
      const out = [];
      m.categories.forEach((c) => {
        out.push(c);
        if (ids.has(c.id)) {
          out.push({
            ...c, id: newId('c'), name: `${c.name} copy`,
            items: c.items.map((it) => ({ ...it, id: newId('i') })),
          });
        }
      });
      return { ...m, categories: out };
    });
    setSelCats(new Set());
  };

  /* --- checklist-item-level (scoped to a category in the open module) --- */
  const mutateCategory = (ci, fn) => {
    mutateOpenModule((m) => {
      const categories = m.categories.slice();
      if (!categories[ci]) return m;
      categories[ci] = fn(categories[ci]);
      return { ...m, categories };
    });
  };
  const addItem = (ci) => mutateCategory(ci, (c) => ({ ...c, items: [...c.items, { id: newId('i'), text: '' }] }));
  const renameItem = (ci, itemId, text) => mutateCategory(ci, (c) => ({
    ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, text } : it)),
  }));
  const deleteItem = (ci, itemId) => mutateCategory(ci, (c) => ({
    ...c, items: c.items.filter((it) => it.id !== itemId),
  }));

  /* --- entity-level --- */
  const addEntity = () => {
    if (!tpl) return;
    const existing = tpl.roster.map((r) => r.role);
    let n = 1, role;
    do { role = `Entity ${n++}`; } while (existing.includes(role));
    const color = ENTITY_COLORS[tpl.roster.length % ENTITY_COLORS.length];
    const id = newId('e');
    mutateTpl(tpl.id, (t) => ({ ...t, roster: [...t.roster, { id, role, color }] }));
    /* Open the new entity's colour picker so it reads as "freshly added". */
    setTimeout(() => setOpenColor(id), 0);
  };
  const renameEntity = (eid, role) => {
    const v = role.trim();
    if (!v || !tpl) return;
    mutateTpl(tpl.id, (t) => ({
      ...t, roster: t.roster.map((r) => (r.id === eid ? (r.role === v ? r : { ...r, role: v }) : r)),
    }));
  };
  const setEntityColor = (eid, color) => {
    if (!tpl) return;
    mutateTpl(tpl.id, (t) => ({
      ...t, roster: t.roster.map((r) => (r.id === eid ? { ...r, color } : r)),
    }));
  };
  const deleteEntities = (ids) => {
    if (!tpl || !ids.size) return;
    mutateTpl(tpl.id, (t) => ({ ...t, roster: t.roster.filter((r) => !ids.has(r.id)) }));
    setSelEntities(new Set());
  };
  const duplicateEntities = (ids) => {
    if (!tpl || !ids.size) return;
    mutateTpl(tpl.id, (t) => {
      const out = [];
      t.roster.forEach((r) => {
        out.push(r);
        if (ids.has(r.id)) out.push({ ...r, id: newId('e'), role: `${r.role} copy` });
      });
      return { ...t, roster: out };
    });
    setSelEntities(new Set());
  };

  const subtitle = (
    <span><b>{rich.length}</b> templates · reusable category + checklist sets</span>
  );
  const actions = <><Search placeholder="Search Templates..." /></>;

  /* Categories shown for the open module. */
  const activeMod = orderedMods[openMod] || orderedMods[0] || { categories: [] };
  const visibleCats = activeMod.categories || [];

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
                      const allSel = tplSelCount === rich.length && rich.length > 0;
                      return (
                        <button
                          onClick={() => setSelTpls(allSel ? new Set() : new Set(rich.map((t) => t.id)))}
                          style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: 'var(--ink-soft)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >{allSel ? 'None' : 'All'}</button>
                      );
                    })()}
                    <button onClick={() => { if (tplSelCount) { duplicateTemplates(selTpls); setSelTpls(new Set()); } }} disabled={!tplSelCount} style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: tplSelCount ? 'var(--ink-soft)' : 'var(--ink-quiet)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: tplSelCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Duplicate</button>
                    <button disabled={!tplSelCount} style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: tplSelCount ? 'var(--ink-soft)' : 'var(--ink-quiet)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: tplSelCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={11} /></button>
                    <button onClick={() => { if (tplSelCount) { deleteTemplates(selTpls); setSelTpls(new Set()); } }} disabled={!tplSelCount} style={{ background: 'transparent', border: '1px solid var(--rule-strong)', color: tplSelCount ? '#cf6f6f' : 'var(--ink-quiet)', borderRadius: 2, padding: '2px 5px', fontSize: 10, cursor: tplSelCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={11} /></button>
                  </>
                )}
              </div>
            </div>
            <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
              {rich.length === 0 && (
                <div className="meta" style={{ padding: '20px 8px', fontSize: 11.5 }}>No templates yet — create one to get started.</div>
              )}
              {rich.map((t) => {
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
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTplMenu((m) => (m && m.id === t.id ? null : { id: t.id, rect }));
                          }}
                          style={{ background: 'transparent', border: 0, color: 'var(--ink-200)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
                          title="More"
                        >⋯</button>
                      )}
                    </div>
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
                  onBlur={(e) => renameTemplate(tpl.id, e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = tpl.name; e.currentTarget.blur(); } }}
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
                    const catCount = (mod.categories || []).length;
                    return (
                      <div
                        key={mod.id}
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
                            onBlur={(e) => renameModule(mi, e.currentTarget.value)}
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
                          <button onClick={() => setSelCats(allSel ? new Set() : new Set(visibleCats.map((cat) => cat.id)))} style={{ ...baseBtn, color: 'var(--ink-soft)' }}>{allSel ? 'None' : 'All'}</button>
                          <button disabled={!c} onClick={() => duplicateCategories(selCats)} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Duplicate</button>
                          <button disabled={!c} onClick={() => setMoveModal({ count: c })} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Move/Copy</button>
                          <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={11} /></button>
                          <button disabled={!c} onClick={() => deleteCategories(selCats)} style={{ ...baseBtn, color: c ? '#cf6f6f' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={11} /></button>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <button onClick={addCategory} className="btn-ink" style={{ padding: '4px 8px', fontSize: 11, gap: 4, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: 'none' }}>
                  <Icon name="plus" size={11} />New Category
                </button>
              </div>

              {/* Expandable category list */}
              <div className="slim-scroll" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4, flex: 1, minHeight: 0 }}>
                {visibleCats.length === 0 && (
                  <div className="meta" style={{ padding: '16px 4px', fontSize: 11.5 }}>This module has no categories yet.</div>
                )}
                {visibleCats.map((c, i) => {
                  const items = c.items || [];
                  const open = openCat === i;
                  const isSel = selCats.has(c.id);
                  return (
                    <div key={c.id} className="card-line" style={{ overflow: 'hidden', flexShrink: 0 }}>
                      {/* Row header */}
                      <div
                        onClick={() => { if (catEdit) toggleCatSel(c.id); }}
                        style={{
                          width: '100%', display: 'grid', gridTemplateColumns: catEdit ? '14px 20px 1fr auto 16px' : '14px 20px 1fr auto', gap: 8,
                          alignItems: 'center', padding: '3px 10px',
                          cursor: catEdit ? 'pointer' : 'default',
                          background: catEdit && isSel ? 'rgba(216,168,78,0.08)' : 'transparent',
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
                          key={c.id + ':' + c.name}
                          title="Click to rename"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.currentTarget.select()}
                          onBlur={(e) => renameCategory(i, e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = c.name; e.currentTarget.blur(); } }}
                          style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2, width: 'max-content', maxWidth: '100%', minWidth: 40 }}
                        />
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-quiet)', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{items.length} items</span>
                        {catEdit && (
                          <span
                            onClick={(e) => { e.stopPropagation(); toggleCatSel(c.id); }}
                            style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--rule-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            {isSel && <span style={{ color: 'var(--paper)', fontSize: 10, lineHeight: 1 }}>✓</span>}
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
                                key={it.id}
                                style={{
                                  display: 'grid', gridTemplateColumns: '14px 1fr 16px',
                                  alignItems: 'center', gap: 6, padding: '3px 0',
                                  borderBottom: j === items.length - 1 ? 0 : '1px dashed var(--rule)',
                                }}
                              >
                                <span style={{ color: 'var(--ink-muted)', fontSize: 11, cursor: 'grab' }}>⋮⋮</span>
                                <input
                                  className="inline-edit"
                                  defaultValue={it.text}
                                  placeholder="Checklist item"
                                  onBlur={(e) => renameItem(i, it.id, e.currentTarget.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = it.text; e.currentTarget.blur(); } }}
                                />
                                <button
                                  title="Delete item"
                                  onClick={(e) => { e.stopPropagation(); deleteItem(i, it.id); }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#cf6f6f'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-quiet)'; }}
                                  style={{ background: 'transparent', border: 0, color: 'var(--ink-quiet)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
                                >×</button>
                              </div>
                            ))}
                            <button
                              onClick={() => addItem(i)}
                              style={{
                                width: '100%', padding: '6px 10px', marginTop: 6,
                                border: '1px dashed var(--rule-strong)', background: 'transparent',
                                color: 'var(--ink-muted)', borderRadius: 2, fontSize: 11.5,
                                cursor: 'pointer', fontFamily: 'inherit',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                              }}
                            >
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
                <button onClick={addEntity} disabled={!tpl} className="btn-ink" style={{ padding: '4px 8px', fontSize: 11, gap: 4, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: 'none', opacity: tpl ? 1 : 0.5, cursor: tpl ? 'pointer' : 'not-allowed' }}>
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
                      <button onClick={() => setSelEntities(allSel ? new Set() : new Set(tpl.roster.map((r) => r.id)))} style={{ ...baseBtn, color: 'var(--ink-soft)' }}>{allSel ? 'None' : 'All'}</button>
                      <button disabled={!c} onClick={() => duplicateEntities(selEntities)} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Duplicate</button>
                      <button disabled={!c} onClick={() => setMoveModal({ count: c })} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed' }}>Move/Copy</button>
                      <button disabled={!c} style={{ ...baseBtn, color: c ? 'var(--ink-soft)' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={10} /></button>
                      <button disabled={!c} onClick={() => deleteEntities(selEntities)} style={{ ...baseBtn, color: c ? '#cf6f6f' : 'var(--ink-quiet)', cursor: c ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={10} /></button>
                    </>
                  );
                })()}
              </div>

              <div className="slim-scroll" style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1, minHeight: 0 }}>
                {(!tpl || tpl.roster.length === 0) && (
                  <div className="meta" style={{ fontSize: 11.5, padding: '12px 2px' }}>No entities on this template yet.</div>
                )}
                {tpl && tpl.roster.map((r) => {
                  const c = roleColors[r.id]?.color || r.color || '#8c8c8a';
                  const op = roleColors[r.id]?.opacity ?? 0.35;
                  const alpha = Math.round(op * 255).toString(16).padStart(2, '0');
                  const isOpen = openColor === r.id;
                  const isSel = selEntities.has(r.id);
                  return (
                    <div key={r.id}>
                      <div className="card-line" style={{
                        display: 'grid', gridTemplateColumns: '14px 18px 1fr 16px', gap: 10,
                        padding: '8px 10px', alignItems: 'center',
                        height: 38, boxSizing: 'border-box',
                      }}>
                        <span style={{ color: 'var(--ink-muted)', fontSize: 12, cursor: 'grab', userSelect: 'none', lineHeight: 1 }}>⋮⋮</span>
                        <button
                          onClick={() => setOpenColor(isOpen ? null : r.id)}
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
                          key={r.id + ':' + r.role}
                          onDoubleClick={(e) => e.currentTarget.select()}
                          onBlur={(e) => renameEntity(r.id, e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = r.role; e.currentTarget.blur(); } }}
                          style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}
                        />
                        {!isOpen && (
                          entityEdit ? (
                            <span
                              onClick={(e) => { e.stopPropagation(); toggleEntitySel(r.id); }}
                              style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--rule-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                            >
                              {isSel && <span style={{ color: 'var(--paper)', fontSize: 10, lineHeight: 1 }}>✓</span>}
                            </span>
                          ) : (
                            <button
                              title="More"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setEntityMenu((m) => (m && m.id === r.id ? null : { id: r.id, rect }));
                              }}
                              style={{ background: 'transparent', border: 0, color: 'var(--ink-muted)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', lineHeight: 1, fontFamily: 'inherit', borderRadius: 4 }}
                            >⋯</button>
                          )
                        )}
                      </div>
                      {isOpen && (() => {
                        const tab = colorTab[r.id] || 'presets';
                        const layer = layerTab[r.id] || 'fill';
                        const match = !!matchFill[r.id];
                        const fillData = { color: c, opacity: op };
                        const borderData = borderColors[r.id] || { color: c, opacity: op };
                        const isBorderMatched = layer === 'border' && match;
                        const activeData = isBorderMatched ? fillData : (layer === 'border' ? borderData : fillData);
                        const activeColor = activeData.color;
                        const activeOp = activeData.opacity;
                        /* Picker writes both into the editor's local picker state
                           AND, for fill, straight into the entity's working data
                           so the left-rail swatch updates live. */
                        const setColor = (color) => {
                          if (isBorderMatched) return;
                          if (layer === 'border') {
                            setBorderColors({ ...borderColors, [r.id]: { color, opacity: borderData.opacity } });
                          } else {
                            setRoleColors({ ...roleColors, [r.id]: { color, opacity: op } });
                            setEntityColor(r.id, color);
                          }
                        };
                        const setOpacity = (opacity) => {
                          if (isBorderMatched) return;
                          if (layer === 'border') setBorderColors({ ...borderColors, [r.id]: { color: borderData.color, opacity } });
                          else setRoleColors({ ...roleColors, [r.id]: { color: c, opacity } });
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
                                  onClick={() => setLayerTab({ ...layerTab, [r.id]: k })}
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
                                    onClick={() => setColorTab({ ...colorTab, [r.id]: 'presets' })}
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
                                    onClick={() => setColorTab({ ...colorTab, [r.id]: 'custom' })}
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
                                    onChange={(e) => setMatchFill({ ...matchFill, [r.id]: e.target.checked })}
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

    {/* ---------- Per-row "more" menus — portalled, fixed-position ---------- */}
    {tplMenu && (() => {
      const t = rich.find((x) => x.id === tplMenu.id);
      if (!t) return null;
      return (
        <MoreMenu
          anchorRect={tplMenu.rect}
          onClose={() => setTplMenu(null)}
          items={[
            { label: 'Copy', onClick: () => duplicateTemplates(new Set([t.id])) },
            { label: 'Rename', onClick: () => { setSelected(t.id); setTplEdit(false); } },
            { label: 'Share', onClick: () => {} },
            { label: 'Delete', danger: true, onClick: () => deleteTemplates(new Set([t.id])) },
          ]}
        />
      );
    })()}
    {entityMenu && tpl && (() => {
      const ent = tpl.roster.find((x) => x.id === entityMenu.id);
      if (!ent) return null;
      return (
        <MoreMenu
          anchorRect={entityMenu.rect}
          onClose={() => setEntityMenu(null)}
          items={[
            { label: 'Duplicate', onClick: () => duplicateEntities(new Set([ent.id])) },
            { label: 'Move/Copy', onClick: () => setMoveModal({ count: 1 }) },
            { label: 'Share', onClick: () => {} },
            { label: 'Rename', onClick: () => setOpenColor(null) },
            { label: 'Delete', danger: true, onClick: () => deleteEntities(new Set([ent.id])) },
          ]}
        />
      );
    })()}

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
                  <div key={mod.id} draggable style={{
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
                      key={mod.id + ':' + mod.name}
                      onBlur={(e) => renameModule(mi, e.currentTarget.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = mod.name; e.currentTarget.blur(); } }}
                      style={{ background: 'transparent', border: 0, borderBottom: '1px solid transparent', color: '#f4f1ea', font: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '4px 0', width: '100%', outline: 'none' }}
                    />
                    <span style={{ fontSize: 10, color: '#5a6473', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{(mod.categories || []).length}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '0 10px 8px', flex: 'none' }}>
              <button onClick={addModule} style={{ width: '100%', padding: '6px 10px', border: '1px dashed #3a4252', background: 'transparent', color: '#8d96a6', borderRadius: 2, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>+</span> New Module
              </button>
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid #2a3140', background: '#12151c', display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
              <button onClick={() => { const allSel = selMods.size === mods.length; setSelMods(allSel ? new Set() : new Set(mods.map((_, i) => i))); }} style={{ background: 'transparent', border: '1px solid #3a4252', color: '#e8e2d4', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{selMods.size === mods.length && mods.length > 0 ? 'None' : 'All'}</button>
              <button onClick={() => duplicateModules(selMods)} disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Duplicate</button>
              <button onClick={() => { if (selCount) setMoveModal({ count: selCount }); }} disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Move/Copy</button>
              <button disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={12} /></button>
              <button onClick={() => deleteModules(selMods)} disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#cf6f6f' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Delete"><Icon name="trash" size={12} /></button>
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
              {rich.map((t) => <option key={t.id} value={t.id} style={{ background: '#181c24' }}>{t.name}</option>)}
            </select>
            <label style={{ fontSize: 12, color: '#8d96a6', marginTop: 6 }}>Destination category</label>
            <select style={{ background: 'transparent', border: 0, borderBottom: '1px solid #3a4252', color: '#f4f1ea', font: 'inherit', fontSize: 13, padding: '6px 0', outline: 'none' }}>
              {visibleCats.map((c) => <option key={c.id} style={{ background: '#181c24' }}>{c.name}</option>)}
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
