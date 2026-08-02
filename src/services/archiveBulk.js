/**
 * The bulk fan-out used by every Archive action (KAL-430's bulk requirement).
 *
 * Split out of archiveService.js and kept free of any Supabase import so it can
 * be unit-tested directly: the operations are injected as a `{ type: fn }` map.
 */

/**
 * Run one operation across a selection, sequentially, and report per item.
 *
 * Sequential rather than parallel on purpose: a project operation rewrites the
 * rows of its own documents, so overlapping selections must not race each other.
 * Every item is attempted even after an earlier one fails — that is what lets
 * the screen name exactly which items did not go through instead of collapsing
 * a partial failure into one generic error.
 *
 * @param {Array} items      normalized Archive items
 * @param {Object} dispatch  { document: fn(id), project: fn(id), template: fn(id) }
 *                           each returning `{ success, error }`
 * @param {string} verb      past participle used in fallback copy ('restored')
 * @returns {Promise<{ succeeded: Array, failed: Array<{ item, error }> }>}
 */
export async function runArchiveBulk(items, dispatch, verb) {
  const succeeded = [];
  const failed = [];

  for (const item of items || []) {
    const operation = dispatch?.[item?.type];
    if (typeof operation !== 'function') {
      failed.push({ item, error: `${item?.name || 'That item'} cannot be ${verb}.` });
      continue;
    }
    try {
      const result = await operation(item.id);
      if (result?.success) succeeded.push(item);
      else failed.push({ item, error: result?.error || `${item.name} could not be ${verb}.` });
    } catch (err) {
      failed.push({ item, error: err?.message || `${item.name} could not be ${verb}.` });
    }
  }

  return { succeeded, failed };
}
