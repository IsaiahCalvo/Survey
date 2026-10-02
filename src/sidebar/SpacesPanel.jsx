/**
 * SpacesPanel.jsx — sidebar panel for managing "Spaces" (named page groups with
 * regions and per-page annotation visibility).
 *
 * Default-exports the SpacesPanel component; internal SpaceSortableCard renders
 * each space as one divided list row (2026-09-23: no cards, desktop and phone)
 * with expand, toggle, page-range add (parsePageRangeInput) and a `⋯` menu
 * (SpacesRowMenu: rename, export, delete; on page rows rename, edit areas,
 * canvas/survey annotation visibility, region outline, remove - Spaces chunk
 * B, 2026-10-01). SpacesExportPanel is the "Export <space>" menu (desktop) /
 * sheet (phone). Cards reorder via dnd-kit
 * SortableRearrangeList with optimistic ordering and frame-capture debug hooks.
 */
import React, { useState, useCallback, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Icon from '../Icons';
import { parsePageRangeInput, sanitizePageRangeInput } from '../utils/pageRangeParser';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from '../reorder/SortableRearrangeList';
import { moveItem } from '../reorder/flatReorderUtils.js';
import {
  getPageVisibilityControlMode,
  PAGE_VISIBILITY_CONTROL_MODE
} from '../utils/annotationVisibilityRules';
import { showToast } from '../utils/toast';
import { useTooltip } from '../components/Tooltip';
import { watchLightPopover } from '../components/dismissRules.js';
import AnchoredPopover from '../components/AnchoredPopover';
import { useConfirmDialog } from '../components/dialogPrompts';
import {
  buildDeleteSpaceConfirm,
  buildRemovePageConfirm,
  formatSpaceCountLabel,
} from '../utils/spaceCascadeImpact.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const animateSpaceLayoutChanges = () => false;

// Spaces chunk B: a stored page label still at its old default ("Region 3")
// reads as "Page 3" - the row already says it is a page in a space. Nothing is
// rewritten in the data; a rename stores whatever the user types.
const pageRowLabel = (page) => {
  const stored = typeof page?.label === 'string' ? page.label.trim() : '';
  if (!stored || stored === `Region ${page?.pageId}`) return `Page ${page?.pageId}`;
  return stored;
};

/*
 * Spaces chunk B: the `⋯` menu every space and page row ends in. The trigger is
 * a glyph in the row's last column (invisible pad, no plate); the menu is a
 * light popover (dismissRules R1/R5) portalled above the phone sheet, so the
 * list's scroller and the sheet's transform never clip it. Disabled entries
 * say why underneath instead of vanishing.
 */
function SpacesRowMenu({ label, items, mobileMode = false }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    return watchLightPopover({
      contains: (target) => Boolean(buttonRef.current?.contains(target) || menuRef.current?.contains(target)),
      close: () => setOpen(false),
    });
  }, [open]);
  const getAnchor = useCallback(() => buttonRef.current, []);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`spaces-item__icon spaces-item__more${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <Icon name="moreHorizontal" size={16} color="currentColor" />
      </button>
      {open && (
        <AnchoredPopover getAnchor={getAnchor} gap={2} zIndex={7000}>
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className={`spaces-menu${mobileMode ? ' spaces-menu--phone' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {items.filter(Boolean).map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-spaces-menu-item={item.id}
                className={`spaces-menu__item${item.danger ? ' is-danger' : ''}`}
                aria-disabled={item.disabled || undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.(e);
                }}
              >
                <span>{item.label}</span>
                {item.hint ? <small>{item.hint}</small> : null}
              </button>
            ))}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

