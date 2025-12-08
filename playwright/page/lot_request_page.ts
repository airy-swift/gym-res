import type { Page } from '@playwright/test';
import { logEarlyReturn } from '../util';
import type { StatusEntry } from './request_status_page';

const TARGET_URL = 'https://yoyaku.harp.lg.jp/sapporo/LotRequests/';

type LotRequestSlot = {
  datetime: string | null;
  dateLabel: string;
  timeLabel: string;
};

export async function runLotRequestPage(
  page: Page,
  entries: StatusEntry[],
): Promise<LotRequestSlot[]> {
  await page.waitForURL((url) => url.toString().startsWith(TARGET_URL), {timeout: 10_000});

  const subtitleLocator = page.locator('div.v-list-item__subtitle');
  const subtitleCount = await subtitleLocator.count();
  logEarlyReturn(`Found ${subtitleCount} lot request subtitle blocks (StatusEntry len ${entries.length}).`);

  const slots: LotRequestSlot[] = [];
  for (let index = 0; index < subtitleCount; index += 1) {
    const subtitle = subtitleLocator.nth(index);
    const timeNode = subtitle.locator('time').first();
    const dateLabel = (await timeNode.count())
      ? (await timeNode.innerText()).replace(/\s+/g, ' ').trim()
      : '';
    const datetime = (await timeNode.count())
      ? await timeNode.getAttribute('datetime')
      : null;
    const timeSpan = subtitle.locator('span.InputContainer.InputRange.is-time').first();
    const timeLabel = (await timeSpan.count())
      ? (await timeSpan.innerText()).replace(/\s+/g, ' ').trim()
      : '';

    slots.push({ datetime, dateLabel, timeLabel });
  }
  console.log(slots);

//   // await new Promise(resolve => setTimeout(resolve, 3_000));
//   const dropdownOption = page.locator('div[role="combobox"]', { hasText: 'バドミントン' });
//   await dropdownOption.first().waitFor({ state: 'visible', timeout: 10_000 });
//   await dropdownOption.first().click();

//   // await new Promise(resolve => setTimeout(resolve, 3_000));
//   const participantsInput = page.locator('[id^="input-55"]');
//   await participantsInput.waitFor({ state: 'visible', timeout: 10_000 });
//   await participantsInput.fill('20');


//   const confirmButton = page.getByRole('button', { name: '確認' });
//   await confirmButton.waitFor({ state: 'visible', timeout: 10_000 });
//   await confirmButton.click({ force: true });

  return slots;
}
