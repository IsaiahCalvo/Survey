import { normalizePagePresentations } from './pagePresentation.js';
const TAG = 'SurveyPagePresentation';
const markerBytes = [...`/${TAG}`].map(character => character.charCodeAt(0));
export const pdfBytesHavePresentationTag = bytes => hasTag(bytes);
const hasTag = bytes => {
  const array = new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  for (let index = array.indexOf(markerBytes[0]); index >= 0 && index <= array.length - markerBytes.length; index = array.indexOf(markerBytes[0], index + 1)) {
    if (markerBytes.every((byte, offset) => array[index + offset] === byte)) return true;
  }
  return false;
};

export function pageReflectionMatrix(page, state) {
  const box = page.getCropBox();
  const turned = ((page.getRotation().angle % 180) + 180) % 180 !== 0;
  const flipX = turned ? state.mirrorV : state.mirrorH;
  const flipY = turned ? state.mirrorH : state.mirrorV;
  return [flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? 2 * box.x + box.width : 0, flipY ? 2 * box.y + box.height : 0];
}
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const point = (matrix, x, y) => [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]];

// Reflect physical page content and native annotation appearances together.
// App metadata stays in its original frame; the tag lets Survey undo this
// projection at open, then show the same mirrored presentation exactly once.
export async function reflectPdfPagePresentations(pdf, presentations, { stamp = true } = {}) {
  const { PDFArray, PDFDict, PDFName, PDFString } = await import('pdf-lib');
  const ctx = pdf.context;
  const state = normalizePagePresentations(presentations);
  const numbers = array => array.asArray().map(value => ctx.lookup(value).asNumber());
  const appearance = (value, flipX, flipY) => {
    const object = ctx.lookup(value);
    if (object?.dict && typeof object.getContents === 'function') {
      const stream = object.clone(ctx);
      const bbox = numbers(stream.dict.lookup(PDFName.of('BBox'), PDFArray));
      const old = stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
      const matrix = old ? numbers(old) : [1,0,0,1,0,0];
      const corners = [point(matrix,bbox[0],bbox[1]),point(matrix,bbox[2],bbox[1]),point(matrix,bbox[0],bbox[3]),point(matrix,bbox[2],bbox[3])];
      const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
      const reflect = [flipX ? -1 : 1,0,0,flipY ? -1 : 1,flipX ? Math.min(...xs)+Math.max(...xs) : 0,flipY ? Math.min(...ys)+Math.max(...ys) : 0];
      stream.dict.set(PDFName.of('Matrix'), ctx.obj(multiply(reflect,matrix)));
      return ctx.register(stream);
    }
    if (object instanceof PDFDict) {
      const result = object.clone(ctx);
      for (const [key, child] of object.entries()) result.set(key, appearance(child,flipX,flipY));
      return result;
    }
    return value;
  };
  for (const [pageNumber, presentation] of Object.entries(state)) {
    const page = pdf.getPages()[Number(pageNumber)-1];
    if (!page || (!presentation.mirrorH && !presentation.mirrorV)) continue;
    const matrix = pageReflectionMatrix(page,presentation);
    page.node.normalize();
    const prefix = ctx.register(ctx.stream(`q\n${matrix.join(' ')} cm\n`));
    const suffix = ctx.register(ctx.stream('\nQ\n'));
    page.node.wrapContentStreams(prefix,suffix);
    const annots = page.node.Annots();
    for (const reference of annots?.asArray() || []) {
      const annotation = ctx.lookup(reference,PDFDict);
      for (const name of ['Rect','QuadPoints','L','Vertices','CL']) {
        const coordinates = annotation.lookupMaybe(PDFName.of(name),PDFArray);
        if (!coordinates) continue;
        const list = numbers(coordinates);
        const reflected = [];
        for (let index=0; index+1<list.length; index+=2) reflected.push(...point(matrix,list[index],list[index+1]));
        if (name==='Rect' && reflected.length===4) annotation.set(PDFName.of(name),ctx.obj([Math.min(reflected[0],reflected[2]),Math.min(reflected[1],reflected[3]),Math.max(reflected[0],reflected[2]),Math.max(reflected[1],reflected[3])]));
        else annotation.set(PDFName.of(name),ctx.obj(reflected));
      }
      const ink = annotation.lookupMaybe(PDFName.of('InkList'),PDFArray);
      if (ink) annotation.set(PDFName.of('InkList'),ctx.obj(ink.asArray().map(run => { const values=numbers(ctx.lookup(run,PDFArray)); return values.flatMap((value,index)=>index%2===0 ? point(matrix,value,values[index+1]) : []); })));
      const ap = annotation.get(PDFName.of('AP'));
      if (ap) annotation.set(PDFName.of('AP'),appearance(ap,matrix[0]<0,matrix[3]<0));
    }
  }
  if (stamp && Object.values(state).some(value => value.mirrorH || value.mirrorV)) pdf.catalog.set(PDFName.of(TAG),PDFString.of(JSON.stringify(state)));
  else pdf.catalog.delete(PDFName.of(TAG));
}

export async function normalizePresentationPdf(bytes) {
  if (!hasTag(bytes)) return { bytes, presentations: null };
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  const tag = pdf.catalog.lookup(PDFName.of(TAG));
  if (!tag?.decodeText) return { bytes, presentations: null };
  const presentations = normalizePagePresentations(JSON.parse(tag.decodeText()));
  await reflectPdfPagePresentations(pdf,presentations,{ stamp: false });
  return { bytes: await pdf.save({ updateFieldAppearances: false, useObjectStreams: false }), presentations };
}
