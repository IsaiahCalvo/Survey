import { sharedFromRow } from '../services/sharedTemplates.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const deterministicTemplateRowId = (ownerId, logicalId) => {
  const input = `${ownerId}:${logicalId}`;
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1, h2, h3, h4]
    .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
    .join('')
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
};

export function buildAtomicTemplatePayload(templates, { ownerId } = {}) {
  if (!Array.isArray(templates)) {
    throw new TypeError('Template snapshot must be an array.');
  }
  if (typeof ownerId !== 'string' || ownerId.trim() === '') {
    throw new TypeError('Template snapshot owner id is required.');
  }

  return templates.map((template) => {
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      throw new TypeError('Template snapshot entries must be objects.');
    }
    if (typeof template.id !== 'string' || template.id.trim() === '') {
      throw new TypeError('Template snapshot entries require a logical template id.');
    }
    if (typeof template.name !== 'string' || template.name.trim() === '') {
      throw new TypeError('Template snapshot entries require a template name.');
    }

    // `sharedFrom` is this session's note that a template was shared with me;
    // it is never part of the stored template.
    const { supabaseId, sharedFrom: _sharedFrom, ...config } = template || {};
    if (supabaseId != null && !UUID_PATTERN.test(supabaseId)) {
      throw new TypeError('Template snapshot row id must be a UUID.');
    }
    return {
      // New rows get a deterministic, owner-scoped UUID before the first RPC.
      // If the transaction commits but its response is lost, the retry updates
      // this same row instead of inserting a replacement and cascading deletes.
      supabase_id: supabaseId || deterministicTemplateRowId(ownerId, template.id),
      name: template.name.trim(),
      config,
    };
  });
}

export async function persistTemplateSnapshot({ ownerId, templates, persist }) {
  if (typeof persist !== 'function') {
    throw new TypeError('Template snapshot persistence function is required.');
  }
  const payload = buildAtomicTemplatePayload(templates, { ownerId });
  const rows = await persist(payload);
  if (!Array.isArray(rows)) throw new Error('Template persistence returned no authoritative rows.');
  return rows;
}

export function mapAuthoritativeTemplateRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const config = row?.config && typeof row.config === 'object' ? row.config : {};
    const { ballInCourtEntities, sharedFrom: _storedSharedFrom, ...currentConfig } = config;
    // A row shared with me carries who shared it (never read from config).
    const sharedFrom = sharedFromRow(row);
    return {
      ...currentConfig,
      ...(sharedFrom ? { sharedFrom } : {}),
      entities: currentConfig.entities ?? ballInCourtEntities ?? [],
      id: currentConfig.id || row.id,
      supabaseId: row.id,
      name: currentConfig.name || row.name || 'Untitled Template',
      createdAt: currentConfig.createdAt || row.created_at || row.updated_at,
      updatedAt: currentConfig.updatedAt || row.updated_at || currentConfig.createdAt || row.created_at,
    };
  });
}

export async function reloadTemplatesAfterPendingSave({ pendingSave, reload, apply }) {
  await Promise.resolve(pendingSave).catch(() => undefined);
  const authoritative = await reload();
  apply(authoritative);
  return authoritative;
}
