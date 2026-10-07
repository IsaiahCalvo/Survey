// The template a Share dialog should invite people to.
//
// The Templates editor hands over its working copy, whose `id` is the
// template's own config id (e.g. "t_muyb19t6_0", made by the editor), while
// the invite tables (template_invites / template_collaborators) key on the
// templates ROW id, a uuid, which the hub's list carries as `supabaseId`
// (Dashboard.jsx). Passing the config id made every template invite fail
// with Postgres 22P02 "invalid input syntax for type uuid" (found on the real
// backend, 2026-10-07). A template not saved yet has no row: id null, and the
// Share dialog says it needs a saved template instead of sending anything.
export function templateShareTarget(template, templates = []) {
  if (!template) return null;
  const stored = (Array.isArray(templates) ? templates : [])
    .find((t) => t && (t.id === template.id || (template.supabaseId && t.supabaseId === template.supabaseId)));
  const rowId = template.supabaseId || stored?.supabaseId || null;
  return { ...template, id: rowId };
}
