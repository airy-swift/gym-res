import type { Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { waitForTutorial } from '../util';

export async function runSeekLotPage(
  page: Page,
  url: string,
): Promise<{count: number, entry: RepresentativeEntry}[] | undefined> {
    await page.waitForURL(url => url.toString().startsWith('https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Index'), {timeout: 10_000,});
    await waitForTutorial(page);

    await page.locator('button.AvailabilityFrameSet_frame_content.is-lot').first().waitFor({ state: 'visible', timeout: 10_000 });
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const lotterySlots = page.locator('button.AvailabilityFrameSet_frame_content.is-lot');

    let results: {count: number, entry: RepresentativeEntry}[] = [];

    const count = await lotterySlots.count();
    for (let i = 0; i < count; i++) {
      const slot = lotterySlots.nth(i);
    
      // --- 日付 & 時間（timeタグから取る：最重要） ---
      const times = slot.locator('time');
      const start = await times.nth(0).getAttribute('datetime');
      const end = await times.nth(1).getAttribute('datetime');
    
      // start/end 例: "2026-01-04 09:00:00"
      const date = start!.split(' ')[0];
      const startTime = toHourMinute(start!.split(' ')[1].slice(0, 5));
      const endTime = toHourMinute(end!.split(' ')[1].slice(0, 5));
      const timeRange = `${startTime}-${endTime}`;
    
      // --- lottery 数（IconTextContainer_text） ---
      const countText = await slot
        .locator('.IconTextContainer_text')
        .innerText();
    
      const lotteryCount = Number(countText.trim());
      const gymName = await page.locator('a.h-ctDeep.headline').innerText();
      const roomName = await page.locator('button.SearchForm_simple_condition span.InputContainer').innerText();
      const boothLocator = slot.locator('xpath=ancestor::tr/th//span.v-btn__content');
      const boothName = (await boothLocator.count()) > 0 ? ` / ${(await boothLocator.innerText()).trim()}` : '';
      results.push({
        count: lotteryCount,
        entry: {
            gymName: gymName,
            room: `${roomName}${boothName}`,
            date,
            time: timeRange,
        },
      });
    }
    
    return results;
}
    
function toHourMinute(value: string): string {
  const [hour, minute] = value.split(':');
  const normalizedHour = String(Number(hour));
  return `${normalizedHour}:${minute}`;
}
  
