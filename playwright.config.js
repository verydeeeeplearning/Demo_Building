import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 120000,
  workers: process.env.CI === 'true' ? 2 : 4,
  expect: {
    timeout: 7000
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npm run dev -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: process.env.CI !== 'true' || process.env.PW_REUSE_SERVER === '1',
      timeout: 120000
    },
    {
      command: 'npm run agent:dev',
      url: 'http://127.0.0.1:8787/api/agent/health',
      reuseExistingServer: process.env.CI !== 'true' || process.env.PW_REUSE_SERVER === '1',
      timeout: 120000
    }
  ],
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 820 }
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5']
      }
    }
  ]
});
