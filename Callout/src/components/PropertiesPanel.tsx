import React from 'react';
import { Callout, CalloutStyle } from '@/types/callout';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bold, Italic, Square } from 'lucide-react';

interface PropertiesPanelProps {
  selectedCallout: Callout | null;
  onUpdateStyle: (updates: Partial<CalloutStyle>) => void;
}

const fontFamilies = [
  'Inter',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
];

const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32];

const presetColors = [
  '#1e293b', // slate-800
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#2563eb', // blue-600
  '#9333ea', // purple-600
  '#ea580c', // orange-600
  '#0891b2', // cyan-600
  '#000000', // black
];

const fillColors = [
  '#fef3c7', // amber-100
  '#fee2e2', // red-100
  '#dcfce7', // green-100
  '#dbeafe', // blue-100
  '#f3e8ff', // purple-100
  '#ffedd5', // orange-100
  '#cffafe', // cyan-100
  '#ffffff', // white
  'transparent',
];

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedCallout,
  onUpdateStyle,
}) => {
  if (!selectedCallout) {
    return (
      <div className="w-64 bg-card border-l border-border p-4">
        <p className="text-sm text-muted-foreground text-center py-8">
          Select a callout to edit its properties
        </p>
      </div>
    );
  }

  const { style } = selectedCallout;

  return (
    <div className="w-64 bg-card border-l border-border overflow-y-auto">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-sm">Properties</h3>
      </div>

      <div className="p-4 space-y-6">
        {/* Border Color */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">BORDER COLOR</Label>
          <div className="grid grid-cols-4 gap-2">
            {presetColors.map((color) => (
              <button
                key={color}
                className={`w-8 h-8 rounded border-2 transition-all ${
                  style.borderColor === color ? 'border-primary scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => onUpdateStyle({ borderColor: color })}
              />
            ))}
          </div>
          <Input
            type="color"
            value={style.borderColor}
            onChange={(e) => onUpdateStyle({ borderColor: e.target.value })}
            className="h-8 w-full"
          />
        </div>

        {/* Line Thickness */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">LINE THICKNESS</Label>
          <div className="flex items-center gap-3">
            <Slider
              value={[style.lineThickness]}
              onValueChange={([value]) => onUpdateStyle({ lineThickness: value })}
              min={1}
              max={6}
              step={1}
              className="flex-1"
            />
            <span className="text-sm font-medium w-6 text-right">{style.lineThickness}px</span>
          </div>
        </div>

        {/* Fill Color */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">FILL COLOR</Label>
          <div className="grid grid-cols-4 gap-2">
            {fillColors.map((color) => (
              <button
                key={color}
                className={`w-8 h-8 rounded border-2 transition-all flex items-center justify-center ${
                  style.fillColor === color ? 'border-primary scale-110' : 'border-border'
                }`}
                style={{ backgroundColor: color === 'transparent' ? 'transparent' : color }}
                onClick={() => onUpdateStyle({ fillColor: color })}
              >
                {color === 'transparent' && (
                  <Square className="w-4 h-4 text-muted-foreground" strokeDasharray="3 3" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Opacity */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">OPACITY</Label>
          <div className="flex items-center gap-3">
            <Slider
              value={[style.opacity * 100]}
              onValueChange={([value]) => onUpdateStyle({ opacity: value / 100 })}
              min={20}
              max={100}
              step={5}
              className="flex-1"
            />
            <span className="text-sm font-medium w-10 text-right">{Math.round(style.opacity * 100)}%</span>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Font Family */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">FONT</Label>
          <Select
            value={style.fontFamily}
            onValueChange={(value) => onUpdateStyle({ fontFamily: value })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fontFamilies.map((font) => (
                <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">SIZE</Label>
          <Select
            value={String(style.fontSize)}
            onValueChange={(value) => onUpdateStyle({ fontSize: Number(value) })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fontSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Font Color */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">TEXT COLOR</Label>
          <div className="grid grid-cols-4 gap-2">
            {presetColors.map((color) => (
              <button
                key={color}
                className={`w-8 h-8 rounded border-2 transition-all ${
                  style.fontColor === color ? 'border-primary scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => onUpdateStyle({ fontColor: color })}
              />
            ))}
          </div>
        </div>

        {/* Bold & Italic */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">STYLE</Label>
          <div className="flex gap-2">
            <Button
              variant={style.bold ? "default" : "outline"}
              size="sm"
              onClick={() => onUpdateStyle({ bold: !style.bold })}
            >
              <Bold className="w-4 h-4" />
            </Button>
            <Button
              variant={style.italic ? "default" : "outline"}
              size="sm"
              onClick={() => onUpdateStyle({ italic: !style.italic })}
            >
              <Italic className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
