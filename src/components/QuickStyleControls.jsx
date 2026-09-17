/**
 * QuickStyleControls.jsx — the quick colour dots and the quick line widths
 * that open the tool-properties row.
 *
 * ONE component pair, two hosts: the desktop top bar (src/AppShell.jsx) and
 * the phone tool-properties strip (src/mobile/MobilePdfViewerChrome.jsx). The
 * `platform` prop only picks the size tier's gap — the controls themselves are
 * the same, because a red dot that is 20px on one screen and 18px on the other
 * is a drift nobody meant.
 *
 * INTENDED UX (owner, 2026-09-17): pressing a dot or a width applies straight
 * away, to the armed tool and to a selected mark, exactly as picking that
 * colour out of the swatch's picker or typing that number into the width field
 * does today. Nothing here opens anything — the popovers stay where they were.
 *
 * NO ICONS LIVE HERE ON PURPOSE. A width chip has to show its real weight, and
 * the shared icon set is drawn at one house stroke (1.5), so an <svg> glyph
 * could not tell 1pt from 4pt without lying about the house weight. The chip
 * draws a plain 22px rule whose height IS the width in question, which is both
 * honest and outside the icon set's business.
 */
import { useTooltip } from './Tooltip';
import {
  QUICK_COLOURS,
  QUICK_COLOUR_NAMES,
  QUICK_WIDTHS,
  isQuickWidth,
  normaliseQuickColour,
} from '../utils/quickStylePresets';
import './QuickStyleControls.css';

/**
 * The four default colour dots.
 *
 * @param {string} value    the colour the row is currently on
 * @param {(hex: string) => void} onPick
 * @param {'desktop'|'phone'} platform
 */
export function QuickColourDots({ value, onPick, platform = 'desktop' }) {
  const chromeTip = useTooltip();
  const current = normaliseQuickColour(value);
  return (
    <div
      className={`quick-style quick-style--colours quick-style--${platform}`}
      data-quick-colours="true"
      role="group"
      aria-label="Quick colors"
    >
      {QUICK_COLOURS.map((colour) => {
        const name = QUICK_COLOUR_NAMES[colour] || colour;
        const isCurrent = normaliseQuickColour(colour) === current;
        return (
          <button
            key={colour}
            type="button"
            className={`quick-style__dot${isCurrent ? ' is-current' : ''}`}
            style={{ '--quick-style-dot': colour }}
            // KAL-65: a control carries chromeTip OR a native title=, never
            // both. On the phone there is no tooltip provider, so this is a
            // no-op there and the aria-label is the whole accessible name.
            {...chromeTip(name, 'below')}
            aria-label={name}
            aria-pressed={isCurrent}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onPick?.(colour)}
          >
            <span className="quick-style__dot-fill" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The three default line widths, drawn as real lines at their real weight.
 *
 * @param {string|number} value  the width the row is currently on
 * @param {(width: number) => void} onPick
 * @param {'desktop'|'phone'} platform
 */
export function QuickWidthPresets({ value, onPick, platform = 'desktop' }) {
  const chromeTip = useTooltip();
  return (
    <div
      className={`quick-style quick-style--widths quick-style--${platform}`}
      data-quick-widths="true"
      role="group"
      aria-label="Quick line widths"
    >
      {QUICK_WIDTHS.map((width) => {
        const isCurrent = isQuickWidth(value, width);
        const label = `Line width ${width}`;
        return (
          <button
            key={width}
            type="button"
            className={`quick-style__width${isCurrent ? ' is-current' : ''}`}
            {...chromeTip(label, 'below')}
            aria-label={label}
            aria-pressed={isCurrent}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onPick?.(width)}
          >
            <span
              className="quick-style__width-line"
              aria-hidden="true"
              style={{ '--quick-style-width': `${width}px` }}
            />
          </button>
        );
      })}
    </div>
  );
}
