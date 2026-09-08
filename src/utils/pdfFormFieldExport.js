/**
 * KAL-441 — write the values a user typed into a PDF's own form fields back
 * into the exported/printed document's AcroForm.
 *
 * Filling ships already: `PdfjsFormLayer` renders the document's Widget
 * annotations as live inputs and `usePdfjsFormFieldPersistence` stores every
 * edit as a `form-field` object inside `annotationsByPage`. Until this module
 * existed, nothing carried those values into the bytes we hand back, so an
 * exported PDF opened with its form fields blank — silent data loss on a paid
 * feature.
 *
 * UX DECISION (KAL-441, 2026-08-19): exported fields stay EDITABLE, with the
 * typed value baked into each field's appearance stream so Acrobat, macOS
 * Preview, Chrome and the app itself all show it.
 *   - Why not flatten: the whole export path is "keep it a real PDF" — app
 *     annotations are written as genuine PDF annotation objects, not painted
 *     into the page. Flattening form fields would be the one destructive step
 *     in an otherwise lossless export: the recipient could not correct a typo,
 *     re-opening the exported file in Survey would no longer show live fields,
 *     and the value could never be read back out of the form. Engineering firms
 *     pass these documents on to be checked and completed, so a live field that
 *     already reads correctly everywhere is strictly the more useful artefact.
 *   - A baked-flat output is still available: Print with markup renders the
 *     page (appearance streams included), which is the "send this as a record"
 *     route.
 *
 * Field identity: `PdfjsFormLayer` keys each value by the pdf.js annotation id,
 * which is the widget's PDF object reference rendered as `"<num>R"` /
 * `"<num>R<gen>"`. Resolving that ref straight back to the widget dictionary is
 * exact — it survives duplicate field names, and it is the only way to know
 * WHICH radio button in a group the user ticked (the app persists a plain
 * true/false per widget, so the chosen option lives in the widget's own
 * on-state, not in the stored value).
 */
import {
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  PDFBool,
} from 'pdf-lib';

export const FORM_FIELD_OBJECT_TYPE = 'form-field';

/** True for the carrier object `usePdfjsFormFieldPersistence` stores per field. */
export const isFormFieldObject = (obj) => (
  obj?.data?.type === FORM_FIELD_OBJECT_TYPE || obj?.type === FORM_FIELD_OBJECT_TYPE
);

/**
 * Pull every persisted form value out of `annotationsByPage`, newest wins when
 * the same field somehow appears twice on a page.
 */
export const collectFormFieldValues = (annotationsByPage = {}) => {
  const byKey = new Map();
  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const pageNumber = Number.parseInt(pageKey, 10);
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    objects.forEach((obj) => {
      if (!isFormFieldObject(obj)) return;
      const data = obj.data || {};
      const fieldId = data.fieldId;
      if (fieldId == null) return;
      byKey.set(`${pageNumber}:${fieldId}`, {
        pageNumber,
        fieldId: String(fieldId),
        fieldName: data.fieldName ?? null,
        fieldType: data.fieldType ?? null,
        value: data.value,
      });
    });
  });
  return [...byKey.values()];
};

const emptyFormDiagnostics = () => ({
  formFieldValuesConsidered: 0,
  formFieldValuesWritten: 0,
  formFieldValuesSkipped: 0,
  formFieldSkipReasons: {},
  formFieldAppearancesUpdated: false,
  formFieldAppearanceError: null,
});

const recordFormSkip = (diagnostics, reason) => {
  diagnostics.formFieldValuesSkipped += 1;
  diagnostics.formFieldSkipReasons[reason] = (diagnostics.formFieldSkipReasons[reason] || 0) + 1;
};

/** `"12R"` / `"12R3"` (a pdf.js widget id) → the matching pdf-lib object ref. */
const parseWidgetRef = (fieldId) => {
  const match = /^(\d+)R(\d*)$/.exec(String(fieldId || ''));
  if (!match) return null;
  return PDFRef.of(Number.parseInt(match[1], 10), match[2] ? Number.parseInt(match[2], 10) : 0);
};

