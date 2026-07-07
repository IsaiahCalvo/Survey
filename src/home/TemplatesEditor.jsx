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
     template.entities  (the right-panel "Entities")

   Interaction model
   -----------------
   The prototype's `RICH` was a frozen module-level constant — most of its
   buttons were visual only. This port keeps a *mutable* local copy of the
   normalised data (`rich` state) seeded from the `templates` prop, so every
   interactive control actually mutates state: New Module / New Category /
   New Entity, the Select/edit bulk actions (Duplicate / Delete), inline
   rename of templates, modules, categories, entities and checklist items,
   drag-reorder of templates, module tabs, categories, and entities, the per-entity colour picker, and the per-row
   "more" menus. None of this is persisted to a backend in this pass — exactly
   as the prototype intended. "New Template" still calls the onCreateTemplate
   prop (template creation is owned by the host).

   The two per-row "more" menus (template rows, entity rows) are rendered into
   a document.body portal at fixed coordinates measured from the trigger, so
   the parent panels' `overflow: hidden` can never clip them or spawn
   scrollbars.
*/
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HubShell, Icon, Search } from './HubShell';
import {
  resolveTemplatesReload,
  createStableIdMint,
  createOccurrenceKeyer,
  seedColorMaps,
  resolveTitleCommit,
} from './templatesEditorReload';
import CompactColorPicker from '../components/CompactColorPicker';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from '../reorder/SortableRearrangeList';
import {
  archiveChecklistItem,
  isActiveChecklistItem,
  isArchivedChecklistItem,
  archivedItemLabel,
} from '../services/checklistOrphanCleanup';
import { moveItemById } from '../reorder/flatReorderUtils.js';
import { pickByIds, removeByIds, duplicateAfterByIds } from './selectionById.js';
import { closeButtonStyle, miniButtonStyle, miniSelectButtonStyle, moreButtonStyle } from './hubControls';

const CATEGORY_COLLAPSE_TRANSITION = 'grid-template-rows 0.18s ease, opacity 0.16s ease';
const TEMPLATE_ORDER_STORAGE_KEY = 'surveyHub.templateOrder';
const animateCategoryLayoutChanges = undefined;

const templateMatchesSearch = (template, query) => {
  if (!query) return true;
  const haystack = [
    template.name,
    ...(template.modules || []).flatMap((mod) => [
      mod.name,
      ...(mod.categories || []).flatMap((cat) => [
        cat.name,
        ...(cat.items || []).map((item) => item.text || item.lastKnownLabel),
      ]),
    ]),
    ...(template.roster || []).map((entity) => entity.role),
  ];
  return haystack.some((value) => String(value || '').toLowerCase().includes(query));
};

const restrictSortableToHorizontalAxis = ({ transform }) => ({
  ...transform,
  y: 0,
});

const getModuleTabClampBounds = (activeId) => {
  if (typeof document === 'undefined') return null;
  const activeNode = Array.from(document.querySelectorAll('[data-module-tab-id]'))
    .find((node) => node.getAttribute('data-module-tab-id') === String(activeId ?? ''));
  const listNode = activeNode?.closest?.('[data-module-tab-list]');
  if (!activeNode || !listNode) return null;

  const listRect = listNode.getBoundingClientRect();
  const activeRect = activeNode.getBoundingClientRect();
  const tabRects = Array.from(listNode.querySelectorAll('[data-module-tab-id]'))
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute('data-module-tab-id'),
        left: rect.left - listRect.left,
        width: rect.width,
      };
    })
    .filter((rect) => rect.width > 0);

  if (!tabRects.length) return null;

  const activeLeft = activeRect.left - listRect.left;
  const firstSlotLeft = Math.min(...tabRects.map((rect) => rect.left));
  const lastSlotLeft = Math.max(...tabRects.map((rect) => rect.left));

  return {
    minX: firstSlotLeft - activeLeft,
    maxX: lastSlotLeft - activeLeft,
  };
};

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
const entitiesOf = (t) => t?.entities || t?.config?.entities || [];
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

/* Normalise the `templates` prop into the editor's mutable working shape.
   BL-23: `mint(key, prefix)` supplies ids for legacy rows that lack one. The
   component passes a session-stable cached mint so id-less rows keep the same
   id across rebuilds (their keyed inputs would otherwise remount on every
   background refresh and wipe uncommitted typing). Keys are semantic
   (name + occurrence within scope) so a remote insertion above doesn't shift
   surviving rows' ids; identically-named id-less siblings remain the accepted
   occurrence-shift corner pinned in tests. */
const buildRich = (templates, mint = (_key, prefix) => newId(prefix)) => templates.map((t, i) => {
  const keyer = createOccurrenceKeyer();
  const tplScope = t?.id ?? `t${i}`;
  const mods = modulesOf(t).map((m, mi) => {
    const modKey = keyer(tplScope, `m:${m?.name || `Module ${mi + 1}`}`);
    return {
    id: m?.id ?? mint(modKey, 'm'),
    name: m?.name || `Module ${mi + 1}`,
    categories: categoriesOf(m).map((c, ci) => {
      const catKey = keyer(modKey, `c:${c?.name || `Category ${ci + 1}`}`);
      return {
      id: c?.id ?? mint(catKey, 'c'),
      name: c?.name || `Category ${ci + 1}`,
      items: checklistOf(c).map((it) => {
        /* Preserve stable item ids when the persisted row already has one —
           archived items rely on the same id the marker's checklist_responses
           key was written against. Only mint a new id for legacy rows that
           never had one. Also carry archive metadata through round-trip so
           "saved-then-reopened" archives keep their flag + label. */
        const text = itemText(it);
        const base = {
          id: (it && typeof it.id === 'string' && it.id) ? it.id : mint(keyer(catKey, `i:${text}`), 'i'),
          text,
        };
        if (it && typeof it === 'object') {
          if (it.archived === true) base.archived = true;
          if (typeof it.archivedAt === 'string') base.archivedAt = it.archivedAt;
          if (typeof it.lastKnownLabel === 'string') {
            base.lastKnownLabel = it.lastKnownLabel;
          } else if (it.archived === true && text) {
            base.lastKnownLabel = text;
          }
        }
        return base;
      }),
    };
    }),
  };
  });
  const roster = entitiesOf(t).map((e, ei) => ({
    id: e?.id ?? mint(keyer(tplScope, `e:${e?.name || e?.role || `Entity ${ei + 1}`}`), 'e'),
    role: e?.name || e?.role || `Entity ${ei + 1}`,
    color: toHex6(e?.color),
    /* Optional colour refinements persisted alongside the entity. Older
       templates won't have them — fall back to sensible defaults. */
    opacity: typeof e?.opacity === 'number' ? e.opacity : 0.35,
    borderColor: typeof e?.borderColor === 'string' ? e.borderColor : null,
    borderOpacity: typeof e?.borderOpacity === 'number' ? e.borderOpacity : null,
    matchFill: !!e?.matchFill,
  }));
  return {
    id: t?.id ?? `t${i}`,
    name: t?.name || 'Untitled Template',
    accent: t?.accent || ACCENTS[i % ACCENTS.length],
    modules: mods,
    roster,
  };
});

const templateOrderKeyForUser = (user) => `${TEMPLATE_ORDER_STORAGE_KEY}:${user?.id || user?.email || 'local'}`;

const loadTemplateOrderPreference = (user) => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(templateOrderKeyForUser(user)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const saveTemplateOrderPreference = (user, ids) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(templateOrderKeyForUser(user), JSON.stringify(ids.filter(Boolean)));
  } catch {
    /* Preference persistence is non-critical. */
  }
};

