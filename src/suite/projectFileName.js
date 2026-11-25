// A walk or job file sent into a Project a second time arrives as a new PDF
// with the walk's own name. When its bytes match the first copy, the
// document row is reused (services/documentRowDedupe.js); when they differ
// (a job file's PDF is not byte for byte the walk's), the Project got two
// files with the same name and no way to tell them apart (tester report
// Survey #1612). The second copy now takes the next free "(2)" name.

/** `name` if no file in `takenNames` has it (ignoring case), else "name (2).pdf", "(3)"... */
export function freeFileName(name, takenNames = []) {
  const taken = new Set([...takenNames].filter(Boolean).map((n) => String(n).toLowerCase()));
  const original = String(name || 'Drawing.pdf');
  if (!taken.has(original.toLowerCase())) return original;
  const match = /^(.*?)(\.pdf)?$/i.exec(original);
  const base = match[1];
  const ext = match[2] || '';
  for (let n = 2; n < 1000; n += 1) {
    const next = `${base} (${n})${ext}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** Names of the files in a Project (archived ones too: harmless). Empty on any error. */
export async function projectFileNames(supabase, projectId) {
  if (!supabase || !projectId) return [];
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('name')
      .eq('project_id', projectId);
    if (error) return [];
    return (data || []).map((row) => row.name);
  } catch {
    return [];
  }
}

/** The file, renamed to the next free name in the Project when its name is taken. */
export async function withFreeProjectName(file, { supabase, projectId }) {
  const name = file?.name;
  if (!name) return file;
  const free = freeFileName(name, await projectFileNames(supabase, projectId));
  if (free === name || typeof File !== 'function') return file;
  return new File([file], free, { type: file.type || 'application/pdf' });
}
