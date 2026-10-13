// Same as playwright.config.mjs but reuses a Vite you already started on
// PLAYWRIGHT_BASE_URL (handy while iterating on one spec).
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({ ...base, webServer: undefined });
