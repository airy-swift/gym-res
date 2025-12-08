import type { Page } from '@playwright/test';
import { captureScreenshot, throwLoggedError } from '../util';
import type { RepresentativeEntry } from '../types';

export const LOT_REQUEST_URL = 'https://yoyaku.harp.lg.jp/sapporo/LotRequests/';

export async function runLotRequestPage(
  page: Page,
  entries: RepresentativeEntry[],
): Promise<void> {
  try {
    await page.waitForURL((url) => url.toString().startsWith(LOT_REQUEST_URL), {
      timeout: 10_000,
      waitUntil: 'domcontentloaded',
    });
  } catch (error) {
    await captureScreenshot(page, 'debug');
    throw error;
  }
  await page.waitForSelector('#fixedCotnentsWrapper', { state: 'hidden' });

  await new Promise(resolve => setTimeout(resolve, 3_000));
  const sportInput = page.locator('input[role="combobox"][aria-controls]');
  await sportInput.first().waitFor({ state: 'visible', timeout: 10_000 });
  const targetInput = sportInput.first();
  await targetInput.click();
  await targetInput.fill('');
  await targetInput.type('バドミントン', { delay: 50 });

  const listId = await targetInput.getAttribute('aria-controls');
  if (!listId) {
    throwLoggedError('[runLotRequestPage:No.4] 種目選択用のリストを取得できませんでした。');
  }

  const optionList = page.locator(`#${listId}`);
  await optionList.waitFor({ state: 'visible', timeout: 10_000 });
  const badmintonOption = optionList.locator('[role="option"]', { hasText: 'バドミントン' }).first();
  await badmintonOption.waitFor({ state: 'visible', timeout: 10_000 });
  await badmintonOption.click();

  // await new Promise(resolve => setTimeout(resolve, 3_000));
  const participantsInput = page.locator('#input-55');
  await participantsInput.waitFor({ state: 'visible', timeout: 10_000 });
  await participantsInput.fill('20');


  const confirmButton = page.getByRole('button', { name: '確認' });
  await confirmButton.waitFor({ state: 'visible', timeout: 10_000 });
  await confirmButton.click({ force: true });
}
