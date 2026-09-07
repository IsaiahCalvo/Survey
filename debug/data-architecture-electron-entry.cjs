// Isolated entry for the data durability smoke test. Never uses the real profile.
const { app } = require('electron');
const path = require('node:path');
const profile = process.env.SURVEY_DATA_QA_PROFILE;
if (!profile || !path.isAbsolute(profile) || !path.basename(profile).startsWith('survey-data-qa-')) {
  throw new Error('An isolated data QA profile is required');
}
app.setPath('userData', profile);
require('../src/electron-main.js');