const SpaceSortableCard = React.memo(function SpaceSortableCard({
  space,
  dragHandleProps,
  isDragging = false,
  isRearranging = false,
  isActive,
  isSelected,
  isExpanded,
  pageCount,
  regionCount,
  pageInputValue,
  pageError,
  onToggleExpand,
  onRenameSpace,
  onDelete,
  onExport = null,
  onPageInputChange,
  onAssignPages,
  onRenameRegion,
  onRemovePage,
  onNavigateToPage,
  onExitSpace,
  onToggleSpace,
  onRequestRegionEdit = null,
  onCancelRegionEdit = null,
  isRegionSelectionActive = false,
  regionSelectionPage = null,
  getCanvasAnnotationVisibilityState = null,
  onToggleCanvasAnnotations = null,
  getSurveyAnnotationVisibilityState = null,
  onToggleSurveyAnnotations = null,
  activeSpaceId = null,
  onToggleRegionOverlay = null,
  getRegionOverlayEnabled = null,
  isRegionOverlayToggleEnabled = null,
  showSurveyPanel = false,
  selectedModuleId = null,
  mobileMode = false,
}) {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [editingRegionValue, setEditingRegionValue] = useState('');
  // The name the field opened with: committing it unchanged is not a rename
  // (owner 2026-10-02: only a real change is saved).
  const editingRegionStartRef = useRef('');
  const editingRegionInputRef = useRef(null);
  // Spaces chunk B: the name is plain text at rest (a tap on it opens the
  // space, like the rest of the row); Rename in `⋯` (or a double-click on the
  // desktop) swaps in the field.
  const [isRenamingSpace, setIsRenamingSpace] = useState(false);
  const spaceNameInputRef = useRef(null);
  React.useEffect(() => {
    if (!isExpanded) {
      setEditingRegionId(null);
      setEditingRegionValue('');
    }
  }, [isExpanded]);
  React.useEffect(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
    setIsRenamingSpace(false);
  }, [space.id]);

  const commitRegionRename = useCallback((pageId) => {

    if (editingRegionId !== pageId) {

      return;
    }
    const labelToSave = editingRegionValue.trim();

    if (labelToSave !== editingRegionStartRef.current.trim()) {
      onRenameRegion?.(space.id, pageId, labelToSave);
    }
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, [editingRegionId, editingRegionValue, onRenameRegion, space.id]);


  const cancelRegionRename = useCallback(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, []);

  React.useEffect(() => {
    if (editingRegionId === null) return;
    requestAnimationFrame(() => {
      editingRegionInputRef.current?.focus();
      editingRegionInputRef.current?.select();
    });
  }, [editingRegionId]);

  const handleRegionEditClick = useCallback((pageId, currentLabel) => {
    // Spaces chunk A: render the field and focus it inside the tap itself -
    // iOS only raises the keyboard for a focus() made in the user's gesture,
    // and the rAF focus below came a frame too late for that.
    editingRegionStartRef.current = currentLabel || '';
    flushSync(() => {
      setEditingRegionId(pageId);
      setEditingRegionValue(currentLabel);
    });
    editingRegionInputRef.current?.focus();
    editingRegionInputRef.current?.select();
  }, []);

  const commitSpaceName = useCallback((input) => {
    if (!input) return;
    const fallbackName = space.name?.trim() || 'Space';
    const nextName = (input.value || '').trim() || fallbackName;
    // A refused rename (duplicate name, no permission) simply keeps the old
    // name: the field closes and the row shows space.name again.
    if (nextName !== space.name) onRenameSpace?.(space.id, nextName);
    setIsRenamingSpace(false);
  }, [onRenameSpace, space.id, space.name]);

  const startSpaceRename = useCallback(() => {
    // Same rule as the region rename: the field exists and takes focus inside
    // the tap, so iOS raises the keyboard.
    flushSync(() => setIsRenamingSpace(true));
    spaceNameInputRef.current?.focus();
    spaceNameInputRef.current?.select();
  }, []);


  /*
   * UX 2026-09-23 (owner: "everything is so bulky ... the hitbox should be
   * invisible"; "not individual cards ... dividers but integrated within the
   * panel", desktop AND phone), revised by Spaces chunk B (2026-10-01 audit):
   *   - a space is a ROW: grip · fold arrow · name · "3 pages · 2 areas" ·
   *     switch · `⋯` (Rename, Export, Delete). No standing red trash can;
   *   - its pages are indented LINES: "p.3" · name ("Page 3") · "Draw area" or
   *     "2 areas" · `⋯` (Rename, Edit areas, Show marks, Show outline,
   *     Remove). The lightbulb, the overlay switch, the pencil and the trash
   *     can moved into that menu; every capability is still one tap away;
   *   - "+ Add pages" is the last line of an open space;
   *   - every control is a glyph or a word with an invisible pad (44px on the
   *     phone, 28px on the desktop). Nothing paints a plate on hover or press.
   * Sizes: the .spaces-list block in styles.css (desktop) and
   * mobilePdfViewer.css (phone).
   */
  const visibilityControlMode = getPageVisibilityControlMode({ showSurveyPanel, selectedModuleId });
  const isSurveyVisibilityContext =
    activeSpaceId !== null && visibilityControlMode === PAGE_VISIBILITY_CONTROL_MODE.SURVEY;
  const getVisibilityState = isSurveyVisibilityContext
    ? getSurveyAnnotationVisibilityState
    : getCanvasAnnotationVisibilityState;
  const onToggleVisibility = isSurveyVisibilityContext
    ? onToggleSurveyAnnotations
    : onToggleCanvasAnnotations;
  // Spaces chunk A: the row counts PAGES (it counted drawn areas, so a space
  // listing two pages could read 0). Chunk B: the label is on the row itself.
  const regionCountLabel = formatSpaceCountLabel(pageCount, regionCount);
  // A space with no pages would hide every page: it cannot be turned on until
  // it has some (an active one can always be turned off).
  const isSwitchBlocked = !isActive && pageCount === 0;
  const spaceSwitchLabel = isActive ? 'Turn off space' : (isSwitchBlocked ? 'Add pages first' : 'Turn on space');
  const toggleThisSpace = () => {
    if (isSwitchBlocked) {
      if (!isExpanded) onToggleExpand(space.id);
      showToast(`Add pages to ${space.name || 'this space'} first.`, 'info');
      return;
    }
    onToggleSpace?.(space.id, !isActive);
  };
  const switchKeyDown = (handler) => (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }
  };
  const spaceName = space.name || 'Space';

  return (
    <div
      data-space-sortable-row-id={space.id}
      className={`spaces-item${isExpanded ? ' is-expanded' : ''}${isDragging ? ' is-dragging' : ''}${isActive ? ' is-active' : ''}`}
    >
      <div data-drag-rearrange-row className="spaces-item__block">
        <div
          className="spaces-item__row"
          aria-expanded={isExpanded}
          onClick={() => {
            if (isRenamingSpace) return;
            onToggleExpand(space.id);
          }}
        >
          <DragRearrangeHandle
            {...dragHandleProps}
            className="spaces-item__grip"
            data-space-drag-handle
            isDragging={isDragging}
            title="Drag to rearrange"
            onClick={() => onToggleExpand(space.id)}
            style={{ width: undefined, height: undefined, color: 'var(--text-3)' }}
          />

          {/* Owner 2026-09-23: the fold arrow sits between the grip and the
              name. Right when folded, down when open. */}
          <button
            type="button"
            className="spaces-item__chevron"
            aria-label={isExpanded ? `Fold ${spaceName}` : `Open ${spaceName}`}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(space.id);
            }}
          >
            <Icon name="chevronRight" size={12} color="currentColor" />
          </button>

          {isRenamingSpace ? (
            <input
              ref={spaceNameInputRef}
              type="text"
              className="spaces-item__name spaces-item__name-input"
              defaultValue={space.name}
              aria-label={`Rename ${spaceName}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitSpaceName(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.value = space.name || '';
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span
              className="spaces-item__name"
              onDoubleClick={(e) => {
                if (mobileMode) return;
                e.stopPropagation();
                startSpaceRename();
              }}
            >
              {spaceName}
            </span>
          )}

          <span className="spaces-item__fill" aria-hidden="true" />

          {!isRenamingSpace && (
            <span className="spaces-item__meta" data-space-meta>
              {regionCountLabel}
            </span>
          )}

          <div
            role="switch"
            tabIndex={0}
            aria-checked={isActive}
            aria-disabled={isSwitchBlocked || undefined}
            aria-label={spaceSwitchLabel}
            className="spaces-switch"
            {...tip(spaceSwitchLabel, 'below')}
            onClick={(e) => {
              e.stopPropagation();
              toggleThisSpace();
            }}
            onKeyDown={switchKeyDown(toggleThisSpace)}
          >
            <span className="spaces-switch__knob" />
          </div>

          <SpacesRowMenu
            label={`${spaceName} options`}
            mobileMode={mobileMode}
            items={[
              { id: 'rename', label: 'Rename', onSelect: startSpaceRename },
              onExport ? { id: 'export', label: 'Export…', onSelect: () => onExport(space.id) } : null,
              { id: 'delete', label: 'Delete space', danger: true, onSelect: () => onDelete(space.id) },
            ]}
          />
        </div>

        {isExpanded && (
          <div className="spaces-item__body">
            {pageCount > 0 && (
              <ul className="spaces-item__regions">
                {space.assignedPages
                  ?.slice()
                  .sort((a, b) => (a.pageId || 0) - (b.pageId || 0))
                  .map((page) => {
                    const regionLabel = pageRowLabel(page);
                    const isEditingRegion = editingRegionId === page.pageId;
                    const areaCount = Array.isArray(page.regions) ? page.regions.length : 0;

                    // Region outline (the hatching outside the drawn areas).
                    const hasOverlayProps = onToggleRegionOverlay && getRegionOverlayEnabled && isRegionOverlayToggleEnabled;
                    const isOverlayEnabled = hasOverlayProps ? getRegionOverlayEnabled(space.id, page.pageId, page) : false;
                    const isOverlayToggleEnabled = hasOverlayProps ? isRegionOverlayToggleEnabled(space.id, page.pageId, page) : false;
                    const overlayHint = !hasOverlayProps
                      ? 'Not available here'
                      : !isActive
                        ? 'Turn the space on first'
                        : (!isOverlayToggleEnabled ? 'Draw an area first' : null);

                    // KAL-313 / history F1 (2026-06-11): the region-edit entry
                    // point. Without it the Region Selection Tool — and the
                    // commit-time region-delete journaling — is unreachable.
                    const isActiveRegionEdit =
                      isRegionSelectionActive &&
                      regionSelectionPage === page.pageId &&
                      activeSpaceId === space.id;
                    const toggleRegionEdit = () => {
                      if (isActiveRegionEdit) {
                        onCancelRegionEdit?.(space.id, page.pageId);
                      } else {
                        onRequestRegionEdit?.(space.id, page.pageId);
                      }
                    };

                    // One menu entry, separate canvas/survey features in code.
                    const hasVisibility = Boolean(getVisibilityState && onToggleVisibility);
                    const visibilityState = hasVisibility ? getVisibilityState(space.id, page.pageId) : true;
                    const isVisibilityDisabled = !isActive || activeSpaceId === null;
                    const marksNoun = isSurveyVisibilityContext ? 'survey markers' : 'marks';
                    const visibilityLabel = `${visibilityState ? 'Hide' : 'Show'} ${marksNoun}`;

                    const areaAction = isActiveRegionEdit
                      ? 'Drawing…'
                      : (areaCount > 0 ? `${areaCount} ${areaCount === 1 ? 'area' : 'areas'}` : 'Draw area');
                    const areaActionLabel = isActiveRegionEdit
                      ? 'Stop drawing areas'
                      : (areaCount > 0 ? `Edit ${areaCount === 1 ? 'the area' : `the ${areaCount} areas`} on page ${page.pageId}` : `Draw an area on page ${page.pageId}`);

                    return (
                      <li key={page.pageId} className={`spaces-region${isActiveRegionEdit ? ' is-editing' : ''}`}>
                        <button
                          type="button"
                          className="spaces-region__page tertiary"
                          {...tip(`Go to page ${page.pageId}`, 'below')}
                          aria-label={`Go to page ${page.pageId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onNavigateToPage?.(page.pageId);
                          }}
                        >
                          <span>p.{page.pageId}</span>
                        </button>

                        <div className="spaces-region__name">
                          {isEditingRegion ? (
                            <input
                              ref={editingRegionInputRef}
                              type="text"
                              value={editingRegionValue}
                              aria-label="Region name"
                              onChange={(e) => setEditingRegionValue(e.target.value)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              // No onFocus stopPropagation: the window focusin
                              // listener in mobile/keyboardViewport.js is what
                              // lifts the field above the phone keyboard.
                              onBlur={() => {
                                if (isRegionSelectionActive) return;
                                commitRegionRename(page.pageId);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRegionRename(page.pageId);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cancelRegionRename();
                                }
                              }}
                              className="spaces-region__name-input"
                            />
                          ) : (
                            // Chunk B: the name goes to its page (Rename is in
                            // `⋯`; a double-click renames on the desktop).
                            <button
                              type="button"
                              className="spaces-region__label tertiary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onNavigateToPage?.(page.pageId);
                              }}
                              onDoubleClick={(e) => {
                                if (mobileMode) return;
                                e.preventDefault();
                                e.stopPropagation();
                                handleRegionEditClick(page.pageId, regionLabel);
                              }}
                            >
                              <span>{regionLabel}</span>
                              {hasVisibility && !visibilityState && (
                                <small className="spaces-region__hint">{marksNoun} hidden</small>
                              )}
                            </button>
                          )}
                        </div>

                        {!isEditingRegion && (
                          <button
                            type="button"
                            className={`spaces-region__areas tertiary${areaCount === 0 && !isActiveRegionEdit ? ' is-empty' : ''}${isActiveRegionEdit ? ' is-editing' : ''}`}
                            {...tip(areaActionLabel, 'below')}
                            aria-label={areaActionLabel}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleRegionEdit();
                            }}
                          >
                            {areaAction}
                          </button>
                        )}

                        <SpacesRowMenu
                          label={`${regionLabel} options`}
                          mobileMode={mobileMode}
                          items={[
                            { id: 'rename', label: 'Rename', onSelect: () => handleRegionEditClick(page.pageId, regionLabel) },
                            { id: 'edit-areas', label: isActiveRegionEdit ? 'Stop editing areas' : (areaCount > 0 ? 'Edit areas' : 'Draw area'), onSelect: toggleRegionEdit },
                            hasVisibility ? {
                              id: 'marks',
                              label: visibilityLabel,
                              disabled: isVisibilityDisabled,
                              hint: isVisibilityDisabled ? 'Turn the space on first' : null,
                              onSelect: () => onToggleVisibility(space.id, page.pageId, !visibilityState),
                            } : null,
                            {
                              id: 'outline',
                              label: isOverlayEnabled ? 'Hide outline' : 'Show outline',
                              disabled: !isOverlayToggleEnabled,
                              hint: overlayHint,
                              onSelect: () => onToggleRegionOverlay?.(space.id, page.pageId),
                            },
                            { id: 'remove', label: 'Remove from space', danger: true, onSelect: () => onRemovePage(space.id, page.pageId) },
                          ]}
                        />
                      </li>
                    );
                  })}
              </ul>
            )}

            {/* Chunk B: "+ Add pages" is the last line of an open space. */}
            <div className="spaces-item__add">
              <span className="spaces-item__add-glyph" aria-hidden="true">
                <Icon name="plus" size={14} color="currentColor" />
              </span>
              <input
                type="text"
                className="spaces-item__add-input"
                value={pageInputValue}
                placeholder={pageCount === 0 ? 'Add pages, e.g. 3, 6-9' : 'Add pages'}
                aria-label="Add pages (e.g. 3, 6-9, 12)"
                onChange={(e) => onPageInputChange(space.id, sanitizePageRangeInput(e.target.value))}
                inputMode="numeric"
                pattern="[0-9,-]*"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAssignPages(space.id);
                  }
                }}
              />
              {/* A word, not a gold square. It turns gold only once there is
                  something to add; empty, it rests in quiet ink. */}
              <button
                type="button"
                className={`spaces-item__add-go tertiary${pageInputValue ? ' has-value' : ''}`}
                aria-label="Add pages"
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignPages(space.id);
                }}
              >
                Add
              </button>
            </div>
            {pageError && (
              <div className="spaces-item__error" role="alert">
                {pageError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/*
 * Spaces chunk B: "Export <space>" - which space, then CSV or PDF pages. The
 * desktop shows it as a menu under Export; the phone as its own small sheet
 * (portalled above the Spaces sheet), never the desktop popover.
 */
function SpacesExportPanel({ spaces, spaceId, onSpaceChange, onExportCSV, onExportPDF, onClose }) {
  const target = spaces.find((space) => space.id === spaceId) || null;
  const title = `Export ${target?.name || 'space'}`;
  return (
    <>
      <div className="spaces-export__head">
        <strong>{title}</strong>
        {onClose ? (
          <button type="button" className="spaces-export__close tertiary" onClick={onClose}>Cancel</button>
        ) : null}
      </div>
      <div className="spaces-export__label">Space</div>
      <div className="spaces-export__spaces" role="radiogroup" aria-label="Space to export">
        {spaces.map((space) => {
          const chosen = space.id === spaceId;
          const pages = space.assignedPages?.length || 0;
          return (
            <button
              key={space.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              className={`spaces-export__space${chosen ? ' is-chosen' : ''}`}
              onClick={() => onSpaceChange(space.id)}
            >
              <span>{space.name || 'Space'}</span>
              <small>{pages} {pages === 1 ? 'page' : 'pages'}</small>
              {chosen ? <Icon name="check" size={14} color="currentColor" /> : <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="spaces-export__actions">
        <button
          type="button"
          className="spaces-export__action"
          disabled={!target}
          onClick={() => onExportCSV(target.id)}
        >
          <span>CSV</span>
          <small>One row per mark in this space</small>
        </button>
        <button
          type="button"
          className="spaces-export__action"
          disabled={!target}
          onClick={() => onExportPDF(target.id)}
        >
          <span>PDF Pages</span>
          <small>Exports base PDF pages only; app annotations are not embedded.</small>
        </button>
      </div>
    </>
  );
}

const SpacesPanel = ({
  spaces,
  activeSpaceId,
  onSpaceCreate,
  onSpaceUpdate,
  onSpaceDelete,
  onSetActiveSpace,
  onExitSpaceMode,
  onRequestRegionEdit,
  onCancelRegionEdit,
  onSpaceAssignPages,
  onSpaceRenamePage,
  onSpaceRemovePage,
  onNavigateToPage = null,
  onReorderSpaces,
  onExportSpaceCSV,
  onExportSpacePDF,
  isRegionSelectionActive = false,
  regionSelectionPage = null,
  numPages,
  features,
  canManageSpaces = false,
  getCanvasAnnotationVisibilityState = null,
  onToggleCanvasAnnotations = null,
  getSurveyAnnotationVisibilityState = null,
  onToggleSurveyAnnotations = null,
  externalSelectedSpaceId = null,
  onToggleRegionOverlay = null,
  getRegionOverlayEnabled = null,
  isRegionOverlayToggleEnabled = null,
  showSurveyPanel = false,
  selectedModuleId = null,
  mobileMode = false,
  mobilePanelVisible = false,
  onMobilePanelMetricsChange = null,
  // Phone only: exits space mode and closes the sheet (PDFSidebar owns both).
  onExitSpacesAction = null,
  // Spaces chunk A: counts what a page removal / space delete would delete
  // (PDFViewer.getSpaceRemovalImpact), for the confirm.
  getSpaceRemovalImpact = null,
  // Phone: the space whose areas were just edited opens again with the sheet.
  initiallyExpandedSpaceId = null,
  // Spaces chunk B: a ref owned by PDFSidebar (which outlives this panel) that
  // remembers which spaces are open, so closing and reopening the phone sheet
  // (or the desktop panel) brings them back as they were.
  expandedSpacesStoreRef = null,
}) => {
  const tip = useTooltip();
  const [askConfirm, confirmDialogElement] = useConfirmDialog();
  const [expandedSpaces, setExpandedSpaces] = useState(() => new Set([
    ...(expandedSpacesStoreRef?.current || []),
    ...(initiallyExpandedSpaceId ? [initiallyExpandedSpaceId] : []),
  ]));
  React.useEffect(() => {
    if (expandedSpacesStoreRef) expandedSpacesStoreRef.current = expandedSpaces;
  }, [expandedSpaces, expandedSpacesStoreRef]);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [isRearrangingSpaces, setIsRearrangingSpaces] = useState(false);
  const [optimisticSpaceIds, setOptimisticSpaceIds] = useState(() => spaces.map(space => space.id));
  // Spaces chunk B: the space the Export menu / sheet is open for (null =
  // closed).
  const [exportSpaceId, setExportSpaceId] = useState(null);
  const isSpacesExportMenuOpen = exportSpaceId !== null;
  const spacesExportMenuRef = useRef(null);

  // Sync external selectedSpaceId prop with internal state
  React.useEffect(() => {
    // Always sync when external changes, even if it's the same value (handles re-renders)
    if (externalSelectedSpaceId !== null) {
      if (externalSelectedSpaceId !== selectedSpaceId) {
        setSelectedSpaceId(externalSelectedSpaceId);
      }
    }
    // Don't clear internal state when external becomes null - user might have manually selected
    // This ensures the exit button stays visible during region editing even if external state is cleared
  }, [externalSelectedSpaceId]); // Only depend on externalSelectedSpaceId to avoid infinite loop

  // Additional effect to restore state if it gets cleared but external is still set
  // This handles cases where internal state is cleared by other means (e.g., space updates)
  React.useEffect(() => {
    if (externalSelectedSpaceId !== null && selectedSpaceId === null) {
      setSelectedSpaceId(externalSelectedSpaceId);
    }
  }, [selectedSpaceId, externalSelectedSpaceId]);
  const [pageInputs, setPageInputs] = useState({});
  const [pageErrors, setPageErrors] = useState({});
  const previousSpaceIdsRef = useRef(new Set(spaces.map(space => space.id)));
  const spacesReorderDebugSessionRef = useRef(null);
  const spacesReorderMoveCountRef = useRef(0);

  // 2026-07-12 (demo parity defect #4): report the panel's MEASURED natural
  // height so the mobile spaces sheet hugs its real content, instead of the
  // sheet predicting row heights that drifted from these restyled desktop
  // rows. expandedPageRows is kept as the pre-measurement fallback signal.
  const mobilePanelRootRef = useRef(null);
  const mobileSpacesListRef = useRef(null);
  React.useEffect(() => {
    if (!mobileMode || typeof onMobilePanelMetricsChange !== 'function') return;
    // Skip while hidden (display:none tab) — rects read 0 there; the effect
    // re-runs when mobilePanelVisible flips true and measures real layout.
    if (!mobilePanelVisible) return;
    const expandedPageRows = spaces.reduce((sum, space) => {
      const pageCount = Array.isArray(space.assignedPages)
        ? space.assignedPages.length
        : (Array.isArray(space.pages) ? space.pages.length : 0);
      return sum + (expandedSpaces.has(space.id) ? Math.max(1, pageCount) : 0);
    }, 0);
    // Measure synchronously — the DOM is committed by the time effects run,
    // and requestAnimationFrame stalls entirely in backgrounded/paused
    // WebViews, which would leave the sheet stuck on the fallback height.
    const rootEl = mobilePanelRootRef.current;
    const listEl = mobileSpacesListRef.current;
    let contentHeight = null;
    if (rootEl && listEl) {
      const rootH = rootEl.getBoundingClientRect().height;
      const listH = listEl.getBoundingClientRect().height;
      const listStyles = window.getComputedStyle(listEl);
      const listPadY = (parseFloat(listStyles.paddingTop) || 0) + (parseFloat(listStyles.paddingBottom) || 0);
      // Natural height of the list content: the sortable wrapper stretches
      // to minHeight:100%, so measure first-row top -> last-row bottom
      // (includes gaps); the empty-state block is naturally sized.
      const inner = listEl.firstElementChild;
      let listContentH = 0;
      if (inner) {
        const rows = inner.children;
        if (rows.length > 0) {
          listContentH = rows[rows.length - 1].getBoundingClientRect().bottom
            - rows[0].getBoundingClientRect().top;
        } else {
          listContentH = inner.getBoundingClientRect().height;
        }
      }
      // (rootH - listH) = the panel chrome above the list (header row),
      // independent of whatever height the sheet imposed on the list.
      const natural = (rootH - listH) + listPadY + listContentH;
      if (Number.isFinite(natural) && natural > 0) contentHeight = Math.ceil(natural);
    }
    onMobilePanelMetricsChange({ expandedPageRows, contentHeight });
  }, [expandedSpaces, mobileMode, mobilePanelVisible, onMobilePanelMetricsChange, spaces]);
  const spacesDropFrameCaptureRef = useRef(null);
  const spacesExportAnchorRef = useRef(null);

  React.useEffect(() => {
    // The phone sheet has its own backdrop (a blocking window, R4).
    if (!isSpacesExportMenuOpen || mobileMode) return undefined;
    // Light popover — shared dismiss rules R1/R2/R5 (src/components/dismissRules.js).
    return watchLightPopover({
      contains: (target) => Boolean(
        !spacesExportAnchorRef.current
        || spacesExportAnchorRef.current.contains(target)
        || spacesExportMenuRef.current?.contains(target)
      ),
      close: () => setExportSpaceId(null),
    });
  }, [isSpacesExportMenuOpen, mobileMode]);

  const captureSpacesDropFrame = useCallback((label, details = {}) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const sampleStyle = (node) => {
      if (!node) return null;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        x: Number(rect.x.toFixed(1)),
        y: Number(rect.y.toFixed(1)),
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        opacity: style.opacity,
        transform: style.transform,
        transition: style.transition,
        background: style.backgroundColor,
        border: style.border,
        boxShadow: style.boxShadow,
        overflow: style.overflow,
        visibility: style.visibility,
        display: style.display,
      };
    };

    const rows = Array.from(document.querySelectorAll('[data-space-sortable-row-id]')).map((node) => {
      const wrapper = node.closest('[data-sortable-rearrange-item]');
      const card = node.querySelector('[data-drag-rearrange-row]');
      const header = card?.firstElementChild || null;
      // 2026-09-23: the row itself carries aria-expanded (no separate expand button).
      const expandButton = node.querySelector('.spaces-item__row[aria-expanded]');

      return {
        id: node.getAttribute('data-space-sortable-row-id'),
        text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        expanded: expandButton?.getAttribute('aria-expanded') === 'true',
        wrapper: sampleStyle(wrapper),
        rowRoot: sampleStyle(node),
        card: sampleStyle(card),
        header: sampleStyle(header),
      };
    });

    const frame = {
      label,
      time: Number(performance.now().toFixed(1)),
      details,
      rows,
    };

    const capture = spacesDropFrameCaptureRef.current;
    if (capture) {
      capture.frames.push(frame);
    }

    return frame;
  }, []);

  const summarizeSpacesDropCapture = useCallback((capture) => {
    const frames = capture?.frames || [];
    const firstFrame = frames[0];
    const lastFrame = frames[frames.length - 1];
    const beforeRows = new Map((firstFrame?.rows || []).map((row) => [row.id, row]));
    const changedRows = (lastFrame?.rows || []).map((afterRow) => {
      const beforeRow = beforeRows.get(afterRow.id);
      if (!beforeRow) return null;
      return {
        id: afterRow.id,
        text: afterRow.text,
        expanded: afterRow.expanded,
        wrapperYDelta: Number(((afterRow.wrapper?.y ?? 0) - (beforeRow.wrapper?.y ?? 0)).toFixed(1)),
        cardYDelta: Number(((afterRow.card?.y ?? 0) - (beforeRow.card?.y ?? 0)).toFixed(1)),
        wrapperTransform: {
          before: beforeRow.wrapper?.transform,
          after: afterRow.wrapper?.transform,
        },
        wrapperTransition: {
          before: beforeRow.wrapper?.transition,
          after: afterRow.wrapper?.transition,
        },
        cardBackground: {
          before: beforeRow.card?.background,
          after: afterRow.card?.background,
        },
        headerBackground: {
          before: beforeRow.header?.background,
          after: afterRow.header?.background,
        },
        boxShadow: {
          before: beforeRow.card?.boxShadow,
          after: afterRow.card?.boxShadow,
        },
      };
    }).filter(Boolean).filter((row) => (
      row.wrapperYDelta !== 0 ||
      row.cardYDelta !== 0 ||
      row.wrapperTransform.before !== row.wrapperTransform.after ||
      row.wrapperTransition.before !== row.wrapperTransition.after ||
      row.cardBackground.before !== row.cardBackground.after ||
      row.headerBackground.before !== row.headerBackground.after ||
      row.boxShadow.before !== row.boxShadow.after
    ));

    return {
      startedAt: capture?.startedAt,
      event: capture?.event,
      frameCount: frames.length,
      firstFrame: firstFrame?.label,
      lastFrame: lastFrame?.label,
      changedRows,
    };
  }, []);

  const startSpacesDropFrameCapture = useCallback((event = {}) => {
    if (typeof window === 'undefined') return;

    const capture = {
      startedAt: new Date().toISOString(),
      event,
      frames: [],
    };
    spacesDropFrameCaptureRef.current = capture;
    captureSpacesDropFrame('before-drop-commit', event);

    let frameCount = 0;
    const captureNextFrame = () => {
      frameCount += 1;
      captureSpacesDropFrame(`raf-${frameCount}`, event);
      if (frameCount < 10) {
        window.requestAnimationFrame(captureNextFrame);
        return;
      }

      window.setTimeout(() => {
        captureSpacesDropFrame('after-120ms', event);
        window.__spacesDropFrameCaptures = window.__spacesDropFrameCaptures || [];
        window.__spacesDropFrameCaptures.push(capture);
        window.__copySpacesDropFrames = () => JSON.stringify({
          latest: window.__spacesDropFrameCaptures?.[window.__spacesDropFrameCaptures.length - 1] || null,
          captures: window.__spacesDropFrameCaptures || [],
        }, null, 2);
        const summary = summarizeSpacesDropCapture(capture);
        console.info('[SPACES_DROP_SUMMARY]', JSON.stringify(summary, null, 2));
        console.info('[SPACES_DROP_FRAMES]', window.__copySpacesDropFrames());
        spacesDropFrameCaptureRef.current = null;
      }, 120);
    };

    window.requestAnimationFrame(captureNextFrame);
  }, [captureSpacesDropFrame, summarizeSpacesDropCapture]);

  const recordSpacesReorderDebug = useCallback((type, details = {}) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const rows = Array.from(document.querySelectorAll('[data-space-sortable-row-id]')).map((node) => {
      if (!node.closest('[data-sortable-rearrange-list]')) return null;
      const item = node.querySelector('[data-sortable-rearrange-item]') || node;
      const rect = item.getBoundingClientRect();
      const outerRect = node.getBoundingClientRect();
      // 2026-09-23: the row itself carries aria-expanded.
      const expandButton = node.querySelector('.spaces-item__row[aria-expanded]');
      const style = window.getComputedStyle(node);

      return {
        id: node.getAttribute('data-space-sortable-row-id'),
        text: (item.innerText || node.innerText || '').replace(/\s+/g, ' ').trim(),
        expanded: expandButton?.getAttribute('aria-expanded') === 'true',
        y: Number(rect.y.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        outerY: Number(outerRect.y.toFixed(1)),
        outerHeight: Number(outerRect.height.toFixed(1)),
        transform: style.transform,
        transition: style.transition,
      };
    }).filter(Boolean);

    const session = spacesReorderDebugSessionRef.current || {
      startedAt: new Date().toISOString(),
      events: [],
    };
    session.events.push({
      type,
      time: Math.round(performance.now()),
      details,
      rows,
      expandedSpaceIds: Array.from(expandedSpaces),
    });
    spacesReorderDebugSessionRef.current = session;

    window.__spacesReorderDebugSessions = window.__spacesReorderDebugSessions || [];
    window.__spacesReorderDebugSessions[window.__spacesReorderDebugSessions.length - 1] = session;
    window.__copySpacesReorderDebug = () => JSON.stringify({
      latest: window.__spacesReorderDebugSessions?.[window.__spacesReorderDebugSessions.length - 1] || null,
      sessions: window.__spacesReorderDebugSessions || [],
    }, null, 2);
  }, [expandedSpaces]);

  const requireSpaceManagement = useCallback(() => {
    if (!canManageSpaces) {
      showToast('Your plan or document access does not allow editing Spaces or Regions.', 'error');
      return false;
    }
    return true;
  }, [canManageSpaces]);

  const handleCreateSpace = useCallback(() => {
    if (!requireSpaceManagement()) return;
    // Next UNUSED number, not the count: after a delete, `Space ${length + 1}`
    // can equal a surviving space's name ("Space 2") and the create was refused
    // with a duplicate-name toast (owner's phone report 2026-09-30).
    const takenNames = new Set((spaces || []).map((space) => (
      typeof space?.name === 'string' ? space.name.trim().toLowerCase() : ''
    )));
    let counter = (spaces || []).length + 1;
    while (takenNames.has(`space ${counter}`)) counter += 1;
    const name = `Space ${counter}`;
    if (onSpaceCreate) {
      onSpaceCreate({
        name,
        assignedPages: []
      });
    }
  }, [requireSpaceManagement, spaces, onSpaceCreate]);

  const handleRenameSpace = useCallback((spaceId, nextName) => {
    if (!requireSpaceManagement()) return;
    const name = nextName?.trim();
    if (!name) return false;
    // Same rule as PDFViewer's handleSpaceUpdate (which keeps the final say);
    // checked here too so the row knows to put the old name back.
    const lowered = name.toLowerCase();
    if ((spaces || []).some((space) => space?.id !== spaceId
      && typeof space?.name === 'string' && space.name.trim().toLowerCase() === lowered)) {
      showToast('A space with this name already exists. Please choose a different name.', 'error');
      return false;
    }
    if (spaceId && onSpaceUpdate) {
      onSpaceUpdate(spaceId, { name });
    }
    return true;
  }, [onSpaceUpdate, requireSpaceManagement, spaces]);

  // Spaces chunk A: deleting a space also deletes what was placed in it (the
  // cascade), so the confirm says so, with counts. Undo restores it all.
  const handleDelete = useCallback((spaceId) => {
    if (!requireSpaceManagement()) return;
    const space = (spaces || []).find((entry) => entry?.id === spaceId);
    const impact = getSpaceRemovalImpact?.(spaceId, null) || null;
    askConfirm(buildDeleteSpaceConfirm({
      spaceName: space?.name,
      pageCount: space?.assignedPages?.length || 0,
      impact,
    })).then((confirmed) => {
      if (confirmed && onSpaceDelete) onSpaceDelete(spaceId);
    });
  }, [askConfirm, getSpaceRemovalImpact, onSpaceDelete, requireSpaceManagement, spaces]);

  const handleToggleExpand = useCallback((spaceId) => {
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
      }
      return next;
    });
  }, []);

  const handleExitSpace = useCallback((spaceId) => {
    if (selectedSpaceId === spaceId) {
      setSelectedSpaceId(null);
    }
    if (activeSpaceId === spaceId && onExitSpaceMode) {
      onExitSpaceMode();
    }
  }, [selectedSpaceId, activeSpaceId, onExitSpaceMode]);

  const handleToggleSpace = useCallback((spaceId, shouldActivate) => {
    if (shouldActivate) {
      // Turn on: activate the space
      setSelectedSpaceId(spaceId);
      if (onSetActiveSpace) {
        onSetActiveSpace(spaceId);
      }
    } else {
      // Turn off: deactivate the space
      if (selectedSpaceId === spaceId) {
        setSelectedSpaceId(null);
      }
      if (activeSpaceId === spaceId && onExitSpaceMode) {
        onExitSpaceMode();
      }
    }
  }, [selectedSpaceId, activeSpaceId, onSetActiveSpace, onExitSpaceMode]);

  const handlePageInputChange = useCallback((spaceId, value) => {
    setPageInputs(prev => ({
      ...prev,
      [spaceId]: value
    }));
    setPageErrors(prev => ({
      ...prev,
      [spaceId]: null
    }));
  }, []);

  const handleAssignPages = useCallback((spaceId) => {
    if (!requireSpaceManagement()) return;
    const rawInput = (pageInputs[spaceId] || '').trim();
    const { pages, errors } = parsePageRangeInput(rawInput, {
      min: 1,
      max: typeof numPages === 'number' && numPages > 0 ? numPages : Infinity
    });

    if (errors.length > 0) {
      setPageErrors(prev => ({
        ...prev,
        [spaceId]: errors.join(' ')
      }));
      return;
    }

    if (pages.length === 0) {
      setPageErrors(prev => ({
        ...prev,
        [spaceId]: 'Enter one or more page numbers.'
      }));
      return;
    }

    if (onSpaceAssignPages) {
      onSpaceAssignPages(spaceId, pages);
    }

    setPageInputs(prev => ({
      ...prev,
      [spaceId]: ''
    }));
    setPageErrors(prev => ({
      ...prev,
      [spaceId]: null
    }));
  }, [pageInputs, numPages, onSpaceAssignPages, requireSpaceManagement]);

  React.useEffect(() => {
    const previousIds = previousSpaceIdsRef.current;
    const currentIds = new Set(spaces.map(space => space.id));
    const newlyAddedIds = spaces
      .map(space => space.id)
      .filter((spaceId) => spaceId != null && !previousIds.has(spaceId));

    if (newlyAddedIds.length > 0) {
      setExpandedSpaces(prev => {
        const next = new Set(prev);
        newlyAddedIds.forEach(id => next.add(id));
        return next;
      });
    }

    previousSpaceIdsRef.current = currentIds;
  }, [spaces]);

  React.useEffect(() => {
    setOptimisticSpaceIds(spaces.map(space => space.id));
  }, [spaces]);

  // Spaces chunk A: an active space with no pages (the viewer's "No pages in
  // ..." card sends the user here) opens on its Add pages field.
  const activeSpaceIsEmpty = Boolean(activeSpaceId) && (spaces || []).some((space) => (
    space?.id === activeSpaceId && (space.assignedPages?.length || 0) === 0
  ));
  React.useEffect(() => {
    if (!activeSpaceIsEmpty) return;
    setExpandedSpaces((prev) => (prev.has(activeSpaceId) ? prev : new Set(prev).add(activeSpaceId)));
  }, [activeSpaceId, activeSpaceIsEmpty]);

  const orderedSpaces = React.useMemo(() => {
    const byId = new Map(spaces.map(space => [space.id, space]));
    const seen = new Set();
    const ordered = optimisticSpaceIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((space) => {
        if (seen.has(space.id)) return false;
        seen.add(space.id);
        return true;
      });

    spaces.forEach((space) => {
      if (!seen.has(space.id)) {
        ordered.push(space);
      }
    });

    return ordered;
  }, [optimisticSpaceIds, spaces]);

  // Spaces chunk A: removing a page also deletes the marks placed in this
  // space on it and its drawn areas - ask first when there is any, with the
  // counts. A bare page assignment goes without a question (one Undo step).
  const handleRemovePage = useCallback((spaceId, pageId) => {
    if (!requireSpaceManagement()) return;
    if (!onSpaceRemovePage) return;
    const space = (spaces || []).find((entry) => entry?.id === spaceId);
    const prompt = buildRemovePageConfirm({
      spaceName: space?.name,
      pageId,
      impact: getSpaceRemovalImpact?.(spaceId, [pageId]) || null,
    });
    if (!prompt) {
      onSpaceRemovePage(spaceId, pageId);
      return;
    }
    askConfirm(prompt).then((confirmed) => {
      if (confirmed) onSpaceRemovePage(spaceId, pageId);
    });
  }, [askConfirm, getSpaceRemovalImpact, onSpaceRemovePage, requireSpaceManagement, spaces]);

  const handleRenameRegion = useCallback((spaceId, pageId, label) => {
    if (!requireSpaceManagement()) return;
    onSpaceRenamePage?.(spaceId, pageId, label);
  }, [onSpaceRenamePage, requireSpaceManagement]);

  const handleRequestRegionEdit = useCallback((spaceId, pageId) => {
    if (!requireSpaceManagement()) return;
    onRequestRegionEdit?.(spaceId, pageId);
  }, [onRequestRegionEdit, requireSpaceManagement]);

  const handleSpaceReorder = useCallback((activeId, overId) => {
    if (!requireSpaceManagement()) return;
    if (activeId === overId) return;
    if (!onReorderSpaces) return;
    const fromIndex = spaces.findIndex(space => space.id === activeId);
    const toIndex = spaces.findIndex(space => space.id === overId);
    if (fromIndex === -1 || toIndex === -1) return;
    recordSpacesReorderDebug('reorder', { activeId, overId, fromIndex, toIndex });
    setOptimisticSpaceIds((prevIds) => {
      const currentIds = orderedSpaces.map(space => space.id);
      const ids = prevIds.length === currentIds.length && currentIds.every((id) => prevIds.includes(id))
        ? prevIds
        : currentIds;
      const optimisticFromIndex = ids.indexOf(activeId);
      const optimisticToIndex = ids.indexOf(overId);
      const nextIds = moveItem(ids, optimisticFromIndex, optimisticToIndex);
      return nextIds === ids ? ids : nextIds;
    });
    onReorderSpaces(fromIndex, toIndex);
  }, [onReorderSpaces, orderedSpaces, recordSpacesReorderDebug, requireSpaceManagement, spaces]);

  const handleSpaceDragStart = useCallback(({ activeId }) => {
    setIsRearrangingSpaces(true);
    spacesReorderMoveCountRef.current = 0;
    spacesReorderDebugSessionRef.current = {
      startedAt: new Date().toISOString(),
      events: [],
    };
    if (typeof window !== 'undefined') {
      window.__spacesReorderDebugSessions = window.__spacesReorderDebugSessions || [];
      window.__spacesReorderDebugSessions.push(spacesReorderDebugSessionRef.current);
    }
    recordSpacesReorderDebug('drag-start', { activeId, wasExpanded: expandedSpaces.has(activeId) });
  }, [expandedSpaces, recordSpacesReorderDebug]);

  const handleSpaceDragMove = useCallback(({ activeId, overId, delta }) => {
    spacesReorderMoveCountRef.current += 1;
    if (spacesReorderMoveCountRef.current > 1 && spacesReorderMoveCountRef.current % 4 !== 0) return;
    recordSpacesReorderDebug('drag-move', { activeId, overId, delta });
  }, [recordSpacesReorderDebug]);

  const restoreCollapsedSpaceAfterDrag = useCallback((event = {}) => {
    recordSpacesReorderDebug('drag-settle', event);

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setIsRearrangingSpaces(false);
      }, 180);
      try {
        window.localStorage.setItem('spacesReorderDebugLatest', window.__copySpacesReorderDebug?.() || '');
        console.info('[SPACES_REORDER_DEBUG]', window.__copySpacesReorderDebug?.());
      } catch {
        // Best-effort debugging only.
      }
    } else {
      setIsRearrangingSpaces(false);
    }
  }, [recordSpacesReorderDebug]);

  const expandedSpaceId = Array.from(expandedSpaces)[0] || null;
  const spacesExportTargetId = selectedSpaceId || activeSpaceId || expandedSpaceId || orderedSpaces[0]?.id || null;
  const spacesExportTarget = orderedSpaces.find((space) => space.id === spacesExportTargetId) || null;
  const createSpaceLabel = canManageSpaces ? 'Create space' : 'Upgrade to Pro to create spaces';
  const exportSpaceLabel = spacesExportTarget ? `Export ${spacesExportTarget.name || 'space'}` : 'Create a space to export';
  const activeSpace = activeSpaceId ? orderedSpaces.find((space) => space.id === activeSpaceId) || null : null;

  // Chunk B: Export opens on a chosen space (the row's `⋯` passes its own;
  // the header's Export the selected / active / open / first one) and the
  // menu lets you pick another.
  const openSpacesExport = useCallback((spaceId) => {
    if (!spaceId) return;
    if (!features?.excelExport) {
      showToast('Exporting spaces is a Pro feature.', 'error');
      return;
    }
    setExportSpaceId(spaceId);
  }, [features?.excelExport]);
  const runSpacesExport = (kind, spaceId) => {
    setExportSpaceId(null);
    if (kind === 'csv') onExportSpaceCSV?.(spaceId);
    else onExportSpacePDF?.(spaceId);
  };
  const exportPanel = isSpacesExportMenuOpen ? (
    <SpacesExportPanel
      spaces={orderedSpaces}
      spaceId={exportSpaceId}
      onSpaceChange={setExportSpaceId}
      onExportCSV={(spaceId) => runSpacesExport('csv', spaceId)}
      onExportPDF={(spaceId) => runSpacesExport('pdf', spaceId)}
      onClose={mobileMode ? () => setExportSpaceId(null) : null}
    />
  ) : null;

  return (
    <div
      ref={mobilePanelRootRef}
      className={`spaces-panel${mobileMode ? ' mobile-spaces-panel' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: mobileMode ? 'auto' : '100%',
        flex: mobileMode ? 1 : undefined,
        minHeight: 0,
        fontFamily: FONT_FAMILY,
        background: mobileMode ? 'var(--surface-2)' : 'var(--surface-1)'
      }}
    >
      {/* UX 2026-09-23 (owner): the Bookmarks header pattern - [+ Add] on the
          left and [Export] on the right, quiet words of equal weight.
          Spaces chunk B: the phone header is the Survey sheet's - a "Spaces"
          title, then Add, the export glyph and a neutral "Done" (it leaves
          Spaces mode and closes the sheet, as the red "Exit Spaces / Regions"
          link at the foot of the list did). The desktop header gains an
          "Exit space" chip while a space is on. */}
      <div className="spaces-panel__head">
        {mobileMode && <h2 className="spaces-panel__heading">Spaces</h2>}
        <button
          type="button"
          className="spaces-panel__head-btn spaces-panel__head-btn--add tertiary"
          onClick={handleCreateSpace}
          {...tip(createSpaceLabel, 'below')}
          aria-label={createSpaceLabel}
        >
          <Icon name="plus" size={14} color="currentColor" />
          <span>Add</span>
        </button>

        {!mobileMode && <span className="spaces-panel__head-fill" aria-hidden="true" />}

        {!mobileMode && activeSpace && (
          <button
            type="button"
            className="spaces-panel__exit-chip"
            onClick={() => handleExitSpace(activeSpace.id)}
            {...tip(`Turn off ${activeSpace.name || 'the space'} and show every page`, 'below')}
            aria-label={`Exit ${activeSpace.name || 'space'}`}
          >
            <span>Exit space</span>
            <Icon name="close" size={10} color="currentColor" />
          </button>
        )}

        <div
          ref={spacesExportAnchorRef}
          className="spaces-panel__export-anchor"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`spaces-panel__head-btn spaces-panel__head-btn--export tertiary${mobileMode ? ' is-glyph' : ''}`}
            {...tip(exportSpaceLabel, 'below')}
            aria-label={exportSpaceLabel}
            aria-haspopup={mobileMode ? 'dialog' : 'menu'}
            aria-expanded={isSpacesExportMenuOpen}
            disabled={!spacesExportTarget}
            onClick={() => {
              if (!spacesExportTarget) return;
              if (isSpacesExportMenuOpen) {
                setExportSpaceId(null);
                return;
              }
              openSpacesExport(spacesExportTarget.id);
            }}
          >
            <Icon name="upload" size={mobileMode ? 16 : 14} color="currentColor" />
            {!mobileMode && <span>Export</span>}
          </button>
          {!mobileMode && exportPanel && (
            <AnchoredPopover getAnchor={() => spacesExportAnchorRef.current} gap={2} zIndex={7000}>
              <div ref={spacesExportMenuRef} className="spaces-export spaces-export--menu" role="menu" aria-label={`Export ${orderedSpaces.find((space) => space.id === exportSpaceId)?.name || 'space'}`}>
                {exportPanel}
              </div>
            </AnchoredPopover>
          )}
        </div>

        {typeof onExitSpacesAction === 'function' && (
          <button
            type="button"
            className="spaces-panel__done tertiary"
            onClick={onExitSpacesAction}
          >
            Done
          </button>
        )}
      </div>

      {/* Spaces List — one divided list, no cards. */}
      <div ref={mobileSpacesListRef} className="spaces-list">
        {spaces.length === 0 ? (
          <div className="spaces-list__empty">
            No spaces yet. Create a space to filter pages by visibility.
          </div>
        ) : (
          <SortableRearrangeList
            ids={orderedSpaces.map(space => space.id)}
            onReorder={handleSpaceReorder}
            onDragStart={handleSpaceDragStart}
            onDragMove={handleSpaceDragMove}
            onBeforeDragEnd={startSpacesDropFrameCapture}
            onDragEnd={restoreCollapsedSpaceAfterDrag}
            onDragCancel={restoreCollapsedSpaceAfterDrag}
            variableHeight
            gap={0}
          >
            {orderedSpaces.map((space) => {
              const isActive = activeSpaceId === space.id;
              const isSelected = selectedSpaceId === space.id;
              const isExpanded = expandedSpaces.has(space.id);
              const pageCount = space.assignedPages?.length || 0;
              const regionCount = space.assignedPages?.reduce((sum, p) => sum + (p.regions?.length || 0), 0) || 0;
              return (
                <SortableRearrangeRow
                  key={space.id}
                  id={space.id}
                  disabled={!canManageSpaces || !onReorderSpaces}
                  animateLayoutChanges={animateSpaceLayoutChanges}
                  draggingOpacity={1}
                  transition={null}
                >
                  {({ attributes, listeners, isDragging }) => (
                    <SpaceSortableCard
                      space={space}
                      dragHandleProps={{ ...attributes, ...listeners }}
                      isDragging={isDragging}
                      isRearranging={isRearrangingSpaces}
                      isActive={isActive}
                      isSelected={isSelected}
                      isExpanded={isExpanded}
                      pageCount={pageCount}
                      regionCount={regionCount}
                      pageInputValue={pageInputs[space.id] || ''}
                      pageError={pageErrors[space.id]}
                      onToggleExpand={handleToggleExpand}
                      onRenameSpace={handleRenameSpace}
                      onDelete={handleDelete}
                      onExport={(onExportSpaceCSV || onExportSpacePDF) ? openSpacesExport : null}
                      onExitSpace={handleExitSpace}
                      onToggleSpace={handleToggleSpace}
                      onPageInputChange={handlePageInputChange}
                      onAssignPages={handleAssignPages}
                      onRenameRegion={handleRenameRegion}
                      onRemovePage={handleRemovePage}
                      onNavigateToPage={onNavigateToPage}
                      onRequestRegionEdit={handleRequestRegionEdit}
                      onCancelRegionEdit={onCancelRegionEdit}
                      isRegionSelectionActive={isRegionSelectionActive}
                      regionSelectionPage={regionSelectionPage}
                      getCanvasAnnotationVisibilityState={getCanvasAnnotationVisibilityState}
                      onToggleCanvasAnnotations={onToggleCanvasAnnotations}
                      getSurveyAnnotationVisibilityState={getSurveyAnnotationVisibilityState}
                      onToggleSurveyAnnotations={onToggleSurveyAnnotations}
                      activeSpaceId={activeSpaceId}
                      onToggleRegionOverlay={onToggleRegionOverlay}
                      getRegionOverlayEnabled={getRegionOverlayEnabled}
                      isRegionOverlayToggleEnabled={isRegionOverlayToggleEnabled}
                      showSurveyPanel={showSurveyPanel}
                      selectedModuleId={selectedModuleId}
                      mobileMode={mobileMode}
                    />
                  )}
                </SortableRearrangeRow>
              );
            })}
          </SortableRearrangeList>
        )}
      </div>
      {/* Rendered on <body>, above the phone sheet (z 6500): inside the sheet a
          fixed overlay is caught by the sheet's transform. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'relative', zIndex: 7000 }}>
          {confirmDialogElement}
          {/* Chunk B (phone): Export is its own small sheet over the Spaces
              sheet, standing on the dock like every phone sheet. */}
          {mobileMode && exportPanel && (
            <>
              <button
                type="button"
                className="spaces-export-sheet__backdrop"
                aria-label="Close export"
                onClick={() => setExportSpaceId(null)}
              />
              <div className="spaces-export spaces-export-sheet" role="dialog" aria-label={`Export ${orderedSpaces.find((space) => space.id === exportSpaceId)?.name || 'space'}`}>
                {exportPanel}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default SpacesPanel;
