import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3190', browserName: 'chromium', viewport: { width: 390, height: 844 } },
  reporter: 'list',
  webServer: {
    command: 'node scripts/browser-server.js',
    url: 'http://127.0.0.1:3190/healthz',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
