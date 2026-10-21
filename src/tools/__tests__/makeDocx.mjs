// Builds small .docx files for the Word to PDF tests.
import JSZip from 'jszip';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

const run = (text, { b, i, u } = {}) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${u ? '<w:u w:val="single"/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
export const para = (runs, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${(Array.isArray(runs) ? runs : [run(runs)]).join('')}</w:p>`;
export const listItem = (text) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
export const table = (rows) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
export { run };

export async function makeDocx(body, { extra = {} } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>`);
  zip.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  for (const [k, v] of Object.entries(extra)) zip.file(k, v);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}
