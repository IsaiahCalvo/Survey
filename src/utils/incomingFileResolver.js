// incomingFileResolver — decide what to do when a user brings a PDF into the app.
//
// Root cause of the "blank pages" bug: every time a file was opened from disk the
// app uploaded it and created a brand-new empty cloud document, with no check for
// one it already had. Blank duplicates piled up and opening landed on an empty one.
//
// A file is recognized by its NAME + exact byte SIZE, which in practice uniquely
// identifies the same file (two different PDFs sharing a name AND an identical byte
// count effectively never happens). Same name but a different size means the user
// brought in genuinely different content under a familiar name.

/**
 * @param {{name?: string, size?: number}} file - the incoming File
 * @param {Array<object>} existingDocs - the user's existing documents (raw rows)
 * @returns {{kind:'new'} | {kind:'reuse', doc:object} | {kind:'name-collision', collisions:object[]}}
 */
export function classifyIncomingFile(file, existingDocs = []) {
  const name = file?.name;
  const size = Number(file?.size);
  if (!name || !Number.isFinite(size)) return { kind: 'new' };

  const docName = (d) => d?.name ?? d?.fileName ?? null;
  const docSize = (d) => Number(d?.file_size ?? d?.size ?? NaN);
  const docCreated = (d) => new Date(d?.created_at ?? d?.createdAt ?? 0).getTime();

  const sameName = (Array.isArray(existingDocs) ? existingDocs : []).filter((d) => docName(d) === name);
  if (sameName.length === 0) return { kind: 'new' };

  const sameFile = sameName.filter((d) => docSize(d) === size);
  if (sameFile.length > 0) {
    // It's the same file — reopen the original (the oldest matching copy) so we
    // land on the one that has been around the longest (and holds the marks).
    const chosen = sameFile.slice().sort((a, b) => docCreated(a) - docCreated(b))[0];
    return { kind: 'reuse', doc: chosen };
  }

  // Same name, different content.
  return { kind: 'name-collision', collisions: sameName };
}

/**
 * Returns a non-colliding display name by appending " (n)" before the extension,
 * the way desktop operating systems do ("Report.pdf" -> "Report (1).pdf").
 * @param {string} name
 * @param {Iterable<string>} existingNames
 * @returns {string}
 */
export function nextAvailableName(name, existingNames = []) {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
