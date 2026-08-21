/**
 * Share-modal email list parser. Kept out of ShareModal.jsx so Node tests
 * can import it without the React dialog.
 */
export function parseEmails(raw) {
  const seen = new Set();
  return (raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .filter((e) => {
      if (seen.has(e)) return false;
      seen.add(e);
      return true;
    });
}
