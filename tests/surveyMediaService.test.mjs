import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SURVEY_MEDIA_BUCKET,
  SURVEY_MEDIA_LIMITS,
  SURVEY_MEDIA_NOT_SET_UP_MESSAGE,
  __setSurveyMediaClientForTests,
  __setSurveyMediaImageToolsForTests,
  buildNoteWithMedia,
  checkSurveyMediaLimits,
  classifyMediaFile,
  deleteSurveyMedia,
  getSurveyMediaUrl,
  migrateLegacyNoteMedia,
  noteHasLegacyMedia,
  normalizeNoteMedia,
  removeSurveyMediaForDocument,
  sanitizeMarkerSegment,
  uploadSurveyMedia,
} from '../src/services/surveyMediaService.js';

const DOC = '11111111-2222-4333-8444-555555555555';
const MARKER = 'surveyMarker-0f0e0d0c-aaaa-4bbb-8ccc-000000000001';
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;

const pngDataUrl = (seed) => `data:image/png;base64,${Buffer.from(`png-bytes-${seed}`).toString('base64')}`;
const mp4DataUrl = (seed) => `data:video/mp4;base64,${Buffer.from(`mp4-bytes-${seed}`).toString('base64')}`;

// A file of a given size without allocating it.
const sizedFile = (name, type, size) => ({ name, type, size });

function mockClient({ uploadError = null, signError = null, listing = {} } = {}) {
  const calls = { upload: [], sign: [], remove: [], list: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' }, access_token: 'jwt' } } }) },
    storage: {
      from(bucket) {
        assert.equal(bucket, SURVEY_MEDIA_BUCKET);
        return {
          async upload(path, body, options) {
            calls.upload.push({ path, body, options });
            const error = typeof uploadError === 'function' ? uploadError(path, calls.upload.length) : uploadError;
            return error ? { data: null, error } : { data: { path }, error: null };
          },
          async createSignedUrl(path, ttl) {
            calls.sign.push({ path, ttl });
            if (signError) return { data: null, error: signError };
            return { data: { signedUrl: `https://storage.test/${path}?n=${calls.sign.length}` }, error: null };
          },
          async remove(paths) {
            calls.remove.push(paths);
            return { data: paths.map((name) => ({ name })), error: null };
          },
          async list(prefix) {
            calls.list.push(prefix);
            return { data: listing[prefix] || [], error: null };
          },
        };
      },
    },
  };
  return { client, calls };
}

// Image tools stand-in: "decodes" by reading dimensions from the blob name map.
function imageTools(dims = {}) {
  const encoded = [];
  return {
    encoded,
    tools: {
      async decode(blob) {
        const d = dims[blob.name] || dims['*'];
        return d ? { ...d } : null;
      },
      async encodeJpeg(image, width, height, quality) {
        encoded.push({ width, height, quality });
        return new Blob([new Uint8Array(1234)], { type: 'image/jpeg' });
      },
    },
  };
}

afterEach(() => {
  __setSurveyMediaClientForTests(null);
  __setSurveyMediaImageToolsForTests(null);
});

describe('classifyMediaFile', () => {
  it('maps storable photo, video and audio types and refuses the rest', () => {
    assert.equal(classifyMediaFile({ type: 'image/jpeg', name: 'a.jpg' }), 'photo');
    assert.equal(classifyMediaFile({ type: 'image/heic', name: 'IMG_1.HEIC' }), 'photo');
    assert.equal(classifyMediaFile({ type: 'image/gif', name: 'a.gif' }), 'photo', 'decodable, re-encoded to JPEG');
    assert.equal(classifyMediaFile({ type: 'image/svg+xml', name: 'a.svg' }), null);
    assert.equal(classifyMediaFile({ type: 'video/quicktime', name: 'IMG_2.MOV' }), 'video');
    assert.equal(classifyMediaFile({ type: 'video/x-m4v', name: 'a.m4v' }), 'video');
    assert.equal(classifyMediaFile({ type: 'video/x-msvideo', name: 'a.avi' }), null);
    assert.equal(classifyMediaFile({ type: 'audio/webm;codecs=opus', name: 'rec.webm' }), 'audio');
    assert.equal(classifyMediaFile({ type: 'audio/mp4', name: 'rec.m4a' }), 'audio');
    assert.equal(classifyMediaFile({ type: 'application/pdf', name: 'a.pdf' }), null);
    assert.equal(classifyMediaFile(null), null);
  });

  it('falls back to the extension when the browser gives no type', () => {
    assert.equal(classifyMediaFile({ type: '', name: 'voice.m4a' }), 'audio');
    assert.equal(classifyMediaFile({ type: '', name: 'clip.MOV' }), 'video');
    assert.equal(classifyMediaFile({ type: 'application/octet-stream', name: 'photo.heic' }), 'photo');
    assert.equal(classifyMediaFile({ type: '', name: 'notes.txt' }), null);
  });
});

