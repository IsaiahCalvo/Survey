import config from './playwright.config.mjs';

export default {
  ...config,
  webServer: {
    ...config.webServer,
    reuseExistingServer: true,
  },
};
