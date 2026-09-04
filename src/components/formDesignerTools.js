/**
 * formDesignerTools — KAL-47
 *
 * Pure helpers for the custom Forms toolbar. Keeping field-type metadata
 * + tool-id mapping out of App.jsx makes the placement logic testable
 * without spinning the React/Pdfjs stack.
 */

// Tool ids surfaced through the App's existing `activeTool` state. We
// prefix everything with `form-` so the existing `activeTool !== 'pan' &&
// activeTool !== 'select'` chrome rules don't trip on Form mode.
export const FORM_TOOLS = [
  { id: 'form-textbox', label: 'Text field', formFieldType: 'Textbox', iconName: 'textBox' },
  { id: 'form-checkbox', label: 'Checkbox', formFieldType: 'CheckBox', iconName: 'rect' },
  { id: 'form-radio', label: 'Radio button', formFieldType: 'RadioButton', iconName: 'ellipse' },
  { id: 'form-signature', label: 'Signature', formFieldType: 'SignatureField', iconName: 'pen' }
];

export const FORM_TOOL_IDS = FORM_TOOLS.map((t) => t.id);

const FORM_TOOL_BY_ID = FORM_TOOLS.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {});

export function getFormToolById(id) {
  return FORM_TOOL_BY_ID[id] || null;
}

export function getFormFieldTypeForTool(id) {
  return FORM_TOOL_BY_ID[id]?.formFieldType || null;
}

export function isFormTool(id) {
  return FORM_TOOL_IDS.includes(id);
}

/**
 * Build the Pdfjs *FieldSettings payload for `addFormField`. Centralised
 * so the toolbar buttons + the unit tests + the right-click "place here"
 * path all produce identical shapes.
 *
 * @param {string} formFieldType — 'Textbox' | 'CheckBox' | 'RadioButton' | 'SignatureField'
 * @param {object} opts — { pageNumber, bounds, name? }
 */
export function buildFieldSettings(formFieldType, opts) {
  const pageNumber = Number(opts?.pageNumber) || 1;
  const bounds = opts?.bounds || { x: 0, y: 0, width: 150, height: 24 };
  const baseName = opts?.name || `${formFieldType}_${Date.now().toString(36)}`;

  // Width/height defaults differ per type — checkboxes/radio are square,
  // signatures are wider. Mirror what Pdfjs's own toolbar uses so the
  // placement feels familiar.
  const sized = sizeBoundsForType(formFieldType, bounds);

  switch (formFieldType) {
    case 'CheckBox':
      return { bounds: sized, name: baseName, pageNumber, isRequired: false, isReadOnly: false };
    case 'RadioButton':
      return { bounds: sized, name: baseName, pageNumber, isRequired: false, isReadOnly: false };
    case 'SignatureField':
      return { bounds: sized, name: baseName, pageNumber, isRequired: false, isReadOnly: false };
    case 'Textbox':
    default:
      return {
        bounds: sized,
        name: baseName,
        value: '',
        pageNumber,
        fontFamily: 'Helvetica',
        fontSize: 12,
        color: '#000000',
        backgroundColor: '#FFFFFF',
        alignment: 'Left',
        isReadOnly: false,
        visibility: 'visible',
        maxLength: 0,
        isRequired: false,
        isPrint: true,
        tooltip: '',
        thickness: 1,
        borderColor: '#000000',
        isMultiline: false
      };
  }
}

/**
 * Build the small subset of options we forward to `FormDesigner.updateFormField`.
 * Lives here (not in the panel JSX) so the unit test can import via Node's
 * native ESM loader without a JSX transform step.
 */
export function buildFormFieldUpdate(input) {
  const out = {};
  if (typeof input?.name === 'string') out.name = input.name;
  if (typeof input?.value === 'string') out.value = input.value;
  if (typeof input?.tooltip === 'string') out.tooltip = input.tooltip;
  if (typeof input?.isRequired === 'boolean') out.isRequired = input.isRequired;
  if (typeof input?.isReadOnly === 'boolean') out.isReadOnly = input.isReadOnly;
  return out;
}

export function sizeBoundsForType(formFieldType, bounds) {
  const x = Number(bounds?.x) || 0;
  const y = Number(bounds?.y) || 0;
  switch (formFieldType) {
    case 'CheckBox':
    case 'RadioButton':
      return { x, y, width: 20, height: 20 };
    case 'SignatureField':
      return { x, y, width: 180, height: 40 };
    case 'Textbox':
    default:
      return { x, y, width: Number(bounds?.width) || 150, height: Number(bounds?.height) || 24 };
  }
}
