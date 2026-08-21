/**
 * Erase-approval planner input. Callouts used to be the only domain that
 * went through buildBulkDeletePlan; page-object and text-markup deletes
 * auto-approved and skipped the post-commit undo toast.
 */

export const ERASE_DELETE_PLAN_DOMAINS = new Set([
  'callout',
  'page-object',
  'text-markup',
]);

export function collectEraseDeleteCandidateIds(intent) {
  return (intent?.targets || [])
    .filter((target) => (
      target?.operation === 'delete'
      && ERASE_DELETE_PLAN_DOMAINS.has(target.domain)
    ))
    .map((target) => (
      target.before?.data?.id
      ?? target.before?.id
      ?? target.before?.annotationId
      ?? null
    ))
    .filter(Boolean);
}
