// Where people reach the Survey team (support, Enterprise, custom builds).
export const SURVEY_SUPPORT_EMAIL = 'isaiahcalvo123@gmail.com';

/** An email to the team asking for a custom spreadsheet / export / template. */
export function customLayoutAskUrl(templateName = '') {
  const subject = 'Custom spreadsheet layout';
  const body = `Hi Survey team,\n\nWe'd like our own spreadsheet layout${templateName ? ` for the "${templateName}" template` : ''}. Here is how we want it to look:\n\n`;
  return `mailto:${SURVEY_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
