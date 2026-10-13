/* "1 file", "3 files". The home screens wrote "{n} files" / "{n} modules"
   by hand, so a project with one file read "1 files" and a template with one
   module read "1 modules". One helper so every count line agrees.
   `many` defaults to `one` + "s"; pass it for an irregular word
   ("category" -> "categories", "entity" -> "entities"). */
export const countLabel = (count, one, many = `${one}s`) => (
  `${count} ${Number(count) === 1 ? one : many}`
);
