/**
 * KAL-441 fixture generator — a PDF whose AcroForm covers every widget kind the
 * app's form layer can render, so "values typed into a form must survive export"
 * can be checked by hand and by the round-trip test.
 *
 * Run:  node scripts/kal441-form-fields-fixture.mjs
 * Writes: debug/fixtures/kal441-form-fields.pdf
 *
 * What is in it (one page, 480 x 380):
 *   - "surveyor.name"     single-line text
 *   - "surveyor.notes"    multiline text
 *   - "inspection.date"   single-line text (a second text field, different page
 *                         position, so a two-field export is exercised)
 *   - "approved"          checkbox
 *   - "condition"         radio group with three options (Good / Fair / Poor)
 *   - "discipline"        dropdown (Civil / Electrical / Mechanical)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'debug', 'fixtures', 'kal441-form-fields.pdf');

const pdf = await PDFDocument.create();
const page = pdf.addPage([480, 380]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const form = pdf.getForm();

const label = (text, x, y) => {
  page.drawText(text, { x, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
};

label('Surveyor name', 40, 340);
const name = form.createTextField('surveyor.name');
name.setText('');
name.addToPage(page, { x: 40, y: 316, width: 240, height: 20, font });

label('Inspection date', 300, 340);
const date = form.createTextField('inspection.date');
date.addToPage(page, { x: 300, y: 316, width: 140, height: 20, font });

label('Notes', 40, 292);
const notes = form.createTextField('surveyor.notes');
notes.enableMultiline();
notes.addToPage(page, { x: 40, y: 216, width: 400, height: 68, font });

label('Approved', 40, 192);
const approved = form.createCheckBox('approved');
approved.addToPage(page, { x: 110, y: 186, width: 14, height: 14 });

label('Condition', 40, 156);
const condition = form.createRadioGroup('condition');
condition.addOptionToPage('Good', page, { x: 110, y: 150, width: 14, height: 14 });
condition.addOptionToPage('Fair', page, { x: 190, y: 150, width: 14, height: 14 });
condition.addOptionToPage('Poor', page, { x: 270, y: 150, width: 14, height: 14 });
label('Good', 128, 153);
label('Fair', 208, 153);
label('Poor', 288, 153);

label('Discipline', 40, 116);
const discipline = form.createDropdown('discipline');
discipline.addOptions(['Civil', 'Electrical', 'Mechanical']);
discipline.addToPage(page, { x: 110, y: 108, width: 160, height: 20, font });

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, await pdf.save());
console.log(`Wrote ${outPath}`);
