import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MEASURE_PRESETS,
  MEASURE_UNITS,
  scaleFromCalibration,
  scaleFromPreset,
} from '../utils/measure/measureScale.js';

// Set page scale (Drawboard "Set page scale" / Calibrate). With a drawn
// calibration line (lengthPt) the user types its real length; without one
// they pick a preset or start "Calibrate" to draw a line.
export default function MeasureScaleDialog({ pageNumber, lengthPt = null, currentScale = null, onApply, onCalibrate, onCancel }) {
  const [real, setReal] = useState('');
  const [unit, setUnit] = useState(currentScale?.unit || 'ft');
  const [preset, setPreset] = useState('1/4');
  const calibrating = Number.isFinite(lengthPt) && lengthPt > 0;
  const scale = calibrating ? scaleFromCalibration(lengthPt, real, unit) : scaleFromPreset(preset);
  // 44px touch targets; 16px text so iOS Safari does not zoom on focus.
  const fieldStyle = { minHeight: 44, fontSize: 16, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2, #fff)', color: 'var(--text-1, #111)' };
  const submit = (e) => {
    e.preventDefault();
    if (scale) onApply(scale);
  };
  return createPortal(
    <div
      data-measure-scale-dialog="true"
      role="dialog"
      aria-modal="true"
      aria-label="Set page scale"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); e.stopPropagation(); }}
        style={{ background: 'var(--surface-1, #fff)', color: 'var(--text-1, #111)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, width: 'min(340px, 100%)', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'system-ui, sans-serif', fontSize: 14 }}
      >
        <strong>Set scale for page {pageNumber}</strong>
        {currentScale && <span style={{ color: 'var(--text-3)' }}>Now: {currentScale.label}</span>}
        {calibrating ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Real length of the line you drew
            <span style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                data-measure-real-length="true"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={real}
                onChange={(e) => setReal(e.target.value)}
                style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
              />
              <select data-measure-unit="true" value={unit} onChange={(e) => setUnit(e.target.value)} style={fieldStyle}>
                {Object.keys(MEASURE_UNITS).map((u) => <option key={u} value={u}>{MEASURE_UNITS[u].label}</option>)}
              </select>
            </span>
          </label>
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              Preset
              <select data-measure-preset="true" value={preset} onChange={(e) => setPreset(e.target.value)} style={fieldStyle}>
                {MEASURE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-ghost" data-measure-start-calibrate="true" style={{ minHeight: 44, whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.3 }} onClick={onCalibrate}>
              Calibrate: draw a line over a known distance
            </button>
          </>
        )}
        <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" style={{ minHeight: 44, minWidth: 72 }} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-active" data-measure-apply="true" style={{ minHeight: 44, minWidth: 72 }} disabled={!scale}>Apply</button>
        </span>
      </form>
    </div>,
    document.body,
  );
}
