import { useEffect, useState } from 'react';
import { pushSurveyRecent, readSurveyRecents } from '../utils/surveyPickLists.js';

/**
 * The recently used items of one survey list (categories or entities of a
 * template, or the templates), most recent first. `pickedId` - the item in
 * use now - is remembered whenever it changes, whatever picked it (a bar chip,
 * the "All" list, the Survey panel). Local to this browser (localStorage,
 * guarded), never the database.
 */
export default function useSurveyRecents(kind, scopeId, pickedId) {
  const [recents, setRecents] = useState(() => readSurveyRecents(kind, scopeId));
  useEffect(() => {
    setRecents(readSurveyRecents(kind, scopeId));
  }, [kind, scopeId]);
  useEffect(() => {
    if (!pickedId) return;
    setRecents(pushSurveyRecent(kind, scopeId, pickedId));
  }, [kind, scopeId, pickedId]);
  return recents;
}
