import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { weightFixture } from '../debug/scenarios/track-b-weight-fixture.mjs';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { adaptUnderline,adaptStrikeOut,adaptSquiggly } from '../src/utils/pdfNativeExport/adapters/textMarkup.js';
import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';
import { inflateSync } from 'node:zlib';

test('B11: BS and legacy Border weights survive native import, export and print',async()=>{
 const bytes=await weightFixture(); const input=await pdfjs.getDocument({data:bytes.slice()}).promise;
 const imported=await importAnnotationsFromPdf(input,{rawPdfBytes:bytes});
 const objects=imported.annotationsByPage[1].objects;
 assert.deepEqual(objects.map(o=>o.data.lineWidth),[3,5,0.5]);
 const out=await PDFDocument.create(); const page=out.addPage([612,792]);
 for(const [i,adapt] of [adaptUnderline,adaptStrikeOut,adaptSquiggly].entries()) {
   const ref=adapt(objects[i],{pdfDoc:out,page,pageHeight:792});
   assert.equal(out.context.lookup(ref).lookup(PDFName.of('BS')).lookup(PDFName.of('W')).asNumber(),[3,5,0.5][i]);
 }
 const printed=await savePDFWithFlattenedRegularAnnotationsForPrint(
   {name:'weights.pdf',arrayBuffer:async()=>bytes.slice().buffer},imported.annotationsByPage,
   {1:{width:612,height:792}},{actionType:'test-print-weight'});
 const pdf=await PDFDocument.load(printed);const contents=pdf.getPage(0).node.Contents();
 const streams=Array.from({length:contents.size()},(_,i)=>contents.lookup(i));
 const paint=streams.map(s=>inflateSync(s.getContents()).toString()).join('\n');
 for(const width of [3,5,0.5]) assert.ok(paint.includes(`${width} w`),`print must paint ${width}pt stroke`);
 await input.cleanup();
});
