/**
 * QuickStyleControls.jsx — the colour cluster that opens every tool's
 * settings bar, and the quick line widths.
 *
 * ONE component set, two hosts: the desktop top bar (src/AppShell.jsx) and the
 * phone tool-properties strip (src/mobile/MobilePdfViewerChrome.jsx). Boards
 * 1-12 draw the cluster at the SAME size on both — a 16px disc in a 22px
 * button on a 4px gap — because a red disc that is 16px on one screen and 20px
 * on the other is a drift nobody meant. The `platform` prop therefore only
 * tags the group for its host's own layout; it changes no size in here.
 *
 * WHAT THE CLUSTER IS (owner, pass 7, boards 1-12):
 *
 *   Single-colour tools (pen, highlighter, line, arrow)
 *     <QuickColourDots> — red, blue, black, then a rainbow custom disc that
 *     opens the picker. The CHOSEN one wears a ring in its OWN colour with a
 *     1.5px gap and a check in the middle. Never a gold ring, never a gold
 *     fill: "a ring in the disc's own colour, a gap, and a white check".
 *
 *   Multi-colour tools (rectangle, ellipse, polygon, polyline, callout, text
 *   box, counter)
 *     <QuickPaintSwatch> — ONE 22px button, no preset discs. A shape shows its
 *     fill in the centre with its border as a 2px ring; a counter shows its pin
 *     in the pin colour with its number inside. Pressing it opens the shared
 *     picker on the Border tab.
 *
 * INTENDED UX: pressing a preset disc applies straight away, to the armed tool
 * and to a selected mark, exactly as picking that colour out of the picker
 * does. Only the custom disc and the combined swatch open anything.
 *
 * THE INLINE SVG IN HERE IS NOT ICON-SET WORK. Three glyphs live here, each
 * copied from the approved boards rather than drawn fresh: the chosen-state
 * check (boards 1-12, 17-19), the custom disc's plus (boards 1, 3, 10, 12) and
 * the counter pin (boards 4, 11). The first two are small STATE glyphs drawn at
 * the boards' own weights, which DESIGN-SYSTEM.md allows explicitly ("use
 * inline SVG for small state glyphs"; "1.5px strokes ... unless the source icon
 * needs another weight") — a 1.5 stroke inside a 10px check renders at half a
 * device pixel and disappears. The pin is drawn at 67 units inside a 0.0224
 * scale, which IS the house 1.5 on the 24 grid.
 *
 * The width chips below still draw no icon at all: a chip has to show its real
 * weight, and the shared icon set is one weight, so the chip draws a plain rule.
 */
import { useTooltip } from './Tooltip';
import {
  QUICK_COLOURS,
  QUICK_COLOUR_NAMES,
  QUICK_WIDTHS,
  isCustomQuickColour,
  isQuickWidth,
  needsSwatchHairline,
  normaliseQuickColour,
  swatchCheckInk,
  swatchRingColour,
} from '../utils/quickStylePresets';
import './QuickStyleControls.css';

/**
 * The chosen-state check, exactly as boards 1-12 draw it in a 16px disc: a
 * 10px glyph on the 24 grid at stroke 2.6, round caps and joins.
 */
const ChosenCheck = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The custom disc's plus, from boards 1, 3, 10 and 12. */
const CustomPlus = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M12 6V18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 12H18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/*
 * The counter pin, from boards 4 and 11 — the owner's own pin outline, filled
 * in the pin colour with the number inside it. "Counter icon = the app's real
 * pin outline, never a circle." Drawn at 67 units inside scale(0.0224), which
 * normalises to the house 1.5 stroke on the 24 grid.
 */
const PIN_PATH = 'M16.64 14.53C32.51 16.06 48.52 16.04 64.42 17.17C84.3 18.58 104.24 19.47 124.15 20.54C172.46 23.14 221 24.9 269.21 28.79C311.2 32.18 353.46 32.81 395.47 35.77C437.49 38.73 479.63 39.7 521.62 43C562.5 46.22 604.72 56.56 642.66 72C785.02 129.91 889.46 257.4 913.66 410.03C920.35 452.22 920.36 494.92 915.01 537.24C910.4 573.68 901 610.28 886.95 644.23C866.32 694.11 836.9 740.48 799.81 779.75C766.71 814.79 728.26 842.48 686.57 866.19C659.41 881.64 629.18 892.19 599.35 900.86C567.56 910.1 535.15 914.56 502.15 916.64C334.46 927.2 173.19 832.76 94.22 686.11C70.5 642.04 55.77 594.61 47.28 545.43C41.58 512.41 41.99 478.36 39.82 444.99C35.52 379.05 33.34 312.95 28.8 247.02C25.11 193.32 22.63 139.51 19.72 85.75C18.82 69.26 17.52 52.77 16.94 36.26C16.7 29.6 14.39 20.75 16.64 14.53Z';

const CounterPin = ({ pin, number, count }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <g transform="translate(1.6 1.6) scale(0.0224)">
      <path d={PIN_PATH} fill={pin} stroke={pin} strokeWidth="67" strokeLinejoin="round" />
      <text
        x="478"
        y="640"
        textAnchor="middle"
        fill={number}
        fontFamily="-apple-system, Helvetica, Arial, sans-serif"
        fontWeight="800"
        fontSize="430"
      >
        {count}
      </text>
    </g>
  </svg>
);

