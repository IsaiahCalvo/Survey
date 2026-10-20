// The Survey agent (KAL-527) ships behind the `survey_agent` flag, off by
// default. Same read order as src/survey/smartFillFlag.js until the shared
// flag system lands:
//   1. localStorage 'SURVEY_AGENT_BETA' === '1' -> on ('0' -> off) per browser
//   2. import.meta.env.VITE_ENABLE_SURVEY_AGENT === '1' -> on (nightly build)
//   3. default -> off
// The button only shows the panel; the survey-agent edge function decides
// who may actually use it (tester list, later paid plans) and caps the cost.

export const SURVEY_AGENT_FLAG = 'survey_agent';
export const SURVEY_AGENT_STORAGE_KEY = 'SURVEY_AGENT_BETA';

export function isSurveyAgentEnabled() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const local = window.localStorage.getItem(SURVEY_AGENT_STORAGE_KEY);
      if (local === '1') return true;
      if (local === '0') return false;
    }
  } catch {
    // Private browsing can throw; fall through.
  }
  try {
    return import.meta.env?.VITE_ENABLE_SURVEY_AGENT === '1';
  } catch {
    return false;
  }
}
