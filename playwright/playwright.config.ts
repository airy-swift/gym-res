import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [
    ['list'],
    ['json', { outputFile: 'pw-result.json' }],
  ],
});
