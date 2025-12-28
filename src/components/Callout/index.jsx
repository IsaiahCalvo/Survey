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
 * @param {Function} props.onSave - Callback when callouts change (for persistence)
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
  onSave,
}) => {
  const selectedCallout = callouts.find(c => c.id === selectedCalloutId) || null;

  // Handle deleting selected callout
  const handleDeleteSelected = useCallback(() => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.filter(c => c.id !== selectedCalloutId));
      setSelectedCalloutId(null);
      if (onSave) onSave();
    }
  }, [selectedCalloutId, setCallouts, setSelectedCalloutId, onSave]);

  // Handle updating callout style
  const handleUpdateStyle = useCallback((updates) => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.map(c =>
        c.id === selectedCalloutId
          ? { ...c, style: { ...c.style, ...updates } }
          : c
      ));
      if (onSave) onSave();
    }
  }, [selectedCalloutId, setCallouts, onSave]);

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

  // Trigger save when callouts change
  useEffect(() => {
    if (onSave) {
      onSave();
    }
  }, [callouts, onSave]);

  return (
    <>
      {/* Callout Canvas Overlay */}
      <CalloutCanvas
        callouts={callouts}
        setCallouts={setCallouts}
        selectedCalloutId={selectedCalloutId}
        setSelectedCalloutId={setSelectedCalloutId}
        isCalloutToolActive={isCalloutToolActive}
        activeTool={activeTool}
        pageNumber={pageNumber}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        defaultStyle={defaultStyle}
      />

      {/* Properties Panel - slides in from right when callout selected */}
      {selectedCalloutId && (
        <CalloutPropertiesPanel
          selectedCallout={selectedCallout}
          onUpdateStyle={handleUpdateStyle}
          onClose={handleClosePanel}
        />
      )}
    </>
  );
};

export default CalloutOverlay;
