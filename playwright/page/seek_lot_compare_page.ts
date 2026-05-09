import type { Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { runSeekLotPage } from './seek_lot_page';
import { entriesAreEqual, FixedQueue } from '../types';
import { waitForTutorial } from '../util';

const GYM_URLS = [
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0004&tg%5B0%5D.r%5B0%5D=001&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0040&tg%5B1%5D.r%5B0%5D=002&tg%5B1%5D.r%5B1%5D=001&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0005&tg%5B2%5D.r%5B0%5D=001&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0010&tg%5B3%5D.r%5B0%5D=001&tg%5B3%5D.r%5B1%5D=002&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0020&tg%5B4%5D.r%5B0%5D=001&tg%5B4%5D.r%5B1%5D=002&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0030&tg%5B5%5D.r%5B0%5D=001&tg%5B5%5D.r%5B1%5D=002&d='
];
const SCHOOL_URLS = [
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0202&tg%5B0%5D.r%5B0%5D=050&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0214&tg%5B1%5D.r%5B0%5D=050&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0217&tg%5B2%5D.r%5B0%5D=050&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0230&tg%5B3%5D.r%5B0%5D=050&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0231&tg%5B4%5D.r%5B0%5D=050&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0242&tg%5B5%5D.r%5B0%5D=050&tg%5B6%5D.lg=011002&tg%5B6%5D.fc=0285&tg%5B6%5D.r%5B0%5D=050&tg%5B7%5D.lg=011002&tg%5B7%5D.fc=0292&tg%5B7%5D.r%5B0%5D=050&tg%5B8%5D.lg=011002&tg%5B8%5D.fc=0302&tg%5B8%5D.r%5B0%5D=050&tg%5B9%5D.lg=011002&tg%5B9%5D.fc=0305&tg%5B9%5D.r%5B0%5D=050&d=',
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0337&tg%5B0%5D.r%5B0%5D=050&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0338&tg%5B1%5D.r%5B0%5D=050&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0340&tg%5B2%5D.r%5B0%5D=050&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0341&tg%5B3%5D.r%5B0%5D=050&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0342&tg%5B4%5D.r%5B0%5D=050&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0344&tg%5B5%5D.r%5B0%5D=050&tg%5B6%5D.lg=011002&tg%5B6%5D.fc=0361&tg%5B6%5D.r%5B0%5D=050&tg%5B7%5D.lg=011002&tg%5B7%5D.fc=0366&tg%5B7%5D.r%5B0%5D=050&tg%5B8%5D.lg=011002&tg%5B8%5D.fc=0391&tg%5B8%5D.r%5B0%5D=050&d='
];

const JST_TIMEZONE = 'Asia/Tokyo';
const DETAIL_PAGE_CONCURRENCY = 10;

export async function runSeekLotComparePage(
  page: Page,
  desiredCount: number,
): Promise<RepresentativeEntry[]> {
  const results: { count: number; entry: RepresentativeEntry }[] = [];
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
  for (const url of selectedUrls) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.toString().startsWith('https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison'), {
      timeout: 10_000,
    });

    await waitForTutorial(page);

    await page.locator('a.AvailabilityFrames_dayFrame_content.is-lot').first().waitFor({ state: 'visible', timeout: 10_000 });
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const lotteryLinks = page.locator('a.AvailabilityFrames_dayFrame_content.is-lot');
    const count = await lotteryLinks.count();
    const targetUrls: string[] = [];
    
    for (let j = 0; j < count; j++) {
      const lotteryLink = lotteryLinks.nth(j);
      const href = await lotteryLink.getAttribute('href');
      if (!href) {
        continue;
      }
      targetUrls.push(buildAbsoluteUrl(href));
    }

    // bot判定をお気持ちで避けたいのでシャッフルしてせめてもの抵抗をする
    shuffleInPlace(targetUrls);

    const targetCount = targetUrls.length;
    if (targetCount === 0) {
      continue;
    }

    console.log(`🔍 詳細チェック開始 ${formatCurrentJst()} 件数:${targetCount}`);
    let processedCount = 0;

    shuffleInPlace(targetUrls);

    await processWithConcurrency(targetUrls, DETAIL_PAGE_CONCURRENCY, async targetUrl => {
      const detailPage = await page.context().newPage();
      let seekLots: {count: number, entry: RepresentativeEntry}[] | undefined;
      try {
        await detailPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        seekLots = await runSeekLotPage(detailPage, targetUrl);
      } finally {
        await detailPage.close();
      }
      if (seekLots?.length) {
        seekLots
          .slice()
          .sort((a, b) => a.count - b.count) // count 昇順で見る
          .forEach(({ count, entry }) => {
            // すでに同じ entry が入っていればスキップ
            const alreadyExists = results.some(e => entriesAreEqual(e.entry, entry));
            if (alreadyExists) {
              logRejected(entry, count);
              return;
            }

            // まだ枠に余裕があるならそのまま入れる
            if (results.length < desiredCount) {
              logAdopted(entry, count);
              results.push({ count, entry });
              return;
            }

            // いちばん悪い（count が最大）の要素を探す
            let worstIndex = 0;
            for (let i = 1; i < results.length; i++) {
              if (results[i].count > results[worstIndex].count) {
                worstIndex = i;
              }
            }
            const worst = results[worstIndex];

            // 今の方がマシ（count が小さい）なら入れ替える
            if (count < worst.count) {
              logAdopted(entry, count);
              results[worstIndex] = { count, entry };
            } else {
              logRejected(entry, count);
            }
          });
      }

      processedCount += 1;
      if (processedCount % 50 === 0) {
        console.log(`  残り${Math.max(targetCount - processedCount, 0)}件`);
      }
    });

    console.log(`✅ 詳細チェック完了 ${formatCurrentJst()} 件数:${targetCount}`);
  }
  
  return results
    .sort((a, b) => a.count - b.count) // 念のため小さい順に整列
    .map(({ entry }) => ({
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

function formatCurrentJst(): string {
  return new Date().toLocaleString('ja-JP', { timeZone: JST_TIMEZONE });
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

function formatEntryLog(entry: RepresentativeEntry, count: number): string {
  return `応募数:${count} 施設:${entry.gymName} 部屋:${entry.room} 日付:${entry.date} 時間:${entry.time}`;
}

function logAdopted(entry: RepresentativeEntry, count: number): void {
  console.log(`🎉 採用 ${formatEntryLog(entry, count)}`);
}

function logRejected(entry: RepresentativeEntry, count: number): void {
  console.log(`  見送り ${formatEntryLog(entry, count)}`);
}

async function processWithConcurrency<T>(items: T[], limit: number, handler: (item: T, index: number) => Promise<void>): Promise<void> {
  if (items.length === 0 || limit <= 0) {
    return;
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
}

function shuffleInPlace<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
