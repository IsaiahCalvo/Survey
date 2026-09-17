/**
 * SpacesPanel.jsx — sidebar panel for managing "Spaces" (named page groups with
 * regions and per-page annotation visibility).
 *
 * Default-exports the SpacesPanel component; internal SpaceSortableCard renders
 * each card with expand, inline rename, toggle, page-range add (parsePageRangeInput),
 * region rename/edit, and canvas/survey annotation-visibility
 * toggles (gated on the Pro `features` flags). Cards reorder via dnd-kit
 * SortableRearrangeList with optimistic ordering and frame-capture debug hooks.
 */
import React, { useState, useCallback, useRef } from 'react';
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

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const animateSpaceLayoutChanges = () => false;

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
  // UX 2026-07-12 — in the mobile Spaces sheet the space activate toggle grows to
  // the demo's touch size (40x24 track, 18px knob; SpaceRow.tsx toggle / styles.ts
  // 2104-2123). Desktop keeps the compact 28x16 toggle. Gold active track, never
  // the demo's blue. Region mini-toggles stay 28x16 (already demo-correct).
  mobileMode = false,
}) {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [editingRegionValue, setEditingRegionValue] = useState('');
  const editingRegionInputRef = useRef(null);
  React.useEffect(() => {
    if (!isExpanded) {
      setEditingRegionId(null);
      setEditingRegionValue('');
    }
  }, [isExpanded]);
  React.useEffect(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, [space.id]);

  const commitRegionRename = useCallback((pageId) => {

    if (editingRegionId !== pageId) {

      return;
    }
    const labelToSave = editingRegionValue.trim();

    onRenameRegion?.(space.id, pageId, labelToSave);
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
    setEditingRegionId(pageId);
    setEditingRegionValue(currentLabel);
  }, []);

  const isHighlighted = isSelected || isActive;
  const headerBackground = isHighlighted ? 'var(--accent-text)' : 'transparent';
  const headerHoverBackground = isHighlighted ? 'var(--accent-text)' : 'var(--accent-text)';
  const regionCountText = String(regionCount);
  const regionCountDigits = regionCountText.length;
  const regionCountFontSize = regionCountDigits >= 4 ? '6px' : (regionCountDigits >= 3 ? '7.5px' : '10px');
  const commitSpaceName = useCallback((input) => {
    if (!input) return;
    const fallbackName = space.name?.trim() || 'Space';
    const nextName = (input.value || '').trim() || fallbackName;
    input.value = nextName;
    if (input.parentElement) {
      input.parentElement.dataset.value = nextName || ' ';
    }
    if (nextName !== space.name) {
      onRenameSpace?.(space.id, nextName);
    }
  }, [onRenameSpace, space.id, space.name]);

  return (
    <div data-space-sortable-row-id={space.id}>
      <div
        data-drag-rearrange-row
        style={{
          background: 'var(--surface-2)',
          border: isHighlighted ? '1px solid transparent' : '1px solid var(--border)',
          borderRadius: '5px',
          overflow: isExpanded ? 'visible' : 'hidden',
          boxShadow: isHighlighted
            ? '0 4px 16px rgba(0, 0, 0, 0.18)'
            : '0 1px 2px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          onClick={() => onToggleExpand(space.id)}
          style={{
            padding: '2px 5px',
            cursor: 'pointer',
            background: headerBackground,
            transition: isDragging || isRearranging ? 'none' : 'background 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseEnter={(e) => {
            if (isDragging || isRearranging) return;
            if (!isSelected && !isActive) {
              e.currentTarget.style.background = headerHoverBackground;
            }
          }}
          onMouseLeave={(e) => {
            if (isDragging || isRearranging) return;
            if (!isSelected && !isActive) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <div className="space-card-leading-controls">
            <DragRearrangeHandle
              {...dragHandleProps}
              className="space-card-drag-handle"
              data-space-drag-handle
              isDragging={isDragging}
              title="Drag to rearrange"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '24px',
                height: '24px',
                color: 'var(--text-disabled)',
              }}
            />

            <span
              className="space-region-count"
              {...tip(`${regionCount} region${regionCount !== 1 ? 's' : ''}`, 'below')}
              aria-label={`${regionCount} region${regionCount !== 1 ? 's' : ''}`}
              style={{ fontSize: regionCountFontSize }}
            >
              {regionCountText}
            </span>

            <button
              className="space-card-expand-button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(space.id);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-disabled)',
                cursor: 'pointer',
                padding: '2px 4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px'
              }}
              {...tip(isExpanded ? 'Collapse' : 'Expand', 'below')}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              onMouseEnter={(e) => {
                tip(isExpanded ? 'Collapse' : 'Expand', 'below').onMouseEnter(e);
                e.currentTarget.style.background = 'var(--accent-text)';
              }}
              onMouseLeave={(e) => {
                tip(isExpanded ? 'Collapse' : 'Expand', 'below').onMouseLeave(e);
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon
                name={isExpanded ? 'chevronDown' : 'chevronRight'}
                size={12}
              />
            </button>
          </div>

          <span className="space-name-fit" data-value={space.name || ' '}>
            <input
              type="text"
              size={1}
              className="space-name-inline"
              defaultValue={space.name}
              key={`${space.id}:${space.name}`}
              {...tip('Click to rename', 'below')}
              aria-label={`Rename ${space.name || 'Space'}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.currentTarget.select();
              }}
              onInput={(e) => {
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.dataset.value = e.currentTarget.value || ' ';
                }
              }}
              onBlur={(e) => {
                tip('Click to rename', 'below').onBlur(e);
                commitSpaceName(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.currentTarget.value = space.name || '';
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.dataset.value = space.name || ' ';
                  }
                  e.currentTarget.blur();
                }
              }}
            />
          </span>
          <div className="space-card-header-controls">
            {/* Toggle Switch - Always visible */}
            <div
              className="space-toggle-control"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSpace?.(space.id, !isActive);
              }}
              style={{
                position: 'relative',
                width: mobileMode ? '40px' : '28px',
                height: mobileMode ? '24px' : '16px',
                borderRadius: mobileMode ? '12px' : '8px',
                background: isActive ? 'var(--accent)' : 'var(--surface-3)',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
                border: isActive ? '1px solid var(--accent-press)' : '1px solid var(--border-strong)',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
                flexShrink: 0
              }}
              {...tip(isActive ? 'Turn off space' : 'Turn on space', 'below')}
              aria-label={isActive ? 'Turn off space' : 'Turn on space'}
              onMouseEnter={(e) => {
                tip(isActive ? 'Turn off space' : 'Turn on space', 'below').onMouseEnter(e);
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--accent-text)';
                } else {
                  e.currentTarget.style.background = 'var(--accent-press)';
                }
              }}
              onMouseLeave={(e) => {
                tip(isActive ? 'Turn off space' : 'Turn on space', 'below').onMouseLeave(e);
                e.currentTarget.style.background = isActive ? 'var(--accent)' : 'var(--accent-text)';
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  width: mobileMode ? '18px' : '12px',
                  height: mobileMode ? '18px' : '12px',
                  borderRadius: '50%',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                  transition: 'transform 0.2s ease',
                  transform: isActive
                    ? (mobileMode ? 'translate(18px, -50%)' : 'translate(12px, -50%)')
                    : 'translate(0px, -50%)',
                  left: '2px',
                  top: '50%'
                }}
              />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(space.id);
              }}
              className="space-card-delete-button"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px',
                cursor: 'pointer',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              {...tip('Delete', 'below')}
              aria-label="Delete"
              onMouseEnter={(e) => {
                tip('Delete', 'below').onMouseEnter(e);
                e.currentTarget.style.background = 'rgba(217, 90, 86, 0.15)';
              }}
              onMouseLeave={(e) => {
                tip('Delete', 'below').onMouseLeave(e);
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon name="trash" size={12} color="var(--danger)" />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div
            style={{
            padding: '10px 12px 16px 12px',
            background: 'var(--surface-2)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '12px',
            color: 'var(--text-3)',
            position: 'relative'
          }}>
            <div className="space-add-pages-row" style={{ position: 'relative', height: '24px', flex: '0 0 24px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <input
                  type="text"
                  className="space-add-pages-input"
                  value={pageInputValue}
                  placeholder="Add pages (e.g. 3, 6-9, 12)"
                  onChange={(e) => onPageInputChange(space.id, sanitizePageRangeInput(e.target.value))}
                  inputMode="numeric"
                  pattern="[0-9,-]*"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onAssignPages(space.id);
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '24px',
                    padding: '2px 8px',
                    background: 'var(--surface-1)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontFamily: FONT_FAMILY,
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssignPages(space.id);
                  }}
                  className="space-add-pages-icon-button"
                  {...tip('Add pages', 'below')}
                  aria-label="Add pages"
                >
                  <Icon name="plus" size={13} />
                </button>
              </div>
              {pageError && (
                <div className="space-page-range-error" {...tip(pageError, 'below')}>
                  {pageError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {pageCount === 0 ? (
                <div style={{ color: 'var(--text-disabled)', fontSize: '12px' }}>
                  No pages added yet.
                </div>
              ) : (
                <ul style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  {space.assignedPages
                    ?.slice()
                    .sort((a, b) => (a.pageId || 0) - (b.pageId || 0))
                    .map(page => {
                      const regionLabel = typeof page.label === 'string' && page.label.trim().length > 0
                        ? page.label.trim()
                        : `Region ${page.pageId}`;
                      const isEditingRegion = editingRegionId === page.pageId;

                      return (
                        <li
                          key={page.pageId}
                          className="space-region-row"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '4px 8px',
                            minHeight: '34px',
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px'
                          }}
                        >
                          <div className="region-leading-controls">
                            <button
                              type="button"
                              className="region-page-pill region-page-pill-leading"
                              {...tip(`Go to page ${page.pageId}`, 'below')}
                              aria-label={`Go to page ${page.pageId}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onNavigateToPage?.(page.pageId);
                              }}
                            >
                              {page.pageId}
                            </button>

                            {/* Region Overlay Toggle Switch - Always visible, dimmed when disabled */}
                            {(() => {
                              const hasProps = onToggleRegionOverlay && getRegionOverlayEnabled && isRegionOverlayToggleEnabled;
                              const isOverlayEnabled = hasProps && getRegionOverlayEnabled ? getRegionOverlayEnabled(space.id, page.pageId, page) : false;
                              const isToggleEnabled = hasProps && isRegionOverlayToggleEnabled ? isRegionOverlayToggleEnabled(space.id, page.pageId, page) : false;
                              const isSpaceActive = isActive;
                              const overlayTooltipText = !hasProps
                                ? 'Overlay toggle'
                                : !isSpaceActive
                                  ? 'Enable space to toggle overlay'
                                  : !isToggleEnabled
                                    ? 'Define regions first to enable overlay'
                                    : (isOverlayEnabled ? 'Hide overlay for this region' : 'Show overlay for this region');

                              return (
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isToggleEnabled || !onToggleRegionOverlay) {
                                      return;
                                    }
                                    onToggleRegionOverlay(space.id, page.pageId);
                                  }}
                                  style={{
                                    position: 'relative',
                                    width: '28px',
                                    height: '16px',
                                    borderRadius: '8px',
                                    background: isToggleEnabled && isOverlayEnabled ? 'var(--accent)' : 'var(--surface-3)',
                                    cursor: isToggleEnabled ? 'pointer' : 'not-allowed',
                                    transition: 'background 0.2s ease',
                                    border: isToggleEnabled && isOverlayEnabled ? '1px solid var(--accent-press)' : '1px solid var(--border-strong)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '2px',
                                    flexShrink: 0,
                                    opacity: isToggleEnabled ? 1 : 0.5
                                  }}
                                  {...tip(overlayTooltipText, 'below')}
                                  aria-label={overlayTooltipText}
                                  onMouseEnter={(e) => {
                                    tip(overlayTooltipText, 'below').onMouseEnter(e);
                                    if (!isToggleEnabled) return;
                                    if (!isOverlayEnabled) {
                                      e.currentTarget.style.background = 'var(--accent-text)';
                                    } else {
                                      e.currentTarget.style.background = 'var(--accent-press)';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    tip(overlayTooltipText, 'below').onMouseLeave(e);
                                    if (!isToggleEnabled) return;
                                    e.currentTarget.style.background = isOverlayEnabled ? 'var(--accent)' : 'var(--accent-text)';
                                  }}
                                >
                                  <div
                                    style={{
                                      position: 'absolute',
                                      width: '12px',
                                      height: '12px',
                                      borderRadius: '50%',
                                      background: '#ffffff',
                                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                                      transition: 'transform 0.2s ease',
                                      transform: isToggleEnabled && isOverlayEnabled ? 'translate(12px, -50%)' : 'translate(0px, -50%)',
                                      left: '2px',
                                      top: '50%'
                                    }}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div className="region-name-line">
                              {isEditingRegion ? (
                                <input
                                  ref={editingRegionInputRef}
                                  type="text"
                                  value={editingRegionValue}
                                  onChange={(e) => setEditingRegionValue(e.target.value)}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onFocus={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onBlur={() => {
                                    if (isRegionSelectionActive) {
                                      return;
                                    }
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
                                  className="region-name-inline"
                                  style={{
                                    width: '100%',
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="region-name-display"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleRegionEditClick(page.pageId, regionLabel);
                                  }}
                                  {...tip('Click to rename', 'below')}
                                  aria-label="Click to rename"
                                >
                                  {regionLabel}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="region-action-controls">
                            {/* KAL-313 / history F1 (2026-06-11): region-edit entry point.
                                The 2026-06-11 panel rewrite ("Polish spaces sidebar controls")
                                dropped the only call site of onRequestRegionEdit, making the
                                Region Selection Tool unreachable from the UI — and with it the
                                commit-time region-delete journaling. This button restores it. */}
                            {(() => {
                              const isActiveRegionEdit =
                                isRegionSelectionActive &&
                                regionSelectionPage === page.pageId &&
                                activeSpaceId === space.id;
                              return (
                                <button
                                  type="button"
                                  className="region-edit-button"
                                  {...tip(isActiveRegionEdit ? 'Exit region edit' : 'Edit region areas on the page', 'below')}
                                  aria-label={isActiveRegionEdit ? 'Exit region edit' : 'Edit region areas on the page'}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isActiveRegionEdit) {
                                      onCancelRegionEdit?.(space.id, page.pageId);
                                    } else {
                                      onRequestRegionEdit?.(space.id, page.pageId);
                                    }
                                  }}
                                  style={{
                                    background: isActiveRegionEdit ? 'rgba(216, 168, 78, 0.18)' : 'transparent',
                                    border: isActiveRegionEdit ? '1px solid rgba(216, 168, 78, 0.55)' : '1px solid transparent',
                                    borderRadius: '4px',
                                    padding: '2px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: isActiveRegionEdit ? 'var(--accent)' : 'var(--text-3)'
                                  }}
                                >
                                  <Icon name="edit" size={12} color="currentColor" />
                                </button>
                              );
                            })()}
                            {/* One visible control on screen, but separate canvas/survey features in code. */}
                            {isExpanded && (() => {
                              const controlMode = getPageVisibilityControlMode({ showSurveyPanel, selectedModuleId });
                              const isSurveyContext =
                                activeSpaceId !== null &&
                                controlMode === PAGE_VISIBILITY_CONTROL_MODE.SURVEY;
                              const getVisibilityState = isSurveyContext
                                ? getSurveyAnnotationVisibilityState
                                : getCanvasAnnotationVisibilityState;
                              const onToggleVisibility = isSurveyContext
                                ? onToggleSurveyAnnotations
                                : onToggleCanvasAnnotations;

                              if (!getVisibilityState || !onToggleVisibility) {
                                return null;
                              }

                              const visibilityState = getVisibilityState(space.id, page.pageId);
                              const isDisabled = !isActive || activeSpaceId === null;
                              const title = !isDisabled
                                ? (isSurveyContext
                                  ? (visibilityState ? 'Hide survey annotations' : 'Show survey annotations')
                                  : (visibilityState ? 'Hide canvas annotations' : 'Show canvas annotations'))
                                : 'Toggle is only available when a space is active';

                              return (
                                <button
                                  onClick={(e) => {
                                    const now = Date.now();
                                    const lastClick = parseInt(e.currentTarget.dataset.lastClick || '0', 10);
                                    if (now - lastClick < 300) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      return;
                                    }
                                    e.currentTarget.dataset.lastClick = now.toString();

                                    if (isDisabled) {
                                      return;
                                    }

                                    e.stopPropagation();
                                    onToggleVisibility(space.id, page.pageId, !visibilityState);
                                  }}
                                  className="region-visibility-button"
                                  style={{
                                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                                    color: isDisabled ? '#5a6473' : (visibilityState ? '#d8a84e' : '#8d96a6'),
                                    opacity: isDisabled ? 0.5 : 1,
                                    pointerEvents: isDisabled ? 'none' : 'auto'
                                  }}
                                  {...tip(title, 'below')}
                                  aria-label={title}
                                  onMouseEnter={(e) => {
                                    tip(title, 'below').onMouseEnter(e);
                                    if (!isDisabled) {
                                      e.currentTarget.style.color = visibilityState ? '#5ba1f0' : 'var(--text-3)';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    tip(title, 'below').onMouseLeave(e);
                                    e.currentTarget.style.color = visibilityState ? 'var(--accent)' : 'var(--text-3)';
                                  }}
                                >
                                  {isSurveyContext ? (
                                    <Icon
                                      name="survey"
                                      size={12}
                                      style={{ width: '15px', height: '15px', flexShrink: 0 }}
                                    />
                                  ) : (
                                    <Icon
                                      name={visibilityState ? 'lightbulbOn' : 'lightbulbOff'}
                                      size={14}
                                      color="currentColor"
                                      style={{ width: '14px', height: '14px', flexShrink: 0 }}
                                    />
                                  )}
                                </button>
                              );
                            })()}
                            <button
                              {...tip('Delete', 'below')}
                              aria-label="Delete"
                              onClick={() => onRemovePage(space.id, page.pageId)}
                              className="region-delete-button"
                            >
                              <Icon name="trash" size={12} color="var(--danger)" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

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
}) => {
  const tip = useTooltip();
  const [expandedSpaces, setExpandedSpaces] = useState(() => new Set());
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [isRearrangingSpaces, setIsRearrangingSpaces] = useState(false);
  const [optimisticSpaceIds, setOptimisticSpaceIds] = useState(() => spaces.map(space => space.id));
  const [isSpacesExportMenuOpen, setIsSpacesExportMenuOpen] = useState(false);
  const [isSpacesExportHovered, setIsSpacesExportHovered] = useState(false);

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
    if (!isSpacesExportMenuOpen) return;

    const handleOutsideClick = (event) => {
      if (!spacesExportAnchorRef.current) return;
      if (!spacesExportAnchorRef.current.contains(event.target)) {
        setIsSpacesExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isSpacesExportMenuOpen]);

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
      // KAL-65: the expand/collapse button no longer carries a native title=
      // (see the shared tip() binder above), so this debug-capture selector
      // now keys off aria-label, which still carries 'Expand'/'Collapse'.
      const expandButton = node.querySelector('button[aria-label="Expand"], button[aria-label="Collapse"]');

      return {
        id: node.getAttribute('data-space-sortable-row-id'),
        text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        expanded: expandButton?.getAttribute('aria-label') === 'Collapse',
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
      // KAL-65: aria-label, not title=, now carries 'Expand'/'Collapse'.
      const expandButton = node.querySelector('button[aria-label="Expand"], button[aria-label="Collapse"]');
      const style = window.getComputedStyle(node);

      return {
        id: node.getAttribute('data-space-sortable-row-id'),
        text: (item.innerText || node.innerText || '').replace(/\s+/g, ' ').trim(),
        expanded: expandButton?.getAttribute('aria-label') === 'Collapse',
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
    const name = `Space ${spaces.length + 1}`;
    if (onSpaceCreate) {
      onSpaceCreate({
        name,
        assignedPages: []
      });
    }
  }, [requireSpaceManagement, spaces.length, onSpaceCreate]);

  const handleRenameSpace = useCallback((spaceId, nextName) => {
    if (!requireSpaceManagement()) return;
    const name = nextName?.trim();
    if (spaceId && name && onSpaceUpdate) {
      onSpaceUpdate(spaceId, { name });
    }
  }, [onSpaceUpdate, requireSpaceManagement]);

  const handleDelete = useCallback((spaceId) => {
    if (!requireSpaceManagement()) return;
    if (window.confirm('Delete this space? This will not delete the pages, only the space assignment.')) {
      if (onSpaceDelete) {
        onSpaceDelete(spaceId);
      }
    }
  }, [onSpaceDelete, requireSpaceManagement]);

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

  const handleRemovePage = useCallback((spaceId, pageId) => {
    if (!requireSpaceManagement()) return;
    if (!onSpaceRemovePage) return;
    onSpaceRemovePage(spaceId, pageId);
  }, [onSpaceRemovePage, requireSpaceManagement]);

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
  const isSpacesExportActive = isSpacesExportHovered || isSpacesExportMenuOpen;

  return (
    <div ref={mobilePanelRootRef} className={mobileMode ? 'mobile-spaces-panel' : undefined} style={{
      display: 'flex',
      flexDirection: 'column',
      height: mobileMode ? 'auto' : '100%',
      flex: mobileMode ? 1 : undefined,
      minHeight: 0,
      fontFamily: FONT_FAMILY,
      background: mobileMode ? 'var(--surface-2)' : 'var(--surface-1)'
    }}>
      {/* Header */}
      <div className={mobileMode ? 'mobile-spaces-header' : undefined} style={{
        padding: '12px',
        height: '50px',
        boxSizing: 'border-box',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <div className={mobileMode ? 'mobile-spaces-title' : undefined}>
          <h3 style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: '600',
            color: 'var(--text-2)',
            lineHeight: 1
          }}>
            Spaces
          </h3>
          {mobileMode ? (
            <span>{isRegionSelectionActive ? 'Region active' : (activeSpaceId || selectedSpaceId) ? 'Space active' : 'No space active'}</span>
          ) : null}
        </div>

        <div className="spaces-header-actions">
          <button
            type="button"
            onClick={handleCreateSpace}
            className="survey-marker-category-create-button"
            {...tip(canManageSpaces ? 'Create space' : 'Upgrade to Pro to create spaces', 'below')}
            aria-label={canManageSpaces ? 'Create space' : 'Upgrade to Pro to create spaces'}
          >
            <Icon name="plus" size={14} />
          </button>
          <div
            ref={spacesExportAnchorRef}
            style={{ position: 'relative', display: 'inline-flex' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Future: replace this compact menu with a custom Spaces export panel that lets users choose which space to export. */}
            <button
              type="button"
              className={`spaces-header-export-button${isSpacesExportActive ? ' is-active' : ''}`}
              {...tip(spacesExportTarget ? `Export ${spacesExportTarget.name || 'space'}` : 'Create a space to export', 'below')}
              aria-label={spacesExportTarget ? `Export ${spacesExportTarget.name || 'space'}` : 'Create a space to export'}
              aria-expanded={isSpacesExportMenuOpen}
              disabled={!spacesExportTarget}
              onClick={() => {
                if (!spacesExportTarget) return;
                if (!features?.excelExport) {
                  showToast('Exporting spaces is a Pro feature.', 'error');
                  return;
                }
                setIsSpacesExportMenuOpen((open) => !open);
              }}
              onMouseEnter={(e) => {
                tip(spacesExportTarget ? `Export ${spacesExportTarget.name || 'space'}` : 'Create a space to export', 'below').onMouseEnter(e);
                setIsSpacesExportHovered(true);
              }}
              onMouseLeave={(e) => {
                tip(spacesExportTarget ? `Export ${spacesExportTarget.name || 'space'}` : 'Create a space to export', 'below').onMouseLeave(e);
                setIsSpacesExportHovered(false);
              }}
            >
              <Icon name="upload" size={14} />
            </button>
            {isSpacesExportMenuOpen && spacesExportTarget && (
              <div className="spaces-header-export-menu" role="menu">
                <button
                  type="button"
                  className="spaces-header-export-menu-button"
                  onClick={() => {
                    setIsSpacesExportMenuOpen(false);
                    onExportSpaceCSV?.(spacesExportTarget.id);
                  }}
                >
                  CSV
                </button>
                <button
                  type="button"
                  className="spaces-header-export-menu-button"
                  {...tip('Exports base PDF pages only; app annotations are not embedded.', 'below')}
                  onClick={() => {
                    setIsSpacesExportMenuOpen(false);
                    onExportSpacePDF?.(spacesExportTarget.id);
                  }}
                >
                  PDF Pages
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Spaces List */}
      <div ref={mobileSpacesListRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px'
      }}>
        {spaces.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--text-3)',
            fontSize: '13px'
          }}>
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
            gap={8}
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
    </div>
  );
};

export default SpacesPanel;
