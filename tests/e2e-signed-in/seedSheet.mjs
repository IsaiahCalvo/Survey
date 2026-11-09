// A one-page PDF of the owner's own, made for one spec and removed after,
// so a spec that draws never leaves marks on the shared sample document.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor } from './helpers.mjs';

export async function seedSheet(label, { size = [612, 792] } = {}) {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage(size).drawText(`${label} sheet`, { x: 72, y: size[1] - 72, size: 20, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.pdf`;
  const name = `${label} ${RUN} ${id.slice(0, 6)}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: 1,
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
