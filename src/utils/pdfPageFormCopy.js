import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';

const name = PDFName.of;
const fail = (reason) => { throw new Error(`This PDF form cannot safely change pages: ${reason}`); };
const isWidget = (dict) => dict instanceof PDFDict && dict.get(name('Subtype')) === name('Widget');
const fieldId = (ref) => `${ref.objectNumber}R${ref.generationNumber || ''}`;
const inheritedKeys = ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'Opt', 'MaxLen', 'TI', 'I', 'DS', 'RV'];
const widgetKeys = ['Type', 'Subtype', 'Rect', 'P', 'AP', 'AS', 'MK', 'F', 'Border', 'BS', 'H', 'OC'];

function annotations(pdf, page) {
  const raw = page.node.get(name('Annots'));
  if (!raw) return [];
  const array = pdf.context.lookup(raw);
  if (!(array instanceof PDFArray)) fail('invalid page annotations');
  return array.asArray().map(ref => {
    const dict = pdf.context.lookup(ref);
    if (!(dict instanceof PDFDict)) fail('invalid annotation dictionary');
    return { ref, dict };
  });
}

// Direct dictionaries have PDF.js-generated page/counter IDs, not PDFRefs.
// Even a move/insert can rename them. Never guess that runtime identity.
export function assertStablePageWidgetIdentities(pdf) {
  if (pdf.catalog.getAcroForm()?.dict.has(name('XFA'))) fail('XFA forms are not supported');
  for (const page of pdf.getPages()) {
    for (const { ref, dict } of annotations(pdf, page)) {
      if (isWidget(dict) && !(ref instanceof PDFRef)) fail('direct widget identity is not stable');
    }
  }
}

// Clone mutable containers, but keep immutable streams (appearance/font bytes)
// in this same private PDF context. Sharing AP/MK dictionaries would let a later
// appearance update on the clone change the original widget's appearance.
function cloneContainers(context, value, seen = new Map(), active = new Set()) {
  const resolved = context.lookup(value);
  if (!(resolved instanceof PDFDict) && !(resolved instanceof PDFArray)) return value;
  if (active.has(resolved) || active.size > 64) fail('cyclic or deeply nested field data');
  if (seen.has(resolved)) return seen.get(resolved);
  if (seen.size > 4096) fail('field data is too complex');
  const copied = context.obj(resolved instanceof PDFArray ? [] : {});
  seen.set(resolved, copied);
  active.add(resolved);
  if (resolved instanceof PDFArray) {
    for (const item of resolved.asArray()) copied.push(cloneContainers(context, item, seen, active));
  } else {
    for (const [key, item] of resolved.entries()) copied.set(key, cloneContainers(context, item, seen, active));
  }
  active.delete(resolved);
  return copied;
}

function registeredWidgets(pdf) {
  const acro = pdf.catalog.getAcroForm();
  const widgets = new Map(), names = new Set(), visited = new Set();
  if (!acro) return { widgets, names, acro };
  const root = acro.Fields();
  const walk = (ref, inherited, prefix, depth) => {
    if (!(ref instanceof PDFRef) || depth > 64 || visited.has(ref) || visited.size > 100000) fail('invalid or cyclic field tree');
    visited.add(ref);
    const dict = pdf.context.lookup(ref);
    if (!(dict instanceof PDFDict)) fail('invalid registered field');
    if (dict.has(name('A')) || dict.has(name('AA'))) fail('field actions need explicit remapping');
    const values = { ...inherited };
    for (const key of inheritedKeys) if (dict.has(name(key))) values[key] = dict.get(name(key));
    const partial = pdf.context.lookup(dict.get(name('T')));
    if (partial && !(partial instanceof PDFString) && !(partial instanceof PDFHexString)) fail('invalid field name');
    const fullName = [prefix, partial?.decodeText()].filter(Boolean).join('.');
    if (fullName) names.add(fullName);
    const rawKids = dict.get(name('Kids'));
    const kids = rawKids ? pdf.context.lookup(rawKids) : null;
    if (kids && !(kids instanceof PDFArray)) fail('invalid field children');
    const entries = kids?.asArray() || [];
    // A named Widget may itself be a merged terminal field under a nonterminal
    // group. Its own /T starts a field, not another widget of the parent field.
    const widgetChildren = entries.filter(child => {
      const childDict = pdf.context.lookup(child);
      return isWidget(childDict) && !childDict.has(name('T'));
    });
    if (entries.length && !widgetChildren.length) {
      for (const child of entries) walk(child, values, fullName, depth + 1);
      return;
    }
    if (widgetChildren.length !== entries.length) fail('mixed field/widget children');
    const refs = entries.length ? entries : isWidget(dict) ? [ref] : [];
    const group = { ref, dict, values, refs, fullName };
    for (const child of refs) {
      if (!(child instanceof PDFRef) || widgets.has(child)) fail('ambiguous registered widget');
      const childDict = pdf.context.lookup(child);
      if (child !== ref && childDict.get(name('Parent')) !== ref) fail('widget parent does not match its field');
      widgets.set(child, group);
    }
  };
  for (const ref of root?.asArray() || []) walk(ref, {}, '', 0);
  return { widgets, names, acro };
}

