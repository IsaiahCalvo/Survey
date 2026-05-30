// pageAnnotationReindex — pure helper that shifts the per-page annotation model
// when pages are added/removed/moved, so annotations follow their page instead
// of staying glued to a now-stale page number (the page-operation data-loss bug).
//
// The model is the five page-addressed stores the viewer owns:
//   - annotationsByPage:   { [pageNumber]: { objects: [...] } }   (page-keyed)
//   - pageNames:           { [pageNumber]: string }               (page-keyed)
//   - pageTransformations: { [pageNumber]: {...} }                (page-keyed)
//   - surveyMarkers:       { [id]: { pageNumber, ... } }          (id-keyed, page field)
//   - callouts:            [ { pageNumber, ... } ]                (list, page field)
//
// Every operation is expressed as a single page-number remap `mapPage(old) ->
// new | null` (null = the item is on a removed page and is dropped). Pure and
// non-mutating: returns a fresh model; input is untouched.

function applyPageMap(model, mapPage) {
  const remapPageKeyed = (obj) => {
    const out = {};
    for (const key of Object.keys(obj || {})) {
      const np = mapPage(Number(key));
      if (np == null) continue;
      out[np] = obj[key];
    }
    return out;
  };
  const remapIdKeyed = (byId) => {
    const out = {};
    for (const id of Object.keys(byId || {})) {
      const item = byId[id];
      const np = mapPage(Number(item?.pageNumber));
      if (np == null) continue;
      out[id] = { ...item, pageNumber: np };
    }
    return out;
  };
  const remapList = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) => {
        const np = mapPage(Number(item?.pageNumber));
        return np == null ? null : { ...item, pageNumber: np };
      })
      .filter(Boolean);

  return {
    annotationsByPage: remapPageKeyed(model.annotationsByPage),
    surveyMarkers: remapIdKeyed(model.surveyMarkers),
    callouts: remapList(model.callouts),
    pageNames: remapPageKeyed(model.pageNames),
    pageTransformations: remapPageKeyed(model.pageTransformations),
  };
}

// op shapes:
//   { type: 'delete',    page: N }      remove page N, shift pages > N down by 1
//   { type: 'insert',    afterPage: N } new blank page at N+1, shift pages > N up by 1
//   { type: 'duplicate', page: N }      new page at N+1 (existing annotations shift up; new page starts empty)
//   { type: 'reorder',   from: S, to: T } move page S to position T
export function reindexAnnotationModel(model, op) {
  switch (op?.type) {
    case 'delete': {
      const n = op.page;
      return applyPageMap(model, (p) => (p < n ? p : p === n ? null : p - 1));
    }
    case 'insert': {
      // New blank page lands at afterPage + 1; everything above shifts up.
      const n = op.afterPage;
      return applyPageMap(model, (p) => (p <= n ? p : p + 1));
    }
    case 'duplicate': {
      // The duplicate lands at page + 1. Existing annotations shift up exactly
      // like an insert; the duplicated page starts empty (copying annotations
      // onto it is a deliberate follow-up that must regenerate marker/callout ids).
      const n = op.page;
      return applyPageMap(model, (p) => (p <= n ? p : p + 1));
    }
    case 'reorder': {
      // Move page `from` to position `to`; only the pages between them shift.
      const s = op.from;
      const t = op.to;
      return applyPageMap(model, (p) => {
        if (p === s) return t;
        if (s < t) return p > s && p <= t ? p - 1 : p;
        if (s > t) return p >= t && p < s ? p + 1 : p;
        return p;
      });
    }
    default:
      throw new Error(`reindexAnnotationModel: unknown op type ${op?.type}`);
  }
}
