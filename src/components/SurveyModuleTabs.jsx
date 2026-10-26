// The Survey panel's module tabs on desktop (owner 2026-10-26):
//  - as many tabs as fit, then a "+N" menu with the rest (no sideways scroll
//    hiding modules past the panel's edge); the open module is always shown;
//  - drag a tab to reorder the modules, the same as the module tabs on the
//    home Templates page; the order is the template's, so both places match.
import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DndContext, KeyboardSensor, MouseSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CALM_STRIP_AUTO_SCROLL } from '../reorder/dragAutoScroll.js';
import { restrictToHorizontalAxis } from '../reorder/axisLock.js';
import useTabOverflow from '../reorder/useTabOverflow.js';
import ListItemContextMenu from './ListItemContextMenu';
import Icon from '../Icons';

const nameOf = (module) => module?.name || 'Untitled module';

// A held tab stays inside the tab row (the row clips what passes its edge).
const keepInRow = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return transform;
  const minX = containerNodeRect.left - draggingNodeRect.left;
  const maxX = containerNodeRect.right - draggingNodeRect.right;
  return { ...transform, x: Math.min(Math.max(transform.x, minX), maxX) };
};
const MODIFIERS = [restrictToHorizontalAxis, keepInRow];

function ModuleTab({ module, isActive, canDrag, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: module.id, disabled: !canDrag });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      // dnd-kit's attributes call every sortable a button; these are tabs.
      role="tab"
      aria-selected={isActive}
      aria-roledescription={canDrag ? 'draggable tab' : undefined}
      data-survey-module-tab={module.id}
      data-drag-lifted={isDragging ? '' : undefined}
      className={isActive ? 'is-active' : undefined}
      onClick={() => onSelect(module.id)}
      style={{
        // Translate only: a scale would stretch the label of a wider or
        // narrower neighbour's slot (the owner's "stretched and compacted").
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? undefined : transition,
        position: 'relative',
        zIndex: isDragging ? 2 : undefined,
        touchAction: canDrag ? 'none' : undefined,
      }}
    >
      <span>{nameOf(module)}</span>
    </button>
  );
}

export default function SurveyModuleTabs({ modules, activeId, onSelect, onReorder }) {
  const rowRef = useRef(null);
  const measureRef = useRef(null);
  const moreRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const ids = useMemo(() => modules.map((module) => module.id), [modules]);
  const byId = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules]);
  const contentKey = modules.map(nameOf).join('\u0000');
  const { visible, hidden } = useTabOverflow({ ids, activeId, rowRef, measureRef, contentKey });
  const canDrag = typeof onReorder === 'function' && modules.length > 1;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) return;
    flushSync(() => onReorder?.(active.id, over.id));
  }, [onReorder]);

  return (
    <div ref={rowRef} className="survey-rail__tabs survey-rail__tabs--fit" role="tablist" aria-label="Modules">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={MODIFIERS}
        autoScroll={CALM_STRIP_AUTO_SCROLL}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visible} strategy={horizontalListSortingStrategy}>
          {visible.map((id) => (
            <ModuleTab key={id} module={byId.get(id)} isActive={id === activeId} canDrag={canDrag} onSelect={onSelect} />
          ))}
        </SortableContext>
      </DndContext>
      {hidden.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          className="survey-rail__tabs-more"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          aria-label={`${hidden.length} more module${hidden.length === 1 ? '' : 's'}`}
          onClick={() => {
            const box = moreRef.current?.getBoundingClientRect();
            setMenu(menu ? null : { x: box ? box.right - 180 : 0, y: box ? box.bottom + 4 : 0 });
          }}
        >
          <span>+{hidden.length}</span>
          <Icon name="chevronDown" size={12} color="currentColor" />
        </button>
      )}
      {/* The hidden copy the row is measured from (same classes as above). */}
      <div ref={measureRef} className="survey-rail__tabs survey-rail__tabs-measure" aria-hidden="true">
        {modules.map((module) => (
          <button key={module.id} type="button" tabIndex={-1} data-measure-tab={module.id} className={module.id === activeId ? 'is-active' : undefined}>
            <span>{nameOf(module)}</span>
          </button>
        ))}
        <button type="button" tabIndex={-1} data-measure-more="" className="survey-rail__tabs-more">
          <span>+{Math.max(hidden.length, 9)}</span>
          <Icon name="chevronDown" size={12} color="currentColor" />
        </button>
      </div>
      {menu && (
        <ListItemContextMenu
          point={menu}
          onClose={() => setMenu(null)}
          items={hidden.map((id) => ({ label: nameOf(byId.get(id)), onClick: () => onSelect(id) }))}
        />
      )}
    </div>
  );
}