export async function copyPageWithForms(pdf, sourcePage, targetPage) {
  const source = pdf.getPage(sourcePage - 1), entries = annotations(pdf, source);
  const selected = entries.filter(({ dict }) => isWidget(dict));
  const { widgets, names, acro } = selected.length ? registeredWidgets(pdf) : { widgets: new Map(), names: new Set() };
  const groups = new Map();
  for (const entry of selected) {
    const group = widgets.get(entry.ref);
    if (!group) fail('widget is not registered in AcroForm');
    if (entry.dict.has(name('A')) || entry.dict.has(name('AA'))) fail('widget actions need explicit remapping');
    const type = pdf.context.lookup(group.values.FT);
    const flags = pdf.context.lookup(group.values.Ff);
    if (!['Tx', 'Btn', 'Ch'].some(value => type === name(value))
      || (type === name('Btn') && flags instanceof PDFNumber && (flags.asNumber() & 65536))) {
      fail('this field type is not supported for copying');
    }
    if (!groups.has(group)) groups.set(group, new Map());
    groups.get(group).set(entry.ref, entry.dict);
  }

  // copyPages recursively copies Parent/Kids/P links. Remove only source-page
  // widgets while copying content, then restore the exact source Annots object.
  const oldAnnots = source.node.get(name('Annots'));
  let copied;
  try {
    if (selected.length) source.node.set(name('Annots'), pdf.context.obj(entries.filter(({ dict }) => !isWidget(dict)).map(({ ref }) => ref)));
    [copied] = await pdf.copyPages(pdf, [sourcePage - 1]);
  } finally {
    if (oldAnnots) source.node.set(name('Annots'), oldAnnots);
    else source.node.delete(name('Annots'));
  }
  pdf.insertPage(targetPage - 1, copied);
  const copiedWidgets = [];
  for (const [group, selectedByRef] of groups) {
    let suffix = 1, targetFieldName;
    do { targetFieldName = `SurveyCopy_${group.ref.objectNumber}_${suffix++}`; } while (names.has(targetFieldName));
    names.add(targetFieldName);
    const field = pdf.context.obj({});
    for (const [key, value] of group.dict.entries()) {
      if (['Parent', 'Kids', 'T', ...widgetKeys].includes(key.decodeText())) continue;
      field.set(key, cloneContainers(pdf.context, value));
    }
    for (const [key, value] of Object.entries(group.values)) field.set(name(key), cloneContainers(pdf.context, value));
    field.set(name('T'), PDFHexString.fromText(targetFieldName));
    const fieldRef = pdf.context.register(field), kids = pdf.context.obj([]);
    field.set(name('Kids'), kids);
    const selectedRefs = group.refs.filter(ref => selectedByRef.has(ref));
    if (pdf.context.lookup(group.values.FT) === name('Btn') && group.values.Opt) {
      const opt = pdf.context.lookup(group.values.Opt);
      const choices = opt instanceof PDFArray ? opt.asArray() : [opt];
      if (choices.length !== group.refs.length || choices.some(value => {
        const item = pdf.context.lookup(value);
        return !(item instanceof PDFString) && !(item instanceof PDFHexString);
      })) fail('button export values do not match its widgets');
      field.set(name('Opt'), pdf.context.obj(selectedRefs.map(ref => cloneContainers(pdf.context, choices[group.refs.indexOf(ref)]))));
    }
    for (const sourceRef of selectedRefs) {
      const original = selectedByRef.get(sourceRef), widget = pdf.context.obj({});
      for (const [key, value] of original.entries()) {
        // Field attributes live on the new registered parent, including /V.
        if (['Parent', 'Kids', 'P', 'T', ...inheritedKeys].includes(key.decodeText())) continue;
        widget.set(key, cloneContainers(pdf.context, value));
      }
      widget.set(name('P'), copied.ref); widget.set(name('Parent'), fieldRef);
      const widgetRef = pdf.context.register(widget);
      kids.push(widgetRef); copied.node.addAnnot(widgetRef);
      copiedWidgets.push({ sourcePage, targetPage, sourceFieldId: fieldId(sourceRef), targetFieldId: fieldId(widgetRef), targetFieldName });
    }
    // A radio selection on an off-page sibling is not a selection in the new
    // independent group. Preserve selected copied options, otherwise use Off.
    if (pdf.context.lookup(group.values.FT) === name('Btn')) {
      const onValues = new Set();
      for (const sourceRef of selectedRefs) {
        const ap = pdf.context.lookup(selectedByRef.get(sourceRef).get(name('AP')));
        const normal = ap instanceof PDFDict ? pdf.context.lookup(ap.get(name('N'))) : null;
        if (normal instanceof PDFDict) for (const [key] of normal.entries()) if (key !== name('Off')) onValues.add(key);
      }
      for (const key of ['V', 'DV']) {
        const current = pdf.context.lookup(field.get(name(key)));
        if (current instanceof PDFName && current !== name('Off') && !onValues.has(current)) field.set(name(key), name('Off'));
      }
    }
    acro.addField(fieldRef);
  }
  return copiedWidgets;
}
