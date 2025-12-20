import type { Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { waitForTutorial } from '../util';
import JapaneseHolidays from 'japanese-holidays';

export async function runSeekLotPage(
  page: Page,
  url: string,
): Promise<{count: number, entry: RepresentativeEntry}[] | undefined> {
    await page.waitForURL(url => url.toString().startsWith('https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Index'), {timeout: 10_000,});
    await waitForTutorial(page);
    await new Promise(resolve => setTimeout(resolve, 1_000));

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
      const startTimeRaw = start!.split(' ')[1].slice(0, 5);
      const endTime = toHourMinute(end!.split(' ')[1].slice(0, 5));
      const startHour = Number(startTimeRaw.split(':')[0]);
      const jsDate = getDate(date);
      const isHoliday = Boolean(JapaneseHolidays.isHoliday(jsDate, true));
      const isWeekday = !isHoliday && jsDate.getDay() >= 1 && jsDate.getDay() <= 5;

      // Skip weekday slots that start before 18:00
      if (isWeekday && startHour < 18) {
        continue;
      }

      const startTime = toHourMinute(startTimeRaw);
      const timeRange = `${startTime}-${endTime}`;
    
      // --- lottery 数（IconTextContainer_text） ---
      const countText = await slot
        .locator('.IconTextContainer_text')
        .innerText();
    
      const lotteryCount = Number(countText.trim());
      const gymName = await page.locator('a.h-ctDeep.headline').innerText();
      const roomName = await page.locator('button.SearchForm_simple_condition span.InputContainer').innerText();
      const boothName = await slot.evaluate(el => {
        const tr = el.closest('tr');
        const name = tr
          ?.querySelector('th .v-btn__content')
          ?.textContent
          ?.trim();
        return name ?? '';
      });
      if (boothName === '全面') {
        continue;
      }
      const boothSuffix = boothName ? ` / ${boothName}` : '';
      
      
      results.push({
        count: lotteryCount,
        entry: {
            gymName: gymName,
            room: `${roomName}${boothSuffix}`,
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

function getDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}
  
