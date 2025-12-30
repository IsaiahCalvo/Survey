import React, { useCallback, useEffect } from 'react';
import CalloutCanvas from './CalloutCanvas';
import CalloutPropertiesPanel from './CalloutPropertiesPanel';

export { defaultCalloutStyle, createCallout, hexToRgba } from './types';

/**
 * CalloutOverlay - Main orchestrator for the callout system
 * Renders the callout canvas overlay and properties panel
 *
 * @param {Object} props
 * @param {Array} props.callouts - Array of all callout objects
 * @param {Function} props.setCallouts - Update callouts
 * @param {string|null} props.selectedCalloutId - Currently selected callout ID
 * @param {Function} props.setSelectedCalloutId - Set selected callout
 * @param {boolean} props.isCalloutToolActive - Whether callout tool is selected
 * @param {number} props.pageNumber - Current page number (1-indexed)
 * @param {number} props.pageWidth - Page width in pixels at current scale
 * @param {number} props.pageHeight - Page height in pixels at current scale
 * @param {Object} props.defaultStyle - Default style for new callouts (optional)
 * @param {Object} props.middleAreaBounds - Bounds of the middle area ({top, height})
 * @param {number} props.surveyPanelWidth - Width of survey panel (0 when closed, 320 when open, 48 when collapsed)
 */
const CalloutOverlay = ({
  callouts,
  setCallouts,
  selectedCalloutId,
  setSelectedCalloutId,
  isCalloutToolActive,
  activeTool,
  pageNumber,
  pageWidth,
  pageHeight,
  defaultStyle,
  selectionRect,
  selectedSpaceId,
  selectedModuleId,
  showSurveyPanel,
  middleAreaBounds,
  surveyPanelWidth,
  onCalloutRightClick,
}) => {
  const selectedCallout = callouts.find(c => c.id === selectedCalloutId) || null;

  // Handle deleting selected callout
  const handleDeleteSelected = useCallback(() => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.filter(c => c.id !== selectedCalloutId));
      setSelectedCalloutId(null);
    }
  }, [selectedCalloutId, setCallouts, setSelectedCalloutId]);

  // Handle updating callout style
  const handleUpdateStyle = useCallback((updates) => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.map(c =>
        c.id === selectedCalloutId
          ? { ...c, style: { ...c.style, ...updates } }
          : c
      ));
    }
  }, [selectedCalloutId, setCallouts]);

  // Handle closing properties panel
  const handleClosePanel = useCallback(() => {
    setSelectedCalloutId(null);
    setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
  }, [setSelectedCalloutId, setCallouts]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Delete or Backspace - delete selected callout
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only delete if not focused on textarea or other input
        const tagName = document.activeElement?.tagName.toLowerCase();
        if (tagName !== 'textarea' && tagName !== 'input') {
          if (selectedCalloutId) {
            e.preventDefault();
            handleDeleteSelected();
          }
        }
      }

      // Escape - deselect callout
      if (e.key === 'Escape') {
        if (selectedCalloutId) {
          setSelectedCalloutId(null);
          setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCalloutId, handleDeleteSelected, setSelectedCalloutId, setCallouts]);

  // Note: Callout saves are handled by setCallouts in App.jsx
  // The onSave prop here was incorrectly calling the annotation save function
  // without proper arguments. Removed to prevent interference.

  return (
    <>
      {/* Callout Canvas Overlay */}
      <CalloutCanvas
        callouts={callouts.filter(c => {
          // Filter by survey mode: if survey mode is active, hide callouts that don't have matching moduleId
          // Note: Callouts created via Fabric.js (old system) may have moduleId, but React callouts don't yet
          // For React callouts, hide all when in survey mode (they'll need moduleId added in the future)
          if (showSurveyPanel && selectedModuleId) {
            // If callout has moduleId, only show if it matches selected module
            // If callout doesn't have moduleId, hide it in survey mode (it was created outside survey mode)
            return c.moduleId === selectedModuleId;
          }
          // When not in survey mode, show all callouts
          return true;
        })}
        setCallouts={setCallouts}
        selectedCalloutId={selectedCalloutId}
        setSelectedCalloutId={setSelectedCalloutId}
        isCalloutToolActive={isCalloutToolActive}
        activeTool={activeTool}
        pageNumber={pageNumber}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        defaultStyle={defaultStyle}
        selectionRect={selectionRect}
        selectedSpaceId={selectedSpaceId}
        selectedModuleId={selectedModuleId}
        showSurveyPanel={showSurveyPanel}
        onCalloutRightClick={onCalloutRightClick}
      />

      {/* Properties Panel - slides in from right when callout selected */}
      {selectedCalloutId && (
        <CalloutPropertiesPanel
          selectedCallout={selectedCallout}
          onUpdateStyle={handleUpdateStyle}
          onClose={handleClosePanel}
          middleAreaBounds={middleAreaBounds}
          surveyPanelWidth={surveyPanelWidth}
        />
      )}
    </>
  );
};

export default CalloutOverlay;