const applyTemplateOrderPreference = (templates, user) => {
  const order = loadTemplateOrderPreference(user);
  if (!order.length) return templates;

  const rank = new Map(order.map((id, index) => [id, index]));
  return [...templates].sort((a, b) => {
    const ai = rank.has(a?.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = rank.has(b?.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return 0;
  });
};

function SortableModuleTab({
  mod,
  index,
  isOn,
  catCount,
  isRenaming,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id: mod.id,
    disabled: isRenaming,
  });

  const activeInk = isOn ? 'var(--ink)' : 'var(--ink-muted)';
  const tabTransition = [
    isDragging ? null : transition,
    'background 0.15s ease',
    'box-shadow 0.15s ease',
    'opacity 0.15s ease',
  ].filter(Boolean).join(', ');

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(!isRenaming ? listeners : {})}
      data-module-tab-id={mod.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: tabTransition || undefined,
        display: 'flex',
        alignItems: 'center',
        marginBottom: -1,
        borderBottom: isOn ? '2px solid var(--ink)' : '2px solid transparent',
        borderRadius: '5px 5px 0 0',
        background: isDragging ? 'rgba(216,168,78,0.14)' : (isOn ? 'rgba(244,241,234,0.035)' : 'transparent'),
        boxShadow: isDragging ? '0 12px 26px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(216,168,78,0.28)' : 'none',
        cursor: isRenaming ? 'text' : (isDragging ? 'grabbing' : 'grab'),
        flex: '1 1 0',
        minWidth: 32,
        maxWidth: 140,
        overflow: 'hidden',
        position: 'relative',
        zIndex: isDragging ? 4 : (isOn ? 1 : 0),
        opacity: isDragging ? 0.94 : 1,
        touchAction: 'none',
        userSelect: isDragging || isSorting ? 'none' : undefined,
      }}
    >
      {isRenaming ? (
        <input
          className="inline-edit"
          defaultValue={mod.name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => onRename(mod.id, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') onCancelRename();
          }}
          style={{
            background: 'transparent',
            border: 0,
            padding: '3px 6px',
            fontSize: 12,
            fontWeight: isOn ? 500 : 400,
            color: activeInk,
            width: '100%',
            borderBottom: '1px solid var(--accent)',
            outline: 'none',
          }}
        />
      ) : (
        <button
          onClick={() => onOpen(index)}
          onDoubleClick={() => onStartRename(mod.id)}
          title={`${mod.name} · drag to reorder · double-click to rename`}
          style={{
            background: 'transparent',
            border: 0,
            padding: '3px 6px',
            fontFamily: 'inherit',
            color: activeInk,
            fontSize: 12,
            fontWeight: isOn ? 500 : 400,
            cursor: isDragging ? 'grabbing' : 'grab',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
          }}
        >
          {mod.name}
        </button>
      )}
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-quiet)', padding: '0 6px 0 2px', flex: 'none' }}>
        {catCount}
      </span>
    </div>
  );
}

function SortableModuleTabs({
  modules,
  openMod,
  modRename,
  onOpenModule,
  onStartRename,
  onRenameModule,
  onCancelRename,
  onReorderModules,
  children,
}) {
  const [activeId, setActiveId] = useState(null);
  const dragClampBoundsRef = useRef(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const modifiers = useMemo(() => [
    restrictSortableToHorizontalAxis,
    ({ transform }) => {
      const bounds = dragClampBoundsRef.current;
      if (!bounds) return transform;
      return {
        ...transform,
        x: Math.min(Math.max(transform.x, bounds.minX), bounds.maxX),
      };
    },
  ], []);

  const handleDragEnd = useCallback(({ active, over }) => {
    setActiveId(null);
    dragClampBoundsRef.current = null;
    if (!over || active.id === over.id) return;
    const fromIndex = modules.findIndex((mod) => mod.id === active.id);
    const toIndex = modules.findIndex((mod) => mod.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    flushSync(() => {
      onReorderModules(fromIndex, toIndex);
    });
  }, [modules, onReorderModules]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      onDragStart={({ active }) => {
        dragClampBoundsRef.current = getModuleTabClampBounds(active.id);
        setActiveId(active.id);
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        dragClampBoundsRef.current = null;
        setActiveId(null);
      }}
    >
      <SortableContext items={modules.map((mod) => mod.id)} strategy={horizontalListSortingStrategy}>
        <div
          data-module-tab-list={String(activeId ?? '')}
          style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderBottom: '1px solid var(--rule)', minHeight: 26 }}
        >
          {modules.map((mod, mi) => (
            <SortableModuleTab
              key={mod.id}
              mod={mod}
              index={mi}
              isOn={openMod === mi}
              catCount={(mod.categories || []).length}
              isRenaming={modRename === mod.id}
              onOpen={onOpenModule}
              onStartRename={onStartRename}
              onRename={onRenameModule}
              onCancelRename={onCancelRename}
            />
          ))}
          {children}
        </div>
      </SortableContext>
    </DndContext>
  );
}

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
    window.addEventListener('scroll', onClose, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onClose, { capture: true });
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

/* ============================================================
   CustomSelect — a styled dropdown that replaces native <select>.
   Native selects render an OS-themed popup that clashes with the
   editor's warm-dark "paper-and-ink" palette. This is a styled
   trigger button that opens a dark popup list. The popup is
   portalled to document.body and fixed-positioned (measured from
   the trigger) so the modal's overflow can never clip it.

   Palette / font are hard hex/literal because the popup renders
   outside the .ed-scope CSS-variable root:
     card #181c24 · deep #12151c · rule #2a3140 · ink #f4f1ea
     muted #8d96a6 · gold #d8a84e · font Helvetica Neue stack
   ============================================================ */
function CustomSelect({ value, options, onChange, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const selected = options.find((o) => o.value === value) || null;

  /* Dismiss on outside click / Escape / scroll — same feel as MoreMenu. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  /* Place the popup directly under the trigger, flipping up if it
     would overflow the viewport. */
  useEffect(() => {
    if (!open || !triggerRef.current) { setPos(null); return; }
    const r = triggerRef.current.getBoundingClientRect();
    const ph = Math.min(240, Math.max(40, options.length * 30 + 8));
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
    setPos({ left: r.left, top, width: r.width });
  }, [open, options.length]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          width: '100%', background: '#12151c', border: '1px solid #2a3140',
          borderRadius: 6, padding: '6px 10px', height: 32, boxSizing: 'border-box',
          color: selected ? '#f4f1ea' : '#8d96a6',
          font: 'inherit', fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', textAlign: 'left',
          outline: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: '#8d96a6', fontSize: 10, lineHeight: 1, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .12s', flex: 'none' }}>▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed', zIndex: 4100,
            left: pos.left, top: pos.top, width: pos.width,
            background: '#181c24', border: '1px solid #3a4252', borderRadius: 8,
            padding: 4, boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
            maxHeight: 240, overflowY: 'auto',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: '7px 10px', fontSize: 12, color: '#8d96a6' }}>No options</div>
          )}
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  width: '100%', textAlign: 'left', background: isSel ? '#232834' : 'transparent',
                  border: 0, color: isSel ? '#d8a84e' : '#f4f1ea',
                  padding: '7px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#232834'; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {isSel && <span style={{ color: '#d8a84e', fontSize: 11, flex: 'none' }}>✓</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#64748b',
];