/**
 * The three quick colour discs, plus the rainbow custom disc when the host
 * gives it somewhere to open.
 *
 * @param {string} value               the colour the cluster is currently on
 * @param {(hex: string) => void} onPick
 * @param {'desktop'|'phone'} platform tags the group for its host's layout
 * @param {() => void} [onOpenPicker]  when given, the custom disc renders and
 *                                     pressing it calls this
 * @param {boolean} [customActive]     override for "the current colour is not
 *                                     one of the three" — leave it alone
 */
export function QuickColourDots({
  value,
  onPick,
  platform = 'desktop',
  onOpenPicker,
  customActive,
}) {
  const chromeTip = useTooltip();
  const current = normaliseQuickColour(value);
  const showCustom = typeof onOpenPicker === 'function';
  const customIsCurrent = customActive ?? (showCustom && isCustomQuickColour(value));
  return (
    <div
      className={`quick-style quick-style--colours quick-style--${platform}`}
      data-quick-colours="true"
      role="group"
      aria-label="Colour"
    >
      {QUICK_COLOURS.map((colour) => {
        const name = QUICK_COLOUR_NAMES[colour] || colour;
        const isCurrent = normaliseQuickColour(colour) === current;
        return (
          <button
            key={colour}
            type="button"
            className={`quick-style__dot${isCurrent ? ' is-current' : ''}`}
            data-quick-colour-preset={colour}
            style={{
              '--quick-style-dot': colour,
              '--quick-style-ring': swatchRingColour(colour),
            }}
            // KAL-65: a control carries chromeTip OR a native title=, never
            // both. On the phone there is no tooltip provider, so this is a
            // no-op there and the aria-label is the whole accessible name.
            {...chromeTip(name, 'below')}
            aria-label={name}
            aria-pressed={isCurrent}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onPick?.(colour)}
          >
            <span
              className={`quick-style__dot-fill${needsSwatchHairline(colour) ? ' has-hairline' : ''}`}
            >
              {isCurrent && (
                <span
                  className="quick-style__check"
                  style={{ color: swatchCheckInk(colour) }}
                  aria-hidden="true"
                >
                  <ChosenCheck />
                </span>
              )}
            </span>
          </button>
        );
      })}
      {showCustom && (
        /* The custom disc: a conic rainbow ring with a plus in the middle. When
           the current colour is not one of the three presets this disc, and
           only this disc, wears the chosen mark — the same own-colour ring and
           check the presets use, with the check standing in for the plus. */
        <button
          type="button"
          className={`quick-style__dot quick-style__dot--custom${customIsCurrent ? ' is-current' : ''}`}
          data-quick-colour-custom="true"
          style={customIsCurrent ? { '--quick-style-ring': swatchRingColour(value) } : undefined}
          {...chromeTip('Custom colour', 'below')}
          aria-label="Custom colour"
          aria-pressed={customIsCurrent}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onOpenPicker?.()}
        >
          <span className="quick-style__rainbow" aria-hidden="true" />
          <span className="quick-style__custom-glyph" aria-hidden="true">
            {customIsCurrent ? <ChosenCheck /> : <CustomPlus />}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The ONE combined swatch every multi-colour tool shows instead of preset
 * discs. Boards 2, 5, 9 and 12 for a shape; boards 4 and 11 for the counter.
 *
 * @param {string} ring     the ring colour: a shape's border, a counter's pin.
 *                          `border` is accepted as an alias.
 * @param {string} center   the centre colour: a shape's fill, a counter's
 *                          number. `fill` is accepted as an alias.
 * @param {'shape'|'counter'} variant
 * @param {number|string} count  the number drawn in the pin (counter only)
 * @param {() => void} onOpen    opens the shared picker on its Border tab
 * @param {'desktop'|'phone'} platform
 * @param {string} [label]  accessible-name override
 */
export function QuickPaintSwatch({
  ring,
  center,
  border,
  fill,
  variant = 'shape',
  count = 1,
  onOpen,
  platform = 'desktop',
  label,
}) {
  const chromeTip = useTooltip();
  const isCounter = variant === 'counter';
  const ringColour = ring ?? border ?? '#FF0000';
  const centreColour = center ?? fill ?? (isCounter ? '#ffffff' : '#ffffff');
  const name = label || (isCounter ? 'Pin and number colours' : 'Border and fill colours');
  return (
    <button
      type="button"
      className={`quick-style__swatch quick-style--${platform}${isCounter ? ' quick-style__swatch--counter' : ''}`}
      data-quick-paint-swatch={variant}
      {...chromeTip(name, 'below')}
      aria-label={name}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => onOpen?.()}
    >
      {isCounter ? (
        <span className="quick-style__swatch-pin" aria-hidden="true">
          <CounterPin pin={ringColour} number={centreColour} count={count} />
        </span>
      ) : (
        <span
          className="quick-style__swatch-disc"
          aria-hidden="true"
          style={{
            '--quick-style-fill': centreColour,
            '--quick-style-border': ringColour,
          }}
        />
      )}
    </button>
  );
}

/**
 * The three default line widths, drawn as real lines at their real weight.
 *
 * Kept for hosts that still show chips. The approved pass-7 bars show width as
 * a dropdown only, so neither bar renders this today.
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
