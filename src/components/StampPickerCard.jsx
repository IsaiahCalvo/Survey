// Nightly 'stamp-tool': Drawboard Projects' Stamp picker (checked live
// 2026-11-10, /mnt/project-files/drawboard-trial/deep/stamps-and-captions.md).
//
//   - The Text group's Stamp button opens a 260 px card titled "Stamp" with
//     the twelve preset tiles, three to a row (drawboardStamps.js).
//   - Pick a tile (it gets a blue ring), then click the page: the stamp lands
//     centred on the click, and the tile stays picked, so each further click
//     drops another, as Drawboard's tool stays on. Esc or another tool lets go.
//   - A finger only pans (house rule), so on a touch screen a tap on a tile
//     drops the stamp in the middle of the page in view.
// Placement is the mark library's own (markLibraryPlacement.js): one save,
// one Undo step, and the new stamp becomes the selection.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { viewerBounds } from './SelectionQuickBar.jsx';
import {
  armLibraryItem,
  disarmLibraryItem,
  getArmedLibraryItem,
  placeLibraryItem,
  subscribeLibraryPlacement,
} from '../markLibrary/markLibraryPlacement.js';
import {
  STAMP_BOX,
  STAMP_FONT_SIZE,
  STAMP_LINE_GAP,
  STAMP_PRESET_COLOUR,
  isStampPresetItem,
  stampPresetItems,
} from '../markLibrary/drawboardStamps.js';
import './SelectionPropertiesPanel.css';
import './StampPickerCard.css';

const listeners = new Set();
let open = false;
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const isStampPickerOpen = () => open;
export function setStampPickerOpen(next) {
  const value = Boolean(next);
  if (value === open) return;
  open = value;
  if (!value && isStampPresetItem(getArmedLibraryItem()?.item)) disarmLibraryItem();
  listeners.forEach((listener) => listener());
}
export const useStampPickerOpen = () => useSyncExternalStore(subscribe, isStampPickerOpen, () => false);

const useArmedId = () => useSyncExternalStore(
  subscribeLibraryPlacement,
  () => getArmedLibraryItem()?.item?.id || null,
  () => null,
);

/** One preset drawn as it lands, at its own page units (120 x 60 pt box). */
function StampTile({ item }) {
  const n = item.lines.length;
  const first = STAMP_BOX.height / 2 - ((n - 1) * STAMP_LINE_GAP) / 2;
  return (
    <svg className="stamp-card__stamp" viewBox={`-2 -2 ${STAMP_BOX.width + 4} ${STAMP_BOX.height + 4}`} aria-hidden="true">
      <rect x="0" y="0" width={STAMP_BOX.width} height={STAMP_BOX.height} fill="none" stroke={STAMP_PRESET_COLOUR} strokeWidth="2" />
      {item.lines.map((line, i) => (
        <text
          key={line}
          x={STAMP_BOX.width / 2}
          y={first + i * STAMP_LINE_GAP}
          fill={STAMP_PRESET_COLOUR}
          fontSize={STAMP_FONT_SIZE}
          fontFamily="Helvetica"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {line}
        </text>
      ))}
    </svg>
  );
}

export default function StampPickerCard({ enabled = false, phone = false, tip = null }) {
  const isOpen = useStampPickerOpen();
  const armedId = useArmedId();
  const items = useMemo(() => stampPresetItems(), []);
  const [frame, setFrame] = useState(null);
  const pointerTypeRef = useRef('mouse');
  const active = enabled && isOpen;

  useEffect(() => {
    if (!active) return undefined;
    const place = () => {
      const b = viewerBounds(phone);
      setFrame({ top: b.top + 10, right: Math.max(10, window.innerWidth - b.right + 10) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [active, phone]);

  // Esc lets go of a picked preset (the placement layer's own Esc) and then
  // closes the card.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || armedId) return;
      setStampPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, armedId]);

  useEffect(() => () => setStampPickerOpen(false), []);

  if (!active || !frame || typeof document === 'undefined') return null;
  const chip = typeof tip === 'function' ? tip : () => ({});
  const pick = (item) => {
    if (pointerTypeRef.current === 'touch' || phone) {
      placeLibraryItem(item, { center: true });
      return;
    }
    if (armedId === item.id) disarmLibraryItem();
    else armLibraryItem(item, { keep: true });
  };
  return createPortal(
    <section
      className="props-panel stamp-card"
      data-stamp-picker=""
      data-mark-library-panel=""
      aria-label="Stamp"
      style={{ top: frame.top, right: frame.right }}
    >
      <header className="props-panel__header">
        <div className="props-panel__heading"><div className="props-panel__count">Stamp</div></div>
        <button
          type="button"
          className="props-panel__icon-button"
          aria-label="Close"
          onClick={() => setStampPickerOpen(false)}
          {...chip('Close', 'below')}
        >
          <Icon name="close" size={16} color="currentColor" />
        </button>
      </header>
      <div className="props-panel__body">
        <div className="stamp-card__group">Preset</div>
        <div className="stamp-card__grid" role="listbox" aria-label="Preset stamps">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={armedId === item.id}
              aria-label={item.name}
              className="stamp-card__tile"
              data-stamp-preset={item.id.slice(item.id.indexOf(':') + 1)}
              onPointerDown={(event) => { pointerTypeRef.current = event.pointerType || 'mouse'; }}
              onClick={() => pick(item)}
              {...chip(item.name, 'below')}
            >
              <StampTile item={item} />
            </button>
          ))}
        </div>
      </div>
    </section>,
    document.body,
  );
}
