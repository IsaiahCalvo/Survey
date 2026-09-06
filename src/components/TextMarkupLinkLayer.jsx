import { buildTextMarkupLinkRegions } from '../utils/pdfTextMarkup.js';
import { openExternalDestination } from '../utils/accountPlatform.js';

const activateLink = (region, onPageNavigate) => {
  if (region.mode === 'page') onPageNavigate?.(region.pageNumber);
  else void openExternalDestination(region.url).catch(() => {});
};

export default function TextMarkupLinkLayer({ annotations, pageSize, interactionMode = 'disabled', nativeTextSelection = false, onPageNavigate, onSelectLink }) {
  const regions = buildTextMarkupLinkRegions(annotations, pageSize);
  if (!regions.length) return null;
  // Native text owns pointer gestures in Text Select; the viewer resolves
  // short annotation clicks without blocking native text gestures.
  const interactive = interactionMode !== 'disabled' && !nativeTextSelection;
  return (
    <div aria-label="Text links" style={{ position: 'absolute', inset: 0, zIndex: 110, pointerEvents: 'none' }}>
      {regions.map((region) => (
        <button
          key={region.id}
          data-text-markup-link={region.annotationId || region.id}
          data-text-markup-link-index={region.annotationIndex}
          type="button"
          aria-label={region.mode === 'page' ? `Go to page ${region.pageNumber}` : `Open link ${region.url}`}
          title={interactionMode === 'select' ? 'Click to select. Double-click or Cmd/Ctrl+click to open.' : undefined}
          onPointerDownCapture={(event) => {
            if (!interactive || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUpCapture={(event) => {
            if (!interactive || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            if (interactionMode === 'open' || event.metaKey || event.ctrlKey) {
              activateLink(region, onPageNavigate);
              return;
            }
            onSelectLink?.(region);
          }}
          onDoubleClickCapture={(event) => {
            if (!interactive || interactionMode !== 'select') return;
            event.preventDefault();
            event.stopPropagation();
            activateLink(region, onPageNavigate);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!interactive) return;
            // Pointer activation happens on pointerup. detail=0 is a keyboard click.
            if (event.detail === 0 && interactionMode === 'open') {
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
