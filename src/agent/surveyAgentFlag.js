// The Survey agent (KAL-527) ships behind the `survey-agent` flag in
// src/featureFlags.js (off by default, on in nightly, switched at /flags).
// The button only shows the panel; the survey-agent edge function decides
// who may actually use it (tester list, later paid plans) and caps the cost.
import { isFeatureOn } from '../featureFlags.js';

export const SURVEY_AGENT_FLAG = 'survey-agent';
export const SURVEY_AGENT_STORAGE_KEY = 'SURVEY_AGENT_BETA';

export function isSurveyAgentEnabled() {
  return isFeatureOn(SURVEY_AGENT_FLAG);
}
