import { buildTextMarkupLinkRegions } from '../utils/pdfTextMarkup.js';

const openLink = (url) => {
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};

export default function TextMarkupLinkLayer({ annotations, pageSize, interactive = false, onPageNavigate }) {
  const regions = buildTextMarkupLinkRegions(annotations, pageSize);
  if (!regions.length) return null;
  return (
    <div aria-label="Text links" style={{ position: 'absolute', inset: 0, zIndex: 13, pointerEvents: 'none' }}>
      {regions.map((region) => (
        <button
          key={region.id}
          type="button"
          aria-label={region.mode === 'page' ? `Go to page ${region.pageNumber}` : `Open link ${region.url}`}
          onClick={(event) => {
            event.preventDefault();
            if (!interactive) return;
            if (region.mode === 'page') onPageNavigate?.(region.pageNumber);
            else openLink(region.url);
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
