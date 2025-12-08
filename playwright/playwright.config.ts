import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/tests',
  reporter: [
    ['list'],
    ['json', { outputFile: 'playwright/pw-result.json' }],
  ],
});
