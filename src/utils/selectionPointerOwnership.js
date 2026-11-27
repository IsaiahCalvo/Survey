export const isClientPointNearRect = (clientX, clientY, rect, padding = 0) => {
  if (!rect) return false;
  const x = Number(clientX);
  const y = Number(clientY);
  const inset = Math.max(0, Number(padding) || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= rect.left - inset
    && x <= rect.right + inset
    && y >= rect.top - inset
    && y <= rect.bottom + inset;
};

// Keep mouse arming tight to the visual range-resize pill so starting a drag on
// an adjacent word (e.g. "103" right next to "STORAGE") creates a separate text
// markup instead of grabbing the previous underline's edge handle (#1732).
export const TEXT_RANGE_HANDLE_POINTER_PADDING = 4;

export const shouldArmTextSelectManipulation = ({ activeTool, textDragModeActive = false } = {}) => (
  activeTool === 'text-select' && !textDragModeActive
);
