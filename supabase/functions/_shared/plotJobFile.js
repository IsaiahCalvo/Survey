// KAL-581: upload and download links for Plot job files in R2 (bucket
// plot-files). The caller's role in the job's Survey Project decides, read
// with the caller's own token; every R2 operation is charged to Plot's share
// (public.plot_r2_reserve) before a link is signed. Off, full or failing, the
// answer says `stored: false` and Plot keeps the job on its computer only.
//
// Plain JS with its effects passed in, so tests run it in Node.

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
const UPLOAD_SECONDS = 600;
const DOWNLOAD_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const plotFileKey = (jobId, revision) =>
  `jobs/${String(jobId).toLowerCase()}/${String(revision ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file'}.plt`;

/**
 * Plot's R2 settings: PLOT_R2_* where set, else Survey's R2_* (one Cloudflare
 * account), with the bucket plot-files unless PLOT_R2_BUCKET names another.
 */
export const plotR2Env = (get) => (name) => {
  const own = get(`PLOT_${name}`);
  if (own != null && String(own).trim() !== '') return own;
  if (name === 'R2_BUCKET') return 'plot-files';
  return get(name);
};

const canEdit = (role) => role === 'editor' || role === 'owner';

/**
 * @param {object} input
 * @param {unknown} input.body the request body
 * @param {object|null} input.config r2ConfigFromEnv(plotR2Env(...)), or null when R2 is off
 * @param {(jobId: string) => Promise<string|null>} input.roleOf caller's role on the job
 * @param {(jobId: string) => Promise<{file_key: string|null, file_bytes: number|null}|null>} input.jobOf the job as the caller sees it
 * @param {(key: string|null, jobId: string, bytes: number, a: number, b: number) => Promise<boolean>} input.reserve
 * @param {(jobId: string, key: string, bytes: number) => Promise<string[]>} input.commit
 * @param {object} input.r2 { presignPut, presignGet, headObject, deleteObject, putBucketCors }
 * @param {{ corsSet?: boolean }} [input.state] kept across calls in one function instance
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handlePlotJobFile({ body, config, roleOf, jobOf, reserve, commit, r2, state = {} }) {
  const op = body?.op;
  const jobId = typeof body?.jobId === 'string' ? body.jobId.toLowerCase() : '';
  if (!['upload', 'commit', 'download'].includes(op) || !UUID.test(jobId)) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  const role = await roleOf(jobId);
  if (!role) return { status: 404, body: { error: 'no_job' } };
  if (op !== 'download' && !canEdit(role)) return { status: 403, body: { error: 'not_allowed' } };
  if (!config) return { status: 200, body: { stored: false, reason: 'off' } };

  if (op === 'upload') {
    const bytes = Number(body.bytes);
    if (!Number.isInteger(bytes) || bytes <= 0) return { status: 400, body: { error: 'invalid_request' } };
    if (bytes > MAX_FILE_BYTES) return { status: 413, body: { error: 'too_big', max: MAX_FILE_BYTES } };
    const key = plotFileKey(jobId, body.revision);
    // The bucket takes browser uploads once its CORS rule is set: once per instance.
    const cors = state.corsSet ? 0 : 1;
    if (!(await reserve(key, jobId, bytes, 1 + cors, 0))) return { status: 200, body: { stored: false, reason: 'full' } };
    if (cors) {
      await r2.putBucketCors(config, { methods: ['GET', 'HEAD', 'PUT'], headers: ['range', 'content-type'] });
      state.corsSet = true;
    }
    return { status: 200, body: { stored: true, key, url: await r2.presignPut(config, key, { expiresIn: UPLOAD_SECONDS }) } };
  }

  if (op === 'commit') {
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key.startsWith(`jobs/${jobId}/`) || key.includes('..')) return { status: 400, body: { error: 'invalid_request' } };
    if (!(await reserve(null, jobId, 0, 0, 1))) return { status: 200, body: { stored: false, reason: 'full' } };
    const head = await r2.headObject(config, key);
    if (!head.exists) return { status: 409, body: { error: 'not_uploaded' } };
    const replaced = await commit(jobId, key, head.size);
    // Deletes are free; one that fails leaves a counted file, never a lost one.
    await Promise.allSettled(replaced.map((old) => r2.deleteObject(config, old)));
    return { status: 200, body: { stored: true, key, bytes: head.size } };
  }

  const job = await jobOf(jobId);
  if (!job?.file_key) return { status: 404, body: { error: 'no_file' } };
  if (!(await reserve(null, jobId, 0, 0, 1))) return { status: 200, body: { stored: false, reason: 'full' } };
  return {
    status: 200,
    body: { stored: true, key: job.file_key, bytes: job.file_bytes ?? null, url: await r2.presignGet(config, job.file_key, { expiresIn: DOWNLOAD_SECONDS }) },
  };
}
