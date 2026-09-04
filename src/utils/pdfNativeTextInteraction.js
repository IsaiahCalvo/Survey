const elementFor = (node) => (node?.nodeType === 3 ? node.parentElement : node);

export function selectionUsesPdfTextLayer(selection) {
  if (!selection || selection.isCollapsed) return false;
  return Boolean(
    elementFor(selection.anchorNode)?.closest?.('.pdfjsTextLayer, .textLayer'),
  );
}
