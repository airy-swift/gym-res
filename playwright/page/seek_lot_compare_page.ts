import type { Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { runSeekLotPage } from './seek_lot_page';
import { entriesAreEqual, FixedQueue } from '../types';
import { waitForTutorial } from '../util';

const GYM_URLS = [
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0004&tg%5B0%5D.r%5B0%5D=001&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0040&tg%5B1%5D.r%5B0%5D=002&tg%5B1%5D.r%5B1%5D=001&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0005&tg%5B2%5D.r%5B0%5D=001&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0010&tg%5B3%5D.r%5B0%5D=001&tg%5B3%5D.r%5B1%5D=002&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0020&tg%5B4%5D.r%5B0%5D=001&tg%5B4%5D.r%5B1%5D=002&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0030&tg%5B5%5D.r%5B0%5D=001&tg%5B5%5D.r%5B1%5D=002&d='
];
const SCHOOL_URLS = [
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011001&tg%5B0%5D.fc=0004&tg%5B0%5D.r%5B0%5D=001&tg%5B1%5D.lg=011001&tg%5B1%5D.fc=0040&tg%5B1%5D.r%5B0%5D=002&tg%5B1%5D.r%5B1%5D=001&tg%5B2%5D.lg=011001&tg%5B2%5D.fc=0005&tg%5B2%5D.r%5B0%5D=001&tg%5B3%5D.lg=011001&tg%5B3%5D.fc=0010&tg%5B3%5D.r%5B0%5D=001&tg%5B3%5D.r%5B1%5D=002&tg%5B4%5D.lg=011001&tg%5B4%5D.fc=0020&tg%5B4%5D.r%5B0%5D=001&tg%5B4%5D.r%5B1%5D=002&tg%5B5%5D.lg=011001&tg%5B5%5D.fc=0030&tg%5B5%5D.r%5B0%5D=001&tg%5B5%5D.r%5B1%5D=002&d='
];

const JST_TIMEZONE = 'Asia/Tokyo';

export async function runSeekLotComparePage(
  page: Page,
  desiredCount: number,
): Promise<RepresentativeEntry[]> {
  let result: FixedQueue<RepresentativeEntry> = new FixedQueue<RepresentativeEntry>(desiredCount);
  const now = new Date();
  const jstTimestamp = new Date(now.toLocaleString('en-US', { timeZone: JST_TIMEZONE }));
  const nextMonthReference = new Date(jstTimestamp);
  nextMonthReference.setMonth(nextMonthReference.getMonth() + 1);
  const nextMonth = `${nextMonthReference.getFullYear()}-${String(nextMonthReference.getMonth() + 1).padStart(2, '0')}`;
  const isFirstHalf = jstTimestamp.getDate() <= 15;
  const chosenUrlBase = isFirstHalf ? GYM_URLS : SCHOOL_URLS;
  const selectedUrls = nextMonth
    ? chosenUrlBase.map(url => `${url}${nextMonth}`)
    : chosenUrlBase;
  for (let url of selectedUrls) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.toString().startsWith('https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison'), {
      timeout: 10_000,
    });

    await waitForTutorial(page);

    await page.locator('a.AvailabilityFrames_dayFrame_content.is-lot').first().waitFor({ state: 'visible', timeout: 10_000 });
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const lotteryLinks = page.locator('a.AvailabilityFrames_dayFrame_content.is-lot');
    const count = await lotteryLinks.count();
    
    for (let j = 0; j < count; j++) {
      const lotteryLink = lotteryLinks.nth(j);
      const href = await lotteryLink.getAttribute('href');
      if (!href) {
        continue;
      }
      const targetUrl = buildAbsoluteUrl(href);
      const detailPage = await page.context().newPage();
      let results: {count: number, entry: RepresentativeEntry}[] | undefined;
      try {
        await detailPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        results = await runSeekLotPage(detailPage, targetUrl);
      } finally {
        await detailPage.close();
      }
      if (results?.length) {
        results.forEach(({count, entry}) => console.log('応募数:', count, '施設:', entry.gymName, '部屋:', entry.room, '日付:', entry.date, '時間:', entry.time));
        results
          .slice() // 元配列を壊さない
          .sort((a, b) => a.count - b.count) // count 昇順
          .forEach(({ count, entry }) => {
            const exists = result
              .toArray()
              .some(e => entriesAreEqual(e, entry));
      
            if (!exists) {
              result.enqueue(entry);
            }
          });
      }
      }
    }

  return result
    .toArray()
    .map(entry => ({
      ...entry,
      date: formatJapaneseDate(entry.date),
    }));
}

function buildAbsoluteUrl(href: string): string {
  try {
    return new URL(href, 'https://yoyaku.harp.lg.jp').toString();
  } catch (error) {
    console.warn('Failed to build absolute URL for lot link', href, error);
    return 'https://yoyaku.harp.lg.jp';
  }
}

function formatJapaneseDate(rawDate: string): string {
  const [yearPart, monthPart, dayPart] = rawDate.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (!year || !month || !day) {
    return rawDate;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  // Convert to JST to ensure weekday matches local calendar.
  const jstTimestamp = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][jstTimestamp.getUTCDay()];

  return `${year}年${month}月${day}日(${weekday})`;
}
