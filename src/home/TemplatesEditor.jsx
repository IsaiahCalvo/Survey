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
   into TemplatesEditor.css, so the end result is warm-dark on its own.

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
import { reloadTemplatesAfterPendingSave } from './templatePersistence.js';
import useMobileEdgeSwipeBack from './useMobileEdgeSwipeBack';
import useModalFocusTrap from './useModalFocusTrap';
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
import { HubShell, Icon, Search, EmptyState } from './HubShell';
import SectionIconButton, { SectionIconActions, SelectModeButtons } from '../components/SectionIconButton.jsx';
import SwipeToDeleteRow from '../components/SwipeToDeleteRow.jsx';
import {
  resolveTemplatesReload,
  createStableIdMint,
  createOccurrenceKeyer,
  seedColorMaps,
  resolveTitleCommit,
  fingerprintTemplates,
  workingCopyDiffers,
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
/* The defensive readers for a persisted template's structure. Shared with the
   Archive screen's template preview so the two cannot drift. */
import {
  modulesOf,
  entitiesOf,
  categoriesOf,
  checklistOf,
  itemText,
  toHex6,
} from '../services/templateConfigShape';
import { moveItemById } from '../reorder/flatReorderUtils.js';
import { CALM_STRIP_AUTO_SCROLL } from '../reorder/dragAutoScroll.js';
import { pickByIds, removeByIds, duplicateAfterByIds } from './selectionById.js';
import { countLabel } from './countLabel.js';
import { flagRequiredInput, isBlank } from '../components/requiredInput';
import './TemplatesEditor.css';
import DismissBarrier from '../components/DismissBarrier';

/* Desktop/web already use this quiet chevron for category disclosure. Keep
   one shared glyph so mobile cannot drift to a different arrow treatment.

   UX: it is the app's own chevron now, not a local tracing of it. This drew the
   chevron-right shape by hand on an 18-unit grid at stroke 2, which resolves to
   2.67 on the house 24 grid — nearly twice the 1.5 every other chevron in the
   hub paints, so the category carets read bolder than the archive tree's carets
   two screens over. Reference behaviour matched: ArchiveScreen's disclosure
   chevron, the same <Icon> rotated by its button rather than a swapped
   down/right pair. The box stays 18px and the rotation stays on the button, so
   nothing about the control moves. Weight fixed 2026-09-16 (r5-icons). */
const CategoryDisclosureGlyph = () => (
  <Icon name="chevronRight" size={18} style={{ display: 'block', flex: 'none' }} />
);

/* Owner 2026-10-01 ("the name's hit box is too long"): a name field is as
   wide as its text. The wrapper's hidden twin (hub.css .hub-autowidth::after,
   fed by data-value) sets the width, so this works in every engine without
   `field-sizing`. Uncontrolled inputs push each keystroke into data-value. */
const syncAutoWidth = (event) => {
  const wrap = event?.currentTarget?.parentElement;
  if (wrap?.classList?.contains('hub-autowidth')) wrap.dataset.value = event.currentTarget.value;
};
/* Focus the copy of a field the user can SEE (the desktop and phone trees are
   both mounted; one is hidden by CSS) and select its text - the "Rename" menu
   items land here. It runs synchronously inside the menu tap, which is what
   lets iOS raise the keyboard. */
const focusVisibleField = (selector) => {
  if (typeof document === 'undefined') return false;
  const el = [...document.querySelectorAll(selector)].find((node) => node.getClientRects().length > 0);
  if (!el) return false;
  el.focus();
  el.select?.();
  return true;
};

/* The phone tree is the one on screen (hub.css swaps the layouts at 720px). */
const mobileLayoutActive = () => typeof document !== 'undefined'
  && [...document.querySelectorAll('.templates-mobile-layout')].some((node) => node.getClientRects().length > 0);

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
  // The desktop editor stays mounted (hidden) on phones, so the same tab id
  // exists twice. Use the copy that is actually on screen: the hidden one
  // measures 0 wide, which left the drag with no limit on phones.
  const activeNode = Array.from(document.querySelectorAll('[data-module-tab-id]'))
    .find((node) => node.getAttribute('data-module-tab-id') === String(activeId ?? '')
      && node.getBoundingClientRect().width > 0);
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

/* Accent ribbon — templates may not store an accent colour.
   Survey calm gold (2026-10-01): no user colour equals the app's accent gold
   (#d8a84e) any more - a gold marker or entity read as app chrome. Its slot is
   a distinct orange, #f0883e. */
const ACCENTS = ['#e07a5e', '#7ab7e6', '#c293e6', '#a6e07a', '#f0883e', '#9aa3b2'];

/* Entity colours cycled through when a brand-new entity is created. Real hex
   only: the last slot was 'var(--text-3)', which hexToRgba, the page's marker
   fill and the Excel export cannot read (it became rgba(NaN...)). */
const ENTITY_COLORS = [
  '#e07a5e', '#7ab7e6', '#c293e6', '#a6e07a', '#f0883e', '#ec8a9a',
  '#5fc7b0', '#959eae',
];

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
  showCount = true,
  isRenaming,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onOpenMenu,
}) {
  /* How the last press on the label arrived. A touch screen has no
     double-click, so on touch a tap on the tab that is ALREADY open opens its
     menu (Rename / Delete) instead (owner 2026-10-01: module tabs could not be
     renamed on a phone at all). */
  const pointerTypeRef = useRef('mouse');
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
      {...(!isRenaming ? attributes : {})}
      {...(!isRenaming ? listeners : {})}
      data-module-tab-id={mod.id}
      // Owner 2026-10-01: the held tab takes the app's one picked-up look
      // (states.css [data-drag-lifted]) - one solid surface, soft shadow, no
      // gold, no scale, no inner block behind its label or count.
      data-drag-lifted={isDragging ? '' : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: tabTransition || undefined,
        display: 'flex',
        alignItems: 'center',
        marginBottom: -1,
        borderBottom: isOn ? '2px solid var(--ink)' : '2px solid transparent',
        borderRadius: '5px 5px 0 0',
        background: isOn ? 'var(--hover)' : 'transparent',
        cursor: isRenaming ? 'text' : (isDragging ? 'grabbing' : 'grab'),
        /* Owner 2026-10-01 ("module tab titles not centred"): every tab hugs
           its own label - 12px each side, the count 6px after it - so the
           label is centred in its tab by construction. The tabs used to
           stretch to 140px with the name pushed left and the count right. */
        flex: '0 0 auto',
        gap: 6,
        padding: '0 12px',
        height: 32,
        boxSizing: 'border-box',
        justifyContent: 'center',
        minWidth: 0,
        maxWidth: 220,
        overflow: 'hidden',
        position: 'relative',
        zIndex: isDragging ? 4 : (isOn ? 1 : 0),
        touchAction: 'none',
        userSelect: isDragging || isSorting ? 'none' : undefined,
      }}
    >
      {isRenaming ? (
        <span className="hub-autowidth module-tab-name" data-value={mod.name} style={{ fontSize: 12, fontWeight: isOn ? 500 : 400 }}>
          <input
            size={1}
            className="inline-edit hub-rename"
            defaultValue={mod.name}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onInput={syncAutoWidth}
            onBlur={(e) => onRename(mod.id, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') onCancelRename();
            }}
            /* The dotted rename line is .hub-rename (hub.css), shared with
               every other rename field. */
            style={{
              padding: '3px 0',
              color: activeInk,
            }}
          />
        </span>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => { pointerTypeRef.current = e.pointerType || 'mouse'; }}
          onClick={(e) => {
            if (isOn && pointerTypeRef.current === 'touch' && onOpenMenu) {
              onOpenMenu(mod.id, (e.currentTarget.closest('[data-module-tab-id]') || e.currentTarget).getBoundingClientRect());
              return;
            }
            onOpen(index);
          }}
          onDoubleClick={() => onStartRename(mod.id)}
          onContextMenu={onOpenMenu ? (e) => {
            e.preventDefault();
            onOpenMenu(mod.id, (e.currentTarget.closest('[data-module-tab-id]') || e.currentTarget).getBoundingClientRect());
          } : undefined}
          title={`${mod.name} · drag to reorder · double-click to rename`}
          style={{
            background: 'transparent',
            border: 0,
            padding: 0,
            fontFamily: 'inherit',
            color: activeInk,
            fontSize: 12,
            fontWeight: isOn ? 500 : 400,
            cursor: isDragging ? 'grabbing' : 'grab',
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {mod.name}
        </button>
      )}
      {showCount ? (
        <span className="module-tab-count" style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
          {catCount}
        </span>
      ) : null}
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
  onOpenMenu,
  showCounts = true,
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
      autoScroll={CALM_STRIP_AUTO_SCROLL}
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
              showCount={showCounts}
              isRenaming={modRename === mod.id}
              onOpen={onOpenModule}
              onStartRename={onStartRename}
              onRename={onRenameModule}
              onCancelRename={onCancelRename}
              onOpenMenu={onOpenMenu}
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

  /* Scrolling invalidates the anchor rectangle. Outside press / Escape are
     handled by the shared first-gesture dismissal barrier below. */
  useEffect(() => {
    window.addEventListener('scroll', onClose, { capture: true, passive: true });
    return () => {
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
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} />
      <div
        ref={ref}
        className="ed-tpl-menu"
        role="menu"
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
            type="button"
            role="menuitem"
            className={`hub-menu__item${danger ? ' is-danger' : ''}`}
            onClick={() => { onClick(); onClose(); }}
          >
            {label}
          </button>
        ))}
      </div>
    </>,
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
     muted var(--text-3) · gold var(--accent) · font var(--font-ui)
   ============================================================ */
