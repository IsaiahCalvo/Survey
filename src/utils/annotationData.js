// Annotation data helpers — color patch composition + Y.Map → Fabric annotation materialization. Lifted verbatim from PDFViewer; all capture-free.

export function composeColorForPatch(hex, opacityPct) {
    if (!hex || hex === 'transparent') return 'transparent';
    const alpha = Math.max(0, Math.min(1, (opacityPct ?? 100) / 100));
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hex;
  }

export function materializeFabricAnnotationFromYMap(annoYMap, fallbackId = null) {
    if (!annoYMap || typeof annoYMap.get !== 'function') return null;
    const fabricYMap = annoYMap.get('fabric');
    let fabricObj = null;
    if (fabricYMap?.toJSON) {
      try { fabricObj = fabricYMap.toJSON(); } catch (_err) { fabricObj = null; }
    }
    if (!fabricObj && fabricYMap?.forEach) {
      fabricObj = {};
      fabricYMap.forEach((value, key) => { fabricObj[key] = value; });
    }
    if (!fabricObj) return null;
    const id = annoYMap.get('id') || fallbackId || fabricObj?.data?.id || fabricObj?.id;
    if (!fabricObj.data || typeof fabricObj.data !== 'object') fabricObj.data = {};
    if (id && !fabricObj.data.id) fabricObj.data.id = id;
    if (id && !fabricObj.id) fabricObj.id = id;
    const pageNumber = annoYMap.get('pageNumber') ?? fabricObj?.data?.pageNumber ?? fabricObj?.pageNumber ?? 1;
    fabricObj.data.pageNumber = pageNumber;
    try {
      const metaYMap = annoYMap.get('meta');
      if (metaYMap && typeof metaYMap.get === 'function') {
        const authorId = metaYMap.get('authorId');
        if (authorId) {
          fabricObj.meta = { ...(fabricObj.meta || {}), authorId: fabricObj.meta?.authorId || authorId };
        }
        const lastEditorId = metaYMap.get('lastEditorId');
        if (lastEditorId) fabricObj.lastEditorId = fabricObj.lastEditorId || lastEditorId;
      }
    } catch (_err) {
      // Best-effort attribution hydration for local materialization only.
    }
    return { fabricObj, id, pageNumber };
  }
