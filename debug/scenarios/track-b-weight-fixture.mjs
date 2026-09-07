import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
export async function weightFixture() {
  const doc=await PDFDocument.create(); const page=doc.addPage([612,792]);
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const refs=[];
  for(const [i,subtype] of ['Underline','StrikeOut','Squiggly'].entries()) {
    const y=650-i*75;
    page.drawText('Authored weight stays on this line',{x:70,y,font,size:18});
    refs.push(doc.context.register(doc.context.obj({Type:'Annot',Subtype:subtype,F:4,
      Rect:[70,y-4,350,y+18],QuadPoints:[70,y+18,350,y+18,70,y-4,350,y-4],C:[0,0,1],
      ...(i===1 ? {Border:[0,0,5]} : {BS:{W:i===0?3:0.5,S:PDFName.of('S')}}),
    })));
  }
  page.node.set(PDFName.of('Annots'),doc.context.obj(refs));
  return doc.save();
}
