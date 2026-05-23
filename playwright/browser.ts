import { chromium, type Browser } from '@playwright/test';

type ChromiumLaunchOptions = Parameters<typeof chromium.launch>[0];

const FALLBACK_BROWSER_CHANNEL = 'chrome';

export async function launchChromium(options: ChromiumLaunchOptions): Promise<Browser> {
  try {
    return await chromium.launch(options);
  } catch (error) {
    if (!isMissingPlaywrightBrowserError(error)) {
      throw error;
    }

    console.log(
      `[pw] Playwright managed Chromium is missing; retrying with local ${FALLBACK_BROWSER_CHANNEL} channel.`,
    );

    try {
      return await chromium.launch({
        ...options,
        channel: FALLBACK_BROWSER_CHANNEL,
      });
    } catch (fallbackError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        [
          `Playwright managed Chromium is missing and local ${FALLBACK_BROWSER_CHANNEL} channel launch also failed.`,
          'Install the Playwright browser runtime with `cd playwright && npx playwright install chromium`.',
          `Original error: ${originalMessage}`,
          `Fallback error: ${fallbackMessage}`,
        ].join('\n'),
      );
    }
  }
}

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Executable doesn\'t exist') || message.includes('Please run the following command');
}