const decodeTextValue = (value) => {
  if (!value) return null;
  if (typeof value.decodeText === 'function') return value.decodeText();
  return null;
};

/** Fully-qualified field name: every /T from the field root down to this node. */
const fullyQualifiedFieldName = (context, widgetDict) => {
  const parts = [];
  let node = widgetDict;
  let guard = 0;
  while (node instanceof PDFDict && guard < 32) {
    guard += 1;
    const title = decodeTextValue(context.lookup(node.get(PDFName.of('T'))));
    if (title) parts.unshift(title);
    const parent = node.get(PDFName.of('Parent'));
    node = parent ? context.lookupMaybe(parent, PDFDict) : null;
  }
  return parts.length ? parts.join('.') : null;
};

/** The nearest dictionary carrying /FT — the terminal field for this widget. */
const terminalFieldDict = (context, widgetDict) => {
  let node = widgetDict;
  let guard = 0;
  while (node instanceof PDFDict && guard < 32) {
    guard += 1;
    if (node.get(PDFName.of('FT'))) return node;
    const parent = node.get(PDFName.of('Parent'));
    node = parent ? context.lookupMaybe(parent, PDFDict) : null;
  }
  return null;
};

/**
 * The widget's "on" state name (e.g. `Good`, `Yes`) read from its normal
 * appearance dictionary. This is what identifies one radio option or the ticked
 * state of a checkbox.
 */
const widgetOnStateName = (context, widgetDict) => {
  const ap = context.lookupMaybe(widgetDict?.get(PDFName.of('AP')), PDFDict);
  const normal = ap ? context.lookupMaybe(ap.get(PDFName.of('N')), PDFDict) : null;
  if (!normal) return null;
  const names = normal.keys()
    .map((key) => (typeof key?.decodeText === 'function' ? key.decodeText() : null))
    .filter((name) => name && name !== 'Off');
  return names[0] || null;
};

const isTruthyCheckValue = (value) => (
  value === true
  || value === 'true'
  || value === 'on'
  || value === 'Yes'
  || (typeof value === 'string' && value !== '' && value !== 'Off' && value !== 'false')
);

/**
 * Last-resort writer for a field pdf-lib will not hand us as a typed object
 * (unusual /FT, a field the form index does not expose). Writes /V straight
 * onto the field dictionary and asks viewers to build the appearance.
 */
const writeRawFieldValue = (pdfDoc, widgetDict, entry) => {
  const context = pdfDoc.context;
  const fieldDict = terminalFieldDict(context, widgetDict);
  if (!fieldDict) return false;
  const fieldType = decodeTextValue(context.lookup(fieldDict.get(PDFName.of('FT'))))
    || (context.lookup(fieldDict.get(PDFName.of('FT')))?.asString?.() || '').replace('/', '');
  if (fieldType === 'Btn') {
    const onState = widgetOnStateName(context, widgetDict) || 'Yes';
    const state = isTruthyCheckValue(entry.value) ? onState : 'Off';
    fieldDict.set(PDFName.of('V'), PDFName.of(state));
    widgetDict.set(PDFName.of('AS'), PDFName.of(state));
  } else {
    fieldDict.set(PDFName.of('V'), PDFHexString.fromText(entry.value == null ? '' : String(entry.value)));
  }
  try {
    pdfDoc.catalog.getOrCreateAcroForm().dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  } catch { /* a viewer-side regeneration hint only — never fail the export for it */ }
  return true;
};

/**
 * Apply persisted form values to an already-loaded pdf-lib document.
 *
 * Callers must save with `updateFieldAppearances: false` — this function has
 * already regenerated the appearances (inside its own try/catch) so a single
 * awkward field can never take the whole export down with it.
 *
 * @returns diagnostics describing what was written and what was skipped.
 */
