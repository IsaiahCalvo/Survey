// AcroForm values for the XFDF <fields> block (KAL-393).
//
// The PDF export (KAL-441) writes values typed into a PDF's own form fields
// straight into the AcroForm. XFDF has a standard place for those values, so
// the sidecar carries every field whose value differs from the source PDF.
// Anything unexpected here is skipped: form values are a bonus, and they must
// never stop the annotation export.

import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';
import { escapeXml } from './xfdfXml.js';

function fieldValue(field) {
  if (field instanceof PDFTextField) return [field.getText() ?? ''];
  if (field instanceof PDFCheckBox) {
    if (!field.isChecked()) return ['Off'];
    let onValue = 'Yes';
    try {
      onValue = field.acroField.getOnValue()?.decodeText?.() || 'Yes';
    } catch { /* keep Yes */ }
    return [onValue];
  }
  if (field instanceof PDFRadioGroup) return [field.getSelected() ?? 'Off'];
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected();
  return null;
}

export function readFormValues(pdfDoc) {
  const values = new Map();
  let fields = [];
  try {
    fields = pdfDoc.getForm().getFields();
  } catch {
    return values;
  }
  for (const field of fields) {
    try {
      const value = fieldValue(field);
      if (value) values.set(field.getName(), value);
    } catch { /* unreadable field: skip */ }
  }
  return values;
}

export function changedFormValues(sourceDoc, annotatedDoc) {
  const before = readFormValues(sourceDoc);
  const after = readFormValues(annotatedDoc);
  const changed = [];
  for (const [name, value] of after) {
    if (JSON.stringify(before.get(name) ?? null) !== JSON.stringify(value)) {
      changed.push({ name, value });
    }
  }
  return changed;
}

// XFDF nests fields by partial name: "a.b" -> <field name="a"><field name="b">.
export function formValuesToXfdf(changed, indent = '  ') {
  if (!changed.length) return null;
  const root = new Map();
  for (const { name, value } of changed) {
    let level = root;
    const parts = String(name).split('.');
    parts.forEach((part, index) => {
      if (!level.has(part)) level.set(part, { children: new Map(), value: null });
      const node = level.get(part);
      if (index === parts.length - 1) node.value = value;
      level = node.children;
    });
  }
  const render = (level, depth) => [...level.entries()].map(([part, node]) => {
    const pad = indent.repeat(depth);
    const valueLines = (node.value || []).map((v) => `${pad}${indent}<value>${escapeXml(v)}</value>`);
    const childLines = render(node.children, depth + 1);
    return [`${pad}<field name="${escapeXml(part)}">`, ...valueLines, ...childLines, `${pad}</field>`].join('\n');
  });
  return [`${indent}<fields>`, ...render(root, 2), `${indent}</fields>`].join('\n');
}
