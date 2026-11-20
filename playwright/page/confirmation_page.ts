import type { Page } from '@playwright/test';
import { ACTION_TIMEOUT_MS, getVisibleButton } from '../ui';

const TARGET_URL = 'https://yoyaku.harp.lg.jp/sapporo/LotRequests/InsertConfirm';

export async function runConfirmationPage(page: Page): Promise<boolean> {
  await page.waitForURL((url) => url.toString().startsWith(TARGET_URL), {
    timeout: 10_000,
  });

  const acknowledgeCheckbox = page.getByText('注意事項を確認しました', { exact: true }).first();
  await acknowledgeCheckbox.waitFor({ state: 'visible', timeout: 10_000 });
  await acknowledgeCheckbox.click({ timeout: ACTION_TIMEOUT_MS });

  const submitButton = getVisibleButton(page, '申込確定');
  await submitButton.waitFor({ state: 'visible', timeout: 10_000 });
  await submitButton.click({ timeout: ACTION_TIMEOUT_MS });

  // 札幌市の公式ヘルプに掲載された完了表示と受付番号を確認する。
  await page.getByText('抽選申込が完了しました。', { exact: true })
    .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  await page.getByText('受付番号', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });

  return true;
}
