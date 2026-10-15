import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', headless: true },
  webServer: { command: 'npx wrangler dev --port 8787 --var EMAIL_DISABLED:true', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: !process.env.CI },
});
