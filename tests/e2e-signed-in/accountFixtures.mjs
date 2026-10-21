// Throwaway accounts with files, media and markup, for the account-wide specs
// (delete-account, export-account). Each spec run gets its own RUN tag.
import crypto from 'node:crypto';
import { expect } from './helpers.mjs';

const API = () => process.env.E2E_SUPABASE_URL;
const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;
export const RUN = crypto.randomBytes(3).toString('hex');
export const PDF = new Blob(['%PDF-1.7\n%%EOF\n'], { type: 'application/pdf' });
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])], { type: 'image/jpeg' });

export async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function makeUser(admin, name) {
  const account = { email: `${name}-${RUN}@example.test`, password: `Pw-${crypto.randomUUID()}` };
  const { user } = await must(`create ${name}`, admin.auth.admin.createUser({ ...account, email_confirm: true }));
  return { ...account, id: user.id };
}

export async function signInToken(account) {
  const res = await fetch(`${API()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const body = await res.json();
  expect(body.access_token, JSON.stringify(body)).toBeTruthy();
  return body.access_token;
}

export async function addDocument(admin, owner, { projectId = null, name, sha = null }) {
  const id = crypto.randomUUID();
  const filePath = `${owner.id}/${id}.pdf`;
  await must('upload pdf', admin.storage.from('documents').upload(filePath, PDF, { contentType: 'application/pdf' }));
  await must('document row', admin.from('documents').insert({
    id, user_id: owner.id, project_id: projectId, name, file_path: filePath, file_size: PDF.size, page_count: 1,
    content_sha256: sha,
  }));
  return { id, filePath };
}

// Survey media is keyed by document, whoever took the photo.
export async function addMedia(admin, documentId) {
  const path = `${documentId}/marker-${RUN}/${crypto.randomUUID()}.jpg`;
  await must('upload media', admin.storage.from('survey-media').upload(path, JPEG, { contentType: 'image/jpeg' }));
  return path;
}

export async function addMarkup(admin, documentId, author) {
  const annotationId = `markup-${RUN}-${crypto.randomUUID()}`;
  await must('annotation', admin.from('document_annotations').insert({
    document_id: documentId, user_id: author.id, annotation_id: annotationId, annotation_type: 'survey-marker',
    page_number: 1, bounds: { x: 1, y: 1, width: 10, height: 10 }, annotation_data: { type: 'rect' },
  }));
  return annotationId;
}

export async function exists(admin, bucket, path) {
  const slash = path.lastIndexOf('/');
  const { data } = await admin.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1) });
  return (data || []).some((o) => o.name === path.slice(slash + 1));
}
