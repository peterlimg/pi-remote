import { defineConfig, devices } from '@playwright/test';
import { browserOrigin } from './test/browser-config.mjs';
export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  workers: 1,
  use: { baseURL: browserOrigin, ...devices['iPhone 13'], defaultBrowserType: 'chromium',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node test/browser-server.mjs', url: browserOrigin + '/health', reuseExistingServer: false }
});
