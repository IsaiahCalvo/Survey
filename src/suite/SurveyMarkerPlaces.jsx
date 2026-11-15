// Where the open Survey Marker's device is (Kal Voe suite, KAL-588; Nightly
// flag 'suite'): Building, Wing, Floor and Location, under its tracking line
// on the phone and the desktop rail. Each field saves on blur or Enter through
// `onChange(patch)`, which writes the marker's own field (suiteFields.js), so
// two screens editing different fields both land.
import { useEffect, useState } from 'react';
import { SUITE_FIELD_MAX, SUITE_PLACE_FIELDS, SUITE_PLACE_LABELS, readSuitePlaces } from './suiteFields.js';
import './surveyMarkerPlaces.css';

const stop = (e) => e.stopPropagation();

function PlaceField({ field, value, canEdit, onCommit }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { if (text.trim() !== value) onCommit(field, text); };
  return (
    <label className="survey-places__field" onPointerDown={stop} onClick={stop}>
      <span className="survey-places__label">{SUITE_PLACE_LABELS[field]}</span>
      <input
        type="text"
        className="survey-places__input"
        data-suite-place={field}
        value={text}
        maxLength={SUITE_FIELD_MAX}
        readOnly={!canEdit}
        placeholder={canEdit ? 'Add' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setText(value); }
        }}
      />
    </label>
  );
}

export default function SurveyMarkerPlaces({ marker, canEdit = true, onChange, variant = 'desktop' }) {
  if (!marker) return null;
  const places = readSuitePlaces(marker);
  return (
    <div className={`survey-places survey-places--${variant}`} data-suite-places="true" role="group" aria-label="Where it is">
      {SUITE_PLACE_FIELDS.map((field) => (
        <PlaceField
          key={field}
          field={field}
          value={places[field]}
          canEdit={canEdit}
          onCommit={(f, v) => onChange?.({ [f]: v })}
        />
      ))}
    </div>
  );
}