export default function TemplatesEditor({
  templates = [],
  user = null,
  templatesLocked = false,
  onNav,
  onCreateTemplate,
  onSaveTemplates,
  onShare,
  /* KAL-44 — host-provided usage count for a checklist item. Returns the
     number of survey markers that have a response keyed under itemId. When
     > 0, deleting that item shows the archive confirmation modal instead of
     hard-deleting. Optional — when omitted, falls back to zero (hard-delete
     path), preserving pre-KAL-44 behavior for any caller that hasn't wired
     it up yet. */
  getChecklistItemUsageCount = null,
}) {
  /* ---- mutable working data ----
     Seeded from the `templates` prop, then owned locally so every editor
     action below actually mutates it. Re-seeded from the prop only while the
     editor has no unsaved edits (BL-23 dirty guard below). */
  /* Session-stable cached mint: legacy rows without a persisted id keep one
     minted id across every rebuild, so their keyed inputs don't remount on
     background refreshes (which wiped uncommitted typing). Lazy ref init keeps
     the identity stable without effect-dep churn. */
  const mintIdRef = useRef(null);
  if (mintIdRef.current === null) mintIdRef.current = createStableIdMint(new Map(), newId);
  const mintId = mintIdRef.current;
  const [rich, setRich] = useState(() => buildRich(applyTemplateOrderPreference(templates, user), mintId));
  const [search, setSearch] = useState('');
  const [modSearch, setModSearch] = useState('');
  /* True once the user edits anything; drives the Save / Cancel bar. Reset
     whenever the editor reloads from props, or on Save / Cancel. */
  const [dirty, setDirty] = useState(false);
  /* BL-23 — monotonically increasing edit revision. Save/Delete capture it at
     dispatch and clear (or restore) dirty only if no newer edit happened while
     the request was in flight; otherwise an older promise settling would clear
     dirty over newer unsaved edits and expose them to a reload wipe. */
  const editRevisionRef = useRef(0);
  const markEdited = useCallback(() => { editRevisionRef.current += 1; setDirty(true); }, []);
  /* Companion sequence for dispatched save/delete requests: two requests can
     share an edit revision (Save clicked twice with no edit between), so only
     the LATEST dispatched request may settle the dirty flag — an earlier
     request rejecting after a later one succeeded must not re-dirty a saved
     editor. Each later request snapshots a same-or-newer working copy, so
     deferring to the latest is always correct. */
  const saveReqSeqRef = useRef(0);
  /* Serialize the actual persistence calls: two overlapping onSaveTemplates
     runs interleave per-row writes at the backend, letting an OLDER payload's
     rows land after a newer one's (and its refetch republish stale data over
     a clean editor). Chaining guarantees dispatch order = write order, so the
     newest payload always lands last. Payloads are snapshotted at dispatch. */
  const saveChainRef = useRef(Promise.resolve());
  const dispatchTemplatesSave = useCallback((payload) => {
    const run = () => Promise.resolve(onSaveTemplates(payload));
    const p = saveChainRef.current.then(run, run);
    saveChainRef.current = p.then(() => {}, () => {});
    return p;
  }, [onSaveTemplates]);

  /* ---- selection / edit state ---- */
  const [selectedId, setSelected] = useState(null);
  const [openCat, setOpenCat] = useState(-1);
  const [tplEdit, setTplEdit] = useState(false);
  const [selTpls, setSelTpls] = useState(() => new Set());
  const toggleTplSel = (id) => setSelTpls((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [tplMenu, setTplMenu] = useState(null);       // { id, rect }
  const [entityMenu, setEntityMenu] = useState(null); // { id, rect }
  const [entityEdit, setEntityEdit] = useState(false);
  const [selEntities, setSelEntities] = useState(() => new Set());
  const toggleEntitySel = (id) => setSelEntities((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [openColor, setOpenColor] = useState(null);   // entity id whose picker is open
  const [roleColors, setRoleColors] = useState({});   // { entityId: { color, opacity } } picker fill state
  const [openMod, setOpenMod] = useState(0);
  const [modEdit, setModEdit] = useState(false);
  const [modRename, setModRename] = useState(null);   // module id in rename mode (null = none)
  // Module bulk selection is keyed by module ID (never array index) so a
  // working-copy rebuild or module insertion/removal between selecting and
  // acting can't retarget Delete/Duplicate. Actions resolve ids at use time.
  const [selMods, setSelMods] = useState(() => new Set());
  const toggleModSel = (id) => setSelMods((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [catEdit, setCatEdit] = useState(false);
  const [selCats, setSelCats] = useState(() => new Set());
  const toggleCatSel = (id) => setSelCats((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [moveModal, setMoveModal] = useState(null);  // { count, kind: 'category'|'module'|'entity' }
  /* Move/Copy modal destination picks — destTpl is always meaningful;
     destMod only applies when a Category is being moved. */
  const [moveDestTpl, setMoveDestTpl] = useState(null);
  const [moveDestMod, setMoveDestMod] = useState(null);
  const [colorTab, setColorTab] = useState({});
  const [layerTab, setLayerTab] = useState({});       // { entityId: 'fill' | 'border' }
  const [borderColors, setBorderColors] = useState({});
  const [matchFill, setMatchFill] = useState({});     // { entityId: bool }

  useEffect(() => {
    if (!modEdit) setModSearch('');
  }, [modEdit]);

  /* Rebuild the working copy + colour-picker maps from the templates prop.
     Seeds the maps from each entity's persisted refinements so saved colours
     round-trip, and clears the dirty flag since the copy now matches the host. */
  const reloadFromProps = useCallback(() => {
    const next = buildRich(applyTemplateOrderPreference(templates, user), mintId);
    const seeded = seedColorMaps(next);
    setRich(next);
    setRoleColors(seeded.roleColors);
    setBorderColors(seeded.borderColors);
    setMatchFill(seeded.matchFill);
    /* BL-17 S1: a rebuild can re-mint ids for legacy id-less modules with the
       known occurrence-shift corner (a surviving module can inherit the id a
       same-named sibling had before), so an id-keyed selection held across a
       rebuild could silently point at different modules. Clear it. KAL-302:
       same hazard for the rename-activation id — exit rename mode too. */
    setSelMods(new Set());
    setModRename(null);
    setDirty(false);
  }, [templates, user?.id, user?.email, mintId]);
  /* BL-23 dirty guard — sync the working copy with the host's templates prop.
     `reloadFromProps`'s useCallback identity changes exactly when
     (templates, user) change, so it doubles as the snapshot key; the guard ref
     is written only inside the effect (no render-phase writes). Reruns caused
     by `dirty`/`rich` changes hit the snapshot guard and return, so a dirty
     transition can never replay a reload over fresh local state.
     - Clean editor → full reload, exactly the pre-BL-23 behavior.
     - Unsaved edits → never rebuild over them; only APPEND templates whose ids
       the working copy doesn't know (e.g. host-created via New Template), and
       seed colour maps for the appended entities. Remote deletes/edits of
       known templates are deferred until Save (full-working-copy,
       last-writer-wins — today's Save semantics) or Cancel. */
  const lastSyncedReloadRef = useRef(null);
  useEffect(() => {
    if (lastSyncedReloadRef.current === reloadFromProps) return;
    lastSyncedReloadRef.current = reloadFromProps;
    if (!dirty) { reloadFromProps(); return; }
    const next = buildRich(applyTemplateOrderPreference(templates, user), mintId);
    const res = resolveTemplatesReload({ dirty: true, prevRich: rich, nextRich: next });
    if (res.mode !== 'append') return;
    setRich((prev) => {
      const have = new Set(prev.map((t) => t.id));
      const add = res.appended.filter((t) => !have.has(t.id));
      return add.length ? [...prev, ...add] : prev;
    });
    const seeded = seedColorMaps(res.appended);
    setRoleColors((prev) => ({ ...seeded.roleColors, ...prev }));
    setBorderColors((prev) => ({ ...seeded.borderColors, ...prev }));
    setMatchFill((prev) => ({ ...seeded.matchFill, ...prev }));
  }, [reloadFromProps, dirty, rich, templates, user, mintId]);

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

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rich.filter((template) => templateMatchesSearch(template, q));
  }, [rich, search]);

  useEffect(() => {
    if (!visibleTemplates.length || selectedId == null) return;
    if (!visibleTemplates.some((template) => template.id === selectedId)) {
      setSelected(visibleTemplates[0].id);
      setOpenMod(0);
      setOpenCat(-1);
    }
  }, [visibleTemplates, selectedId]);

  const tpl = rich.find((t) => t.id === selectedId) || visibleTemplates[0] || rich[0] || null;
  const orderedMods = tpl ? tpl.modules : [];

  /* When the Move/Copy modal opens, seed its destination picks: default
     the destination template to the current one, and (for a Category
     move) the destination module to the current module. Cleared on close. */
  useEffect(() => {
    if (!moveModal) { setMoveDestTpl(null); setMoveDestMod(null); return; }
    const tid = tpl ? tpl.id : (rich[0] ? rich[0].id : null);
    setMoveDestTpl(tid);
    if (moveModal.kind === 'category') {
      const seedTpl = rich.find((t) => t.id === tid);
      const mods = seedTpl ? seedTpl.modules : [];
      setMoveDestMod(mods[0] ? mods[0].id : null);
    } else {
      setMoveDestMod(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveModal]);

  /* Keep the destination module valid whenever the destination template
     changes during a Category move — modules belong to a template. */
  useEffect(() => {
    if (!moveModal || moveModal.kind !== 'category') return;
    const destT = rich.find((t) => t.id === moveDestTpl);
    const mods = destT ? destT.modules : [];
    if (!mods.some((m) => m.id === moveDestMod)) {
      setMoveDestMod(mods[0] ? mods[0].id : null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveDestTpl, moveModal]);

  /* ============================================================
     Mutators — every one returns a fresh `rich` array. They are the
     single source of truth for "make every button function".
     ============================================================ */

  /* Map over one template by id and replace it with `fn`'s result. */
  const mutateTpl = useCallback((tid, fn) => {
    setRich((prev) => prev.map((t) => (t.id === tid ? fn(t) : t)));
    markEdited();
  }, [markEdited]);

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
    markEdited();
  };
  const reorderTemplates = (activeId, overId) => {
    if (!activeId || !overId || activeId === overId) return;
    setRich((prev) => {
      const next = moveItemById(prev, activeId, overId);
      if (next !== prev) saveTemplateOrderPreference(user, next.map((template) => template.id));
      return next === prev ? prev : next;
    });
  };
  const deleteTemplates = (ids) => {
    /* BL-23: the save call lives OUTSIDE the setRich updater (updaters must
       stay pure — StrictMode double-invokes them, which would double the
       save). A delete IS an edit: markEdited() keeps dirty=true while the
       save is in flight so a background refetch can't full-reload and
       transiently resurrect the deleted templates; the revision captured
       after the bump gates the dirty clear/restore so a newer edit is never
       exposed to a reload wipe by this promise settling. */
    const next = rich.filter((t) => !ids.has(t.id));
    markEdited();
    setRich(next);
    if (onSaveTemplates) {
      const rev = editRevisionRef.current;
      const req = ++saveReqSeqRef.current;
      dispatchTemplatesSave(next.map(richToTemplate))
        .then(() => { if (editRevisionRef.current === rev && saveReqSeqRef.current === req) setDirty(false); })
        .catch((err) => {
          console.error('Failed to delete templates', err);
          if (editRevisionRef.current === rev && saveReqSeqRef.current === req) setDirty(true);
        });
    } else {
      setDirty(false);
    }
  };

  /* --- module-level --- */
  const addModule = () => {
    if (!tpl) return;
    const existing = orderedMods.map((m) => m.name);
    let n = 1, name;
    do { name = `Module ${n++}`; } while (existing.includes(name));
    /* Mint the id OUTSIDE the updater: rename mode is keyed by it, and the
       updater stays deterministic under StrictMode double-invoke. */
    const id = newId('m');
    mutateTpl(tpl.id, (t) => ({ ...t, modules: [...t.modules, { id, name, categories: [] }] }));
    /* Focus + open the brand-new tab and drop it straight into rename mode. */
    const newIndex = orderedMods.length;
    setTimeout(() => { setOpenMod(newIndex); setOpenCat(-1); setModRename(id); }, 0);
  };
  /* Commits by module ID at blur time — the module list may have been
     rebuilt/reordered since the rename input opened; a missing id is a
     no-op, never a rename of a different module. */
  const renameModule = (id, name) => {
    const v = name.trim();
    if (!v || !tpl) { setModRename(null); return; }
    mutateTpl(tpl.id, (t) => {
      const modules = t.modules.map((m) => (
        m.id === id && m.name !== v ? { ...m, name: v } : m
      ));
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
  /* Bulk delete/duplicate take module IDS, resolved against the template's
     CURRENT modules at action time. Zero matches bail BEFORE mutateTpl —
     a no-op action must never mark the editor dirty (post-BL-23, a spurious
     dirty would block reloads). Stale ids are silently skipped. */
  const deleteModules = (ids) => {
    if (!tpl || !ids.size) return;
    if (pickByIds(tpl.modules, ids).length === 0) return;
    mutateTpl(tpl.id, (t) => ({ ...t, modules: removeByIds(t.modules, ids) }));
    setSelMods(new Set());
    setOpenMod(0);
    setOpenCat(-1);
  };
  const duplicateModules = (ids) => {
    if (!tpl || !ids.size) return;
    if (pickByIds(tpl.modules, ids).length === 0) return;
    mutateTpl(tpl.id, (t) => ({
      ...t,
      modules: duplicateAfterByIds(t.modules, ids, (m) => ({
        ...m, id: newId('m'), name: `${m.name} copy`,
        categories: m.categories.map((c) => ({
          ...c, id: newId('c'),
          items: c.items.map((it) => ({ ...it, id: newId('i') })),
        })),
      })),
    }));
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
  const reorderCategories = (activeId, overId) => {
    if (!activeId || !overId || activeId === overId) return;
    const categories = orderedMods[openMod]?.categories || [];
    const from = categories.findIndex((category) => category.id === activeId);
    const to = categories.findIndex((category) => category.id === overId);

    mutateOpenModule((module) => {
      const nextCategories = moveItemById(module.categories || [], activeId, overId);
      return nextCategories === module.categories ? module : { ...module, categories: nextCategories };
    });

    if (openCat === from) setOpenCat(to);
    else if (from < openCat && to >= openCat) setOpenCat(openCat - 1);
    else if (from > openCat && to <= openCat) setOpenCat(openCat + 1);
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
  const reorderItems = (ci, activeId, overId) => {
    if (!activeId || !overId || activeId === overId) return;
    mutateCategory(ci, (c) => {
      const activeItems = (c.items || []).filter(isActiveChecklistItem);
      const archivedItems = (c.items || []).filter(isArchivedChecklistItem);
      const nextActiveItems = moveItemById(activeItems, activeId, overId);
      return nextActiveItems === activeItems ? c : { ...c, items: [...nextActiveItems, ...archivedItems] };
    });
  };

  /* KAL-44 archive flow state. When the user clicks the "×" delete button on
     a checklist item that has marker responses, we open this confirmation
     modal instead of stripping the item — confirming archives the item so
     historical responses survive. The modal carries `categoryIndex`,
     `itemId`, label snapshot, and the marker count for the copy. */
  const [archiveConfirm, setArchiveConfirm] = useState(null);

  /* Hard-delete an item from the rich tree. Used when the item has zero
     marker references, or as the resolved action from the archive modal's
     "Permanently delete" path (currently unused — the modal only offers
     Cancel / Archive). */
  const hardDeleteItem = (ci, itemId) => mutateCategory(ci, (c) => ({
    ...c, items: c.items.filter((it) => it.id !== itemId),
  }));

  /* Mark an item as archived in the rich tree. The marker UI keeps showing
     its responses under an "Archived" section using lastKnownLabel. */
  const archiveItem = (ci, itemId) => mutateCategory(ci, (c) => ({
    ...c,
    items: c.items.map((it) => (it.id === itemId ? archiveChecklistItem(it) : it)),
  }));

  const deleteItem = async (ci, itemId) => {
    const cat = (orderedMods[openMod]?.categories || [])[ci];
    const item = cat?.items?.find((x) => x.id === itemId);
    if (!item) return;
    /* If the item is already archived, "×" just removes it permanently —
       responses keyed under it become true orphans, but the user explicitly
       asked. We still respect the host's reported usage count to be safe. */
    let usage = 0;
    if (typeof getChecklistItemUsageCount === 'function') {
      try {
        const result = getChecklistItemUsageCount(itemId);
        const resolved = (result && typeof result.then === 'function') ? await result : result;
        usage = Number(resolved) || 0;
      } catch (err) {
        console.warn('[ChecklistArchive] usage probe failed:', err);
        usage = 0;
      }
    }
    if (usage > 0 && !item.archived) {
      setArchiveConfirm({
        categoryIndex: ci,
        itemId,
        label: item.text || item.lastKnownLabel || 'this item',
        usage,
      });
      return;
    }
    hardDeleteItem(ci, itemId);
  };

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
  const reorderEntities = (activeId, overId) => {
    if (!activeId || !overId || activeId === overId || !tpl) return;
    mutateTpl(tpl.id, (t) => {
      const nextRoster = moveItemById(t.roster || [], activeId, overId);
      return nextRoster === t.roster ? t : { ...t, roster: nextRoster };
    });
  };

  /* Resolve an entity's fill + border for its identifier swatch (left template
     list AND right entities panel). The swatch shows the colour at FULL
     strength — a Drawboard-style solid chip — so entities stay easy to tell
     apart; the picked opacity still drives the actual PDF annotation, it just
     isn't baked into the tiny dot (35% on white reads as a washed-out pastel).
     Border honours "Match Fill" — when on, it equals the fill colour. */
  const entitySwatch = (r) => {
    const color = roleColors[r.id]?.color || r.color || '#8c8c8a';
    const border = matchFill[r.id]
      ? color
      : ((borderColors[r.id] || {}).color || color);
    return { fill: color, border };
  };

  /* Map the editor's working copy back to the persisted template shape.
     Entity colours pull from the live picker maps so opacity + border
     refinements round-trip; structural ids/names come straight from `rich`.
     The original row is spread first to preserve fields the editor doesn't
     touch (visibility, createdAt, supabaseId, etc.). */
  const richToTemplate = (r) => {
    const original = (templates || []).find((t) => t.id === r.id) || {};
    const mods = r.modules.map((m) => ({
      id: m.id,
      name: m.name,
      categories: m.categories.map((c) => ({
        id: c.id,
        name: c.name,
        checklist: c.items.map((it) => {
          /* Persist archived metadata so KAL-44 archive survives save/reload.
             Active items round-trip the simple shape unchanged. */
          const out = { id: it.id, text: it.text };
          if (it.archived === true) {
            out.archived = true;
            if (typeof it.archivedAt === 'string') out.archivedAt = it.archivedAt;
            if (typeof it.lastKnownLabel === 'string' && it.lastKnownLabel) {
              out.lastKnownLabel = it.lastKnownLabel;
            } else if (it.text) {
              out.lastKnownLabel = it.text;
            }
          }
          return out;
        }),
      })),
    }));
    return {
      ...original,
      id: r.id,
      name: r.name,
      modules: mods,
      spaces: mods,
      entities: r.roster.map((e) => {
        const fillColor = roleColors[e.id]?.color || e.color || '#8c8c8a';
        const fillOpacity = roleColors[e.id]?.opacity ?? 0.35;
        const mf = !!matchFill[e.id];
        const bd = mf
          ? { color: fillColor, opacity: fillOpacity }
          : (borderColors[e.id] || { color: fillColor, opacity: fillOpacity });
        return {
          id: e.id,
          name: e.role,
          color: fillColor,
          opacity: fillOpacity,
          borderColor: bd.color,
          borderOpacity: bd.opacity,
          matchFill: mf,
        };
      }),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleSaveTemplates = () => {
    /* BL-23: dirty clears only when the save RESOLVES (the host now rethrows
       persistence failures), and only if no newer edit happened while it was
       in flight — an older promise settling must not clear dirty over newer
       unsaved edits (then-branch) or re-dirty an editor whose newer save
       already succeeded (catch-branch). On failure the edits and the Save bar
       survive, so the user can retry. */
    if (!onSaveTemplates) { setDirty(false); return; }
    const rev = editRevisionRef.current;
    const req = ++saveReqSeqRef.current;
    dispatchTemplatesSave(rich.map(richToTemplate))
      .then(() => { if (editRevisionRef.current === rev && saveReqSeqRef.current === req) setDirty(false); })
      .catch((err) => {
        console.error('Failed to save templates', err);
        if (editRevisionRef.current === rev && saveReqSeqRef.current === req) setDirty(true);
      });
  };
  const handleCancelEdits = () => {
    /* BL-23: invalidate any in-flight save/delete so its later settlement
       can't re-dirty (or re-clear) the editor the user just reset. */
    editRevisionRef.current += 1;
    reloadFromProps();
  };

  const subtitle = (
    <span><b>{visibleTemplates.length}</b> templates · reusable category + checklist sets</span>
  );
  const actions = <Search placeholder="Search Templates..." value={search} onChange={setSearch} />;

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
                  style={miniSelectButtonStyle({ color: 'var(--accent)' })}
                >
                  {tplEdit ? 'Done' : 'Select'}
                </button>
                {tplEdit && (
                  <>
                    {(() => {
                      const visibleSelectedIds = new Set(visibleTemplates.filter((t) => selTpls.has(t.id)).map((t) => t.id));
                      const visibleSelCount = visibleSelectedIds.size;
                      const allSel = visibleSelCount === visibleTemplates.length && visibleTemplates.length > 0;
                      return (
                        <>
                          <button
                            onClick={() => {
                              setSelTpls((prev) => {
                                const next = new Set(prev);
                                visibleTemplates.forEach((template) => {
                                  if (allSel) next.delete(template.id);
                                  else next.add(template.id);
                                });
                                return next;
                              });
                            }}
                            style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)' })}
                          >{allSel ? 'None' : 'All'}</button>
                          <button onClick={() => { if (visibleSelCount) { duplicateTemplates(visibleSelectedIds); setSelTpls(new Set()); } }} disabled={!visibleSelCount} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !visibleSelCount })}>Duplicate</button>
                          <button disabled={!visibleSelCount} onClick={() => { const first = visibleTemplates.find((t) => visibleSelectedIds.has(t.id)); if (first) onShare && onShare(first); }} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !visibleSelCount, iconOnly: true })} title="Share"><Icon name="share" size={11} /></button>
                          <button onClick={() => { if (visibleSelCount) { deleteTemplates(visibleSelectedIds); setSelTpls(new Set()); } }} disabled={!visibleSelCount} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !visibleSelCount, danger: true, iconOnly: true })} title="Delete"><Icon name="trash" size={11} /></button>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
            <div className="slim-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
              {visibleTemplates.length === 0 && (
                <div className="meta" style={{ padding: '20px 8px', fontSize: 11.5 }}>
                  {rich.length === 0 ? 'No templates yet — create one to get started.' : 'No templates match your search.'}
                </div>
              )}
              <SortableRearrangeList ids={visibleTemplates.map((t) => t.id)} onReorder={reorderTemplates}>
              {visibleTemplates.map((t) => {
                const active = t.id === selectedId;
                const isSel = selTpls.has(t.id);
                return (
                  <SortableRearrangeRow
                    key={t.id}
                    id={t.id}
                  >
                    {({ attributes, listeners, isDragging }) => (
                    <div
                      data-drag-rearrange-row
                      onClick={() => { if (tplEdit) toggleTplSel(t.id); else { setSelected(t.id); setOpenCat(-1); setOpenMod(0); } }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '28px 1fr auto',
                        gap: 8, alignItems: 'center',
                        padding: '8px 8px', borderRadius: 6,
                        height: 50, boxSizing: 'border-box',
                        background: tplEdit ? (isSel ? 'var(--ink-600)' : 'transparent') : (active ? 'var(--ink-600)' : 'transparent'),
                        cursor: 'pointer',
                        borderLeft: !tplEdit && active ? '2px solid var(--accent)' : '2px solid transparent',
                        transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                      }}
                    >
                      <DragRearrangeHandle
                        {...attributes}
                        {...listeners}
                        isDragging={isDragging}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{t.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {/* Up to 10 entity swatches fit before the row gets crowded;
                               any beyond that collapse into a "+N" overflow pill. */}
                            {t.roster.slice(0, 10).map((r) => {
                              const sw = entitySwatch(r);
                              return (
                                <span key={r.id} style={{ width: 14, height: 14, borderRadius: '50%', background: sw.fill, border: `1.5px solid ${sw.border}` }}></span>
                              );
                            })}
                            {t.roster.length > 10 && (
                              <span className="mono meta" style={{ fontSize: 9.5 }}>+{t.roster.length - 10}</span>
                            )}
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
                          style={moreButtonStyle()}
                          title="More"
                        ><Icon name="more" size={14} /></button>
                      )}
                    </div>
                    )}
                  </SortableRearrangeRow>
                );
              })}
              </SortableRearrangeList>
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
                <SortableModuleTabs
                  modules={orderedMods}
                  openMod={openMod}
                  modRename={modRename}
                  onOpenModule={(mi) => { setOpenMod(mi); setOpenCat(-1); }}
                  onStartRename={setModRename}
                  onRenameModule={renameModule}
                  onCancelRename={() => setModRename(null)}
                  onReorderModules={reorderMods}
                >
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
                </SortableModuleTabs>
              </div>

              {/* Categories header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 8, gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                  <p className="micro" style={{ margin: 0 }}>Categories</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, overflow: 'hidden', flexWrap: 'nowrap' }}>
                  <button
                    onClick={() => { const next = !catEdit; setCatEdit(next); if (!next) setSelCats(new Set()); }}
                    style={{ ...miniSelectButtonStyle({ color: 'var(--accent)' }), flex: 'none' }}
                  >
                      {catEdit ? 'Done' : 'Select'}
                    </button>
                    {catEdit && (() => {
                      const c = selCats.size;
                      const allSel = c === visibleCats.length && visibleCats.length > 0;
                      const baseBtn = miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)' });
                      return (
                        <>
                          <button onClick={() => setSelCats(allSel ? new Set() : new Set(visibleCats.map((cat) => cat.id)))} style={{ ...baseBtn, color: 'var(--ink-soft)' }}>{allSel ? 'None' : 'All'}</button>
                          <button disabled={!c} onClick={() => duplicateCategories(selCats)} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c })}>Duplicate</button>
                          <button disabled={!c} onClick={() => setMoveModal({ count: c, kind: 'category' })} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c })}>Move/Copy</button>
                          <button disabled={!c} onClick={() => { if (c && tpl) onShare && onShare(tpl); }} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c, iconOnly: true })} title="Share"><Icon name="share" size={11} /></button>
                          <button disabled={!c} onClick={() => deleteCategories(selCats)} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c, danger: true, iconOnly: true })} title="Delete"><Icon name="trash" size={11} /></button>
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
                <SortableRearrangeList
                  ids={visibleCats.map((c) => c.id)}
                  onReorder={reorderCategories}
                  variableHeight
                  gap={6}
                >
                {visibleCats.map((c, i) => {
                  const allItems = c.items || [];
                  /* KAL-44 — active vs archived split. Editor surfaces the
                     active items in the normal list and a collapsed
                     "Archived" tail. Archived items can still be permanently
                     deleted via the × button (which calls deleteItem; the
                     hard-delete branch fires because item.archived is true). */
                  const items = allItems.filter(isActiveChecklistItem);
                  const archivedItems = allItems.filter(isArchivedChecklistItem);
                  const open = openCat === i;
                  const isSel = selCats.has(c.id);
                  return (
                    <SortableRearrangeRow
                      key={c.id}
                      id={c.id}
                      animateLayoutChanges={animateCategoryLayoutChanges}
                    >
                      {({ attributes, listeners, isDragging }) => (
                    <div
                      className="card-line"
                      style={{
                        overflow: 'hidden',
                        flexShrink: 0,
                        transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                      }}
                    >
                      {/* Row header */}
                      <div
                        data-drag-rearrange-row
                        onClick={() => { if (catEdit) toggleCatSel(c.id); }}
                        style={{
                          width: '100%', display: 'grid', gridTemplateColumns: catEdit ? '24px 20px 1fr auto 16px' : '24px 20px 1fr auto', gap: 8,
                          alignItems: 'center', padding: '3px 10px',
                          cursor: catEdit ? 'pointer' : 'default',
                          background: catEdit && isSel ? 'rgba(216,168,78,0.08)' : 'transparent',
                        }}
                      >
                        <DragRearrangeHandle
                          {...attributes}
                          {...listeners}
                          isDragging={isDragging}
                          style={{ width: 24, height: 24 }}
                        />
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
                          onBlur={(e) => {
                            /* BL-23: empty titles snap back visibly to the old
                               name (the model never accepted them), and an
                               unchanged title is a no-op that must not dirty
                               the editor (incl. the Escape-then-blur path). */
                            const r = resolveTitleCommit(e.currentTarget.value, c.name);
                            if (r.action === 'commit') renameCategory(i, r.name);
                            e.currentTarget.value = r.name;
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = c.name; e.currentTarget.blur(); } }}
                          style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2, width: 'max-content', maxWidth: '100%', minWidth: 40 }}
                        />
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-quiet)', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                          {items.length} items{archivedItems.length > 0 ? ` (+${archivedItems.length} archived)` : ''}
                        </span>
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
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateRows: open ? '1fr' : '0fr',
                          opacity: open ? 1 : 0,
                          visibility: open ? 'visible' : 'hidden',
                          transition: `${CATEGORY_COLLAPSE_TRANSITION}, visibility 0s linear ${open ? '0s' : '0.18s'}`,
                          borderTop: open ? '1px solid var(--rule)' : '1px solid transparent',
                          minHeight: 0,
                        }}
                      >
                        <div style={{ overflow: 'hidden', minHeight: 0 }}>
                          <div style={{ padding: '4px 14px 12px 50px', background: 'var(--paper-deep)' }}>
                          <div style={{ display: 'grid', gap: 1, marginTop: 6 }}>
                            {items.length === 0 && (
                              <div className="meta" style={{ fontSize: 11, padding: '3px 0' }}>No checklist items yet.</div>
                            )}
                            <SortableRearrangeList ids={items.map((it) => it.id)} onReorder={(activeId, overId) => reorderItems(i, activeId, overId)} gap={0}>
                            {items.map((it, j) => (
                              <SortableRearrangeRow
                                key={it.id}
                                id={it.id}
                              >
                                {({ attributes, listeners, isDragging }) => (
                              <div
                                data-drag-rearrange-row
                                style={{
                                  display: 'grid', gridTemplateColumns: '24px 1fr 16px',
                                  alignItems: 'center', gap: 6, padding: '3px 0',
                                  borderBottom: j === items.length - 1 ? 0 : '1px dashed var(--rule)',
                                }}
                              >
                                <DragRearrangeHandle
                                  {...attributes}
                                  {...listeners}
                                  isDragging={isDragging}
                                  style={{ width: 18, height: 18 }}
                                />
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
                                )}
                              </SortableRearrangeRow>
                            ))}
                            </SortableRearrangeList>
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

                            {/* KAL-44 — Archived items live in the template
                                structure so historical responses survive
                                reload, but they're not editable as active
                                prompts. Surface them in a quiet section so
                                template authors can see what's been retired
                                without restoring it. */}
                            {archivedItems.length > 0 && (
                              <div
                                data-testid={`archived-items-${c.id}`}
                                style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--rule)' }}
                              >
                                <div className="meta" style={{ fontSize: 10.5, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-quiet)' }}>
                                  Archived ({archivedItems.length})
                                </div>
                                {archivedItems.map((it, j) => (
                                  <div
                                    key={it.id}
                                    data-archived-item-id={it.id}
                                    style={{
                                      display: 'grid', gridTemplateColumns: '14px 1fr 16px',
                                      alignItems: 'center', gap: 6, padding: '3px 0',
                                      borderBottom: j === archivedItems.length - 1 ? 0 : '1px dashed var(--rule)',
                                      opacity: 0.65,
                                    }}
                                  >
                                    <span style={{ color: 'var(--ink-quiet)', fontSize: 11 }}>—</span>
                                    <span
                                      title={`Archived${it.archivedAt ? ` ${new Date(it.archivedAt).toLocaleString()}` : ''} — historical responses preserved`}
                                      style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic', textDecoration: 'line-through' }}
                                    >
                                      {archivedItemLabel(it)}
                                    </span>
                                    <button
                                      title="Permanently delete (orphans historical responses)"
                                      onClick={(e) => { e.stopPropagation(); hardDeleteItem(i, it.id); }}
                                      onMouseEnter={(e) => { e.currentTarget.style.color = '#cf6f6f'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-quiet)'; }}
                                      style={{ background: 'transparent', border: 0, color: 'var(--ink-quiet)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          </div>
                        </div>
                      </div>
                    </div>
                      )}
                    </SortableRearrangeRow>
                  );
                })}
                </SortableRearrangeList>
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
                style={{ ...miniSelectButtonStyle({ color: 'var(--accent)' }), padding: '0 4px 0 0', flex: 'none' }}
              >
                  {entityEdit ? 'Done' : 'Select'}
                </button>
                {entityEdit && tpl && (() => {
                  const c = selEntities.size;
                  const allSel = c === tpl.roster.length && tpl.roster.length > 0;
                  const baseBtn = miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)' });
                  return (
                    <>
                      <button onClick={() => setSelEntities(allSel ? new Set() : new Set(tpl.roster.map((r) => r.id)))} style={{ ...baseBtn, color: 'var(--ink-soft)' }}>{allSel ? 'None' : 'All'}</button>
                      <button disabled={!c} onClick={() => duplicateEntities(selEntities)} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c })}>Duplicate</button>
                      <button disabled={!c} onClick={() => setMoveModal({ count: c, kind: 'entity' })} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c })}>Move/Copy</button>
                      <button disabled={!c} onClick={() => { if (c && tpl) onShare && onShare(tpl); }} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c, iconOnly: true })} title="Share"><Icon name="share" size={10} /></button>
                      <button disabled={!c} onClick={() => deleteEntities(selEntities)} style={miniButtonStyle({ borderColor: 'var(--rule-strong)', color: 'var(--ink-soft)', disabled: !c, danger: true, iconOnly: true })} title="Delete"><Icon name="trash" size={10} /></button>
                    </>
                  );
                })()}
                {/* Save / Cancel surface as soon as anything in the template
                    is edited. Cancel discards every working change; Save writes
                    the whole template set (modules, categories, checklist and
                    entities + their colours) back to the host for persistence. */}
                {dirty && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                    <button
                      onClick={handleCancelEdits}
                      style={{ background: 'transparent', border: '1px solid var(--rule-strong)', borderRadius: 2, padding: '1px 7px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-soft)', height: 18, lineHeight: 1, boxSizing: 'border-box', flex: 'none' }}
                    >Cancel</button>
                    <button
                      onClick={handleSaveTemplates}
                      style={{ background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 2, padding: '1px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--paper)', height: 18, lineHeight: 1, boxSizing: 'border-box', flex: 'none' }}
                    >Save</button>
                  </div>
                )}
              </div>

              <div className="slim-scroll" style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1, minHeight: 0 }}>
                {(!tpl || tpl.roster.length === 0) && (
                  <div className="meta" style={{ fontSize: 11.5, padding: '12px 2px' }}>No entities on this template yet.</div>
                )}
                {tpl && (
                <SortableRearrangeList ids={tpl.roster.map((r) => r.id)} onReorder={reorderEntities} gap={4}>
                {tpl.roster.map((r) => {
                  const c = roleColors[r.id]?.color || r.color || '#8c8c8a';
                  const op = roleColors[r.id]?.opacity ?? 0.35;
                  /* Glyph border colour: when "Match Fill" is on the border equals the
                     fill; otherwise it shows the entity's own border choice (defaulting
                     to the fill so an untouched border looks unified). */
                  const rowBorderColor = !!matchFill[r.id]
                    ? c
                    : ((borderColors[r.id] || {}).color || c);
                  const isOpen = openColor === r.id;
                  const isSel = selEntities.has(r.id);
                  return (
                    <SortableRearrangeRow
                      key={r.id}
                      id={r.id}
                    >
                      {({ attributes, listeners, isDragging }) => (
                      <>
                      <div data-drag-rearrange-row className="card-line" style={{
                        display: 'grid', gridTemplateColumns: '24px 18px 1fr 16px', gap: 10,
                        padding: '8px 10px', alignItems: 'center',
                        height: 38, boxSizing: 'border-box',
                        transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                      }}>
                        <DragRearrangeHandle
                          {...attributes}
                          {...listeners}
                          isDragging={isDragging}
                          style={{ width: 24, height: 24 }}
                        />
                        <button
                          onClick={() => setOpenColor(isOpen ? null : r.id)}
                          title="Edit color"
                          style={{
                            width: 18, height: 18, borderRadius: '50%',
                            /* Solid full-strength chip (Drawboard-style) so entity
                               colours stay vibrant and easy to tell apart — the picked
                               opacity drives the PDF annotation, not this identifier. */
                            background: c,
                            border: `1.5px solid ${rowBorderColor}`,
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
                              style={moreButtonStyle({ color: 'var(--ink-muted)' })}
                            ><Icon name="more" size={14} /></button>
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
                        /* The shared colour picker reports colour + opacity together.
                           Write both into the editor's picker state, and for fill also
                           into the entity's working data so the left-rail swatch
                           updates live. No-op while a border is matched to the fill. */
                        const applyColor = (color, opacity) => {
                          if (isBorderMatched) return;
                          if (layer === 'border') {
                            setBorderColors({ ...borderColors, [r.id]: { color, opacity } });
                          } else {
                            setRoleColors({ ...roleColors, [r.id]: { color, opacity } });
                            setEntityColor(r.id, color);
                          }
                          markEdited();
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
                              {/* Match Fill row — only on Border tab */}
                              {layer === 'border' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                                  <input
                                    type="checkbox"
                                    checked={match}
                                    onChange={(e) => { setMatchFill({ ...matchFill, [r.id]: e.target.checked }); markEdited(); }}
                                    style={{ width: 13, height: 13, margin: 0, accentColor: 'var(--accent)' }}
                                  />
                                  <span style={{ fontSize: 11, fontWeight: 600, color: match ? 'var(--ink)' : 'var(--ink-soft)' }}>Match Fill</span>
                                  {match && <span style={{ fontSize: 10, color: 'var(--ink-muted)', marginLeft: 'auto' }}>using fill color &amp; opacity</span>}
                                </label>
                              )}
                              {/* Shared colour picker — the app's one picker. Dimmed +
                                  read-only while a border is matched to the fill. */}
                              <div style={{ opacity: isBorderMatched ? 0.4 : 1, pointerEvents: isBorderMatched ? 'none' : 'auto' }}>
                                <CompactColorPicker
                                  color={activeColor}
                                  opacity={activeOp}
                                  onChange={applyColor}
                                  onClose={() => {}}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      </>
                      )}
                    </SortableRearrangeRow>
                  );
                })}
                </SortableRearrangeList>
                )}
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
            { label: 'Share', onClick: () => onShare && onShare(t) },
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
            { label: 'Move/Copy', onClick: () => setMoveModal({ count: 1, kind: 'entity' }) },
            { label: 'Share', onClick: () => { if (tpl) onShare && onShare(tpl); } },
            { label: 'Rename', onClick: () => setOpenColor(null) },
            { label: 'Delete', danger: true, onClick: () => deleteEntities(new Set([ent.id])) },
          ]}
        />
      );
    })()}

    {/* KAL-44 — Archive checklist item confirmation modal.
        Opened when the user tries to delete an active item that has
        survey-marker responses. Cancel leaves the item untouched. Archive
        marks it `archived: true` with a label snapshot so old marker
        responses still render under the marker UI's "Archived" section. */}
    {archiveConfirm && createPortal(
      <div
        data-testid="archive-confirm-modal"
        onClick={() => setArchiveConfirm(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(13, 15, 20, 0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5100 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 440, maxWidth: 'calc(100vw - 32px)',
            background: '#181c24', border: '1px solid #2a3140', borderRadius: 10,
            padding: '18px 20px 14px', boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', color: '#f4f1ea',
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', color: '#f4f1ea' }}>
            Archive checklist item?
          </h3>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, lineHeight: 1.55, color: '#c7cdda' }}>
            <strong style={{ color: '#f4f1ea' }}>{archiveConfirm.usage}</strong>
            {' '}
            {archiveConfirm.usage === 1 ? 'survey marker has' : 'survey markers have'}
            {' '}responses for <em style={{ color: '#f4f1ea' }}>{archiveConfirm.label || 'this item'}</em>.
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12.5, lineHeight: 1.55, color: '#8d96a6' }}>
            Archiving keeps those responses as historical data, but the item won't appear for new markers. You can permanently delete the archived item later from the Archived section.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              data-testid="archive-confirm-cancel"
              onClick={() => setArchiveConfirm(null)}
              style={{ background: 'transparent', border: '1px solid #3a4252', color: '#c7cdda', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="archive-confirm-archive"
              onClick={() => {
                const { categoryIndex, itemId } = archiveConfirm;
                archiveItem(categoryIndex, itemId);
                setArchiveConfirm(null);
              }}
              style={{ background: '#d8a84e', border: '1px solid #b8893a', color: '#0d0f14', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Archive
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {/* Edit modules modal */}
    {modEdit && tpl && (() => {
      const mods = orderedMods;
      const moduleQuery = modSearch.trim().toLowerCase();
      const visibleMods = moduleQuery
        ? mods.filter((mod) => (mod.name || '').toLowerCase().includes(moduleQuery))
        : mods;
      // Effective selection is DERIVED from the current modules — never the
      // raw id set, which may hold stale ids after a working-copy rebuild.
      const selectedMods = mods.filter((m) => selMods.has(m.id));
      const selCount = selectedMods.length;
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
                  value={modSearch}
                  onChange={(e) => setModSearch(e.currentTarget.value)}
                  placeholder="Search modules..."
                  style={{ background: 'transparent', border: 0, outline: 'none', color: '#f4f1ea', fontFamily: 'inherit', fontSize: 11.5, flex: 1, width: '100%', padding: 0 }}
                />
              </div>
            </div>
            <div className="slim-scroll" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto', flex: '0 1 auto', minHeight: 0 }}>
              {visibleMods.length === 0 && (
                <div className="meta" style={{ padding: '14px 4px', fontSize: 11.5, color: '#8d96a6' }}>
                  {mods.length === 0 ? 'No modules yet.' : 'No modules match your search.'}
                </div>
              )}
              <SortableRearrangeList
                ids={visibleMods.map((mod) => mod.id)}
                onReorder={(activeId, overId) => {
                  const from = mods.findIndex((mod) => mod.id === activeId);
                  const to = mods.findIndex((mod) => mod.id === overId);
                  reorderMods(from, to);
                }}
                gap={4}
              >
              {visibleMods.map((mod) => {
                const isSel = selMods.has(mod.id);
                return (
                  <SortableRearrangeRow key={mod.id} id={mod.id}>
                    {({ attributes, listeners, isDragging }) => (
                      <div
                        data-drag-rearrange-row
                        style={{
                          display: 'grid', gridTemplateColumns: '24px 14px 1fr auto', gap: 10,
                          alignItems: 'center', padding: '7px 8px', borderRadius: 6,
                          background: isSel ? '#181c24' : '#12151c',
                          border: '1px solid #2a3140',
                          transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                        }}
                      >
                        <DragRearrangeHandle
                          {...attributes}
                          {...listeners}
                          isDragging={isDragging}
                        />
                        <span onClick={() => toggleModSel(mod.id)} style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? '#d8a84e' : '#3a4252'}`, background: isSel ? '#d8a84e' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {isSel && <span style={{ color: '#0d0f14', fontSize: 10, lineHeight: 1 }}>✓</span>}
                        </span>
                        <input
                          defaultValue={mod.name}
                          key={mod.id + ':' + mod.name}
                          onBlur={(e) => renameModule(mod.id, e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = mod.name; e.currentTarget.blur(); } }}
                          style={{ background: 'transparent', border: 0, borderBottom: '1px solid transparent', color: '#f4f1ea', font: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '4px 0', width: '100%', outline: 'none' }}
                        />
                        <span style={{ fontSize: 10, color: '#5a6473', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{(mod.categories || []).length}</span>
                      </div>
                    )}
                  </SortableRearrangeRow>
                );
              })}
              </SortableRearrangeList>
            </div>
            <div style={{ padding: '0 10px 8px', flex: 'none' }}>
              <button onClick={addModule} style={{ width: '100%', padding: '6px 10px', border: '1px dashed #3a4252', background: 'transparent', color: '#8d96a6', borderRadius: 2, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>+</span> New Module
              </button>
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid #2a3140', background: '#12151c', display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
              <button onClick={() => { const allSel = selectedMods.length === mods.length; setSelMods(allSel ? new Set() : new Set(mods.map((m) => m.id))); }} style={{ background: 'transparent', border: '1px solid #3a4252', color: '#e8e2d4', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{selectedMods.length === mods.length && mods.length > 0 ? 'None' : 'All'}</button>
              <button onClick={() => duplicateModules(selMods)} disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Duplicate</button>
              <button onClick={() => { if (selCount) setMoveModal({ count: selCount, kind: 'module' }); }} disabled={!selCount} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Move/Copy</button>
              <button disabled={!selCount} onClick={() => { if (selCount && tpl) onShare && onShare(tpl); }} style={{ background: 'transparent', border: '1px solid #3a4252', color: selCount ? '#e8e2d4' : '#5a6473', borderRadius: 4, padding: '5px 9px', fontSize: 11.5, cursor: selCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }} title="Share"><Icon name="share" size={12} /></button>
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
            <button onClick={() => setMoveModal(null)} title="Close" style={closeButtonStyle({ borderColor: '#2a3140', color: '#8d96a6' })}>×</button>
          </div>
          {/* Destination fields depend on WHAT is being moved/copied:
              - Category → pick a Destination Template, then a Destination
                Module within it (a category lives inside a module).
              - Module  → pick a Destination Template only (a module lives
                inside a template).
              - Entity  → pick a Destination Template only (an entity
                belongs to a template).
              There is never a "Destination Category" — nothing lives
              inside a checklist category. */}
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#8d96a6' }}>Destination template</label>
            <CustomSelect
              value={moveDestTpl}
              onChange={setMoveDestTpl}
              placeholder="Choose a template…"
              options={rich.map((t) => ({ value: t.id, label: t.name }))}
            />
            {moveModal.kind === 'category' && (() => {
              const destT = rich.find((t) => t.id === moveDestTpl);
              const mods = destT ? destT.modules : [];
              return (
                <>
                  <label style={{ fontSize: 12, color: '#8d96a6', marginTop: 8 }}>Destination module</label>
                  <CustomSelect
                    value={moveDestMod}
                    onChange={setMoveDestMod}
                    placeholder={mods.length ? 'Choose a module…' : 'This template has no modules'}
                    disabled={mods.length === 0}
                    options={mods.map((m) => ({ value: m.id, label: m.name }))}
                  />
                </>
              );
            })()}
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
