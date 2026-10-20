// KAL-407 — the Symbols tool: a panel of engineering symbols and the press
// that places the chosen one on the page.
//
// While the tool is armed (activeTool === 'symbol') the panel is open. Pick a
// symbol and a colour, then click (or tap) the page: the symbol lands centred
// on that point, as one undoable mark. A drag is not a place: on a phone a
// finger drag still scrolls the page. The viewer does the saving (onPlace).
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icons.jsx';
import {
  SYMBOL_CATEGORIES, SYMBOL_COLORS, getSymbol, symbolDataUrl, symbolsInCategory,
} from '../utils/symbolLibrary.js';
import { screenToSVG } from '../utils/svgTransformMath.js';
import './SymbolStampTool.css';

const CHOICE_KEY = 'survey:symbol-stamp-choice';
const COLOR_NAMES = { '#e11d48': 'Red', '#111111': 'Black', '#2563eb': 'Blue' };
const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 700;
// Presses on these are never a place: the panel itself, tool bars, any control.
const NOT_A_PLACE = 'button, input, select, textarea, a[href], [role="dialog"], [role="menu"], [data-symbol-stamp-panel], [data-chrome-strip], [data-pan-interactive="true"]';

const tapVerb = () => {
  try { return window.matchMedia?.('(pointer: coarse)')?.matches ? 'Tap' : 'Click'; } catch { return 'Click'; }
};

const readChoice = () => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(CHOICE_KEY) || 'null');
    if (saved && getSymbol(saved.symbolId)) {
      return { symbolId: saved.symbolId, color: SYMBOL_COLORS.includes(saved.color) ? saved.color : SYMBOL_COLORS[0] };
    }
  } catch { /* no saved choice */ }
  return { symbolId: symbolsInCategory(SYMBOL_CATEGORIES[0].id)[0].id, color: SYMBOL_COLORS[0] };
};

/**
 * Where a press at (clientX, clientY) lands: the page under it and the point
 * in that page's units (the annotation layer's viewBox, so zoom and view
 * rotation are already undone). Null off the page or on a control.
 */
export function resolveSymbolPlacement(doc, clientX, clientY) {
  const hit = doc.elementFromPoint?.(clientX, clientY);
  if (!hit || hit.closest?.(NOT_A_PLACE)) return null;
  const pageEl = hit.closest?.('.survey-pdfjs-page-div[data-page-number]');
  if (!pageEl) return null;
  const pageNumber = Number(pageEl.getAttribute('data-page-number'));
  const svg = doc.querySelector(`svg[data-svg-annotation-layer="${pageNumber}"]`);
  const viewBox = svg?.viewBox?.baseVal;
  if (!svg || !viewBox?.width || !viewBox?.height) return null;
  const point = screenToSVG(svg, clientX, clientY);
  if (!(point.x >= 0 && point.y >= 0 && point.x <= viewBox.width && point.y <= viewBox.height)) return null;
  return { pageNumber, x: point.x, y: point.y };
}

export default function SymbolStampTool({ active, onPlace, onClose }) {
  const [choice, setChoice] = useState(readChoice);
  const [category, setCategory] = useState(() => getSymbol(choice.symbolId)?.category || SYMBOL_CATEGORIES[0].id);
  const choiceRef = useRef(choice);
  const onPlaceRef = useRef(onPlace);
  choiceRef.current = choice;
  onPlaceRef.current = onPlace;

  useEffect(() => {
    try { globalThis.localStorage?.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* session only */ }
  }, [choice]);

  useEffect(() => {
    if (!active) return undefined;
    let press = null;
    const onDown = (event) => {
      if (event.button > 0 || event.isPrimary === false) { press = null; return; }
      // Both ends of the tap must be a page target: a press that starts on the
      // panel or a tool control is never a place, even if it slips onto the page.
      if (!resolveSymbolPlacement(document, event.clientX, event.clientY)) { press = null; return; }
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() };
    };
    const swallowClick = (event) => { event.stopPropagation(); event.preventDefault(); };
    const onUp = (event) => {
      const start = press;
      press = null;
      if (!start || event.pointerId !== start.id) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
      if (Date.now() - start.at > TAP_MAX_MS) return;
      const spot = resolveSymbolPlacement(document, event.clientX, event.clientY);
      if (!spot) return;
      event.stopPropagation();
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallowClick, true), 400);
      onPlaceRef.current?.({ ...spot, ...choiceRef.current });
    };
    const onCancel = () => { press = null; };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [active]);

  if (!active) return null;
  const chosen = getSymbol(choice.symbolId);
  return (
    <div className="symbol-stamp-panel" data-symbol-stamp-panel="true" role="region" aria-label="Symbols">
      <div className="symbol-stamp-head">
        <span>Symbols</span>
        <span className="symbol-stamp-hint" data-symbol-stamp-hint="true">
          {chosen ? `${tapVerb()} the page to place: ${chosen.label}` : 'Pick a symbol'}
        </span>
        <button type="button" className="btn btn-ghost" aria-label="Close Symbols" onClick={onClose} style={{ padding: 4 }}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="symbol-stamp-tabs" role="tablist">
        {SYMBOL_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            data-symbol-category={cat.id}
            className={`btn ${category === cat.id ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setCategory(cat.id)}
          >
            {cat.label}
            <small>{cat.standard}</small>
          </button>
        ))}
      </div>
      <div className="symbol-stamp-grid" role="tabpanel">
        {symbolsInCategory(category).map((symbol) => (
          <button
            key={symbol.id}
            type="button"
            data-symbol-id={symbol.id}
            aria-pressed={choice.symbolId === symbol.id}
            className={`btn ${choice.symbolId === symbol.id ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setChoice((prev) => ({ ...prev, symbolId: symbol.id }))}
          >
            <img src={symbolDataUrl(symbol, '#111111')} alt="" draggable={false} />
            {symbol.label}
          </button>
        ))}
      </div>
      <div className="symbol-stamp-colors">
        Colour
        {SYMBOL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={COLOR_NAMES[color] || color}
            aria-pressed={choice.color === color}
            data-symbol-color={color}
            style={{ background: color }}
            onClick={() => setChoice((prev) => ({ ...prev, color }))}
          />
        ))}
      </div>
    </div>
  );
}
