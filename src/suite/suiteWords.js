// Kal Voe suite words on screen (KAL-591; word list in KAL-584 Further Notes).
//
// Survey, Walkthru and Plot use one set of words. For Survey that means:
//   Markup -> Annotation (lines, clouds, text and pen that aren't a device)
//   Tags   -> Labels     (words stuck on files and marks to sort them)
//   a Survey Marker's name -> Tag (the device's name, such as C-1-01)
// Screen text only: code, stored values, Excel headers and saved files keep
// their old names until the rename tickets (KAL-574). Behind the `suite`
// beta flag, so Survey Nightly shows the new words and surveytool.app keeps
// the old ones until the suite ships.
import { isFeatureOn } from '../featureFlags.js';

export const SUITE_FLAG = 'suite';

/** Is the suite flag on for this browser (read once per call site). */
export function isSuiteOn() {
  try { return isFeatureOn(SUITE_FLAG); } catch { return false; }
}

// Old screen text -> suite screen text. Keys are the exact old strings, so a
// call site reads the same as before: suiteWord('Markups').
export const SUITE_WORDS = Object.freeze({
  // Markup -> Annotation
  Markups: 'Annotations',
  'Markup layers': 'Annotation layers',
  'Markups off': 'Annotations off',
  'Markup saved': 'Annotation saved',
  'Export markup (XFDF)': 'Export annotations (XFDF)',
  'Comments and markups': 'Comments and annotations',
  'Keep markups and filled-in forms': 'Keep annotations and filled-in forms',
  'This PDF has no form fields or markups to flatten.': 'This PDF has no form fields or annotations to flatten.',
  'This PDF has no markups or comments to remove.': 'This PDF has no annotations or comments to remove.',
  // Tags -> Labels (words that sort files and marks)
  Tags: 'Labels',
  'Add tag': 'Add label',
  'Add tags': 'Add labels',
  'Add tags…': 'Add labels…',
  'New tags': 'New labels',
  'No tag': 'No label',
  'No tags yet': 'No labels yet',
  'Group by tag': 'Group by label',
  'Separate tags with commas': 'Separate labels with commas',
  'Put a comma between tags.': 'Put a comma between labels.',
  'Tags you type are added to each item. Start a tag with a minus (-Old) to take it off.':
    'Labels you type are added to each item. Start a label with a minus (-Old) to take it off.',
  'Tags (comma between them)': 'Labels (comma between them)',
  'Search documents and tags...': 'Search documents and labels...',
  'Survey could not save that tag. Try again.': 'Survey could not save that label. Try again.',
  'Survey could not remove that tag. Try again.': 'Survey could not remove that label. Try again.',
  // A Survey Marker's name -> Tag (the device's name, such as C-1-01)
  Name: 'Tag',
  'Item name': 'Tag',
  'Survey Marker name': 'Survey Marker tag',
});

let cached = null;
function suiteOnCached() {
  if (cached === null) cached = isSuiteOn();
  return cached;
}

/** For tests: forget the cached flag answer. */
export function resetSuiteWordsCache() { cached = null; }

/** "Tags: a, b. Edit tags" for a file's label cell. */
export function labelCellName(tags, on = suiteOnCached()) {
  const noun = on ? 'Labels' : 'Tags';
  return `${noun}: ${tags.join(', ')}. Edit ${noun.toLowerCase()}`;
}

/**
 * The word to show for `oldWord`: the suite word when the flag is on, else the
 * old word unchanged. `on` overrides the flag (tests, callers that already
 * read it). Unknown words come back as given.
 */
export function suiteWord(oldWord, on = suiteOnCached()) {
  if (!on) return oldWord;
  return Object.prototype.hasOwnProperty.call(SUITE_WORDS, oldWord) ? SUITE_WORDS[oldWord] : oldWord;
}