describe('normalizeNoteMedia', () => {
  it('returns [] for missing, plain-text and media-less notes', () => {
    assert.deepEqual(normalizeNoteMedia(null), []);
    assert.deepEqual(normalizeNoteMedia(undefined), []);
    assert.deepEqual(normalizeNoteMedia('just text'), []);
    assert.deepEqual(normalizeNoteMedia({ text: 'x' }), []);
    assert.deepEqual(normalizeNoteMedia({ text: 'x', photos: [], videos: [], media: [] }), []);
  });

  it('reads legacy inline photos/videos as legacy refs (no path)', () => {
    const photo = pngDataUrl(1);
    const list = normalizeNoteMedia({
      text: 'Ceiling',
      photos: [{ name: 'p.png', dataUrl: photo }],
      videos: [{ name: 'v.mp4', dataUrl: mp4DataUrl(1) }],
    });
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], {
      id: 'legacy-photo-0',
      kind: 'photo',
      mime: 'image/png',
      name: 'p.png',
      size: Buffer.from('png-bytes-1').length,
      legacyDataUrl: photo,
    });
    assert.equal(list[1].kind, 'video');
    assert.equal(list[1].mime, 'video/mp4');
    assert.equal(list[1].path, undefined);
  });

  it('reads stored refs and keeps legacy items first (oldest first)', () => {
    const ref = { id: 'm1', kind: 'audio', mime: 'audio/mp4', path: `${DOC}/m/x.m4a`, name: 'rec', size: 9, durationMs: 4000 };
    const list = normalizeNoteMedia({ photos: [{ name: 'p', dataUrl: pngDataUrl(2) }], media: [ref, { bogus: true }] });
    assert.deepEqual(list.map((item) => item.id), ['legacy-photo-0', 'm1']);
    assert.equal(list[1].durationMs, 4000);
  });

  it('parses a note that came back from the TEXT notes column as JSON', () => {
    const ref = { id: 'm1', kind: 'photo', mime: 'image/jpeg', path: `${DOC}/m/x.jpg`, name: 'p', size: 1 };
    assert.deepEqual(normalizeNoteMedia(JSON.stringify({ text: 't', media: [ref] })).map((r) => r.id), ['m1']);
  });

  it('shows cache stubs (bytes dropped from the localStorage cache) as unavailable', () => {
    const list = normalizeNoteMedia({ photos: [{ name: 'big.jpg', dataUrl: null, cacheOmitted: true }] });
    assert.equal(list.length, 1);
    assert.equal(list[0].unavailable, true);
    assert.equal(list[0].legacyDataUrl, null);
    assert.equal(noteHasLegacyMedia({ photos: [{ name: 'big.jpg', dataUrl: null, cacheOmitted: true }] }), false);
  });
});

