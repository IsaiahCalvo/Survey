import React, { useState, useCallback } from 'react';
import { PDFCanvas } from '@/components/PDFCanvas';
import { Toolbar, ToolType } from '@/components/Toolbar';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { Callout, CalloutStyle } from '@/types/callout';

const Index: React.FC = () => {
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('callout');

  const selectedCallout = callouts.find(c => c.id === selectedCalloutId) || null;

  const handleDeleteSelected = useCallback(() => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.filter(c => c.id !== selectedCalloutId));
      setSelectedCalloutId(null);
    }
  }, [selectedCalloutId]);

  const handleUpdateStyle = useCallback((updates: Partial<CalloutStyle>) => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.map(c => 
        c.id === selectedCalloutId 
          ? { ...c, style: { ...c.style, ...updates } }
          : c
      ));
    }
  }, [selectedCalloutId]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only delete if not focused on textarea
        if (document.activeElement?.tagName !== 'TEXTAREA') {
          handleDeleteSelected();
        }
      }
      if (e.key === 'Escape') {
        setSelectedCalloutId(null);
        setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteSelected]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-14 px-6 flex items-center border-b border-border bg-card">
        <h1 className="text-lg font-semibold text-foreground">PDF Annotation Sandbox</h1>
        <span className="ml-3 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          Text Callout Tool
        </span>
      </header>

      {/* Toolbar */}
      <Toolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        onDeleteSelected={handleDeleteSelected}
        hasSelection={!!selectedCalloutId}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <PDFCanvas
          callouts={callouts}
          setCallouts={setCallouts}
          selectedCalloutId={selectedCalloutId}
          setSelectedCalloutId={setSelectedCalloutId}
          activeTool={activeTool}
        />
        {selectedCalloutId && (
          <PropertiesPanel
            selectedCallout={selectedCallout}
            onUpdateStyle={handleUpdateStyle}
          />
        )}
      </div>
    </div>
  );
};

export default Index;
