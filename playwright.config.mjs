import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8799', ...devices['iPhone 13'], defaultBrowserType: 'chromium',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node test/browser-server.mjs', url: 'http://127.0.0.1:8799/health', reuseExistingServer: false }
});
