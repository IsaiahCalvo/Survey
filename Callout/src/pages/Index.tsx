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

  // Helper function to check if user is typing in an input field
  const isUserTyping = useCallback(() => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    
    const tagName = activeElement.tagName.toLowerCase();
    const isInput = tagName === 'input';
    const isTextarea = tagName === 'textarea';
    const isContentEditable = (activeElement as HTMLElement).isContentEditable || 
                              (activeElement as HTMLElement).contentEditable === 'true';
    
    // Check if it's a text input (not checkbox, radio, etc.)
    if (isInput) {
      const inputType = (activeElement as HTMLInputElement).type;
      const textInputTypes = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'];
      return textInputTypes.includes(inputType);
    }
    
    return isTextarea || isContentEditable;
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input field
      if (isUserTyping()) {
        return;
      }

      // 'V' key: Switch to Select Tool
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setActiveTool('select');
        return;
      }

      // 'Q' key: Switch to Text Callout Tool
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        setActiveTool('callout');
        return;
      }

      // Delete/Backspace: Delete selected callout
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
        return;
      }

      // Escape: Deselect and switch to Select Tool
      if (e.key === 'Escape') {
        setSelectedCalloutId(null);
        setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteSelected, isUserTyping]);

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
        <PropertiesPanel
          selectedCallout={selectedCallout}
          onUpdateStyle={handleUpdateStyle}
        />
      </div>
    </div>
  );
};

export default Index;
