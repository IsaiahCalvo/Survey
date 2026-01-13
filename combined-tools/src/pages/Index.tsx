import React, { useState, useCallback } from 'react';
import { FabricPDFCanvas } from '@/components/FabricPDFCanvas';
import { Toolbar, ToolType } from '@/components/Toolbar';
import { Callout, Line, Arrow } from '@/types/callout';

const Index: React.FC = () => {
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('select');

  const handleDeleteSelected = useCallback(() => {
    if (selectedCalloutId) {
      setCallouts(prev => prev.filter(c => c.id !== selectedCalloutId));
      setSelectedCalloutId(null);
    }
    if (selectedLineId) {
      setLines(prev => prev.filter(l => l.id !== selectedLineId));
      setSelectedLineId(null);
    }
    if (selectedArrowId) {
      setArrows(prev => prev.filter(a => a.id !== selectedArrowId));
      setSelectedArrowId(null);
    }
  }, [selectedCalloutId, selectedLineId, selectedArrowId]);

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

      // 'L' key: Switch to Line Tool
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setActiveTool('line');
        return;
      }

      // 'A' key: Switch to Arrow Tool
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setActiveTool('arrow');
        return;
      }

      // Delete/Backspace: Delete selected item
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
        return;
      }

      // Escape: Deselect and switch to Select Tool
      if (e.key === 'Escape') {
        setSelectedCalloutId(null);
        setSelectedLineId(null);
        setSelectedArrowId(null);
        setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
        setLines(prev => prev.map(l => ({ ...l, isSelected: false })));
        setArrows(prev => prev.map(a => ({ ...a, isSelected: false })));
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
        <h1 className="text-lg font-semibold text-foreground">Annotation Tools</h1>
      </header>

      {/* Toolbar */}
      <Toolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        onDeleteSelected={handleDeleteSelected}
        hasSelection={!!(selectedCalloutId || selectedLineId || selectedArrowId)}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <FabricPDFCanvas
          callouts={callouts}
          setCallouts={setCallouts}
          lines={lines}
          setLines={setLines}
          arrows={arrows}
          setArrows={setArrows}
          selectedCalloutId={selectedCalloutId}
          setSelectedCalloutId={setSelectedCalloutId}
          selectedLineId={selectedLineId}
          setSelectedLineId={setSelectedLineId}
          selectedArrowId={selectedArrowId}
          setSelectedArrowId={setSelectedArrowId}
          activeTool={activeTool}
        />
      </div>
    </div>
  );
};

export default Index;
