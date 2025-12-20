import type { Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { deriveUdParam, throwLoggedError } from '../util';
const SEARCH_INPUT_SELECTOR = '#input-43';

const LOT_SEARCH_URL = 'https://yoyaku.harp.lg.jp/sapporo/?u%5B0%5D=28&u%5B1%5D=76&ud=';

export async function runSearchPage(page: Page, entry: RepresentativeEntry): Promise<void> {
  const udParam = deriveUdParam(entry.date);
  if (!udParam) {
    throwLoggedError(`[runSearchPage:No.1] 日付の形式が不正なため検索を続行できません: ${entry.date}`);
  }
  await page.goto(`${LOT_SEARCH_URL}${udParam}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(url => url.toString().startsWith(LOT_SEARCH_URL), {
    timeout: 10_000,
  });

  const keyword = entry.gymName?.trim() ?? '';
  if (!keyword) {
    throwLoggedError('[runSearchPage:No.1] 代表者情報に施設名が含まれていないため検索を実行できません。');
  }

  const facilityCombo = page.getByRole('combobox', { name: '施設' });
  await page.waitForTimeout(1_000);
  await facilityCombo.fill(keyword);
  await page.waitForTimeout(3_000);
  const resultGroup = page.locator('div[role="group"] div.v-list-item__content div.v-list-item__title');
  const firstResult = resultGroup.first();
  await firstResult.waitFor({ state: 'visible', timeout: 5_000 });
  await firstResult.click();
  await page.waitForTimeout(1_000);
  await page.mouse.click(0, 0);


  const searchButton = page.getByRole('button', { name: '検索', exact: true  });
  await searchButton.waitFor({ state: 'visible', timeout: 10_000 });
  await searchButton.click();
}
