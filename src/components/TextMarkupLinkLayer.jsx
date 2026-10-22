import { buildTextMarkupLinkRegions } from '../utils/pdfTextMarkup.js';
import { openExternalDestination } from '../utils/accountPlatform.js';
import { useMoveModifierHeld } from '../utils/moveModifier.js';
import { LINK_MODE_DISABLED, LINK_MODE_OPEN, LINK_MODE_SELECT, resolveLinkMode, shouldOpenLinkOnClick } from '../utils/linkClickPolicy.js';
import { useTooltip } from './Tooltip';

const activateLink = (region, onPageNavigate) => {
  if (region.mode === 'page') onPageNavigate?.(region.pageNumber);
  else void openExternalDestination(region.url).catch(() => {});
};

// Only a TAP is the link's (Appetize iOS run 2026-10-06 / Chromium phone
// repro: a one-finger pull past the top edge that started on a text link
// panned the page AND opened the link when the finger lifted). The press is
// remembered per button; a release that travelled past this slop was a drag
// of the page, so it neither opens nor selects.
export const LINK_TAP_SLOP_PX = 8;
const pressStarts = new WeakMap();
export const isLinkTap = (start, event) => !start
  || Math.hypot((event?.clientX ?? 0) - start.x, (event?.clientY ?? 0) - start.y) <= LINK_TAP_SLOP_PX;

export default function TextMarkupLinkLayer({ annotations, pageSize, interactionMode: toolMode = 'disabled', nativeTextSelection = false, onPageNavigate, onSelectLink }) {
  const tip = useTooltip();
  const regions = buildTextMarkupLinkRegions(annotations, pageSize);
  // Drawboard canvas audit 2026-10-13: Cmd/Ctrl+click opens a link under any
  // tool (utils/linkClickPolicy.js). Only a page that HAS links listens for
  // the key, and Pan (already open) never needs it.
  const modifierHeld = useMoveModifierHeld(regions.length > 0 && toolMode !== LINK_MODE_OPEN);
  if (!regions.length) return null;
  // Native text owns pointer gestures in Text Select; the viewer resolves
  // short annotation clicks without blocking native text gestures.
  const interactionMode = resolveLinkMode({ toolMode, modifierHeld, nativeTextSelection });
  const interactive = interactionMode !== LINK_MODE_DISABLED;
  return (
    <div aria-label="Text links" style={{ position: 'absolute', inset: 0, zIndex: 110, pointerEvents: 'none' }}>
      {regions.map((region) => (
        <button
          key={region.id}
          data-text-markup-link={region.annotationId || region.id}
          data-text-markup-link-index={region.annotationIndex}
          type="button"
          aria-label={region.mode === 'page' ? `Go to page ${region.pageNumber}` : `Open link ${region.url}`}
          {...tip(interactionMode === LINK_MODE_SELECT ? 'Click to select. Double-click or Cmd/Ctrl+click to open.' : undefined, 'below')}
          onPointerDownCapture={(event) => {
            if (!interactive || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            pressStarts.set(event.currentTarget, { x: event.clientX ?? 0, y: event.clientY ?? 0 });
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUpCapture={(event) => {
            if (!interactive || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            const start = pressStarts.get(event.currentTarget);
            pressStarts.delete(event.currentTarget);
            if (!isLinkTap(start, event)) return;
            if (shouldOpenLinkOnClick(interactionMode, event)) {
              activateLink(region, onPageNavigate);
              return;
            }
            onSelectLink?.(region);
          }}
          onDoubleClickCapture={(event) => {
            if (!interactive || interactionMode !== LINK_MODE_SELECT) return;
            event.preventDefault();
            event.stopPropagation();
            activateLink(region, onPageNavigate);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!interactive) return;
            // Pointer activation happens on pointerup. detail=0 is a keyboard click.
            if (event.detail === 0 && interactionMode === LINK_MODE_OPEN) {
              activateLink(region, onPageNavigate);
              return;
            }
            if (event.detail === 0) onSelectLink?.(region);
          }}
          style={{
            position: 'absolute', left: region.left, top: region.top,
            width: region.width, height: region.height,
            pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'pointer' : 'default',
            padding: 0, border: 0, background: 'transparent',
          }}
        />
      ))}
    </div>
  );
}