describe('limits', () => {
  it('enforces the contract limits with a sentence the UI can show', () => {
    assert.equal(SURVEY_MEDIA_LIMITS.photoMaxEdge, 2560);
    assert.equal(SURVEY_MEDIA_LIMITS.videoMaxBytes, 100 * 1024 * 1024);
    assert.equal(SURVEY_MEDIA_LIMITS.audioMaxBytes, 25 * 1024 * 1024);
    assert.equal(checkSurveyMediaLimits({ kind: 'video', size: 100 * 1024 * 1024, name: 'v.mov' }), null);
    const tooBig = checkSurveyMediaLimits({ kind: 'video', size: 140 * 1024 * 1024, name: 'v.mov' });
    assert.equal(tooBig.code, 'too-large');
    assert.equal(tooBig.message, '"v.mov" is 140 MB. Videos can be up to 100 MB.');
    assert.equal(checkSurveyMediaLimits({ kind: 'audio', size: 26 * 1024 * 1024, name: 'r.m4a' }).code, 'too-large');
    assert.equal(checkSurveyMediaLimits({ kind: 'audio', size: 0, name: 'r.m4a' }).code, 'empty-file');
  });

  it('refuses an oversized video or audio before any network call', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    await assert.rejects(
      uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: sizedFile('v.mov', 'video/quicktime', 101 * 1024 * 1024) }),
      (err) => err.code === 'too-large' && /Videos can be up to 100 MB/.test(err.message),
    );
    await assert.rejects(
      uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: sizedFile('r.m4a', 'audio/mp4', 30 * 1024 * 1024), kind: 'audio' }),
      (err) => err.code === 'too-large' && /Audio recordings can be up to 25 MB/.test(err.message),
    );
    await assert.rejects(
      uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: sizedFile('a.avi', 'video/x-msvideo', 10) }),
      (err) => err.code === 'unsupported-type',
    );
    assert.equal(calls.upload.length, 0);
  });

  it('checks a photo after downscaling, against photoMaxBytes', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    __setSurveyMediaImageToolsForTests({ decode: async () => null, encodeJpeg: async () => null });
    await assert.rejects(
      uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: sizedFile('huge.heic', 'image/heic', 40 * 1024 * 1024) }),
      (err) => err.code === 'too-large' && /Photos can be up to 25 MB/.test(err.message),
    );
    assert.equal(calls.upload.length, 0);
  });
});

