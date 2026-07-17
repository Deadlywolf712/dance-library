import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 8000 },
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/147.0.0.0 Mobile Safari/537.36',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node scripts/playback-test-server.mjs',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 10000
  }
});
