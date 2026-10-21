// Schematic Mode badge (KAL-402 / F12).
//
// Sits in the top-right corner of a page the detector reads as a drawing
// (utils/schematicPageDetection.js). Pressing it opens a small panel with the
// tools for marking up drawings (Callout, Arrow, Cloud) and a way to turn
// Schematic Mode off on a page the detector got wrong. Pages that are not
// drawings show nothing.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import Icon from '../Icons.jsx';
import { readPdfjsTextContent } from '../utils/pdfjsTextContent.js';
import { watchLightPopover } from './dismissRules.js';
import {
  configureSchematicDetection, getSchematicResult, getSchematicStoreVersion,
  isSchematicTurnedOff, requestSchematicDetection, setSchematicTurnedOff, subscribeSchematicPages,
} from '../utils/schematicPageStore.js';

configureSchematicDetection({ ops: pdfjsLib.OPS, readTextContent: readPdfjsTextContent });

export const SCHEMATIC_QUICK_TOOLS = Object.freeze([
  { id: 'callout', label: 'Callout', icon: 'callout' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow' },
  { id: 'cloud', label: 'Cloud', icon: 'lineSampleCloud' },
]);

const KIND_TEXT = {
  raster: 'This page is a picture with no text on it.',
  vector: 'This page is drawn with lines and has only labels.',
  mixed: 'This page is a picture with lines drawn over it.',
};

// Above the page's annotation layer (z 95 / 105 in PDFViewer), so the badge
// stays pressable while a drawing tool is armed.
const SCHEMATIC_BADGE_Z = 120;

const stop = (event) => event.stopPropagation();
const shield = { onPointerDown: stop, onMouseDown: stop, onTouchStart: stop, onClick: stop, onDoubleClick: stop };

const pillStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px 0 7px',
  border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)',
  color: 'var(--text-2)', font: '500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)', cursor: 'pointer', whiteSpace: 'nowrap',
};

// Off by default: the owner did not want the badge shown. Nothing renders and
// no page detection runs unless a viewer opts in with
// localStorage['survey.schematicMode'] = '1'.
export const SCHEMATIC_MODE_ENABLED = false;
export const SCHEMATIC_MODE_OPT_IN_KEY = 'survey.schematicMode';

export function isSchematicModeEnabled() {
  if (SCHEMATIC_MODE_ENABLED) return true;
  try {
    return globalThis.localStorage?.getItem(SCHEMATIC_MODE_OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SchematicModeBadge(props) {
  if (!isSchematicModeEnabled()) return null;
  return <SchematicModeBadgeBody {...props} />;
}

function SchematicModeBadgeBody({
  pdfDoc, pageNumber, fingerprint, activeTool, lineBorderStyle, onPickTool,
}) {
  useSyncExternalStore(subscribeSchematicPages, getSchematicStoreVersion, getSchematicStoreVersion);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => { requestSchematicDetection(pdfDoc, pageNumber); }, [pdfDoc, pageNumber]);

  // The app's light-popover contract (components/dismissRules.js): a press
  // outside closes the panel and still does its job, a press on bare page
  // only closes it, and Escape closes only the panel, not the armed tool.
  useEffect(() => {
    if (!open) return undefined;
    return watchLightPopover({
      contains: (element) => Boolean(rootRef.current?.contains(element)),
      close: () => setOpen(false),
    });
  }, [open]);

  // A page wider than the screen (landscape sheets on a phone) put the
  // top-right badge past the screen edge. Pull it left by the overflow so it
  // stays in view; it returns to the page corner once that corner is visible.
  const [shiftX, setShiftX] = useState(0);
  const shiftRef = useRef(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = root.getBoundingClientRect();
      const naturalRight = rect.right - shiftRef.current;
      const naturalLeft = rect.left - shiftRef.current;
      const limit = (document.documentElement.clientWidth || window.innerWidth) - 8;
      const next = naturalRight > limit ? Math.min(0, Math.max(limit - naturalRight, 8 - naturalLeft)) : 0;
      if (Math.abs(next - shiftRef.current) < 0.5) return;
      shiftRef.current = next;
      setShiftX(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'function' && root.offsetParent ? new ResizeObserver(schedule) : null;
    if (observer) observer.observe(root.offsetParent);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  });

  const result = getSchematicResult(pdfDoc, pageNumber);
  if (!result || result === 'pending' || !result.schematic) return null;
  const off = isSchematicTurnedOff(fingerprint, pageNumber);

  const isActive = (id) => (id === 'cloud'
    ? activeTool === 'rect' && lineBorderStyle === 'cloud'
    : activeTool === id);

  return (
    <div
      ref={rootRef}
      // The pan scroller and the finger rules leave presses here alone.
      data-pan-interactive="true"
      data-schematic-mode={off ? 'off' : 'on'}
      data-schematic-kind={result.kind}
      style={{ position: 'absolute', top: 10, right: 10, transform: shiftX ? `translateX(${shiftX}px)` : undefined, zIndex: SCHEMATIC_BADGE_Z, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}
      {...shield}
    >
      {off ? (
        <button
          type="button"
          data-schematic-badge="off"
          aria-label="Schematic Mode is off on this page. Turn it back on"
          title="Schematic Mode is off on this page. Click to turn it back on."
          onClick={(event) => { stop(event); setSchematicTurnedOff(fingerprint, pageNumber, false); }}
          style={{ ...pillStyle, width: 24, padding: 0, justifyContent: 'center', opacity: 0.55 }}
        >
          <Icon name="layers" size={14} />
        </button>
      ) : (
        <button
          type="button"
          data-schematic-badge="on"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="This page is a drawing. Click for drawing tools."
          onClick={(event) => { stop(event); setOpen((value) => !value); }}
          style={pillStyle}
        >
          <Icon name="layers" size={14} />
          Schematic Mode
        </button>
      )}
      {open && !off && (
        <div
          role="dialog"
          aria-label="Schematic Mode"
          data-schematic-panel="true"
          style={{
            width: 232, maxWidth: 'calc(100vw - 32px)', padding: 10, borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.28)', font: '12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Schematic Mode</div>
          <div style={{ color: 'var(--text-2)', marginBottom: 8 }}>
            {KIND_TEXT[result.kind] || 'This page is a drawing.'} Mark it up with these tools:
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {SCHEMATIC_QUICK_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                data-schematic-tool={tool.id}
                aria-pressed={isActive(tool.id)}
                onClick={(event) => { stop(event); onPickTool?.(tool.id); setOpen(false); }}
                className={`btn ${isActive(tool.id) ? 'btn-active' : 'btn-default'}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0', fontSize: 11 }}
              >
                <Icon name={tool.icon} size={16} />
                {tool.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-schematic-turn-off="true"
            onClick={(event) => { stop(event); setOpen(false); setSchematicTurnedOff(fingerprint, pageNumber, true); }}
            style={{ border: 0, padding: 0, background: 'none', color: 'var(--text-3)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >
            Not a drawing? Turn off on this page
          </button>
        </div>
      )}
    </div>
  );
}