describe('uploadSurveyMedia', () => {
  it('uploads to {document}/{marker}/{uuid}.{ext} with the content type and returns a MediaRef', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const progress = [];
    const file = new File([new Uint8Array(5000)], 'note.m4a', { type: 'audio/mp4' });
    const ref = await uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file, kind: 'audio', durationMs: 4321.4, onProgress: (p) => progress.push(p) });
    assert.equal(calls.upload.length, 1);
    const [{ path, body, options }] = calls.upload;
    const [doc, marker, fileName] = path.split('/');
    assert.equal(doc, DOC);
    assert.equal(marker, MARKER);
    assert.match(fileName, UUID_FILE);
    assert.ok(fileName.endsWith('.m4a'));
    assert.equal(options.contentType, 'audio/mp4');
    assert.equal(options.upsert, false);
    assert.equal(body.type, 'audio/mp4', 'multipart part carries the content type');
    assert.deepEqual(progress, [0, 1]);
    assert.equal(ref.id, fileName.replace(/\.m4a$/, ''));
    assert.equal(ref.kind, 'audio');
    assert.equal(ref.mime, 'audio/mp4');
    assert.equal(ref.path, path);
    assert.equal(ref.name, 'note.m4a');
    assert.equal(ref.size, 5000);
    assert.equal(ref.durationMs, 4321);
    assert.equal(ref.createdBy, 'user-1');
    assert.ok(!Number.isNaN(Date.parse(ref.createdAt)));
    assert.equal(ref.legacyDataUrl, undefined);
  });

  it('strips codec parameters (Chrome MediaRecorder) so the bucket MIME list matches', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const file = new File([new Uint8Array(10)], 'rec.webm', { type: 'audio/webm;codecs=opus' });
    const ref = await uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file, kind: 'audio' });
    assert.equal(ref.mime, 'audio/webm');
    assert.equal(calls.upload[0].options.contentType, 'audio/webm');
  });

  it('sanitizes marker ids into one path segment', () => {
    assert.equal(sanitizeMarkerSegment('surveyMarker-abc'), 'surveyMarker-abc');
    assert.equal(sanitizeMarkerSegment('a/b c:d'), 'a_b_c_d');
    assert.equal(sanitizeMarkerSegment(''), 'marker');
    assert.equal(sanitizeMarkerSegment('x'.repeat(300)).length, 128);
  });

  it("fails with \"Media storage isn't set up yet\" while the bucket is missing", async () => {
    const { client } = mockClient({ uploadError: { message: 'Bucket not found', statusCode: '404', status: 400 } });
    __setSurveyMediaClientForTests(client);
    const file = new File([new Uint8Array(10)], 'v.mp4', { type: 'video/mp4' });
    await assert.rejects(uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file }), (err) => {
      assert.equal(err.code, 'not-set-up');
      assert.equal(err.message, SURVEY_MEDIA_NOT_SET_UP_MESSAGE);
      assert.match(err.message, /Media storage isn't set up yet/);
      return true;
    });
  });

  it('maps quota, permission and type refusals to clear errors', async () => {
    const file = new File([new Uint8Array(10)], 'v.mp4', { type: 'video/mp4' });
    const cases = [
      [{ message: 'Storage quota exceeded: this save needs 2 bytes of the 1 bytes allowed on your plan.', statusCode: '42501' }, 'quota', /storage is full/],
      [{ message: 'new row violates row-level security policy', statusCode: '403' }, 'forbidden', /permission to add media/],
      [{ message: 'mime type video/mp4 is not supported', statusCode: '415' }, 'unsupported-type', /not a supported/],
      [{ message: 'The object exceeded the maximum allowed size', statusCode: '413' }, 'too-large', /larger than media storage allows/],
    ];
    for (const [error, code, re] of cases) {
      __setSurveyMediaClientForTests(mockClient({ uploadError: error }).client);
      await assert.rejects(uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file }), (err) => err.code === code && re.test(err.message));
    }
  });

  it('needs a cloud document id (local PDFs cannot hold media files)', async () => {
    __setSurveyMediaClientForTests(mockClient().client);
    const file = new File([new Uint8Array(10)], 'v.mp4', { type: 'video/mp4' });
    for (const documentId of [null, '', 'plan.pdf-12345']) {
      await assert.rejects(uploadSurveyMedia({ documentId, markerId: MARKER, file }), (err) => err.code === 'no-document');
    }
  });

  it('downscales a large photo to a 2560px JPEG', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const { tools, encoded } = imageTools({ '*': { width: 5000, height: 2500 } });
    __setSurveyMediaImageToolsForTests(tools);
    const file = new File([new Uint8Array(8_000_000)], 'IMG_1.png', { type: 'image/png' });
    const ref = await uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file });
    assert.deepEqual(encoded, [{ width: 2560, height: 1280, quality: 0.85 }]);
    assert.equal(ref.mime, 'image/jpeg');
    assert.ok(ref.path.endsWith('.jpg'));
    assert.equal(ref.size, 1234);
    assert.equal(ref.width, 2560);
    assert.equal(ref.height, 1280);
    assert.equal(calls.upload[0].options.contentType, 'image/jpeg');
  });

  it('keeps an already-small JPEG/PNG as-is, but converts a decodable HEIC', async () => {
    __setSurveyMediaClientForTests(mockClient().client);
    const { tools, encoded } = imageTools({ '*': { width: 1200, height: 900 } });
    __setSurveyMediaImageToolsForTests(tools);
    const small = await uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: new File([new Uint8Array(300)], 's.jpg', { type: 'image/jpeg' }) });
    assert.equal(small.mime, 'image/jpeg');
    assert.equal(small.size, 300);
    assert.equal(encoded.length, 0);
    const heic = await uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: new File([new Uint8Array(300)], 'h.heic', { type: 'image/heic' }) });
    assert.equal(heic.mime, 'image/jpeg');
    assert.equal(encoded.length, 1);
  });

  it('uploads an undecodable HEIC as-is and refuses an undecodable GIF', async () => {
    __setSurveyMediaClientForTests(mockClient().client);
    __setSurveyMediaImageToolsForTests(imageTools({}).tools);
    const heic = await uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: new File([new Uint8Array(300)], 'h.heic', { type: 'image/heic' }) });
    assert.equal(heic.mime, 'image/heic');
    assert.ok(heic.path.endsWith('.heic'));
    await assert.rejects(
      uploadSurveyMedia({ documentId: DOC, markerId: MARKER, file: new File([new Uint8Array(300)], 'g.gif', { type: 'image/gif' }) }),
      (err) => err.code === 'unsupported-type',
    );
  });
});

