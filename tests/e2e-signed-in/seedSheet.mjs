// A one-page PDF of the owner's own, made for one spec and removed after,
// so a spec that draws never leaves marks on the shared sample document.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor } from './helpers.mjs';

// `lines`: vector lines drawn on page 1, in page units (origin top-left, y
// down, as the overlay reads them): [{ x1, y1, x2, y2 }].
export async function seedSheet(label, { size = [612, 792], pages = 1, lines = [] } = {}) {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n += 1) {
    const sheet = pdf.addPage(size);
    sheet.drawText(pages > 1 ? `${label} sheet page ${n}` : `${label} sheet`, { x: 72, y: size[1] - 72, size: 20, font });
    if (n === 1) {
      for (const l of lines) {
        sheet.drawLine({ start: { x: l.x1, y: size[1] - l.y1 }, end: { x: l.x2, y: size[1] - l.y2 }, thickness: 1, color: rgb(0, 0, 0) });
      }
    }
  }
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.pdf`;
  const name = `${label} ${RUN} ${id.slice(0, 6)}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: pages,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return {
    name,
    remove: async () => {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([path]);
    },
  };
}
