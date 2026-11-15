// ExcelJS writes a sheet's filter buttons (`worksheet.autoFilter`) but not the
// hidden name Excel keeps beside them (_xlnm._FilterDatabase). Excel opens the
// buttons without it; LibreOffice drops them (checked 11-15). This adds the name
// for every sheet with filter buttons, so the buttons survive in either.
//
// JSZip is passed in (loaded on demand, like the report's chart step).

const xmlEscape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = (text) => String(text).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const absolute = (ref) => ref.split(':').map((cell) => cell.replace(/^([A-Z]+)(\d+)$/i, '$$$1$$$2')).join(':');

/** The workbook bytes with a filter name for each sheet that has filter buttons. */
export async function addFilterNames(JSZip, bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const book = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  if (!book || !rels) return bytes;
  let bookXml = await book.async('string');
  const relsXml = await rels.async('string');
  const targetOf = new Map([...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [
    (/\bId="([^"]+)"/.exec(tag) || [])[1], (/\bTarget="([^"]+)"/.exec(tag) || [])[1],
  ]));
  const sheets = [...bookXml.matchAll(/<sheet\b[^>]*\/>/g)].map(([tag]) => ({
    name: xmlUnescape((/\bname="([^"]*)"/.exec(tag) || [])[1] || ''),
    rid: (/\br:id="([^"]+)"/.exec(tag) || [])[1],
  }));
  const names = [];
  for (const [index, sheet] of sheets.entries()) {
    const target = String(targetOf.get(sheet.rid) || '').replace(/^\/?(xl\/)?/, '');
    const file = target && zip.file(`xl/${target}`);
    if (!file) continue;
    const ref = (/<autoFilter\b[^>]*\bref="([A-Z]+\d+(?::[A-Z]+\d+)?)"/i.exec(await file.async('string')) || [])[1];
    if (!ref) continue;
    const already = new RegExp(`<definedName\\b[^>]*name="_xlnm\\._FilterDatabase"[^>]*localSheetId="${index}"`).test(bookXml);
    if (already) continue;
    names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${xmlEscape(sheet.name.replace(/'/g, "''"))}'!${absolute(ref)}</definedName>`);
  }
  if (!names.length) return bytes;
  if (/<definedNames\s*\/>/.test(bookXml)) bookXml = bookXml.replace(/<definedNames\s*\/>/, `<definedNames>${names.join('')}</definedNames>`);
  else if (/<definedNames>/.test(bookXml)) bookXml = bookXml.replace('<definedNames>', `<definedNames>${names.join('')}`);
  else bookXml = bookXml.replace('</sheets>', `</sheets><definedNames>${names.join('')}</definedNames>`);
  zip.file('xl/workbook.xml', bookXml);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