describe('getSurveyMediaUrl / deleteSurveyMedia', () => {
  let realNow;
  beforeEach(() => { realNow = Date.now; });
  afterEach(() => { Date.now = realNow; });

  it('returns the data URL for legacy items without touching storage', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const dataUrl = pngDataUrl(3);
    assert.equal(await getSurveyMediaUrl({ id: 'legacy-photo-0', legacyDataUrl: dataUrl }), dataUrl);
    assert.equal(await deleteSurveyMedia({ id: 'legacy-photo-0', legacyDataUrl: dataUrl }), true);
    assert.equal(calls.sign.length + calls.remove.length, 0);
  });

  it('caches signed URLs for about 50 minutes and de-duplicates concurrent requests', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const ref = { id: 'm', path: `${DOC}/m/a.jpg`, name: 'a' };
    let now = 1_000_000;
    Date.now = () => now;
    const [a, b] = await Promise.all([getSurveyMediaUrl(ref), getSurveyMediaUrl(ref)]);
    assert.equal(a, b);
    assert.equal(calls.sign.length, 1);
    assert.equal(calls.sign[0].ttl, 3600);
    now += 49 * 60 * 1000;
    assert.equal(await getSurveyMediaUrl(ref), a);
    assert.equal(calls.sign.length, 1);
    now += 2 * 60 * 1000;
    const c = await getSurveyMediaUrl(ref);
    assert.notEqual(c, a);
    assert.equal(calls.sign.length, 2);
  });

  it('deletes the object and forgets its cached URL', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const ref = { id: 'm', path: `${DOC}/m/b.jpg`, name: 'b' };
    await getSurveyMediaUrl(ref);
    assert.equal(await deleteSurveyMedia(ref), true);
    assert.deepEqual(calls.remove, [[ref.path]]);
    await getSurveyMediaUrl(ref);
    assert.equal(calls.sign.length, 2);
  });

  it('removes every listed media object of a purged document, never throwing', async () => {
    const { client, calls } = mockClient({
      listing: {
        [DOC]: [{ name: 'markerA', id: null }, { name: 'markerB', id: null }],
        [`${DOC}/markerA`]: [{ name: '1.jpg', id: 'x' }, { name: '2.mp4', id: 'y' }],
        [`${DOC}/markerB`]: [{ name: '3.m4a', id: 'z' }],
      },
    });
    __setSurveyMediaClientForTests(client);
    const result = await removeSurveyMediaForDocument(DOC);
    assert.equal(result.removed, 3);
    assert.deepEqual(calls.remove, [[`${DOC}/markerA/1.jpg`, `${DOC}/markerA/2.mp4`, `${DOC}/markerB/3.m4a`]]);
    __setSurveyMediaClientForTests({ storage: { from: () => ({ list: async () => { throw new Error('offline'); } }) } });
    assert.equal((await removeSurveyMediaForDocument(DOC)).removed, 0);
  });
});

