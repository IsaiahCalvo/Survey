import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, degrees, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { reflectPdfPagePresentations, normalizePresentationPdf } from '../src/utils/pdfPagePresentation.js';
import { clientPointInPageFrame } from '../src/utils/pagePresentation.js';
import { clientRectToPageQuad } from '../src/utils/pdfTextMarkup.js';

async function fixture(rotation=0, crop=false) {
  const pdf=await PDFDocument.create(), page=pdf.addPage([200,160]);
  page.setRotation(degrees(rotation));
  if (crop) page.setCropBox(5,10,180,140);
  page.drawRectangle({x:15,y:20,width:40,height:70,color:rgb(1,0,0)});
  page.drawRectangle({x:125,y:100,width:20,height:35,color:rgb(0,1,0)});
  const ap=pdf.context.register(pdf.context.stream('0 0 1 rg 0 0 m 20 0 l 0 15 l h f', { Type:'XObject', Subtype:'Form', BBox:[0,0,20,15], Resources:{} }));
  const annot=pdf.context.obj({Type:'Annot',Subtype:'Stamp',Rect:[65,40,85,55],AP:{N:ap},SurveyAppGeometry:'original-geometry'});
  page.node.addAnnot(pdf.context.register(annot));
  const link=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[20,110,60,130],Border:[0,0,0],A:{S:'URI',URI:'https://example.test/'}});
  page.node.addAnnot(pdf.context.register(link));
  return pdf;
}
async function raster(bytes) {
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false});
  const doc=await task.promise, page=await doc.getPage(1), viewport=page.getViewport({scale:1});
  const canvas=createCanvas(viewport.width,viewport.height),ctx=canvas.getContext('2d');
  await page.render({canvasContext:ctx,viewport,annotationMode:pdfjs.AnnotationMode.ENABLE}).promise;
  const result={width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
  await task.destroy();return result;
}
for (const crop of [false,true]) for (const rotation of [0,90,180,270]) for (const [mirrorH,mirrorV] of [[true,false],[false,true],[true,true]]) {
  test(`physical ${mirrorH?'H':''}${mirrorV?'V':''} reflection at /Rotate ${rotation}${crop?' cropped':''} includes native appearance and round-trips`,async()=>{
    const pdf=await fixture(rotation,crop), original=await pdf.save({useObjectStreams:false});
    await reflectPdfPagePresentations(pdf,{1:{mirrorH,mirrorV}});
    const mirrored=await pdf.save({useObjectStreams:false});
    const [before,after]=await Promise.all([raster(original),raster(mirrored)]);
    let different=0;
    for(let y=0;y<before.height;y++)for(let x=0;x<before.width;x++) {
      const target=(y*before.width+x)*4, source=((mirrorV?before.height-y-1:y)*before.width+(mirrorH?before.width-x-1:x))*4;
      if([0,1,2,3].some(channel=>Math.abs(after.data[target+channel]-before.data[source+channel])>3))different++;
    }
    assert.ok(different/(before.width*before.height)<0.005,`reflected raster differed at ${different} pixels`);
    const normalized=await normalizePresentationPdf(mirrored);
    assert.equal(normalized.presentations[1].mirrorH,mirrorH);
    assert.equal(normalized.presentations[1].mirrorV,mirrorV);
    const restored=await PDFDocument.load(normalized.bytes),annot=restored.getPage(0).node.Annots().lookup(0);
    assert.deepEqual(annot.lookup(PDFName.of('Rect'),PDFArray).asArray().map(value=>value.asNumber()),[65,40,85,55]);
    assert.equal(annot.lookup(PDFName.of('SurveyAppGeometry')).decodeText(),'original-geometry');
    const restoredPixels=await raster(normalized.bytes);
    assert.deepEqual(restoredPixels.data,before.data);
  });
}
test('pointer and native text quads invert page reflection without changing zoom measurement',()=>{
  const frame={left:10,top:20,width:200,height:100,mirrorH:true,mirrorV:true};
  assert.deepEqual(clientPointInPageFrame({clientX:50,clientY:50},frame,{width:400,height:200}),{x:320,y:140});
  assert.deepEqual(clientRectToPageQuad({left:30,right:50,top:30,bottom:50},frame,{width:400,height:200}),{x1:320,y1:140,x2:360,y2:140,x3:320,y3:180,x4:360,y4:180});
});

test('native form field names, values, appearance and hit rectangles survive reflected export',async()=>{
  const pdf=await fixture(),field=pdf.getForm().createTextField('Room name');
  field.setText('East room');field.addToPage(pdf.getPage(0),{x:90,y:20,width:60,height:20});
  const original=await pdf.save({useObjectStreams:false});
  await reflectPdfPagePresentations(pdf,{1:{mirrorH:true}});
  const projected=await pdf.save({useObjectStreams:false,updateFieldAppearances:false});
  const normalized=await normalizePresentationPdf(projected);
  const restored=await PDFDocument.load(normalized.bytes);
  assert.equal(restored.getForm().getTextField('Room name').getText(),'East room');
  const pixels=await raster(normalized.bytes),originalPixels=await raster(original);
  assert.deepEqual(pixels.data,originalPixels.data);
});

test('editable app annotation export preserves original geometry through tagged normalization',async()=>{
  const {savePDFWithAnnotationsPdfLib}=await import('../src/utils/pdfAnnotationsPdfLib.js');
  const {PDF_APP_ANNOTATION_METADATA_KEY,parsePdfAppAnnotationMetadata}=await import('../src/utils/pdfAppAnnotationMetadata.js');
  const pdf=await fixture(),file=new File([await pdf.save()], 'mirror-source.pdf',{type:'application/pdf'});
  const mark={id:'mirror-rect',type:'rect',tool:'rect',left:35,top:25,width:45,height:30,scaleX:1,scaleY:1,angle:0,fill:'transparent',stroke:'#ff0000',strokeWidth:2,data:{id:'mirror-rect'}};
  const exported=await savePDFWithAnnotationsPdfLib(file,{1:{objects:[mark]}},{1:{width:200,height:160}},null,{returnBytes:true,pageTransformations:{1:{mirrorH:true,mirrorV:true}}});
  const normalized=await normalizePresentationPdf(exported);
  const restored=await PDFDocument.load(normalized.bytes);
  const metadata=restored.getPage(0).node.Annots().asArray().map(ref=>restored.context.lookup(ref).lookup(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY))?.decodeText?.()).map(parsePdfAppAnnotationMetadata).find(value=>value?.id==='mirror-rect');
  assert.ok(metadata);
  assert.equal(metadata.geometry.left,mark.left);
  assert.equal(metadata.geometry.top,mark.top);
  assert.equal(metadata.geometry.width,mark.width);
  assert.equal(metadata.geometry.height,mark.height);
});