function CustomSelect({ value, options, onChange, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const selected = options.find((o) => o.value === value) || null;

  /* Scrolling invalidates the measured popup position. */
  useEffect(() => {
    if (!open) return undefined;
    const onScroll = () => setOpen(false);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
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
      <DismissBarrier
        active={open}
        insideRefs={[triggerRef, popRef]}
        onDismiss={() => setOpen(false)}
      />
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          width: '100%', background: 'var(--surface-1)', border: '1px solid var(--border-strong)',
          borderRadius: 6, padding: '6px 10px', height: 32, boxSizing: 'border-box',
          color: disabled ? 'var(--text-disabled)' : (selected ? 'var(--text-1)' : 'var(--text-3)'),
          font: 'inherit', fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
          background: disabled ? 'var(--disabled-fill)' : 'var(--surface-1)',
          fontFamily: 'var(--font-ui)', textAlign: 'left',
          outline: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 10, lineHeight: 1, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .12s', flex: 'none' }}>▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed', zIndex: 4100,
            left: pos.left, top: pos.top, width: pos.width,
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 4, boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
            maxHeight: 240, overflowY: 'auto',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: '7px 10px', fontSize: 12, color: 'var(--text-3)' }}>No options</div>
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
                  width: '100%', textAlign: 'left', background: isSel ? 'var(--surface-2)' : 'transparent',
                  border: 0, color: isSel ? 'var(--accent)' : 'var(--text-1)',
                  padding: '7px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'var(--hover)'; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {isSel && <Icon name="check" size={11} color="var(--accent)" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/* A colour pick that lands on the colour the layer already has is not an
   edit (owner 2026-10-02: only a real change asks to be saved). */
const sameEntityColour = (current, color, opacity) => (
  !!current
  && String(current.color || '').toLowerCase() === String(color || '').toLowerCase()
  && Math.abs((current.opacity ?? 0) - (opacity ?? 0)) < 0.0005
);

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#64748b',
];

export default function TemplatesEditor({
  templates = [],
  user = null,
  templatesLocked = false,
  initialMobileOpen = false,
  onNav,
  onCreateTemplate,
  onSaveTemplates,
  onArchiveTemplates,
  onReloadTemplates,
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
  /* `editFlag` turns on once any edit action runs and is reset whenever the
     editor reloads from props, or on Save / Cancel (all the BL-23 rules below
     still govern it). It is NOT the Save bar on its own any more: `dirty`
     (declared after the colour maps) is editFlag AND a real difference from
     `baseline` — the last loaded / saved copy, one fingerprint per template.
     Owner 2026-10-02: double-clicking a module and clicking off, or dragging
     a row away and back, must not ask to save; only a real change does. */
  const [editFlag, setDirty] = useState(false);
  const [baseline, setBaseline] = useState(() => fingerprintTemplates(rich));
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
  const [persistenceError, setPersistenceError] = useState('');
  const dispatchTemplatesSave = useCallback((payload) => {
    const run = () => Promise.resolve(onSaveTemplates(payload));
    const p = saveChainRef.current.then(run, run);
    saveChainRef.current = p.then(() => {}, () => {});
    return p;
  }, [onSaveTemplates]);

  /* ---- selection / edit state ---- */
  const [selectedId, setSelected] = useState(() => (initialMobileOpen ? (templates[0]?.id ?? null) : null));
  const [mobileTemplateOpen, setMobileTemplateOpen] = useState(initialMobileOpen);
  const [mobileEntitiesOpen, setMobileEntitiesOpen] = useState(false);
  const mobileEntitiesModalRef = useRef(null);
  const mobileEntitiesCloseRef = useRef(null);
  const [templateContentSearch, setTemplateContentSearch] = useState('');
  const [openCat, setOpenCat] = useState(-1);
  const [tplEdit, setTplEdit] = useState(false);
  const [selTpls, setSelTpls] = useState(() => new Set());
  const toggleTplSel = (id) => setSelTpls((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [tplMenu, setTplMenu] = useState(null);       // { id, rect }
  const [entityMenu, setEntityMenu] = useState(null); // { id, rect }
  const [catMenu, setCatMenu] = useState(null);       // { id, rect } category row "more" menu
  const [modMenu, setModMenu] = useState(null);       // { id, rect } module tab menu (touch / right-click)
  const [entityEdit, setEntityEdit] = useState(false);
  const [selEntities, setSelEntities] = useState(() => new Set());
  const toggleEntitySel = (id) => setSelEntities((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [openColor, setOpenColor] = useState(null);   // entity id whose picker is open
  // UX 2026-09-23 (owner: the collapse was "too abrupt"). A user fold keeps the
  // panel mounted for 260ms while it shrinks away (hub.css
  // hub-color-panel-fold), from its own measured height, then unmounts it.
  // Programmatic closes (switching template, deleting) stay instant.
  const [foldingColor, setFoldingColor] = useState(null);
  const [foldIsSwitch, setFoldIsSwitch] = useState(false);
  const foldTimerRef = useRef(0);
  const markPanelHeights = () => {
    // Only the panel you can SEE: the phone and desktop trees both render,
    // and the hidden twin measures 0, which made the new panel drop to 0 and
    // then pop open at the end of the motion.
    document.querySelectorAll('[data-entity-color-panel]').forEach((el) => {
      if (el.getBoundingClientRect().height <= 0 || el.dataset.folding) return;
      el.style.setProperty('--panel-h', `${el.getBoundingClientRect().height}px`);
      // The next panel to open is the same picker, so it drops to this height:
      // fold and drop then trade pixels one for one.
      document.documentElement.style.setProperty('--entity-panel-h', `${el.getBoundingClientRect().height}px`);
    });
  };
  // SWITCHING straight from one entity's panel to another's (owner
  // 2026-09-23: "one collapse while the other one expands ... is very
  // disorienting"). Both run at once — the old panel folds, the new one drops
  // — and the row you tapped is held still on screen for the whole motion:
  // each frame, whatever the fold above it removed is scrolled back, so only
  // the panels move and your row never jumps.
  const holdRowStill = (anchorEl) => {
    const row = anchorEl?.closest?.('[data-sortable-rearrange-item]') || anchorEl;
    if (!row) return;
    let scroller = row.parentElement;
    while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) {
      scroller = scroller.parentElement;
    }
    const startTop = row.getBoundingClientRect().top;
    const began = performance.now();
    const step = () => {
      if (!row.isConnected) return;
      const drift = row.getBoundingClientRect().top - startTop;
      if (scroller && Math.abs(drift) > 0.5) scroller.scrollTop += drift;
      if (performance.now() - began < 420) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  /* A press that will become a click on another entity's dot or row (both
     open that entity's panel) must not fold the open one first. A press on a
     row's name, grip or More is an ordinary outside press. */
  const isEntitySwitchPress = (event) => {
    const target = event?.target;
    if (!target?.closest) return false;
    if (target.closest('button[title="Edit color"]')) return true;
    return !!(target.closest('[data-entity-row]')
      && !target.closest('input, button[title="More"], [data-drag-rearrange-handle]'));
  };
  const foldColor = (next, anchorEl) => {
    clearTimeout(foldTimerRef.current);
    if (next === null && openColor) {
      markPanelHeights();
      setFoldIsSwitch(false);
      setFoldingColor(openColor);
      foldTimerRef.current = setTimeout(() => { setOpenColor(null); setFoldingColor(null); }, 260);
      return;
    }
    if (next && openColor && next !== openColor) {
      markPanelHeights();
      setFoldIsSwitch(true);
      setFoldingColor(openColor);
      setOpenColor(next);
      holdRowStill(anchorEl);
      foldTimerRef.current = setTimeout(() => setFoldingColor(null), 340);
      return;
    }
    setFoldingColor(null);
    setOpenColor(next);
  };
  useEffect(() => () => clearTimeout(foldTimerRef.current), []);
  // UX 2026-09-23 (owner: the phone colour panel "overflows/clips at the
  // bottom of the modal"). Opening a colour panel under a low row scrolls the
  // Entities sheet just enough to show the whole panel, once, on open.
  useEffect(() => {
    if (!openColor || !mobileEntitiesOpen) return undefined;
    // Wait for the panel's drop-down (280ms, hub.css) so the user first
    // SEES the rows below slide down — the sheet reads as one scrolling list
    // growing, not a new window (owner 2026-09-23) — then nudge it into view.
    const timer = setTimeout(() => {
      const panel = mobileEntitiesModalRef.current?.querySelector('.templates-mobile-color-panel');
      panel?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 380);
    return () => clearTimeout(timer);
  }, [openColor, mobileEntitiesOpen]);
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
  const pendingCategoryFocusRef = useRef(null);
  const toggleCatSel = (id) => setSelCats((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [moveModal, setMoveModal] = useState(null);  // { count, kind: 'category'|'module'|'entity', mode: 'move'|'copy' }
  const moveModalRef = useRef(null);
  const moveModalCloseRef = useRef(null);
  /* Move/Copy modal destination picks — destTpl is always meaningful;
     destMod only applies when a Category is being moved. */
  const [moveDestTpl, setMoveDestTpl] = useState(null);
  const [moveDestMod, setMoveDestMod] = useState(null);
  const [colorTab, setColorTab] = useState({});
  const [layerTab, setLayerTab] = useState({});       // { entityId: 'fill' | 'border' }
  const [borderColors, setBorderColors] = useState({});
  const [matchFill, setMatchFill] = useState({});     // { entityId: bool }
  /* Ids of the blank placeholder checklist rows THIS session added and the
     user has not typed into yet (rules at addItemToModule / discardFreshItem).
     Declared here because the real-change check below leaves them out. */
  const freshBlankItemsRef = useRef(new Set());
  /* The Save / Cancel bar, the reload guard and Cancel all read `dirty`: an
     edit happened AND the working copy (with its colour maps) differs from
     the baseline. Change-then-change-back is clean again. */
  const workingFingerprint = useMemo(
    () => fingerprintTemplates(rich, { roleColors, borderColors, matchFill }, freshBlankItemsRef.current),
    [rich, roleColors, borderColors, matchFill],
  );
  const dirty = editFlag && workingCopyDiffers(workingFingerprint, baseline);
  /* The baseline a save makes once it lands: exactly the copy it sent. */
  const fingerprintOf = (list) => fingerprintTemplates(list, { roleColors, borderColors, matchFill }, freshBlankItemsRef.current);

  const closeMobileTemplate = useCallback(() => {
    setMobileTemplateOpen(false);
    setMobileEntitiesOpen(false);
    setTemplateContentSearch('');
    setOpenColor(null);
    setCatEdit(false);
    setEntityEdit(false);
    setSelCats(new Set());
    setSelEntities(new Set());
  }, []);
  const closeMobileEntities = useCallback(() => {
    setMobileEntitiesOpen(false);
    setOpenColor(null);
    setEntityEdit(false);
    setSelEntities(new Set());
  }, []);
  const closeMoveModal = useCallback(() => setMoveModal(null), []);
  useModalFocusTrap({
    active: mobileEntitiesOpen,
    containerRef: mobileEntitiesModalRef,
    initialFocusRef: mobileEntitiesCloseRef,
    onClose: closeMobileEntities,
  });
  useModalFocusTrap({
    active: Boolean(moveModal),
    containerRef: moveModalRef,
    initialFocusRef: moveModalCloseRef,
    onClose: closeMoveModal,
  });
  const mobileSwipeSurfaceRef = useRef(null);
  const captureMobileTemplateList = useMobileEdgeSwipeBack({
    enabled: mobileTemplateOpen && !mobileEntitiesOpen,
    onBack: closeMobileTemplate,
    surfaceRef: mobileSwipeSurfaceRef,
  });

  useEffect(() => {
    if (!modEdit) setModSearch('');
  }, [modEdit]);

  /* Rebuild the working copy + colour-picker maps from the templates prop.
     Seeds the maps from each entity's persisted refinements so saved colours
     round-trip, and clears the dirty flag since the copy now matches the host. */
  const applyAuthoritativeTemplates = useCallback((sourceTemplates) => {
    const next = buildRich(applyTemplateOrderPreference(sourceTemplates, user), mintId);
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
    setBaseline(fingerprintTemplates(next, seeded, freshBlankItemsRef.current));
    setPersistenceError('');
  }, [user?.id, user?.email, mintId]);
  const reloadFromProps = useCallback(() => {
    applyAuthoritativeTemplates(templates);
  }, [applyAuthoritativeTemplates, templates]);
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
    /* A template the host added is part of what is saved, not a local edit. */
    const appendedBaseline = fingerprintTemplates(res.appended, seeded);
    setBaseline((prev) => ({ ...appendedBaseline, ...prev }));
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
      setMobileTemplateOpen(false);
      setMobileEntitiesOpen(false);
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

  /* Map over one template by id and replace it with `fn`'s result.

     `quiet` skips the dirty flag. It exists for ONE case: the placeholder blank
     checklist row that "Add checklist item" drops in. Owner 2026-09-22 — a
     blank row the user walks away from must "act like it was never created",
     and a Save / Cancel bar appearing out of nowhere is a visible trace that it
     was. Adding the blank row and discarding it again are therefore both quiet;
     the moment the user types into it, the normal (dirty) path takes over. */
  const mutateTpl = useCallback((tid, fn, { quiet = false } = {}) => {
    setRich((prev) => prev.map((t) => (t.id === tid ? fn(t) : t)));
    if (!quiet) markEdited();
  }, [markEdited]);

  /* --- template-level --- */
  const renameTemplate = (tid, name) => {
    const v = name.trim();
    if (!v) return;
    /* An unchanged name is a no-op and must NOT raise the Save bar. The old
       Escape path tripped this: Escape restored the field text and then blur
       re-committed the same name, leaving the editor falsely dirty. */
    if (rich.some((t) => t.id === tid && t.name === v)) return;
    mutateTpl(tid, (t) => (t.name === v ? t : { ...t, name: v }));
  };

  /* Renaming a template is an EDIT, so the big title offers the same
     Cancel / Save pair the project detail panel does, in the same place — the
     header's subtitle row (owner, 2026-09-22). Before this, the title committed
     silently on blur: there was no way to back out of a half-typed name and
     nothing told you the name had already changed. `titleDraft` holds the
     pending text for one template; while it differs from the saved name the
     pair appears. Enter saves, Escape cancels, and the pair is the only other
     way out — blur no longer commits, because a Save button that does not have
     to be pressed is a lie. */
  const [titleDraft, setTitleDraft] = useState(null); // { id, value } | null
  const titleDraftTemplate = titleDraft ? (rich.find((t) => t.id === titleDraft.id) || null) : null;
  const titleDirty = !!(titleDraftTemplate
    && titleDraft.value.trim()
    && titleDraft.value.trim() !== titleDraftTemplate.name);
  const cancelTitleDraft = () => setTitleDraft(null);
  /* Applies the pending title to `rich` AND returns the post-rename snapshot,
     because Save has to hand the payload straight to the persistence call —
     reading `rich` back after setState would still see the old name. */
  const commitTitleDraft = () => {
    if (!titleDraft) return rich;
    const name = titleDraft.value.trim();
    const target = rich.find((t) => t.id === titleDraft.id);
    setTitleDraft(null);
    if (!target || !name || name === target.name) return rich;
    renameTemplate(target.id, name);
    return rich.map((t) => (t.id === target.id ? { ...t, name } : t));
  };
  /* A draft belongs to one template. Once that template is no longer the one on
     screen, the draft is dropped rather than carried across to another name. */
  useEffect(() => {
    setTitleDraft((draft) => (draft && draft.id !== tpl?.id ? null : draft));
  }, [tpl?.id]);
  /* Spread onto both the desktop and the phone title input so the two copies
     can never drift apart. */
  const templateTitleField = (template) => ({
    value: titleDraft && titleDraft.id === template.id ? titleDraft.value : template.name,
    onChange: (e) => setTitleDraft({ id: template.id, value: e.target.value }),
    onKeyDown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitTitleDraft(); e.currentTarget.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelTitleDraft(); e.currentTarget.blur(); }
    },
  });

  const liveEntityStyle = (entity) => {
    const fill = roleColors[entity.id] || {
      color: entity.color || '#8c8c8a',
      opacity: entity.opacity ?? 0.35,
    };
    const matched = Object.prototype.hasOwnProperty.call(matchFill, entity.id)
      ? !!matchFill[entity.id]
      : !!entity.matchFill;
    const border = matched
      ? fill
      : (borderColors[entity.id] || {
        color: entity.borderColor || fill.color,
        opacity: entity.borderOpacity ?? fill.opacity,
      });
    return {
      color: fill.color,
      opacity: fill.opacity,
      borderColor: border.color,
      borderOpacity: border.opacity,
      matchFill: matched,
    };
  };
  const seedClonedEntityStyles = (clones) => {
    if (!clones.length) return;
    setRoleColors((prev) => ({
      ...prev,
      ...Object.fromEntries(clones.map(({ id, style }) => [id, { color: style.color, opacity: style.opacity }])),
    }));
    setBorderColors((prev) => ({
      ...prev,
      ...Object.fromEntries(clones.map(({ id, style }) => [id, { color: style.borderColor, opacity: style.borderOpacity }])),
    }));
    setMatchFill((prev) => ({
      ...prev,
      ...Object.fromEntries(clones.map(({ id, style }) => [id, style.matchFill])),
    }));
  };
  const duplicateTemplates = (ids) => {
    const next = [];
    const clonedEntities = [];
    rich.forEach((t) => {
      next.push(t);
      if (ids.has(t.id)) {
        next.push({
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
          roster: t.roster.map((r) => {
            const id = newId('e');
            const style = liveEntityStyle(r);
            clonedEntities.push({ id, style });
            return { ...r, ...style, id };
          }),
        });
      }
    });
    markEdited();
    setRich(next);
    seedClonedEntityStyles(clonedEntities);
    const savedBaseline = fingerprintOf(next);
    if (onSaveTemplates) {
      const rev = editRevisionRef.current;
      const req = ++saveReqSeqRef.current;
      dispatchTemplatesSave(next.map(richToTemplate))
        .then(() => {
          // What landed is the new baseline, even if newer edits followed.
          if (saveReqSeqRef.current === req) setBaseline(savedBaseline);
          if (editRevisionRef.current === rev && saveReqSeqRef.current === req) {
            setDirty(false);
            setPersistenceError('');
          }
        })
        .catch((err) => {
          console.error('Failed to duplicate templates', err);
          if (editRevisionRef.current === rev && saveReqSeqRef.current === req) {
            setDirty(true);
            setPersistenceError('Could not save templates. Your edits are still here; try again.');
          }
        });
    } else {
      setDirty(false);
      setBaseline(savedBaseline);
    }
  };
  /* The five entities every new template starts with. Same set the hub used to
     seed when the old create-template modal existed (GC / Subcontractor / My
     Company / 100% Complete / Removed), expressed in the editor's own roster
     shape and palette so a new template's entities look identical to ones added
     with "Add entity". */
  const DEFAULT_ROLES = ['GC', 'Subcontractor', 'My Company', '100% Complete', 'Removed'];

  /* UX: "New template" adds an empty template and opens it, exactly like Copy
     adds a duplicate — no modal. It is marked dirty so the existing Save bar
     persists it, which is the same path every other edit takes; nothing is
     written to the cloud until the user saves.
     This used to call the hub's onCreateTemplate, which had been reduced to a
     stub when its modal was deleted (KAL-82), so every "New template" button in
     this editor did nothing at all. The hub callback is still invoked for its
     remaining side effect (seeding the viewer's default entities). */
  const createTemplate = () => {
    const existing = rich.map((t) => t.name);
    let n = rich.length + 1, name;
    do { name = `Template ${n++}`; } while (existing.includes(name));
    const id = newId('t');
    setRich((prev) => [...prev, {
      id,
      name,
      modules: [],
      roster: DEFAULT_ROLES.map((role, i) => ({
        id: newId('e'),
        role,
        color: ENTITY_COLORS[i % ENTITY_COLORS.length],
      })),
    }]);
    markEdited();
    /* Open the new template so it reads as "created", matching how a new module
       opens itself. */
    setTimeout(() => setSelected(id), 0);
    if (onCreateTemplate) onCreateTemplate();
  };

  const reorderTemplates = (activeId, overId) => {
    if (!activeId || !overId || activeId === overId) return;
    setRich((prev) => {
      const next = moveItemById(prev, activeId, overId);
      if (next !== prev) saveTemplateOrderPreference(user, next.map((template) => template.id));
      return next === prev ? prev : next;
    });
  };
  const deleteTemplates = async (ids) => {
    /* KAL-432: templates archive like everything else. The hub owns the
       confirmation and the archive call; we only drop the rows locally once it
       reports success, so a cancel leaves the list exactly as it was.
       Deliberately NOT routed through the bundle save below: that path infers a
       deletion from the list shrinking and issues a permanent delete, which is
       the behaviour this replaces.
       UX: the hub reports WHICH templates reached Archive, and only those leave
       the list. A template that could not be archived stays visible (the hub
       explains why) — dropping it here would hide a template that still exists,
       and the next bundle save would then read that as a deletion. */
    if (onArchiveTemplates) {
      /* Names travel with the ids: a template that was never saved to the
         cloud is unknown to the hub's own list, and the error it shows has to
         be able to say which template it means. */
      const selection = Array.from(ids).map((id) => ({
        id,
        name: rich.find((t) => t.id === id)?.name || null,
      }));
      const archived = await onArchiveTemplates(selection);
      if (archived === false) return;
      const done = Array.isArray(archived) ? new Set(archived) : ids;
      if (done.size === 0) return;
      setRich((prev) => prev.filter((t) => !done.has(t.id)));
      /* Archived by the hub, so gone from the saved set too — the list
         shrinking must not read as an unsaved change. */
      setBaseline((prev) => {
        const nextBaseline = { ...prev };
        done.forEach((id) => { delete nextBaseline[id]; });
        return nextBaseline;
      });
      return;
    }
    /* Signed-out / local-only fallback keeps the original bundle-save delete.
       BL-23: the save call lives OUTSIDE the setRich updater (updaters must
       stay pure — StrictMode double-invokes them, which would double the
       save). A delete IS an edit: markEdited() keeps dirty=true while the
       save is in flight so a background refetch can't full-reload and
       transiently resurrect the deleted templates; the revision captured
       after the bump gates the dirty clear/restore so a newer edit is never
       exposed to a reload wipe by this promise settling. */
    const next = rich.filter((t) => !ids.has(t.id));
    markEdited();
    setRich(next);
    const savedBaseline = fingerprintOf(next);
    if (onSaveTemplates) {
      const rev = editRevisionRef.current;
      const req = ++saveReqSeqRef.current;
      dispatchTemplatesSave(next.map(richToTemplate))
        .then(() => {
          if (saveReqSeqRef.current === req) setBaseline(savedBaseline);
          if (editRevisionRef.current === rev && saveReqSeqRef.current === req) {
            setDirty(false);
            setPersistenceError('');
          }
        })
        .catch((err) => {
          console.error('Failed to delete templates', err);
          if (editRevisionRef.current === rev && saveReqSeqRef.current === req) {
            setDirty(true);
            setPersistenceError('Could not save templates. Your edits are still here; try again.');
          }
        });
    } else {
      setDirty(false);
      setBaseline(savedBaseline);
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
    // Same name (a double-click and click away): nothing to save.
    if (!tpl.modules.some((m) => m.id === id && m.name !== v)) { setModRename(null); return; }
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

  /* --- category-level (desktop scopes to open module; mobile can target any module) --- */
  const mutateModuleAt = (moduleIndex, fn, options) => {
    if (!tpl) return;
    mutateTpl(tpl.id, (t) => {
      const modules = t.modules.slice();
      if (!modules[moduleIndex]) return t;
      modules[moduleIndex] = fn(modules[moduleIndex]);
      return { ...t, modules };
    }, options);
  };
  const mutateOpenModule = (fn) => mutateModuleAt(openMod, fn);
  const addCategoryToModule = (moduleIndex) => {
    if (!tpl) return;
    const targetIndex = orderedMods[moduleIndex] ? moduleIndex : (orderedMods.length ? 0 : -1);
    const categoryId = newId('c');
    if (mobileTemplateOpen) {
      pendingCategoryFocusRef.current = categoryId;
      setTemplateContentSearch('');
    }

    /* A brand-new template can have no module yet. New Category must still
       produce a visible result, so seed its first module and category in the
       same edit instead of silently returning. */
    if (targetIndex < 0) {
      const existingModules = orderedMods.map((m) => m.name);
      let moduleNumber = 1, moduleName;
      do { moduleName = `Module ${moduleNumber++}`; } while (existingModules.includes(moduleName));
      const moduleId = newId('m');
      mutateTpl(tpl.id, (t) => ({
        ...t,
        modules: [...t.modules, {
          id: moduleId,
          name: moduleName,
          categories: [{ id: categoryId, name: 'Category 1', items: [] }],
        }],
      }));
      setOpenMod(orderedMods.length);
      setOpenCat(0);
      return;
    }

    const existing = (orderedMods[targetIndex].categories || []).map((c) => c.name);
    let n = 1, name;
    do { name = `Category ${n++}`; } while (existing.includes(name));
    mutateModuleAt(targetIndex, (m) => ({
      ...m,
      categories: [...(m.categories || []), { id: categoryId, name, items: [] }],
    }));
    /* Open the new category so its (empty) checklist is immediately visible. */
    setOpenMod(targetIndex);
    setTimeout(() => setOpenCat((orderedMods[targetIndex].categories || []).length), 0);
  };
  const addCategory = () => addCategoryToModule(openMod);
  const renameCategoryInModule = (moduleIndex, ci, name) => {
    const v = name.trim();
    if (!v) return;
    if (tpl?.modules?.[moduleIndex]?.categories?.[ci]?.name === v) return;
    mutateModuleAt(moduleIndex, (m) => {
      const categories = m.categories.slice();
      if (categories[ci] && categories[ci].name !== v) categories[ci] = { ...categories[ci], name: v };
      return { ...m, categories };
    });
  };
  const renameCategory = (ci, name) => renameCategoryInModule(openMod, ci, name);
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
  const reorderCategoriesInModule = (moduleIndex, activeId, overId) => {
    if (!activeId || !overId || activeId === overId) return;
    const categories = orderedMods[moduleIndex]?.categories || [];
    const from = categories.findIndex((category) => category.id === activeId);
    const to = categories.findIndex((category) => category.id === overId);
    if (moveItemById(categories, activeId, overId) === categories) return;   // dropped where it was

    mutateModuleAt(moduleIndex, (module) => {
      const nextCategories = moveItemById(module.categories || [], activeId, overId);
      return nextCategories === module.categories ? module : { ...module, categories: nextCategories };
    });

    if (openMod === moduleIndex) {
      if (openCat === from) setOpenCat(to);
      else if (from < openCat && to >= openCat) setOpenCat(openCat - 1);
      else if (from > openCat && to <= openCat) setOpenCat(openCat + 1);
    }
  };
  const reorderCategories = (activeId, overId) => reorderCategoriesInModule(openMod, activeId, overId);

  /* --- checklist-item-level (scoped to a category in the open module) --- */
  const mutateCategoryInModule = (moduleIndex, ci, fn, options) => {
    mutateModuleAt(moduleIndex, (m) => {
      const categories = m.categories.slice();
      if (!categories[ci]) return m;
      categories[ci] = fn(categories[ci]);
      return { ...m, categories };
    }, options);
  };
  const mutateCategory = (ci, fn) => mutateCategoryInModule(openMod, ci, fn);
  /* Ids of the blank placeholder rows THIS session added and the user has not
     typed into yet. Two rules hang off this set (owner 2026-09-22): walking away
     from such a row deletes it silently, and neither adding nor deleting it
     raises the Save bar. A blank row that arrived from the backend is not in the
     set, so it keeps the old behaviour and its removal is a real edit. */
  /* (freshBlankItemsRef is declared with the colour maps, above.) */
  const isFreshBlankItem = (itemId) => freshBlankItemsRef.current.has(itemId);
  /* Put the caret in a checklist row by id. The fresh blank row MUST be focused
     the moment it appears: the only thing that dismisses it is losing focus
     (blur) or Escape, and a row nobody ever focused can never fire either — that
     is how blank rows used to survive Escape, a click on the page and a click on
     the sidebar alike. */
  const focusChecklistItem = (itemId) => {
    if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      /* The desktop tree and the phone tree are BOTH in the DOM — one of them is
         just hidden by CSS — so every row exists twice under the same id. Focus
         the copy the user can actually see; focusing the hidden one is a silent
         no-op that leaves the blank row undismissable. */
      const el = [...document.querySelectorAll(`input[data-checklist-item-id="${itemId}"]`)]
        .find((candidate) => candidate.offsetParent !== null);
      el?.focus();
    });
  };
  // UX 2026-09-22 (owner): "I should not be allowed to add an infinite amount
  // of empty checklist items." One blank row per category at a time: if the
  // category already holds an empty item, Add does not add another - it puts
  // the cursor in the blank row that is already there.
  const addItemToModule = (moduleIndex, ci) => {
    const current = tpl?.modules?.[moduleIndex]?.categories?.[ci];
    const blank = (current?.items || []).find((item) => !String(item?.text || '').trim());
    if (blank) { focusChecklistItem(blank.id); return; }
    const id = newId('i');
    freshBlankItemsRef.current.add(id);
    mutateCategoryInModule(moduleIndex, ci, (c) => ({ ...c, items: [...c.items, { id, text: '' }] }), { quiet: true });
    focusChecklistItem(id);
  };
  const addItem = (ci) => addItemToModule(openMod, ci);
  const renameItemInModule = (moduleIndex, ci, itemId, text) => {
    const current = tpl?.modules?.[moduleIndex]?.categories?.[ci]?.items?.find((it) => it.id === itemId);
    if (current && current.text === text) return;   // unchanged: nothing to save
    // Real text: the row has graduated from placeholder to content, so it loses
    // the silent-discard exemption and this edit does raise the Save bar.
    freshBlankItemsRef.current.delete(itemId);
    mutateCategoryInModule(moduleIndex, ci, (c) => ({
      ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, text } : it)),
    }));
  };
  const renameItem = (ci, itemId, text) => renameItemInModule(openMod, ci, itemId, text);

  /* UX (KAL-69): required-row commit rules, shared by the desktop and mobile
     copies of the checklist and entity rows so they can never drift apart.

     A blank value NEVER commits — before this, blurring an empty checklist item
     wrote `text: ''` straight into the template and saved it, so a stray Tab
     silently emptied a row.

     Which of the two blank outcomes applies depends on whether the row already
     holds a value, and the distinction matters:
       - EXISTING row blanked -> quiet restore, no shake. Clearing a row must
         never be a back-door delete; the row's delete button is the only way.
       - FRESH blank row -> visible refusal (shake + hint), row stays open so
         the user can just type. Escape removes it outright. */
  const CHECKLIST_BLANK_HINT = "Can't be empty — type something or hit Esc to cancel.";

  /* UX 2026-08-19 (KAL-69): checklist items are capped at 100 characters.
     Why 100: the desktop editor's item input is 624px wide at 13px Helvetica,
     which holds roughly 110 characters of ordinary sentence text (81 at the
     worst-case average glyph width) before the text starts scrolling out of
     view inside the field. A real checklist question — "Verify fire alarm
     speaker coverage in the east corridor stairwell" is 65 — sits well under
     that, so 100 never truncates a realistic item, while still stopping
     someone from pasting a paragraph into a one-line row that then reads as
     an unreadable sliver in the Survey rail.

     A silently swallowed keystroke reads as a broken field, so hitting the cap
     REFUSES VISIBLY using the same one-shot shake + self-clearing hint the
     blank-row rule already uses (components/requiredInput.js). Same treatment,
     same vocabulary — the user learns one "not that, try again" signal. */
  const CHECKLIST_ITEM_MAX_LENGTH = 100;
  const CHECKLIST_LIMIT_HINT = `That's the ${CHECKLIST_ITEM_MAX_LENGTH}-character limit for a checklist item.`;

  // Fires on the keystroke the browser is about to drop because maxLength is
  // already reached. Only for keys that would actually insert a character —
  // arrows, Backspace, Tab, Escape and any shortcut chord must stay silent.
  const flagChecklistLimitIfFull = (e) => {
    const el = e.currentTarget;
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    if (el.selectionStart !== el.selectionEnd) return;   // typing over a selection replaces, not grows
    if (el.value.length < CHECKLIST_ITEM_MAX_LENGTH) return;
    flagRequiredInput(el, CHECKLIST_LIMIT_HINT);
  };
  const ENTITY_BLANK_HINT = "Can't be empty — type a name or remove the row.";

  const commitRequiredRow = (el, previousValue, hint, commit, onDiscardFresh) => {
    if (isBlank(el.value)) {
      if (previousValue) el.value = previousValue;      // existing row: quiet revert
      // Fresh blank row: owner 2026-09-22 - "if I click in an empty input
      // field and then click outside of it, it should just get dismissed",
      // no red hint. Rows that pass onDiscardFresh vanish as if never added;
      // the others (entities) keep the visible refusal.
      else if (onDiscardFresh) onDiscardFresh();
      else flagRequiredInput(el, hint);
      return;
    }
    commit(el.value.trim());
  };
  const reorderItemsInModule = (moduleIndex, ci, activeId, overId) => {
    if (!activeId || !overId || activeId === overId) return;
    const currentItems = (tpl?.modules?.[moduleIndex]?.categories?.[ci]?.items || []).filter(isActiveChecklistItem);
    if (moveItemById(currentItems, activeId, overId) === currentItems) return;   // dropped where it was
    mutateCategoryInModule(moduleIndex, ci, (c) => {
      const activeItems = (c.items || []).filter(isActiveChecklistItem);
      const archivedItems = (c.items || []).filter(isArchivedChecklistItem);
      const nextActiveItems = moveItemById(activeItems, activeId, overId);
      return nextActiveItems === activeItems ? c : { ...c, items: [...nextActiveItems, ...archivedItems] };
    });
  };
  const reorderItems = (ci, activeId, overId) => reorderItemsInModule(openMod, ci, activeId, overId);

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
  const hardDeleteItemInModule = (moduleIndex, ci, itemId, options) => mutateCategoryInModule(moduleIndex, ci, (c) => ({
    ...c, items: c.items.filter((it) => it.id !== itemId),
  }), options);
  const hardDeleteItem = (ci, itemId) => hardDeleteItemInModule(openMod, ci, itemId);
  /* The "walked away from a blank row" exit. Owner 2026-09-22: "if I click in an
     empty input field and then I click outside of it, it should just get
     dismissed ... act like it was never created" — so for a row this session
     added, removing it is quiet and leaves no Save bar behind. */
  const discardFreshItem = (ci, itemId) => {
    const fresh = isFreshBlankItem(itemId);
    freshBlankItemsRef.current.delete(itemId);
    hardDeleteItemInModule(openMod, ci, itemId, fresh ? { quiet: true } : undefined);
  };

  /* Mark an item as archived in the rich tree. The marker UI keeps showing
     its responses under an "Archived" section using lastKnownLabel. */
  const archiveItemInModule = (moduleIndex, ci, itemId) => mutateCategoryInModule(moduleIndex, ci, (c) => ({
    ...c,
    items: c.items.map((it) => (it.id === itemId ? archiveChecklistItem(it) : it)),
  }));
  const archiveItem = (ci, itemId) => archiveItemInModule(openMod, ci, itemId);

  const deleteItemInModule = async (moduleIndex, ci, itemId) => {
    const cat = (orderedMods[moduleIndex]?.categories || [])[ci];
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
        moduleIndex,
        categoryIndex: ci,
        itemId,
        label: item.text || item.lastKnownLabel || 'this item',
        usage,
      });
      return;
    }
    hardDeleteItemInModule(moduleIndex, ci, itemId);
  };
  const deleteItem = (ci, itemId) => deleteItemInModule(openMod, ci, itemId);

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
    if (tpl.roster.some((r) => r.id === eid && r.role === v)) return;   // unchanged
    mutateTpl(tpl.id, (t) => ({
      ...t, roster: t.roster.map((r) => (r.id === eid ? (r.role === v ? r : { ...r, role: v }) : r)),
    }));
  };
  const setEntityColor = (eid, color) => {
    if (!tpl) return;
    if (tpl.roster.some((r) => r.id === eid && r.color === color)) return;   // unchanged
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
    const clonesBySource = new Map();
    const clonedEntities = [];
    tpl.roster.forEach((entity) => {
      if (!ids.has(entity.id)) return;
      const id = newId('e');
      const style = liveEntityStyle(entity);
      const clone = { ...entity, ...style, id, role: `${entity.role} copy` };
      clonesBySource.set(entity.id, clone);
      clonedEntities.push({ id, style });
    });
    mutateTpl(tpl.id, (t) => {
      const out = [];
      t.roster.forEach((r) => {
        out.push(r);
        const clone = clonesBySource.get(r.id);
        if (clone) out.push(clone);
      });
      return { ...t, roster: out };
    });
    seedClonedEntityStyles(clonedEntities);
    setSelEntities(new Set());
  };
  const reorderEntities = (activeId, overId) => {
    if (!activeId || !overId || activeId === overId || !tpl) return;
    if (moveItemById(tpl.roster || [], activeId, overId) === tpl.roster) return;   // dropped where it was
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
        const fillOpacity = roleColors[e.id]?.opacity ?? e.opacity ?? 0.35;
        const mf = Object.prototype.hasOwnProperty.call(matchFill, e.id)
          ? !!matchFill[e.id]
          : !!e.matchFill;
        const bd = mf
          ? { color: fillColor, opacity: fillOpacity }
          : (borderColors[e.id] || {
            color: e.borderColor || fillColor,
            opacity: e.borderOpacity ?? fillOpacity,
          });
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

  /* `snapshot` lets a caller persist a list it just derived (Save committing a
     pending title rename) instead of the `rich` this render closed over, which
     would still hold the old name. Anything else passes nothing. It is never
     wired straight to onClick — a click event must not land here as a list. */
  const handleSaveTemplates = (snapshot) => {
    const payload = Array.isArray(snapshot) ? snapshot : rich;
    /* BL-23: dirty clears only when the save RESOLVES (the host now rethrows
       persistence failures), and only if no newer edit happened while it was
       in flight — an older promise settling must not clear dirty over newer
       unsaved edits (then-branch) or re-dirty an editor whose newer save
       already succeeded (catch-branch). On failure the edits and the Save bar
       survive, so the user can retry. */
    /* The saved copy becomes the baseline once it lands, so a newer edit that
       puts a field back the way it was before this save still counts. */
    const savedBaseline = fingerprintOf(payload);
    if (!onSaveTemplates) { setDirty(false); setBaseline(savedBaseline); return; }
    const rev = editRevisionRef.current;
    const req = ++saveReqSeqRef.current;
    dispatchTemplatesSave(payload.map(richToTemplate))
      .then(() => {
        if (saveReqSeqRef.current === req) setBaseline(savedBaseline);
        if (editRevisionRef.current === rev && saveReqSeqRef.current === req) {
          setDirty(false);
          setPersistenceError('');
        }
      })
      .catch((err) => {
        console.error('Failed to save templates', err);
        if (editRevisionRef.current === rev && saveReqSeqRef.current === req) {
          setDirty(true);
          setPersistenceError('Could not save templates. Your edits are still here; try again.');
        }
      });
  };
  const handleCancelEdits = async () => {
    /* BL-23: invalidate any in-flight save/delete so its later settlement
       can't re-dirty (or re-clear) the editor the user just reset. */
    editRevisionRef.current += 1;
    setPersistenceError('');
    try {
      // A save already in flight may settle after Cancel is pressed. Wait for
      // it, then read the authoritative snapshot so Cancel can never restore a
      // stale pre-save prop over a backend write that just committed.
      if (onReloadTemplates) {
        await reloadTemplatesAfterPendingSave({
          pendingSave: saveChainRef.current,
          reload: onReloadTemplates,
          apply: applyAuthoritativeTemplates,
        });
      } else {
        await saveChainRef.current.catch(() => undefined);
        reloadFromProps();
      }
    } catch (error) {
      console.error('Failed to reload authoritative templates', error);
      setDirty(true);
      setPersistenceError('Could not reload templates. Your edits are still here; try Cancel again.');
    }
  };

  /* One Cancel / Save pair serves the whole editor, so a pending template-title
     draft raises the same pair and is committed or dropped by the same buttons.
     Save applies the title FIRST (renameTemplate bumps the edit revision
     synchronously) and then persists the post-rename snapshot, so the new name
     is in the payload and the save can still clear the Save bar. */
  const saveRowVisible = dirty || titleDirty;
  const handleSaveAll = () => { handleSaveTemplates(commitTitleDraft()); };
  const handleCancelAll = async () => {
    cancelTitleDraft();
    if (dirty) await handleCancelEdits();
  };
  const saveRow = (className) => (saveRowVisible ? (
    <span className={className}>
      <button type="button" className="hub-btn" onClick={handleCancelAll}>Cancel</button>
      <button type="button" className="hub-btn hub-btn--primary" onClick={handleSaveAll}>Save</button>
    </span>
  ) : null);

  const mobileTemplateSelectRow = (
    <div className="templates-mobile-select-row mobile-header-select-row">
      <SectionIconButton
        action="select"
        label={tplEdit ? 'Done' : 'Select'}
        active={tplEdit}
        className="mobile-header-select-button"
        onClick={() => { const next = !tplEdit; setTplEdit(next); if (!next) setSelTpls(new Set()); }}
      />
      {tplEdit && (() => {
        const visibleSelectedIds = new Set(visibleTemplates.filter((t) => selTpls.has(t.id)).map((t) => t.id));
        const visibleSelCount = visibleSelectedIds.size;
        const allSel = visibleSelCount === visibleTemplates.length && visibleTemplates.length > 0;
        return (
          <span className="documents-select-actions templates-mobile-select-actions mobile-header-select-actions">
            <SelectModeButtons
              phone
              count={visibleSelCount}
              allSelected={allSel}
              onToggleAll={() => {
                setSelTpls((prev) => {
                  const next = new Set(prev);
                  visibleTemplates.forEach((template) => {
                    if (allSel) next.delete(template.id);
                    else next.add(template.id);
                  });
                  return next;
                });
              }}
              onDuplicate={() => { duplicateTemplates(visibleSelectedIds); setSelTpls(new Set()); }}
              onShare={() => { const first = visibleTemplates.find((t) => visibleSelectedIds.has(t.id)); if (first) onShare && onShare(first); }}
              onDelete={() => { deleteTemplates(visibleSelectedIds); setSelTpls(new Set()); }}
            />
          </span>
        );
      })()}
    </div>
  );
  const subtitle = (
    <>
      {/* Owner 2026-09-22: the tagline is gone; when the template has unsaved
          edits, Cancel / Save sit right here in the subtitle row instead. */}
      <span className="templates-desktop-summary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span><b>{visibleTemplates.length}</b> {visibleTemplates.length === 1 ? 'template' : 'templates'}</span>
        {saveRow('templates-desktop-save-row')}
      </span>
      <span className="templates-mobile-summary" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
        <span className="templates-mobile-count">
          <b>{mobileTemplateOpen && tpl ? orderedMods.length : visibleTemplates.length}</b> {mobileTemplateOpen && tpl
            ? (orderedMods.length === 1 ? 'module' : 'modules')
            : (visibleTemplates.length === 1 ? 'template' : 'templates')}
        </span>
        {!mobileTemplateOpen ? mobileTemplateSelectRow : null}
      </span>
    </>
  );
  const actions = (
    <>
      <div className="templates-mobile-search-actions hub-mobile-search-actions">
        {mobileTemplateOpen ? (
          <button
            type="button"
            className="templates-mobile-back-button"
            onClick={closeMobileTemplate}
          >
            {/* Owner 2026-10-02: back is chevronLeft, as everywhere else (it
                was a right arrow turned round by .templates-mobile-back-icon). */}
            <span style={{ display: 'inline-flex' }}><Icon name="chevronLeft" size={13} /></span>Templates
          </button>
        ) : null}
        <Search
          placeholder={mobileTemplateOpen ? 'Search template...' : 'Search templates...'}
          value={mobileTemplateOpen ? templateContentSearch : search}
          onChange={mobileTemplateOpen ? setTemplateContentSearch : setSearch}
          width="100%"
          dismissActionSelector={mobileTemplateOpen ? '[data-search-dismiss-action]' : ''}
        />
        {/* Cancel / Save take the gold action's place at the right end of this
            row while the open template has unsaved edits — the same slot "New
            template" holds on the list, so the header's one gold button never
            moves. */}
        {mobileTemplateOpen ? saveRow('templates-mobile-save-row') : null}
        {!mobileTemplateOpen ? (
          <button className="btn primary templates-mobile-create-button hub-mobile-primary-action" onClick={createTemplate}>
            <Icon name="plus" size={12} />New template
          </button>
        ) : null}
      </div>
      <div className="templates-desktop-search">
        <Search placeholder="Search templates..." value={search} onChange={setSearch} />
      </div>
    </>
  );

  /* Categories shown for the open module. */
  const activeMod = orderedMods[openMod] || orderedMods[0] || { categories: [] };
  const visibleCats = activeMod.categories || [];
  const totalCategoryCount = orderedMods.reduce((sum, mod) => sum + ((mod.categories || []).length), 0);
  const templateQuery = templateContentSearch.trim().toLowerCase();
  const mobileVisibleCats = templateQuery
    ? visibleCats.filter((cat) => [
      cat.name,
      ...(cat.items || []).map((item) => item.text || item.lastKnownLabel),
    ].some((value) => String(value || '').toLowerCase().includes(templateQuery)))
    : visibleCats;
  const mobileVisibleEntities = tpl
    ? (templateQuery
      ? tpl.roster.filter((entity) => String(entity.role || '').toLowerCase().includes(templateQuery))
      : tpl.roster)
    : [];

  /* New Category is an explicit action, not an ambiguous background tap.
     Reveal the new row even when a template filter was active, then focus its
     title so the result is immediate on a phone and never lands below the
     visible viewport unnoticed. */
  useEffect(() => {
    const categoryId = pendingCategoryFocusRef.current;
    if (!categoryId || !mobileTemplateOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const input = Array.from(document.querySelectorAll(
        '.templates-mobile-detail input[data-mobile-category-id]',
      )).find((candidate) => candidate.dataset.mobileCategoryId === categoryId);
      if (!input) return;
      pendingCategoryFocusRef.current = null;
      input.scrollIntoView({ block: 'nearest' });
      input.focus({ preventScroll: true });
      input.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileTemplateOpen, openCat, rich, templateContentSearch]);

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
      mobileSwipeSurfaceRef={mobileSwipeSurfaceRef}
    >
      <div className="ed-scope" style={{ width: 'auto', height: 'calc(100% - 65px)', position: 'relative', overflow: 'hidden' }}>
        {/* KAL-72: unified error-banner pattern (docs/ui/colors.md) — red is
            the accent edge, not the text colour. */}
        {persistenceError ? (
          <div role="alert" style={{ position: 'absolute', zIndex: 20, top: 6, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 24px)', padding: '6px 10px', borderRadius: 'var(--alert-radius)', border: 'var(--alert-danger-border)', background: 'var(--alert-danger-bg)', color: 'var(--text-1)', fontSize: 12, lineHeight: 1.35, textAlign: 'center' }}>
            {persistenceError}
          </div>
        ) : null}
        <div className="templates-editor-body" style={{ padding: '0 8px 8px 8px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Three columns */}
        <div className="templates-editor-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr 268px', gap: 8, height: '100%' }}>

          {/* ---------- LEFT: Templates ---------- */}
          <aside style={{
            overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%',
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 8,
          }}>
            {/* Owner 2026-10-01: one header line - the page's one gold action
                on the left, the quiet Select on the right. In select mode the
                bulk actions take the gold button's place and Done stays exactly
                where Select was, so nothing under the header moves. */}
            <div className="hub-section-head hub-panel-head">
              {!tplEdit ? (
                <button
                  className="hub-btn hub-btn--primary"
                  onClick={createTemplate}
                >
                  <Icon name="plus" size={11} />New template
                </button>
              ) : null}
              <div className="hub-select-actions hub-section-actions">
                {tplEdit && (
                  <>
                    {(() => {
                      const visibleSelectedIds = new Set(visibleTemplates.filter((t) => selTpls.has(t.id)).map((t) => t.id));
                      const visibleSelCount = visibleSelectedIds.size;
                      const allSel = visibleSelCount === visibleTemplates.length && visibleTemplates.length > 0;
                      return (
                        <SelectModeButtons
                          count={visibleSelCount}
                          allSelected={allSel}
                          onToggleAll={() => {
                            setSelTpls((prev) => {
                              const next = new Set(prev);
                              visibleTemplates.forEach((template) => {
                                if (allSel) next.delete(template.id);
                                else next.add(template.id);
                              });
                              return next;
                            });
                          }}
                          onDuplicate={() => { duplicateTemplates(visibleSelectedIds); setSelTpls(new Set()); }}
                          onShare={() => { const first = visibleTemplates.find((t) => visibleSelectedIds.has(t.id)); if (first) onShare && onShare(first); }}
                          onDelete={() => { deleteTemplates(visibleSelectedIds); setSelTpls(new Set()); }}
                        />
                      );
                    })()}
                  </>
                )}
                <SectionIconButton
                  action="select"
                  label={tplEdit ? 'Done' : 'Select'}
                  active={tplEdit}
                  onClick={() => { const next = !tplEdit; setTplEdit(next); if (!next) setSelTpls(new Set()); }}
                />
              </div>
            </div>
            <div className="slim-scroll hub-side-list" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
              {visibleTemplates.length === 0 && (
                <div className="meta" style={{ padding: '20px 8px', fontSize: 12 }}>
                  {rich.length === 0 ? 'No templates yet.' : 'No templates match your search.'}
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
                        /* UX 2026-09-23 (vertical symmetry): the 50px height
                           sets the row; an 8px vertical pad left 34px for a
                           34.5px stack, which pushed every child down. */
                        padding: '0 8px', borderRadius: 6,
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
                        {/* lineHeight 1.2: the line box hugs the glyphs, so the
                            name + swatches stack is centred by its ink, not by
                            spare leading above the name. */}
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{t.name}</div>
                        {/* Polish round 2 (2026-10-04): a template with no
                            entities shows no second line at all (it used to
                            show a lone "0"); the name then sits centred in
                            the row, the same as the phone list. */}
                        {t.roster.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {/* Up to 10 entity swatches fit before the row gets crowded;
                               any beyond that collapse into a "+N" overflow pill. */}
                            {t.roster.slice(0, 10).map((r) => {
                              const sw = entitySwatch(r);
                              return (
                                <span key={r.id} data-drag-keep-fill style={{ width: 14, height: 14, borderRadius: '50%', background: sw.fill, border: `1.5px solid ${sw.border}` }}></span>
                              );
                            })}
                            {t.roster.length > 10 && (
                              <span className="mono meta" style={{ fontSize: 11 }}>+{t.roster.length - 10}</span>
                            )}
                          </div>
                          <span className="mono meta" style={{ fontSize: 11 }}>{t.roster.length}</span>
                        </div>
                        )}
                      </div>
                      {tplEdit ? (
                        <span
                          onClick={(e) => { e.stopPropagation(); toggleTplSel(t.id); }}
                          data-drag-keep-fill style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--rule-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                        >
                          {isSel && <Icon name="check" size={10} color="var(--paper)" />}
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTplMenu((m) => (m && m.id === t.id ? null : { id: t.id, rect }));
                          }}
                          className="hub-icon-btn"
                          title="More" aria-label="More"
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
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
          }}>
            {!tpl ? (
              /* `tpl` is only null when there are zero templates (selection
                 falls back to the first visible/rich template otherwise). */
              <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
                <EmptyState
                  icon="template"
                  line="No templates yet"
                  description="Create a template to define your survey structure."
                  actionLabel="New template"
                  onAction={createTemplate}
                />
              </div>
            ) : (
            <>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 4, height: 36, background: tpl.accent, borderRadius: 2, flex: 'none' }}></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Inline rename field. Typing raises Cancel / Save in the
                    header's subtitle row; Enter saves, Escape backs out. Blur
                    deliberately does NOT commit. */}
                {/* Text-width field (owner 2026-10-01): the rename target is
                    the name itself, not the whole header line. */}
                <span className="hub-autowidth hub-title-field" data-value={templateTitleField(tpl).value} style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.2 }}>
                  <input
                    size={1}
                    key={tpl.id}
                    className="inline-edit cat-title hub-rename"
                    data-template-title
                    {...templateTitleField(tpl)}
                    title="Click to rename"
                    onDoubleClick={(e) => e.currentTarget.select()}
                  />
                </span>
              </div>
              <div className="micro" style={{ textAlign: 'right' }}>
                <div>{orderedMods.length} {orderedMods.length === 1 ? 'module' : 'modules'}</div>
              </div>
            </div>

            <div style={{ padding: '6px 18px 14px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

              {/* Module tabs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* LABEL count ...... [Select] [Add] (owner 2026-10-02:
                    icons). The header's Add is the one way to add a module;
                    the old "+" after the tabs is gone so there is no
                    duplicate. */}
                <div className="hub-section-head">
                  <p className="micro hub-section-label" style={{ margin: 0 }}>Modules<span className="hub-section-count">{orderedMods.length}</span></p>
                  <SectionIconActions className="hub-section-actions">
                    <SectionIconButton
                      action="select"
                      label="Select"
                      onClick={() => { setModEdit(true); setSelMods(new Set()); }}
                    />
                    <SectionIconButton action="add" label="Add module" onClick={addModule} />
                  </SectionIconActions>
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
                  onOpenMenu={(id, rect) => setModMenu({ id, rect })}
                />
              </div>

              {/* Categories header */}
              <div className="hub-section-head" style={{ marginTop: 12, marginBottom: 8 }}>
                <p className="micro hub-section-label" style={{ margin: 0 }}>Categories<span className="hub-section-count">{visibleCats.length}</span></p>
                <div className="hub-section-actions">
                    {catEdit && (() => {
                      const c = selCats.size;
                      const allSel = c === visibleCats.length && visibleCats.length > 0;
                      return (
                        <SelectModeButtons
                          count={c}
                          allSelected={allSel}
                          onToggleAll={() => setSelCats(allSel ? new Set() : new Set(visibleCats.map((cat) => cat.id)))}
                          onDuplicate={() => duplicateCategories(selCats)}
                          onMove={() => setMoveModal({ count: c, kind: 'category', mode: 'move' })}
                          onCopy={() => setMoveModal({ count: c, kind: 'category', mode: 'copy' })}
                          onShare={() => { if (tpl) onShare && onShare(tpl); }}
                          onDelete={() => deleteCategories(selCats)}
                        />
                      );
                    })()}
                  <SectionIconButton
                    action="select"
                    label={catEdit ? 'Done' : 'Select'}
                    active={catEdit}
                    onClick={() => { const next = !catEdit; setCatEdit(next); if (!next) setSelCats(new Set()); }}
                  />
                  {!catEdit ? (
                    <SectionIconButton action="add" label="Add category" onClick={addCategory} />
                  ) : null}
                </div>
              </div>

              {/* Expandable category list */}
              <div className="slim-scroll" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4, flex: 1, minHeight: 0 }}>
                {visibleCats.length === 0 && (
                  <div className="meta" style={{ padding: '16px 4px', fontSize: 12 }}>This module has no categories yet.</div>
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
                      {/* Row header. Owner 2026-10-01: a click ANYWHERE on the
                          row opens or closes it (the chevron is only the cue);
                          the grip only drags; the name renames, and its hit
                          box is just its text; ⋮ holds Rename / Delete. In
                          Select mode a click anywhere ticks the row.
                          [grip 24][chevron 22][name][...][count][⋮ 28] */}
                      <div
                        data-drag-rearrange-row
                        className={`tpl-cat-row${open ? ' is-open' : ''}${catEdit ? ' is-selecting' : ''}${catEdit && isSel ? ' is-selected' : ''}`}
                        aria-expanded={catEdit ? undefined : open}
                        onClick={() => { if (catEdit) toggleCatSel(c.id); else setOpenCat(open ? -1 : i); }}
                      >
                        <DragRearrangeHandle
                          {...attributes}
                          {...listeners}
                          isDragging={isDragging}
                          style={{ width: 24, height: 28 }}
                        />
                        <button
                          type="button"
                          className="tpl-cat-chevron"
                          title={open ? 'Collapse' : 'Expand'}
                          aria-label={`${open ? 'Collapse' : 'Expand'} ${c.name}`}
                        ><CategoryDisclosureGlyph /></button>
                        <span className="hub-autowidth tpl-cat-name" data-value={c.name}>
                          <input
                            size={1}
                            className="inline-edit cat-title hub-rename"
                            data-category-name-id={c.id}
                            defaultValue={c.name}
                            key={c.id + ':' + c.name}
                            title="Rename"
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.currentTarget.select()}
                            onInput={syncAutoWidth}
                            onBlur={(e) => {
                              /* BL-23: empty titles snap back visibly to the old
                                 name (the model never accepted them), and an
                                 unchanged title is a no-op that must not dirty
                                 the editor (incl. the Escape-then-blur path). */
                              const r = resolveTitleCommit(e.currentTarget.value, c.name);
                              if (r.action === 'commit') renameCategory(i, r.name);
                              e.currentTarget.value = r.name;
                              syncAutoWidth(e);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = c.name; e.currentTarget.blur(); } }}
                          />
                        </span>
                        <span className="tpl-cat-count" title={`${items.length} ${items.length === 1 ? 'item' : 'items'}${archivedItems.length > 0 ? `, ${archivedItems.length} archived` : ''}`}>
                          {items.length} {items.length === 1 ? 'item' : 'items'}{archivedItems.length > 0 ? ` (+${archivedItems.length} archived)` : ''}
                        </span>
                        {catEdit ? (
                          <span
                            className="tpl-cat-check"
                            onClick={(e) => { e.stopPropagation(); toggleCatSel(c.id); }}
                            data-drag-keep-fill style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--rule-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            {isSel && <Icon name="check" size={10} color="var(--paper)" />}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="hub-icon-btn tpl-cat-more"
                            title="More" aria-label="More"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setCatMenu((m) => (m && m.id === c.id ? null : { id: c.id, rect }));
                            }}
                          ><Icon name="more" size={14} /></button>
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
                          {/* 26 + grip 24 + gap 6 = 56: item text starts under the category name. */}
                          <div style={{ padding: '4px 14px 12px 26px', background: 'var(--paper-deep)' }}>
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
                                  className="inline-edit hub-rename"
                                  data-checklist-item-id={it.id}
                                  defaultValue={it.text}
                                  placeholder="Add checklist item"
                                  maxLength={CHECKLIST_ITEM_MAX_LENGTH}
                                  onBlur={(e) => commitRequiredRow(e.currentTarget, it.text, CHECKLIST_BLANK_HINT, (v) => renameItem(i, it.id, v), () => discardFreshItem(i, it.id))}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { if (!it.text) { discardFreshItem(i, it.id); return; } e.currentTarget.value = it.text; e.currentTarget.blur(); } else flagChecklistLimitIfFull(e); }}
                                />
                                <button
                                  title="Delete item" aria-label="Delete item"
                                  onClick={(e) => { e.stopPropagation(); deleteItem(i, it.id); }}
                                  className="hub-icon-btn is-danger"
                                ><Icon name="close" size={11} /></button>
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
                                color: 'var(--ink-muted)', borderRadius: 2, fontSize: 12,
                                cursor: 'pointer', fontFamily: 'inherit',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                              }}
                            >
                              <Icon name="plus" size={13} /> Add checklist item
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
                                <div className="meta" style={{ fontSize: 11, marginBottom: 6, letterSpacing: 0, color: 'var(--text-3)' }}>
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
                                    <span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span>
                                    <span
                                      title={`Archived${it.archivedAt ? ` ${new Date(it.archivedAt).toLocaleString()}` : ''} — historical responses preserved`}
                                      style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic', textDecoration: 'line-through' }}
                                    >
                                      {archivedItemLabel(it)}
                                    </span>
                                    <button
                                      title="Permanently delete (orphans historical responses)" aria-label="Permanently delete (orphans historical responses)"
                                      onClick={(e) => { e.stopPropagation(); hardDeleteItem(i, it.id); }}
                                      className="hub-icon-btn is-danger"
                                    ><Icon name="close" size={11} /></button>
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
              {/* One header line (owner 2026-10-01): ENTITIES n ... [Select] [+ Entity].
                  In select mode the bulk actions fill the line and Done keeps
                  the right edge; the label steps aside so they fit the rail. */}
              <div className="hub-section-head" style={{ padding: '8px 8px 8px 8px', borderBottom: '1px solid var(--rule)', flex: 'none', minHeight: 64, boxSizing: 'border-box' }}>
                {!entityEdit ? (
                  <p className="micro hub-section-label" style={{ margin: 0 }}>Entities<span className="hub-section-count">{tpl ? tpl.roster.length : 0}</span></p>
                ) : null}
                <div className="hub-section-actions">
                {entityEdit && tpl && (() => {
                  const c = selEntities.size;
                  const allSel = c === tpl.roster.length && tpl.roster.length > 0;
                  return (
                    <SelectModeButtons
                      count={c}
                      allSelected={allSel}
                      onToggleAll={() => setSelEntities(allSel ? new Set() : new Set(tpl.roster.map((r) => r.id)))}
                      onDuplicate={() => duplicateEntities(selEntities)}
                      onMove={() => setMoveModal({ count: c, kind: 'entity', mode: 'move' })}
                      onCopy={() => setMoveModal({ count: c, kind: 'entity', mode: 'copy' })}
                      onShare={() => { if (tpl) onShare && onShare(tpl); }}
                      onDelete={() => deleteEntities(selEntities)}
                    />
                  );
                })()}
                <SectionIconButton
                  action="select"
                  label={entityEdit ? 'Done' : 'Select'}
                  active={entityEdit}
                  onClick={() => { const next = !entityEdit; setEntityEdit(next); if (!next) setSelEntities(new Set()); }}
                />
                {!entityEdit ? (
                  <SectionIconButton action="add" label="Add entity" onClick={addEntity} disabled={!tpl} />
                ) : null}
                {/* Save / Cancel moved to the header's subtitle row (owner,
                    2026-09-22) - see `subtitle` above. */}
                </div>
              </div>

              <div className="slim-scroll" style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1, minHeight: 0 }}>
                {(!tpl || tpl.roster.length === 0) && (
                  <div className="meta" style={{ fontSize: 12, padding: '12px 2px' }}>No entities on this template yet.</div>
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
                  const showPanel = isOpen || foldingColor === r.id;
                  const isSel = selEntities.has(r.id);
                  return (
                    <SortableRearrangeRow
                      key={r.id}
                      id={r.id}
                    >
                      {({ attributes, listeners, isDragging }) => (
                      <>
                      {/* Same row rules as a category (owner 2026-10-01):
                          a click on the row opens / closes its colour panel,
                          the name renames (text-width hit box), the grip
                          drags; in Select mode a click ticks the row.
                          [grip 24][dot 22][name][...][⋮ 28] */}
                      <div
                        data-drag-rearrange-row
                        data-entity-row
                        className={`card-line tpl-entity-row${isOpen ? ' is-open' : ''}${entityEdit ? ' is-selecting' : ''}${entityEdit && isSel ? ' is-selected' : ''}`}
                        aria-expanded={entityEdit ? undefined : isOpen}
                        onClick={(e) => { if (entityEdit) toggleEntitySel(r.id); else foldColor(isOpen ? null : r.id, e.currentTarget); }}
                        style={{
                          transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                        }}
                      >
                        <DragRearrangeHandle
                          {...attributes}
                          {...listeners}
                          isDragging={isDragging}
                          style={{ width: 24, height: 28 }}
                          collapseOpen={isOpen && foldingColor !== r.id}
                          onCollapse={() => foldColor(null)}
                        />
                        <button
                          onClick={(e) => { if (entityEdit) return; e.stopPropagation(); foldColor(isOpen ? null : r.id, e.currentTarget); }}
                          title="Edit color" aria-label="Edit color"
                          style={{
                            width: 18, height: 18, borderRadius: '50%', margin: '0 2px',
                            /* Solid full-strength chip (Drawboard-style) so entity
                               colours stay vibrant and easy to tell apart — the picked
                               opacity drives the PDF annotation, not this identifier. */
                            background: c,
                            /* No edge (owner 2026-09-23): no other template
                               colour dot has one. */
                            border: 0,
                            cursor: 'pointer', padding: 0,
                          }}
                        ></button>
                        <span className="hub-autowidth tpl-entity-name" data-value={r.role || 'Entity name'}>
                          <input
                            size={1}
                            className="inline-edit cat-title hub-rename"
                            data-entity-name-id={r.id}
                            defaultValue={r.role}
                            key={r.id + ':' + r.role}
                            placeholder="Entity name"
                            title="Rename"
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.currentTarget.select()}
                            onInput={syncAutoWidth}
                            onBlur={(e) => { commitRequiredRow(e.currentTarget, r.role, ENTITY_BLANK_HINT, (v) => renameEntity(r.id, v)); syncAutoWidth(e); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = r.role; e.currentTarget.blur(); } }}
                          />
                        </span>
                        {!isOpen && (
                          entityEdit ? (
                            <span
                              className="tpl-entity-check"
                              onClick={(e) => { e.stopPropagation(); toggleEntitySel(r.id); }}
                              data-drag-keep-fill style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--rule-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', justifySelf: 'center' }}
                            >
                              {isSel && <Icon name="check" size={10} color="var(--paper)" />}
                            </span>
                          ) : (
                            <button
                              title="More" aria-label="More"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setEntityMenu((m) => (m && m.id === r.id ? null : { id: r.id, rect }));
                              }}
                              className="hub-icon-btn tpl-entity-more"
                            ><Icon name="more" size={14} /></button>
                          )
                        )}
                      </div>
                      {showPanel && (() => {
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
                          // The colour it already is (a click on the current swatch): no edit.
                          if (sameEntityColour(activeData, color, opacity)) return;
                          if (layer === 'border') {
                            setBorderColors({ ...borderColors, [r.id]: { color, opacity } });
                          } else {
                            setRoleColors({ ...roleColors, [r.id]: { color, opacity } });
                            setEntityColor(r.id, color);
                          }
                          markEdited();
                        };
                        return (
                          <div data-entity-color-panel data-folding={foldingColor === r.id ? (foldIsSwitch ? 'switch' : 'true') : undefined} style={{
                            margin: '-4px 0 6px', padding: 0,
                            background: 'var(--paper-deep)', border: '1px solid var(--rule)', borderTop: 0, borderRadius: '0 0 4px 4px',
                            display: 'flex', flexDirection: 'column',
                            overflow: 'hidden',
                          }}>
                            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {/* Shared colour picker — the app's one picker. Dimmed +
                                  read-only while a border is matched to the fill. */}
                              <div>
                                <CompactColorPicker
                                  color={activeColor}
                                  opacity={activeOp}
                                  onChange={applyColor}
                                  onClose={(event) => {
                                    // A press on ANOTHER entity's colour dot is a switch, not a
                                    // close: its click follows ~100ms later and runs the switch.
                                    // Folding here first made the click restart the fold (a jump).
                                    if (isEntitySwitchPress(event)) return;
                                    foldColor(null);
                                  }}
                                  dismissInsideSelector="[data-entity-color-panel], [data-sortable-rearrange-item]:has([data-entity-color-panel])"
                                  /* The entity panel is already the box (owner
                                     2026-09-23: "not a box within a box"). */
                                  chrome={false}
                                  /* The picker's own Fill / Border tabs — the
                                     same segmented control the canvas picker
                                     uses (owner 2026-09-23: "look like that"). */
                                  tabs={{
                                    items: [{ id: 'fill', label: 'Fill' }, { id: 'border', label: 'Border' }],
                                    active: layer,
                                    onSelect: (k) => setLayerTab({ ...layerTab, [r.id]: k }),
                                  }}
                                  /* UX 2026-09-23 (owner: the "Match fill"
                                     row "shoves things out of the way"). Match
                                     fill is the Border tab's first grid cell,
                                     where the Fill tab keeps Transparent, so
                                     the panel is the same height on both tabs.
                                     It is a link: while on, the border takes
                                     the fill's colour and opacity and the rest
                                     of the picker dims; click it to unlink. */
                                  firstPreset={layer === 'border' ? {
                                    kind: 'match', color: c, opacity: op, linked: match,
                                    onToggle: () => { setMatchFill({ ...matchFill, [r.id]: !match }); markEdited(); },
                                  } : 'transparent'}
                                  locked={isBorderMatched}
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
        <div className="templates-mobile-layout slim-scroll">
          {!mobileTemplateOpen ? (
            <div className="templates-mobile-browser">
              {visibleTemplates.length === 0 ? (
                <EmptyState
                  icon="template"
                  line={rich.length === 0 ? 'No templates yet' : 'No templates match your search'}
                  // UX (KAL-58): the coaching sentence belongs only on the
                  // genuinely-empty case. A user whose SEARCH returned nothing
                  // already has templates and doesn't need to be told what a
                  // template is for — they need to fix their search.
                  description={rich.length === 0 ? 'Create a template to define your survey structure.' : undefined}
                  actionLabel="New template"
                  onAction={createTemplate}
                />
              ) : (
                <>
                  <SortableRearrangeList ids={visibleTemplates.map((t) => t.id)} onReorder={reorderTemplates}>
                    {visibleTemplates.map((t) => {
                      const isSel = selTpls.has(t.id);
                      return (
                        <SortableRearrangeRow key={`mobile-template-${t.id}`} id={t.id}>
                          {({ attributes, listeners, isDragging }) => (
                            <div
                              data-drag-rearrange-row
                              role="button"
                              tabIndex={0}
                              /* Selected takes the panel's cue: a --surface-3
                                 step and a 2px gold left edge, matching the
                                 desktop template list. */
                              className={`templates-mobile-row reorderable${tplEdit && isSel ? ' is-selected' : ''}`}
                              onClick={() => {
                                if (tplEdit) {
                                  toggleTplSel(t.id);
                                  return;
                                }
                                captureMobileTemplateList();
                                setSelected(t.id);
                                setOpenCat(-1);
                                setOpenMod(0);
                                setMobileEntitiesOpen(false);
                                setTemplateContentSearch('');
                                setMobileTemplateOpen(true);
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                e.currentTarget.click();
                              }}
                            >
                              <DragRearrangeHandle
                                {...attributes}
                                {...listeners}
                                isDragging={isDragging}
                                style={{ width: 24, height: 24 }}
                              />
                              <span className="templates-mobile-copy">
                                <strong>{t.name}</strong>
                                <small>{countLabel(t.modules.length, 'module')} · {countLabel(t.modules.reduce((sum, mod) => sum + (mod.categories || []).length, 0), 'category', 'categories')} · {countLabel(t.roster.length, 'entity', 'entities')}</small>
                                <span className="templates-mobile-swatches">
                                  {t.roster.slice(0, 8).map((r) => {
                                    const sw = entitySwatch(r);
                                    return <i key={r.id} style={{ background: sw.fill, borderColor: sw.border }} />;
                                  })}
                                  {t.roster.length > 8 ? <em>+{t.roster.length - 8}</em> : null}
                                </span>
                              </span>
                              {tplEdit ? (
                                <span className={`templates-mobile-check ${isSel ? 'checked' : ''}`}>{isSel ? <Icon name="check" size={11} /> : null}</span>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setTplMenu((m) => (m && m.id === t.id ? null : { id: t.id, rect }));
                                  }}
                                  className="hub-icon-btn"
                                  title="More" aria-label="More"
                                ><Icon name="more" size={14} /></button>
                              )}
                            </div>
                          )}
                        </SortableRearrangeRow>
                      );
                    })}
                  </SortableRearrangeList>
                </>
              )}
            </div>
          ) : tpl ? (
            <div className="templates-mobile-detail">
              {/* Owner 2026-09-23 picked layout B, "one card, divided": the
                  template name, Modules and Categories share ONE panel (the
                  phone list panel's fill, edge and radius), parted by
                  full-width hairlines, with no card nested inside it. Section
                  actions are quiet words (no gold since 2026-10-01) in each header row. */}
              <div className="templates-mobile-detail-card">
              <div className="templates-mobile-template-card">
                <div className="templates-mobile-title-stack">
                  <span className="hub-autowidth templates-mobile-title-field" data-value={templateTitleField(tpl).value}>
                    <input
                      size={1}
                      key={`mobile-template-title-${tpl.id}`}
                      className="templates-mobile-title-input hub-rename"
                      data-template-title
                      {...templateTitleField(tpl)}
                      title="Tap to rename"
                    />
                  </span>
                  <span>{orderedMods.length} {orderedMods.length === 1 ? 'module' : 'modules'} · {totalCategoryCount} {totalCategoryCount === 1 ? 'category' : 'categories'} · {tpl.roster.length} {tpl.roster.length === 1 ? 'entity' : 'entities'}</span>
                </div>
                <button
                  type="button"
                  className="templates-mobile-entities-button"
                  onClick={() => {
                    setMobileEntitiesOpen(true);
                    setOpenColor(null);
                    setEntityEdit(false);
                    setSelEntities(new Set());
                  }}
                >
                  <Icon name="users" size={12} />Entities
                </button>
              </div>

              <section className="templates-mobile-section templates-mobile-modules-section">
                <div className="templates-mobile-section-head">
                  <span>Modules<b className="hub-section-count">{orderedMods.length}</b></span>
                  <div className="templates-mobile-section-actions">
                    <SectionIconActions phone>
                      <SectionIconButton
                        phone
                        action="select"
                        label="Select"
                        className="templates-mobile-section-select"
                        onClick={() => { setModEdit(true); setSelMods(new Set()); }}
                      />
                      <SectionIconButton phone action="add" label="Add module" data-search-dismiss-action onClick={addModule} />
                    </SectionIconActions>
                  </div>
                </div>
                <div className="templates-mobile-module-tabs">
                  <SortableModuleTabs
                    modules={orderedMods}
                    openMod={openMod}
                    modRename={modRename}
                    onOpenModule={(mi) => {
                      setOpenMod(mi);
                      setOpenCat(-1);
                    }}
                    onStartRename={setModRename}
                    onRenameModule={renameModule}
                    onCancelRename={() => setModRename(null)}
                    onReorderModules={reorderMods}
                    onOpenMenu={(id, rect) => setModMenu({ id, rect })}
                    showCounts={false}
                  />
                </div>
              </section>

              <section className="templates-mobile-section templates-mobile-categories-section">
                {/* Select swaps the header's right side for the selection
                    actions in place, so the row keeps its height and nothing
                    under it moves when select mode starts or ends. */}
                <div className="templates-mobile-section-head">
                  <span>Categories<b className="hub-section-count">{visibleCats.length}</b></span>
                  <div className={`templates-mobile-section-actions${catEdit ? ' templates-mobile-select-actions' : ''}`}>
                    {catEdit ? (() => {
                      const visibleSelectedIds = new Set(mobileVisibleCats.filter((cat) => selCats.has(cat.id)).map((cat) => cat.id));
                      const c = visibleSelectedIds.size;
                      const allSel = c === mobileVisibleCats.length && mobileVisibleCats.length > 0;
                      return (
                        <>
                          <SelectModeButtons
                            phone
                            count={c}
                            allSelected={allSel}
                            onToggleAll={() => setSelCats((prev) => {
                              const next = new Set(prev);
                              mobileVisibleCats.forEach((cat) => {
                                if (allSel) next.delete(cat.id);
                                else next.add(cat.id);
                              });
                              return next;
                            })}
                            onDuplicate={() => duplicateCategories(visibleSelectedIds)}
                            onMove={() => setMoveModal({ count: c, kind: 'category', mode: 'move' })}
                            onCopy={() => setMoveModal({ count: c, kind: 'category', mode: 'copy' })}
                            onShare={() => { if (tpl) onShare && onShare(tpl); }}
                            onDelete={() => deleteCategories(visibleSelectedIds)}
                          />
                          <SectionIconButton
                            phone
                            action="select"
                            label="Done"
                            active
                            className="templates-mobile-section-select"
                            onClick={() => { setCatEdit(false); setSelCats(new Set()); }}
                          />
                        </>
                      );
                    })() : (
                      <SectionIconActions phone>
                        <SectionIconButton
                          phone
                          action="select"
                          label="Select"
                          className="templates-mobile-section-select"
                          onClick={() => { setCatEdit(true); }}
                        />
                        <SectionIconButton phone action="add" label="Add category" data-search-dismiss-action onClick={addCategory} />
                      </SectionIconActions>
                    )}
                  </div>
                </div>
                {mobileVisibleCats.length === 0 ? (
                  <div className="templates-mobile-empty">No categories match this view.</div>
                ) : (
                  <SortableRearrangeList ids={mobileVisibleCats.map((c) => c.id)} onReorder={reorderCategories} variableHeight gap={7}>
                    {mobileVisibleCats.map((c) => {
                      const ci = visibleCats.findIndex((cat) => cat.id === c.id);
                      const allItems = c.items || [];
                      const items = allItems.filter(isActiveChecklistItem);
                      const archivedItems = allItems.filter(isArchivedChecklistItem);
                      const open = openCat === ci;
                      const isSel = selCats.has(c.id);
                      return (
                        <SortableRearrangeRow key={`mobile-category-${c.id}`} id={c.id}>
                          {({ attributes, listeners, isDragging }) => (
                            <div className="templates-mobile-category-card">
                              {/* Owner 2026-10-01: a tap anywhere on the row opens
                                  or closes it; the grip only drags; the name
                                  renames ONLY once the row is open (a quick tap
                                  on a closed row never raises the keyboard - the
                                  input ignores taps until then, see hub.css);
                                  ⋮ holds Rename / Delete; in Select mode a tap
                                  ticks the row.
                                  [grip 32][chevron 26][name][...][count][⋮ 36]
                                  Owner 2026-10-02: swipe the row left for a
                                  trash behind it - the ⋮ menu's Delete (off
                                  in Select mode, where a tap ticks). */}
                              <SwipeToDeleteRow
                                label={`Delete ${c.name}`}
                                disabled={catEdit}
                                onDelete={() => deleteCategories(new Set([c.id]))}
                              >
                              <div
                                data-drag-rearrange-row
                                className={`templates-mobile-category-row${open ? ' is-open' : ''}${catEdit ? ' is-selecting' : ''}${catEdit && isSel ? ' is-selected' : ''}`}
                                aria-expanded={catEdit ? undefined : open}
                                onClick={() => { if (catEdit) toggleCatSel(c.id); else setOpenCat(open ? -1 : ci); }}
                              >
                                <DragRearrangeHandle {...attributes} {...listeners} isDragging={isDragging} style={{ width: 24, height: 24 }} />
                                <button
                                  type="button"
                                  className={`templates-mobile-category-toggle ${open ? 'open' : ''}`}
                                  aria-label={`${open ? 'Collapse' : 'Expand'} ${c.name}`}
                                ><CategoryDisclosureGlyph /></button>
                                <span className="hub-autowidth templates-mobile-category-name" data-value={c.name}>
                                  <input
                                    size={1}
                                    className="templates-mobile-inline-input hub-rename"
                                    data-mobile-category-id={c.id}
                                    data-category-name-id={c.id}
                                    defaultValue={c.name}
                                    key={`mobile-cat-${c.id}:${c.name}`}
                                    onClick={(e) => e.stopPropagation()}
                                    onInput={syncAutoWidth}
                                    onBlur={(e) => {
                                      const r = resolveTitleCommit(e.currentTarget.value, c.name);
                                      if (r.action === 'commit') renameCategory(ci, r.name);
                                      e.currentTarget.value = r.name;
                                      syncAutoWidth(e);
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = c.name; e.currentTarget.blur(); } }}
                                  />
                                </span>
                                <span className="templates-mobile-category-count" title={archivedItems.length ? `${items.length} active ${items.length === 1 ? 'item' : 'items'}, ${archivedItems.length} archived` : `${items.length} active ${items.length === 1 ? 'item' : 'items'}`}>{items.length} {items.length === 1 ? 'item' : 'items'}{archivedItems.length ? ` +${archivedItems.length}` : ''}</span>
                                {catEdit ? (
                                  <i className={`templates-mobile-check ${isSel ? 'checked' : ''}`}>{isSel ? <Icon name="check" size={11} /> : null}</i>
                                ) : (
                                  /* Wrapped so `.templates-mobile-category-row > button`
                                     stays the one disclosure button. */
                                  <span className="templates-mobile-category-more">
                                    <button
                                      type="button"
                                      className="templates-mobile-more"
                                      title="More" aria-label="More"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setCatMenu((m) => (m && m.id === c.id ? null : { id: c.id, rect }));
                                      }}
                                    ><Icon name="more" size={14} /></button>
                                  </span>
                                )}
                              </div>
                              </SwipeToDeleteRow>
                              {open ? (
                                <div className="templates-mobile-items">
                                  {items.length === 0 ? <div className="templates-mobile-empty">No checklist items yet.</div> : null}
                                  <SortableRearrangeList ids={items.map((it) => it.id)} onReorder={(activeId, overId) => reorderItems(ci, activeId, overId)} gap={0}>
                                    {items.map((it) => (
                                      <SortableRearrangeRow key={`mobile-item-${it.id}`} id={it.id}>
                                        {({ attributes, listeners, isDragging }) => (
                                          /* Owner 2026-10-02: swipe left for a trash
                                             behind the row - the same delete as its x. */
                                          <SwipeToDeleteRow label="Delete item" onDelete={() => deleteItem(ci, it.id)}>
                                          <div data-drag-rearrange-row className="templates-mobile-item-row">
                                            <DragRearrangeHandle {...attributes} {...listeners} isDragging={isDragging} style={{ width: 20, height: 20 }} />
                                            <input
                                              className="templates-mobile-inline-input hub-rename"
                                              data-checklist-item-id={it.id}
                                              defaultValue={it.text}
                                              placeholder="Add checklist item"
                                              maxLength={CHECKLIST_ITEM_MAX_LENGTH}
                                              onBlur={(e) => commitRequiredRow(e.currentTarget, it.text, CHECKLIST_BLANK_HINT, (v) => renameItem(ci, it.id, v), () => discardFreshItem(ci, it.id))}
                                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { if (!it.text) { discardFreshItem(ci, it.id); return; } e.currentTarget.value = it.text; e.currentTarget.blur(); } else flagChecklistLimitIfFull(e); }}
                                            />
                                            <button type="button" title="Delete item" aria-label="Delete item" onClick={(e) => { e.stopPropagation(); deleteItem(ci, it.id); }}><Icon name="close" size={11} /></button>
                                          </div>
                                          </SwipeToDeleteRow>
                                        )}
                                      </SortableRearrangeRow>
                                    ))}
                                  </SortableRearrangeList>
                                  <button type="button" className="templates-mobile-add-line" onClick={() => addItem(ci)}>+ Add checklist item</button>
                                  {archivedItems.length > 0 ? (
                                    <div className="templates-mobile-archived" data-testid={`mobile-archived-items-${c.id}`}>
                                      <div>Archived ({archivedItems.length})</div>
                                      {archivedItems.map((it) => (
                                        <div key={`mobile-archived-${it.id}`} data-archived-item-id={it.id}>
                                          <span>{archivedItemLabel(it)}</span>
                                          <button
                                            type="button"
                                            title="Permanently delete" aria-label="Permanently delete"
                                            onClick={(e) => { e.stopPropagation(); hardDeleteItem(ci, it.id); }}
                                          ><Icon name="close" size={11} /></button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </SortableRearrangeRow>
                      );
                    })}
                  </SortableRearrangeList>
                )}
              </section>
              </div>

              {mobileEntitiesOpen ? (
                <div
                  className="templates-mobile-modal-scrim"
                  onClick={closeMobileEntities}
                >
                  <div
                    ref={mobileEntitiesModalRef}
                    className="templates-mobile-entity-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Entities"
                    tabIndex={-1}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="templates-mobile-entity-modal-head">
                      {/* UX 2026-09-23 (owner: "slim this down, and change the
                          close button to an exit button"): one line — the
                          title, the count beside it in grey, and the app's
                          standard X, the same one every hub modal uses. */}
                      <div>
                        <strong>Entities</strong>
                        <span>{tpl.roster.length} in {tpl.name}</span>
                      </div>
                      <button
                        ref={mobileEntitiesCloseRef}
                        type="button"
                        onClick={closeMobileEntities}
                        className="hub-icon-btn"
                        title="Close"
                        aria-label="Close"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                    <section className="templates-mobile-section templates-mobile-entity-panel">
                {/* UX 2026-09-23 (owner: the "Entities / New entity" row and the
                    Select row "need to be one header that is way slimmer"). The
                    sheet's own title already says Entities, so the label goes;
                    Select sits left and New entity right on one row. */}
                <div className="templates-mobile-select-inline templates-mobile-entity-toolbar">
                  {entityEdit && (() => {
                    const visibleSelectedIds = new Set(mobileVisibleEntities.filter((entity) => selEntities.has(entity.id)).map((entity) => entity.id));
                    const c = visibleSelectedIds.size;
                    const allSel = c === mobileVisibleEntities.length && mobileVisibleEntities.length > 0;
                    return (
                      <span className="templates-mobile-select-actions">
                        <SelectModeButtons
                          phone
                          count={c}
                          allSelected={allSel}
                          onToggleAll={() => setSelEntities((prev) => {
                            const next = new Set(prev);
                            mobileVisibleEntities.forEach((entity) => {
                              if (allSel) next.delete(entity.id);
                              else next.add(entity.id);
                            });
                            return next;
                          })}
                          onDuplicate={() => duplicateEntities(visibleSelectedIds)}
                          onMove={() => setMoveModal({ count: c, kind: 'entity', mode: 'move' })}
                          onCopy={() => setMoveModal({ count: c, kind: 'entity', mode: 'copy' })}
                          onShare={() => { if (tpl) onShare && onShare(tpl); }}
                          onDelete={() => deleteEntities(visibleSelectedIds)}
                        />
                      </span>
                    );
                  })()}
                  <SectionIconActions phone>
                    <SectionIconButton
                      phone
                      action="select"
                      label={entityEdit ? 'Done' : 'Select'}
                      active={entityEdit}
                      onClick={() => { const next = !entityEdit; setEntityEdit(next); if (!next) setSelEntities(new Set()); }}
                    />
                    {!entityEdit && (
                      <SectionIconButton phone action="add" label="Add entity" className="templates-mobile-new-entity" onClick={addEntity} />
                    )}
                  </SectionIconActions>
                </div>
                {mobileVisibleEntities.length === 0 ? (
                  <div className="templates-mobile-empty">No entities match this view.</div>
                ) : (
                  <SortableRearrangeList ids={mobileVisibleEntities.map((r) => r.id)} onReorder={reorderEntities} gap={7}>
                    {mobileVisibleEntities.map((r) => {
                      const c = roleColors[r.id]?.color || r.color || '#8c8c8a';
                      const op = roleColors[r.id]?.opacity ?? 0.35;
                      const rowBorderColor = !!matchFill[r.id] ? c : ((borderColors[r.id] || {}).color || c);
                      const isOpen = openColor === r.id;
                      const showPanel = isOpen || foldingColor === r.id;
                      const isSel = selEntities.has(r.id);
                      return (
                        <SortableRearrangeRow key={`mobile-entity-${r.id}`} id={r.id}>
                          {({ attributes, listeners, isDragging }) => (
                            <>
                              {/* Same rules as a category row (owner 2026-10-01):
                                  a tap on the row opens / closes its colour
                                  panel; the name renames only while the panel
                                  is open; Select mode ticks the row. */}
                              <div
                                data-drag-rearrange-row
                                data-entity-row
                                className={`templates-mobile-entity-row${isOpen ? ' is-open' : ''}${entityEdit ? ' is-selecting' : ''}${entityEdit && isSel ? ' is-selected' : ''}`}
                                aria-expanded={entityEdit ? undefined : isOpen}
                                onClick={(e) => { if (entityEdit) toggleEntitySel(r.id); else foldColor(isOpen ? null : r.id, e.currentTarget); }}
                              >
                                <DragRearrangeHandle {...attributes} {...listeners} isDragging={isDragging} style={{ width: 24, height: 24 }} collapseOpen={isOpen && foldingColor !== r.id} onCollapse={() => foldColor(null)} />
                                <button
                                  type="button"
                                  title="Edit color" aria-label="Edit color"
                                  onClick={(e) => { if (entityEdit) return; e.stopPropagation(); foldColor(isOpen ? null : r.id, e.currentTarget); }}
                                  style={{ '--entity-color': c, '--entity-border-color': rowBorderColor }}
                                ><span aria-hidden="true" /></button>
                                <span className="hub-autowidth templates-mobile-entity-name" data-value={r.role || 'Entity name'}>
                                  <input
                                    size={1}
                                    className="templates-mobile-inline-input hub-rename"
                                    data-entity-name-id={r.id}
                                    defaultValue={r.role}
                                    key={`mobile-entity-${r.id}:${r.role}`}
                                    placeholder="Entity name"
                                    onClick={(e) => e.stopPropagation()}
                                    onInput={syncAutoWidth}
                                    onBlur={(e) => { commitRequiredRow(e.currentTarget, r.role, ENTITY_BLANK_HINT, (v) => renameEntity(r.id, v)); syncAutoWidth(e); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = r.role; e.currentTarget.blur(); } }}
                                  />
                                </span>
                                {entityEdit ? (
                                  <i className={`templates-mobile-check ${isSel ? 'checked' : ''}`}>{isSel ? <Icon name="check" size={11} /> : null}</i>
                                ) : (
                                  /* Named "More" like every other row menu: it
                                     reads out loud now, and the app-wide rule
                                     for a More button paints it 36px with a
                                     44px pad, which is what holds the entity
                                     row to the 36px the owner asked for. */
                                  <button
                                    type="button"
                                    className="templates-mobile-more"
                                    title="More" aria-label="More"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setEntityMenu((m) => (m && m.id === r.id ? null : { id: r.id, rect }));
                                    }}
                                  ><Icon name="more" size={14} /></button>
                                )}
                              </div>
                              {showPanel ? (() => {
                                const layer = layerTab[r.id] || 'fill';
                                const match = !!matchFill[r.id];
                                const fillData = { color: c, opacity: op };
                                const borderData = borderColors[r.id] || { color: c, opacity: op };
                                const isBorderMatched = layer === 'border' && match;
                                const activeData = isBorderMatched ? fillData : (layer === 'border' ? borderData : fillData);
                                const applyColor = (color, opacity) => {
                                  if (isBorderMatched) return;
                                  if (sameEntityColour(activeData, color, opacity)) return;
                                  if (layer === 'border') setBorderColors({ ...borderColors, [r.id]: { color, opacity } });
                                  else {
                                    setRoleColors({ ...roleColors, [r.id]: { color, opacity } });
                                    setEntityColor(r.id, color);
                                  }
                                  markEdited();
                                };
                                return (
                                  /* UX 2026-09-23 (owner: the phone picker
                                     and its tabs must "match desktop, where
                                     it's not a box within a box"). The same
                                     picker as the desktop panel: the row's
                                     panel paints the surface (chrome off), the
                                     picker draws its own Fill / Border tabs,
                                     and Match fill is the Border tab's first
                                     grid cell, so nothing moves between tabs. */
                                  <div className="templates-mobile-color-panel" data-entity-color-panel data-folding={foldingColor === r.id ? (foldIsSwitch ? 'switch' : 'true') : undefined}>
                                    <CompactColorPicker
                                      color={activeData.color}
                                      opacity={activeData.opacity}
                                      onChange={applyColor}
                                      onClose={(event) => {
                                    // A press on ANOTHER entity's colour dot is a switch, not a
                                    // close: its click follows ~100ms later and runs the switch.
                                    // Folding here first made the click restart the fold (a jump).
                                    if (isEntitySwitchPress(event)) return;
                                    foldColor(null);
                                  }}
                                      dismissInsideSelector="[data-entity-color-panel], [data-sortable-rearrange-item]:has([data-entity-color-panel])"
                                      platform="phone"
                                      denseLayout
                                      chrome={false}
                                      tabs={{
                                        items: [{ id: 'fill', label: 'Fill' }, { id: 'border', label: 'Border' }],
                                        active: layer,
                                        onSelect: (k) => setLayerTab({ ...layerTab, [r.id]: k }),
                                      }}
                                      firstPreset={layer === 'border' ? {
                                        kind: 'match', color: c, opacity: op, linked: match,
                                        onToggle: () => { setMatchFill({ ...matchFill, [r.id]: !match }); markEdited(); },
                                      } : 'transparent'}
                                      locked={isBorderMatched}
                                    />
                                  </div>
                                );
                              })() : null}
                            </>
                          )}
                        </SortableRearrangeRow>
                      );
                    })}
                  </SortableRearrangeList>
                )}
                    </section>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              icon="template"
              line="No templates yet"
              description="Create a template to define your survey structure."
              actionLabel="New template"
              onAction={createTemplate}
            />
          )}
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
            { label: 'Rename', onClick: () => {
              setTplEdit(false);
              if (t.id === tpl?.id && (!mobileLayoutActive() || mobileTemplateOpen)) { focusVisibleField('input[data-template-title]'); return; }
              flushSync(() => {
                setSelected(t.id);
                setOpenCat(-1);
                setOpenMod(0);
                if (mobileLayoutActive()) { captureMobileTemplateList(); setTemplateContentSearch(''); setMobileTemplateOpen(true); }
              });
              focusVisibleField('input[data-template-title]');
            } },
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
            { label: 'Move', onClick: () => setMoveModal({ count: 1, kind: 'entity', mode: 'move' }) },
            { label: 'Copy', onClick: () => setMoveModal({ count: 1, kind: 'entity', mode: 'copy' }) },
            { label: 'Share', onClick: () => { if (tpl) onShare && onShare(tpl); } },
            { label: 'Rename', onClick: () => { focusVisibleField(`input[data-entity-name-id="${ent.id}"]`); } },
            { label: 'Delete', danger: true, onClick: () => deleteEntities(new Set([ent.id])) },
          ]}
        />
      );
    })()}

    {catMenu && tpl && (() => {
      const ci = visibleCats.findIndex((x) => x.id === catMenu.id);
      if (ci < 0) return null;
      const cat = visibleCats[ci];
      return (
        <MoreMenu
          anchorRect={catMenu.rect}
          onClose={() => setCatMenu(null)}
          items={[
            { label: 'Rename', onClick: () => {
              // A closed phone row ignores taps on its name; opening it first
              // makes the field live for the next tap too.
              if (openCat !== ci && mobileLayoutActive()) flushSync(() => setOpenCat(ci));
              focusVisibleField(`input[data-category-name-id="${cat.id}"]`);
            } },
            { label: 'Duplicate', onClick: () => duplicateCategories(new Set([cat.id])) },
            { label: 'Move', onClick: () => setMoveModal({ count: 1, kind: 'category', mode: 'move' }) },
            { label: 'Copy', onClick: () => setMoveModal({ count: 1, kind: 'category', mode: 'copy' }) },
            { label: 'Delete', danger: true, onClick: () => deleteCategories(new Set([cat.id])) },
          ]}
        />
      );
    })()}
    {modMenu && tpl && (() => {
      const mod = orderedMods.find((x) => x.id === modMenu.id);
      if (!mod) return null;
      return (
        <MoreMenu
          anchorRect={modMenu.rect}
          onClose={() => setModMenu(null)}
          items={[
            // flushSync: the rename field mounts and takes focus inside this
            // tap, so a phone raises its keyboard.
            { label: 'Rename', onClick: () => flushSync(() => setModRename(mod.id)) },
            { label: 'Delete', danger: true, onClick: () => deleteModules(new Set([mod.id])) },
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
        style={{ position: 'fixed', inset: 0, background: 'var(--overlay-scrim)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5100 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 440, maxWidth: 'calc(100vw - 32px)',
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-dialog)',
            padding: '18px 20px 14px', boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
            fontFamily: 'var(--font-ui)', color: 'var(--text-1)',
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-1)' }}>
            Archive checklist item?
          </h3>
          <p style={{ margin: '0 0 6px', fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text-1)' }}>{archiveConfirm.usage}</strong>
            {' '}
            {archiveConfirm.usage === 1 ? 'survey marker has' : 'survey markers have'}
            {' '}responses for <em style={{ color: 'var(--text-1)' }}>{archiveConfirm.label || 'this item'}</em>.
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.55, color: 'var(--text-3)' }}>
            Archiving keeps those responses as historical data, but the item won't appear for new markers. You can permanently delete the archived item later from the Archived section.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              data-testid="archive-confirm-cancel"
              onClick={() => setArchiveConfirm(null)}
              className="hub-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="archive-confirm-archive"
              onClick={() => {
                const { moduleIndex = openMod, categoryIndex, itemId } = archiveConfirm;
                archiveItemInModule(moduleIndex, categoryIndex, itemId);
                setArchiveConfirm(null);
              }}
              className="hub-btn hub-btn--primary"
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
          style={{ position: 'fixed', inset: 0, background: 'var(--overlay-scrim)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div
            className="templates-module-edit-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 400, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 32px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-dialog)' }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '-0.025em', flex: 'none', color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>Edit modules</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-0)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '4px 8px', height: 26, boxSizing: 'border-box', flex: 1, maxWidth: 220 }}>
                <Icon name="search" size={12} color="var(--text-3)" />
                <input
                  value={modSearch}
                  onChange={(e) => setModSearch(e.currentTarget.value)}
                  placeholder="Search modules..."
                  style={{ background: 'transparent', border: 0, outline: 'none', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12, flex: 1, width: '100%', padding: 0 }}
                />
              </div>
            </div>
            <div className="slim-scroll" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto', flex: '0 1 auto', minHeight: 0 }}>
              {visibleMods.length === 0 && (
                <div className="meta" style={{ padding: '14px 4px', fontSize: 12, color: 'var(--text-3)' }}>
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
                          background: isSel ? 'var(--surface-2)' : 'var(--surface-1)',
                          border: '1px solid var(--border)',
                          transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease',
                        }}
                      >
                        <DragRearrangeHandle
                          {...attributes}
                          {...listeners}
                          isDragging={isDragging}
                        />
                        <span onClick={() => toggleModSel(mod.id)} data-drag-keep-fill style={{ width: 14, height: 14, border: `1.4px solid ${isSel ? 'var(--accent)' : 'var(--border-strong)'}`, background: isSel ? 'var(--accent)' : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {isSel && <Icon name="check" size={10} color="var(--accent-text)" />}
                        </span>
                        <input
                          defaultValue={mod.name}
                          key={mod.id + ':' + mod.name}
                          onBlur={(e) => renameModule(mod.id, e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = mod.name; e.currentTarget.blur(); } }}
                          style={{ background: 'transparent', border: 0, borderBottom: '1px solid transparent', borderTop: '1px solid transparent' /* matches the underline so the name sits on the row's centre line, 2026-09-23 */, color: 'var(--text-1)', font: 'inherit', fontSize: 13, fontWeight: 500, padding: '4px 0', width: '100%', outline: 'none' }}
                        />
                        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{(mod.categories || []).length}</span>
                      </div>
                    )}
                  </SortableRearrangeRow>
                );
              })}
              </SortableRearrangeList>
            </div>
            <div style={{ padding: '0 10px 8px', flex: 'none' }}>
              <button onClick={addModule} style={{ width: '100%', padding: '6px 10px', border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--text-3)', borderRadius: 2, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="plus" size={13} /> New module
              </button>
            </div>
            <div className="templates-module-edit-actions" style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-1)', display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
              <SelectModeButtons
                phone={mobileLayoutActive()}
                tooltipPlacement="above"
                count={selCount}
                allSelected={selectedMods.length === mods.length && mods.length > 0}
                onToggleAll={() => { const allSel = selectedMods.length === mods.length; setSelMods(allSel ? new Set() : new Set(mods.map((m) => m.id))); }}
                onDuplicate={() => duplicateModules(selMods)}
                onMove={() => setMoveModal({ count: selCount, kind: 'module', mode: 'move' })}
                onCopy={() => setMoveModal({ count: selCount, kind: 'module', mode: 'copy' })}
                onShare={() => { if (tpl) onShare && onShare(tpl); }}
                onDelete={() => deleteModules(selMods)}
              />
              <span style={{ flex: 1 }} />
              <button onClick={() => setModEdit(false)} className="hub-btn hub-btn--primary">Done</button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* Move or Copy modal - opened already set to the button that opened it
        (owner 2026-10-02 split the one Move/Copy action into Move and Copy). */}
    {moveModal && tpl && (
      <div
        onClick={closeMoveModal}
        style={{ position: 'fixed', inset: 0, background: 'var(--overlay-scrim)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5400 }}
      >
        <div
          ref={moveModalRef}
          role="dialog"
          aria-modal="true"
          aria-label={moveModal.mode === 'copy' ? 'Copy items' : 'Move items'}
          data-modal-focus-layer="true"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 420, overflow: 'hidden', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-dialog)' }}
        >
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, letterSpacing: 0, color: 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-ui)' }}>{moveModal.mode === 'copy' ? 'Copy' : 'Move'}</p>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '2px 0 0', color: 'var(--text-1)', letterSpacing: '-0.025em', fontFamily: 'var(--font-ui)' }}>{moveModal.count} item{moveModal.count === 1 ? '' : 's'}</h3>
            </div>
            <button ref={moveModalCloseRef} onClick={closeMoveModal} title="Close" aria-label="Close" className="hub-icon-btn"><Icon name="close" size={13} /></button>
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
            <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Destination template</label>
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
                  <label style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>Destination module</label>
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
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-1)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={closeMoveModal} className="hub-btn">Cancel</button>
            <button onClick={closeMoveModal} className="hub-btn hub-btn--primary">{moveModal.mode === 'copy' ? 'Copy' : 'Move'}</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