describe('migrateLegacyNoteMedia', () => {
  const legacyNote = () => ({
    text: 'Leak above door',
    photos: [{ name: 'a.png', dataUrl: pngDataUrl('a') }, { name: 'b.png', dataUrl: pngDataUrl('b') }],
    videos: [{ name: 'c.mp4', dataUrl: mp4DataUrl('c') }],
    media: [{ id: 'm-existing', kind: 'audio', mime: 'audio/mp4', path: `${DOC}/${MARKER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.m4a`, name: 'r', size: 5 }],
  });

  beforeEach(() => {
    __setSurveyMediaImageToolsForTests(imageTools({ '*': { width: 40, height: 30 } }).tools);
  });

  it('uploads legacy base64 once and returns a note with refs and no base64', async () => {
    const { client, calls } = mockClient();
    __setSurveyMediaClientForTests(client);
    const note = legacyNote();
    const next = await migrateLegacyNoteMedia({ documentId: DOC, markerId: MARKER, note });
    assert.equal(calls.upload.length, 3);
    assert.equal(next.text, 'Leak above door');
    assert.equal(next.photos, undefined);
    assert.equal(next.videos, undefined);
    assert.equal(next.media.length, 4);
    assert.deepEqual(next.media.map((ref) => ref.name), ['a.png', 'b.png', 'c.mp4', 'r']);
    assert.deepEqual(next.media.map((ref) => ref.kind), ['photo', 'photo', 'video', 'audio']);
    assert.ok(next.media.every((ref) => typeof ref.path === 'string' && ref.path.startsWith(`${DOC}/${MARKER}/`)));
    assert.equal(next.media[0].size, Buffer.from('png-bytes-a').length);
    assert.equal(next.media[0].mime, 'image/png');
    assert.equal(calls.upload[2].options.contentType, 'video/mp4');
    assert.doesNotMatch(JSON.stringify(next), /base64|data:/);
    assert.equal(noteHasLegacyMedia(next), false);
    assert.ok(note.photos, 'input note is not mutated');
    // Nothing left to migrate: same object back, no uploads.
    assert.equal(await migrateLegacyNoteMedia({ documentId: DOC, markerId: MARKER, note: next }), next);
    assert.equal(calls.upload.length, 3);
  });

  it('is idempotent across retries and editors (content-derived object names)', async () => {
    const first = mockClient();
    __setSurveyMediaClientForTests(first.client);
    const a = await migrateLegacyNoteMedia({ documentId: DOC, markerId: MARKER, note: legacyNote() });
    const second = mockClient({ uploadError: { message: 'The resource already exists', statusCode: '409', error: 'Duplicate' } });
    __setSurveyMediaClientForTests(second.client);
    const b = await migrateLegacyNoteMedia({ documentId: DOC, markerId: MARKER, note: legacyNote() });
    assert.deepEqual(b.media.map((ref) => ref.path), a.media.map((ref) => ref.path));
    assert.deepEqual(second.calls.upload.map((c) => c.path), first.calls.upload.map((c) => c.path));
  });

  it('throws the not-set-up error and changes nothing while the bucket is missing', async () => {
    const { client, calls } = mockClient({ uploadError: { message: 'Bucket not found', statusCode: '404' } });
    __setSurveyMediaClientForTests(client);
    await assert.rejects(
      migrateLegacyNoteMedia({ documentId: DOC, markerId: MARKER, note: legacyNote() }),
      (err) => err.code === 'not-set-up' && err.message === SURVEY_MEDIA_NOT_SET_UP_MESSAGE,
    );
    assert.equal(calls.upload.length, 1, 'stops after the first not-set-up refusal');
  });

  it('keeps an item inline when only that upload fails', async () => {
    const { client } = mockClient({ uploadError: (path, n) => (n === 2 ? { message: 'Internal error', statusCode: '500' } : null) });
    __setSurveyMediaClientForTests(client);
    const next = await migrateLegacyNoteMedia({ documentId: DOC, markerId: MARKER, note: legacyNote() });
    assert.deepEqual(next.photos.map((p) => p.name), ['b.png']);
    assert.equal(next.videos, undefined);
    assert.deepEqual(normalizeNoteMedia(next).map((item) => item.name), ['b.png', 'a.png', 'c.mp4', 'r']);
    assert.equal(noteHasLegacyMedia(next), true);
  });
});

describe('buildNoteWithMedia', () => {
  it('writes refs to note.media without transient fields and never invents base64', () => {
    const note = { text: 't', photos: [{ name: 'old.png', dataUrl: pngDataUrl(9) }] };
    const list = normalizeNoteMedia(note);
    list.push({ id: 'n1', kind: 'photo', mime: 'image/jpeg', path: `${DOC}/m/n1.jpg`, name: 'new', size: 3, createdBy: 'u', createdAt: 'now', url: 'https://signed', legacyDataUrl: undefined });
    const next = buildNoteWithMedia(note, list);
    assert.deepEqual(next.media, [{ id: 'n1', kind: 'photo', mime: 'image/jpeg', path: `${DOC}/m/n1.jpg`, name: 'new', size: 3, createdBy: 'u', createdAt: 'now' }]);
    assert.deepEqual(next.photos, note.photos);
    assert.equal(next.text, 't');
    // Removing the legacy item drops the base64 field entirely.
    const without = buildNoteWithMedia(next, normalizeNoteMedia(next).filter((item) => item.path));
    assert.equal(without.photos, undefined);
    assert.doesNotMatch(JSON.stringify(without), /data:/);
  });
});
