import React from 'react';
import { MessageSquare, Trash2, MousePointer2, Minus, MoveUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ToolType = 'select' | 'callout' | 'line' | 'arrow';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  setActiveTool,
  onDeleteSelected,
  hasSelection,
}) => {
  return (
    <div className="flex items-center h-12 px-4 bg-toolbar-bg border-b border-toolbar-border">
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === 'select' ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTool('select')}
              className="gap-2"
            >
              <MousePointer2 className="w-4 h-4" />
              <span className="text-sm font-medium">Select</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Select and edit callouts (V)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === 'callout' ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTool('callout')}
              className="gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-sm font-medium">Text Callout</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click and drag to create a text callout (Q)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === 'line' ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTool('line')}
              className="gap-2"
            >
              <Minus className="w-4 h-4" />
              <span className="text-sm font-medium">Line</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click and drag to create a line (L)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === 'arrow' ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTool('arrow')}
              className="gap-2"
            >
              <MoveUpRight className="w-4 h-4" />
              <span className="text-sm font-medium">Arrow</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click and drag to create an arrow (A)</p>
          </TooltipContent>
        </Tooltip>

        <div className="w-px h-6 bg-toolbar-border mx-2" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDeleteSelected}
              disabled={!hasSelection}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Delete selected item (Delete)</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="ml-auto text-xs text-muted-foreground">
        <span className="px-2 py-1 bg-muted rounded">Ctrl/Cmd + Drag</span> to move entire callout
      </div>
    </div>
  );
};
