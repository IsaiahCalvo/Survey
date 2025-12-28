import React, { useState } from 'react';
import { Callout, CalloutStyle } from '@/types/callout';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Bold, Italic, Underline, Strikethrough, Square, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

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
  const [colorMode, setColorMode] = useState<'border' | 'fill'>('border');

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

      <div className="p-3">
        <Accordion type="single" collapsible className="w-full">
          {/* Visual Settings Group */}
          <AccordionItem value="visual-settings">
            <AccordionTrigger className="text-xs font-semibold py-2">
              Visual Settings
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-1">
                {/* Color Picker with Toggle */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">COLOR</Label>
                    <div className="flex gap-1">
                      <Button
                        variant={colorMode === 'border' ? "default" : "outline"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setColorMode('border')}
                      >
                        Border
                      </Button>
                      <Button
                        variant={colorMode === 'fill' ? "default" : "outline"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setColorMode('fill')}
                      >
                        Fill
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(colorMode === 'border' ? presetColors : fillColors).map((color) => {
                      const isSelected = colorMode === 'border' 
                        ? style.borderColor === color 
                        : style.fillColor === color;
                      return (
                        <button
                          key={color}
                          className={`w-6 h-6 rounded border transition-all flex items-center justify-center ${
                            isSelected ? 'border-primary scale-105' : colorMode === 'fill' ? 'border-border' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color === 'transparent' ? 'transparent' : color }}
                          onClick={() => {
                            if (colorMode === 'border') {
                              onUpdateStyle({ borderColor: color });
                            } else {
                              onUpdateStyle({ fillColor: color });
                            }
                          }}
                        >
                          {color === 'transparent' && (
                            <Square className="w-3 h-3 text-muted-foreground" strokeDasharray="3 3" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    type="color"
                    value={colorMode === 'border' ? style.borderColor : style.fillColor}
                    onChange={(e) => {
                      if (colorMode === 'border') {
                        onUpdateStyle({ borderColor: e.target.value });
                      } else {
                        onUpdateStyle({ fillColor: e.target.value });
                      }
                    }}
                    className="h-7 w-full"
                  />
                </div>

                {/* Opacity */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">OPACITY</Label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[colorMode === 'border' ? style.borderOpacity * 100 : style.fillOpacity * 100]}
                      onValueChange={([value]) => {
                        if (colorMode === 'border') {
                          onUpdateStyle({ borderOpacity: value / 100 });
                        } else {
                          onUpdateStyle({ fillOpacity: value / 100 });
                        }
                      }}
                      min={20}
                      max={100}
                      step={5}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min={20}
                      max={100}
                      value={Math.round((colorMode === 'border' ? style.borderOpacity : style.fillOpacity) * 100)}
                      onChange={(e) => {
                        const value = Math.max(20, Math.min(100, Number(e.target.value) || 20));
                        if (colorMode === 'border') {
                          onUpdateStyle({ borderOpacity: value / 100 });
                        } else {
                          onUpdateStyle({ fillOpacity: value / 100 });
                        }
                      }}
                      className="h-7 w-14 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-xs font-medium">%</span>
                  </div>
                </div>

                {/* Line Thickness */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">LINE THICKNESS</Label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[style.lineThickness]}
                      onValueChange={([value]) => onUpdateStyle({ lineThickness: value })}
                      min={1}
                      max={6}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={6}
                      value={style.lineThickness}
                      onChange={(e) => {
                        const value = Math.max(1, Math.min(6, Number(e.target.value) || 1));
                        onUpdateStyle({ lineThickness: value });
                      }}
                      className="h-7 w-14 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-xs font-medium">px</span>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Text Settings Group */}
          <AccordionItem value="text-settings">
            <AccordionTrigger className="text-xs font-semibold py-2">
              Text Settings
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-1">
                {/* Font Family & Size */}
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">FONT</Label>
                      <Select
                        value={style.fontFamily}
                        onValueChange={(value) => onUpdateStyle({ fontFamily: value })}
                      >
                        <SelectTrigger className="h-8 text-xs">
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
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">SIZE</Label>
                      <Select
                        value={String(style.fontSize)}
                        onValueChange={(value) => onUpdateStyle({ fontSize: Number(value) })}
                      >
                        <SelectTrigger className="h-8 text-xs">
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
                  </div>
                </div>

                {/* Text Alignment */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">TEXT ALIGNMENT</Label>
                  <div className="flex gap-1.5">
                    <Button
                      variant={(style.textAlign || 'left') === 'left' ? "default" : "outline"}
                      size="sm"
                      className="h-7 flex-1"
                      onClick={() => onUpdateStyle({ textAlign: 'left' })}
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant={(style.textAlign || 'left') === 'center' ? "default" : "outline"}
                      size="sm"
                      className="h-7 flex-1"
                      onClick={() => onUpdateStyle({ textAlign: 'center' })}
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant={(style.textAlign || 'left') === 'right' ? "default" : "outline"}
                      size="sm"
                      className="h-7 flex-1"
                      onClick={() => onUpdateStyle({ textAlign: 'right' })}
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Bold, Italic, Underline & Strikethrough */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">STYLE</Label>
                  <div className="flex gap-1.5">
                    <Button
                      variant={style.bold ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => onUpdateStyle({ bold: !style.bold })}
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant={style.italic ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => onUpdateStyle({ italic: !style.italic })}
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant={style.underline ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => onUpdateStyle({ underline: !style.underline })}
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant={style.strikethrough ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => onUpdateStyle({ strikethrough: !style.strikethrough })}
                    >
                      <Strikethrough className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Font Color */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">TEXT COLOR</Label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {presetColors.map((color) => (
                      <button
                        key={color}
                        className={`w-6 h-6 rounded border transition-all ${
                          style.fontColor === color ? 'border-primary scale-105' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => onUpdateStyle({ fontColor: color })}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
};
