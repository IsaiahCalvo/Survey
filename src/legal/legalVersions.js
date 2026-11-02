// Dates of the Terms and Privacy Policy in public/terms.html and
// public/privacy.html. Bump the matching date whenever that page's wording
// changes in a way people must agree to again: sign-up stores these with the
// account (user_metadata.terms_accepted) so we know who agreed to which text.
export const TERMS_VERSION = '2026-11-02';
export const PRIVACY_VERSION = '2026-11-02';

// The "Helping improve Survey" section of the privacy policy. Stored with the
// opt-in choice (user_metadata.improve_survey_opt_in.policy).
export const IMPROVE_SURVEY_POLICY_VERSION = '2026-11-02';

// The AI assistant notice the agent panel shows before its first use
// (user_metadata.ai_assistant_consent.version). Bump when the list of AI
// providers or what is sent to them changes.
export const AI_NOTICE_VERSION = '2026-11-02';

export const termsAcceptance = (now = new Date()) => ({
  terms: TERMS_VERSION,
  privacy: PRIVACY_VERSION,
  at: now.toISOString(),
});

export const hasAiConsent = (user) => {
  const consent = user?.user_metadata?.ai_assistant_consent;
  return Boolean(consent?.at) && consent?.version === AI_NOTICE_VERSION;
};