export const applyFormFieldValuesToPdfDoc = (pdfDoc, entries = []) => {
  const diagnostics = emptyFormDiagnostics();
  const values = Array.isArray(entries) ? entries : [];
  if (!pdfDoc || values.length === 0) return diagnostics;

  let form = null;
  try {
    form = pdfDoc.getForm();
  } catch {
    form = null;
  }

  const context = pdfDoc.context;
  values.forEach((entry) => {
    diagnostics.formFieldValuesConsidered += 1;
    const ref = parseWidgetRef(entry.fieldId);
    const widgetDict = ref ? context.lookupMaybe(ref, PDFDict) : null;
    if (!widgetDict) {
      recordFormSkip(diagnostics, 'widget-not-found-in-pdf');
      return;
    }
    const fieldName = fullyQualifiedFieldName(context, widgetDict) || entry.fieldName;
    let field = null;
    if (form && fieldName) {
      try { field = form.getFieldMaybe(fieldName) || null; } catch { field = null; }
    }
    // A name is not widget identity: older copied pages can have orphan fields
    // with the original's name. Never send their value to that original field.
    let fieldWidgetIndex = -1;
    if (field) {
      try { fieldWidgetIndex = field.acroField.getWidgets().findIndex(widget => widget.dict === widgetDict); } catch { /* malformed field */ }
      if (fieldWidgetIndex < 0) {
        recordFormSkip(diagnostics, 'widget-field-mismatch');
        return;
      }
    }

    try {
      if (field instanceof PDFTextField) {
        field.setText(entry.value == null ? '' : String(entry.value));
      } else if (field instanceof PDFCheckBox) {
        if (isTruthyCheckValue(entry.value)) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        const onState = widgetOnStateName(context, widgetDict);
        // /AP on-state names may be numeric while /Opt exports are labels.
        // Validate their /Kids alignment, but do not select by label: several
        // widgets can have the same export label and distinct on-states.
        const exports = field.acroField.getExportValues();
        const option = exports ? exports[fieldWidgetIndex]?.decodeText?.() : onState;
        if (!onState || typeof option !== 'string') {
          recordFormSkip(diagnostics, 'radio-option-unresolved');
          return;
        }
        const onValue = PDFName.of(onState);
        if (isTruthyCheckValue(entry.value)) {
          // The AcroForm setter updates /V and every sibling /AS together.
          field.acroField.setValue(onValue);
          field.markAsDirty();
        } else if (field.acroField.getValue() === onValue) {
          field.clear();
        }
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const text = entry.value == null ? '' : String(entry.value);
        if (text === '') field.clear();
        else field.select(text);
      } else if (!writeRawFieldValue(pdfDoc, widgetDict, entry)) {
        recordFormSkip(diagnostics, 'unsupported-field-type');
        return;
      }
      diagnostics.formFieldValuesWritten += 1;
    } catch (error) {
      // A single stubborn field (an option the document does not declare, an
      // exotic encoding) must never sink the export — fall back to the raw
      // write, and only then give up on that one field.
      if (writeRawFieldValue(pdfDoc, widgetDict, entry)) {
        diagnostics.formFieldValuesWritten += 1;
      } else {
        recordFormSkip(diagnostics, `write-failed:${error?.message || 'unknown'}`);
      }
    }
  });

  if (form && diagnostics.formFieldValuesWritten > 0) {
    try {
      form.updateFieldAppearances();
      diagnostics.formFieldAppearancesUpdated = true;
    } catch (error) {
      // Values are already in /V; without a generated appearance a viewer that
      // honours NeedAppearances still shows them, so keep the export alive.
      diagnostics.formFieldAppearanceError = error?.message || 'unknown';
      try {
        pdfDoc.catalog.getOrCreateAcroForm().dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      } catch { /* noop */ }
    }
  }

  return diagnostics;
};
