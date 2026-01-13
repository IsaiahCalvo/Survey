export interface Point {
  x: number;
  y: number;
}

export interface CalloutStyle {
  borderColor: string;
  lineThickness: number;
  fillColor: string;
  opacity: number;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
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
  lineThickness: 2,
  fillColor: 'transparent',
  opacity: 1,
  fontFamily: 'Inter',
  fontSize: 14,
  fontColor: '#1e293b',
  bold: false,
  italic: false,
};

// Line and Arrow types
export interface LineStyle {
  color: string;
  lineThickness: number;
  opacity: number;
}

export interface Line {
  id: string;
  start: Point;
  end: Point;
  midpoint: Point;
  style: LineStyle;
  isSelected: boolean;
}

export interface Arrow {
  id: string;
  start: Point;
  end: Point;
  midpoint: Point;
  style: LineStyle;
  isSelected: boolean;
}

export const defaultLineStyle: LineStyle = {
  color: '#1e293b',
  lineThickness: 2,
  opacity: 1,
};
