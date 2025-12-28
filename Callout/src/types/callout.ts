export interface Point {
  x: number;
  y: number;
}

export interface CalloutStyle {
  borderColor: string;
  borderOpacity: number;
  lineThickness: number;
  fillColor: string;
  fillOpacity: number;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  textAlign: 'left' | 'center' | 'right';
}

export interface Callout {
  id: string;
  arrowTip: Point;
  knee: Point;
  textBoxPosition: Point;
  textBoxWidth: number;
  textBoxHeight: number;
  text: string;
  style: CalloutStyle;
  isSelected: boolean;
}

export type DragTarget = 
  | { type: 'none' }
  | { type: 'arrowTip'; calloutId: string }
  | { type: 'knee'; calloutId: string }
  | { type: 'textBox'; calloutId: string }
  | { type: 'whole'; calloutId: string }
  | { type: 'textBoxCorner'; calloutId: string; corner: 'nw' | 'ne' | 'se' | 'sw' };

export interface CreationState {
  isCreating: boolean;
  arrowTip: Point | null;
  currentMouse: Point | null;
}

export const defaultCalloutStyle: CalloutStyle = {
  borderColor: '#1e293b',
  borderOpacity: 1,
  lineThickness: 2,
  fillColor: '#fef3c7',
  fillOpacity: 1,
  fontFamily: 'Inter',
  fontSize: 14,
  fontColor: '#1e293b',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  textAlign: 'left',
};
