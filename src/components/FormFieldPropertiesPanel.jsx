/**
 * FormFieldPropertiesPanel — KAL-47
 *
 * Survey-native properties UI for PDF form fields created via the
 * Syncfusion FormDesigner API. We do NOT use Syncfusion's built-in
 * properties dialog (which lives behind `enableFormDesignerToolbar`)
 * because it conflicts with Survey's chrome.
 *
 * Inputs come from a `selectedFormField` object that App.jsx hydrates
 * from FormDesigner's `formFieldSelect` event. Changes are applied via
 * the `onChange` callback, which in turn calls the SyncfusionPDFContainer
 * imperative `updateFormField` API.
 *
 * Keep this component minimal — name / default value / required /
 * read-only / tooltip — and add field-type-specific fields only when
 * the user actually asks for them.
 */
import React, { useEffect, useState } from 'react';
import { buildFormFieldUpdate } from './formDesignerTools';

// Re-export so existing callers / tests that import from this module keep
// working. The canonical implementation lives in `formDesignerTools.js`.
export { buildFormFieldUpdate };

const PANEL_FONT = 'Lato, Inter, system-ui, sans-serif';

// Field types that take a free-form text value. CheckBox/Radio/Signature
// have no "value" string in the UI sense, so we hide the input.
const VALUE_TEXT_TYPES = new Set(['Textbox', 'Password']);

function deriveTypeLabel(type) {
  switch (type) {
    case 'Textbox': return 'Text field';
    case 'CheckBox': return 'Checkbox';
    case 'RadioButton': return 'Radio button';
    case 'SignatureField': return 'Signature';
    case 'InitialField': return 'Initial';
    case 'DropDown': return 'Dropdown';
    case 'ListBox': return 'List box';
    case 'Password': return 'Password';
    default: return type || 'Form field';
  }
}

export default function FormFieldPropertiesPanel({
  selectedFormField,
  onChange,
  onDelete,
  onClose
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [required, setRequired] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [tooltip, setTooltip] = useState('');

  // Resync local state whenever the selected field changes — Syncfusion
  // mutates the underlying model in place, so we treat the field id as the
  // identity for the form (not object identity).
  const fieldId = selectedFormField?.id || selectedFormField?.formFieldId || null;
  useEffect(() => {
    if (!selectedFormField) return;
    setName(selectedFormField.name || '');
    setValue(selectedFormField.value || '');
    setRequired(selectedFormField.isRequired === true);
    setReadOnly(selectedFormField.isReadOnly === true);
    setTooltip(selectedFormField.tooltip || '');
  }, [fieldId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedFormField) return null;

  const fieldType = selectedFormField.type || selectedFormField.formFieldAnnotationType || '';
  const showValueField = VALUE_TEXT_TYPES.has(fieldType);

  const apply = (next) => {
    onChange?.({
      name,
      value,
      isRequired: required,
      isReadOnly: readOnly,
      tooltip,
      ...next
    });
  };

  return (
    <div
      data-testid="form-field-properties-panel"
      style={{
        position: 'absolute',
        top: '80px',
        right: '24px',
        zIndex: 1200,
        width: '260px',
        background: '#2A2A2A',
        color: '#DDD',
        border: '1px solid #444',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: '12px',
        fontFamily: PANEL_FONT,
        fontSize: '12px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>
          {deriveTypeLabel(fieldType)} properties
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close properties"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 6px'
          }}
        >
          ×
        </button>
      </div>

      <label style={{ display: 'block', marginBottom: '8px' }}>
        <div style={{ color: '#AAA', marginBottom: '4px' }}>Name</div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => apply({ name })}
          style={{
            width: '100%',
            background: '#1F1F1F',
            color: '#EEE',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '4px 6px',
            fontFamily: PANEL_FONT,
            fontSize: '12px',
            boxSizing: 'border-box'
          }}
        />
      </label>

      {showValueField && (
        <label style={{ display: 'block', marginBottom: '8px' }}>
          <div style={{ color: '#AAA', marginBottom: '4px' }}>Default value</div>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => apply({ value })}
            style={{
              width: '100%',
              background: '#1F1F1F',
              color: '#EEE',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '4px 6px',
              fontFamily: PANEL_FONT,
              fontSize: '12px',
              boxSizing: 'border-box'
            }}
          />
        </label>
      )}

      <label style={{ display: 'block', marginBottom: '8px' }}>
        <div style={{ color: '#AAA', marginBottom: '4px' }}>Tooltip</div>
        <input
          type="text"
          value={tooltip}
          onChange={(e) => setTooltip(e.target.value)}
          onBlur={() => apply({ tooltip })}
          style={{
            width: '100%',
            background: '#1F1F1F',
            color: '#EEE',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '4px 6px',
            fontFamily: PANEL_FONT,
            fontSize: '12px',
            boxSizing: 'border-box'
          }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => {
            setRequired(e.target.checked);
            apply({ isRequired: e.target.checked });
          }}
        />
        <span>Required</span>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(e) => {
            setReadOnly(e.target.checked);
            apply({ isReadOnly: e.target.checked });
          }}
        />
        <span>Read only</span>
      </label>

      <button
        type="button"
        onClick={onDelete}
        style={{
          width: '100%',
          padding: '6px',
          background: '#5a1d1d',
          color: '#FCD',
          border: '1px solid #7a2a2a',
          borderRadius: '4px',
          fontFamily: PANEL_FONT,
          fontSize: '12px',
          cursor: 'pointer'
        }}
      >
        Delete field
      </button>
    </div>
  );
}

