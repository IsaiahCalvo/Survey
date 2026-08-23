import { useRef } from 'react';
import { FONT_FAMILY } from '../viewerShared';

/**
 * Lone-series Counter Start field. Draft stays in the input until Enter/blur.
 * Escape restores the pre-edit value and skips the blur commit — same contract
 * as Width/Size, Zoom %, page #, and rotation. Typing must not persist.
 * Desktop toolbar and 390 strip share this control.
 */
export default function CounterStartNumberField({
  seriesId,
  start,
  locked,
  onCommit,
  tipProps,
  className = '',
}) {
  const skipCommitRef = useRef(false);
  const valueAtFocusRef = useRef('');
  const committed = String(start ?? 1);

  return (
    <label
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        color: locked ? '#5a6473' : '#8d96a6',
        fontSize: '11px',
        fontFamily: FONT_FAMILY,
      }}
      {...tipProps}
    >
      Start
      <input
        key={`${seriesId}:${committed}`}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="no-spin-buttons"
        defaultValue={committed}
        disabled={locked}
        onFocus={() => {
          skipCommitRef.current = false;
          valueAtFocusRef.current = committed;
        }}
        onInput={(event) => {
          event.currentTarget.value = event.currentTarget.value.replace(/[^0-9]/g, '');
        }}
        onBlur={(event) => {
          if (skipCommitRef.current) {
            skipCommitRef.current = false;
            return;
          }
          const next = Math.max(1, Math.floor(Number(event.currentTarget.value) || 1));
          event.currentTarget.value = String(next);
          onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            skipCommitRef.current = true;
            event.currentTarget.value = valueAtFocusRef.current || committed;
            event.currentTarget.blur();
          }
        }}
        aria-label="Counter start number"
        style={{
          width: '42px',
          height: '20px',
          padding: '4px',
          background: '#3a4252',
          color: '#e8e2d4',
          border: '1px solid transparent',
          borderRadius: '5px',
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          textAlign: 'center',
          opacity: locked ? 0.55 : 1,
        }}
      />
    </label>
  );
}
