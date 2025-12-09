import type { Locator, Page } from '@playwright/test';
import { throwLoggedError } from '../util';
import { RepresentativeEntry } from '../types';

const TARGET_URL = 'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Index';

export async function runFacilityAvailabilityPage(page: Page, entry: RepresentativeEntry): Promise<void> {
  await page.waitForURL((url) => url.toString().startsWith(TARGET_URL), {
    timeout: 10_000,
  });
  
  await page.waitForSelector('#fixedCotnentsWrapper', { state: 'hidden' });
  const skipButton = page.getByText('スキップ');
  let found = false;
  await skipButton.first()
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => { found = true; })
    .catch(() => { /* 出なかっただけ */ });
  if (found) {
    await skipButton.first().click();
  }
  await page.waitForSelector('#fixedCotnentsWrapper', { state: 'hidden' });

  await new Promise(resolve => setTimeout(resolve, 1_000));

  let [room, booth] = entry.room.split('/');
  // if (!booth) {
  //   booth = room;
  // }
  const matchingRowIndex = await getMatchingRow(page, room);
  const lotterySlots = await getLotterySlots(page, matchingRowIndex, booth);

  const entryRange = parseEntryTime(entry.time);
  if (!entryRange) {
    throwLoggedError(`[runFacilityAvailabilityPage:No.3] エントリーの時間形式が不正です: ${entry.time}`);
  }

  const selectedSlots = await resolveSlotsForEntryTime(lotterySlots, entryRange);

  for (const slot of selectedSlots) {
    await slot.click();
  }
  await new Promise(resolve => setTimeout(resolve, 4_000));

  await verifySelectionSummary(page, entry);

  const confirmButton = page.locator('span', { hasText: '確認' }).first();
  await confirmButton.waitFor({ state: 'visible', timeout: 10_000 });
  await confirmButton.click();

  const applyButton = page.locator('span', { hasText: '抽選申込へ' }).first();
  await applyButton.waitFor({ state: 'visible', timeout: 10_000 });
  await applyButton.click();

  await page.waitForTimeout(1_000);
  await handlePossibleErrors(page);
}


// trの見出しから選択するrowを取り出したい
async function getMatchingRow(page: Page, room: string): Promise<number> {
  const roomButtons = page.locator('button.AvailabilityFrames_textBtn .v-btn__content');
  const pageRoomTexts = await roomButtons.allInnerTexts();
  const matchingPageRoom = pageRoomTexts.filter((text: string) => text === room).at(0);
  if (!matchingPageRoom) {
    throwLoggedError('[runFacilityAvailabilityPage:No.3] 施設一覧に一致する部屋名が見つかりませんでした。');
  }

  const rows = page.locator('table.AvailabilityFrames_gridTable tr');
  const rowCount = await rows.count();
  const normalize = (value?: string) => value?.trim() ?? '';
  let matchingRowIndex = -1;
  let matchingRow: Locator | undefined;

  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i);
    const rowLabel = await row
      .locator('button.AvailabilityFrames_textBtn .v-btn__content')
      .first()
      .innerText()
      .catch(() => undefined);
    if (normalize(rowLabel) === normalize(matchingPageRoom)) {
      matchingRow = row;
      matchingRowIndex = i;
      break;
    }
  }

  if (!matchingRow || matchingRowIndex === -1) {
    throwLoggedError('[runFacilityAvailabilityPage:No.3] 対象の行位置を特定できませんでした。');
  }

  return matchingRowIndex;
}

// 
async function getLotterySlots(page: Page, matchingRowIndex: number, booth?: string): Promise<Array<Locator>> {
  let targetRow: Locator | undefined;
  if (booth) {
    for (let i = matchingRowIndex + 2; i < 5; i += 1) {
      const matchingRow = page.locator('table.AvailabilityFrames_gridTable tr').nth(i);
      const boothButtons = matchingRow.locator('button.AvailabilityFrames_textBtn .v-btn__content');
      const boothButton = boothButtons.filter({ hasText: booth }).first();
      if (boothButton) {
        targetRow = matchingRow;
        break;
      }
    }
  } else {
    const matchingRow = page.locator('table.AvailabilityFrames_gridTable tr').nth(matchingRowIndex + 2);
    targetRow = matchingRow;
  }

  if (!targetRow) {
    throwLoggedError(`[runFacilityAvailabilityPage:No.3] 希望するブース行を特定できませんでした。${booth}, ${matchingRowIndex}`);
  }

  const lotteryButtons = targetRow.locator('button[title$="抽選申込可"]');
  const lotteryButtonCount = await lotteryButtons.count();
  const lotterySlots: Array<Locator> = [];

  for (let i = 0; i < lotteryButtonCount; i += 1) {
    const button = lotteryButtons.nth(i);
    lotterySlots.push(button);
  }

  return lotterySlots;
}

async function resolveSlotsForEntryTime(
  lotterySlots: Locator[],
  entryRange: { start: string; end: string },
): Promise<Locator[]> {
  const entryStart = toMinutes(entryRange.start);
  const entryEnd = toMinutes(entryRange.end);

  const slotRanges: Array<{ locator: Locator; start: number; end: number }> = [];
  for (const slot of lotterySlots) {
    const title = await slot.getAttribute('title');
    if (!title) {
      continue;
    }
    const slotRange = parseSlotTitle(title);
    if (!slotRange) {
      continue;
    }
    slotRanges.push({ locator: slot, start: toMinutes(slotRange.start), end: toMinutes(slotRange.end) });
  }
  slotRanges.sort((a, b) => a.start - b.start);

  for (let i = 0; i < slotRanges.length; i += 1) {
    const range = slotRanges[i];
    if (!(range.start <= entryStart && entryStart < range.end)) {
      continue;
    }

    const slotsToClick: Locator[] = [range.locator];
    let coveredEnd = range.end;
    let nextIndex = i + 1;

    while (coveredEnd < entryEnd && nextIndex < slotRanges.length) {
      const nextRange = slotRanges[nextIndex];
      slotsToClick.push(nextRange.locator);
      coveredEnd = Math.max(coveredEnd, nextRange.end);
      nextIndex += 1;
    }

    if (coveredEnd >= entryEnd) {
      return slotsToClick;
    }
  }

  throwLoggedError('[runFacilityAvailabilityPage:No.3] 希望する時間帯に一致するスロットを取得できませんでした。');
}

async function verifySelectionSummary(page: Page, entry: RepresentativeEntry): Promise<void> {
  const selectionSummary = page.locator('span.d-inline-block', { hasText: '日時' }).first();
  await selectionSummary.waitFor({ state: 'visible', timeout: 10_000 });

  const selection = await selectionSummary.evaluate((element) => {
    const timeElement = element.querySelector('time');
    const dateText = timeElement?.textContent?.trim() ?? '';
    let timeText = '';
    if (timeElement) {
      let sibling: ChildNode | null = timeElement.nextSibling;
      while (sibling) {
        if (sibling.nodeType === Node.TEXT_NODE) {
          const candidate = sibling.textContent?.trim();
          if (candidate) {
            timeText = candidate;
            break;
          }
        }
        sibling = sibling.nextSibling;
      }
    }
    return { dateText, timeText };
  });

  const selectionDate = parseDisplayDate(selection.dateText);
  const entryDate = parseDisplayDate(entry.date ?? '');
  const selectionTimeRange = parseEntryTime(selection.timeText);
  const entryTimeRange = parseEntryTime(entry.time);

  const sameDate =
    selectionDate?.year === entryDate?.year &&
    selectionDate?.month === entryDate?.month &&
    selectionDate?.day === entryDate?.day;

  const sameTime =
    selectionTimeRange &&
    entryTimeRange &&
    selectionTimeRange.start === entryTimeRange.start &&
    selectionTimeRange.end === entryTimeRange.end;

  const matches = Boolean(sameDate && sameTime);
  if (!matches) {
    console.log('Selection summary mismatch', {
      selectedDate: selection.dateText,
      selectedTime: selection.timeText,
      expectedDate: entry.date,
      expectedTime: entry.time,
    });
    throwLoggedError('[runFacilityAvailabilityPage:No.3] 選択済みの日時がリクエスト内容と一致しません。');
  }
}

async function handlePossibleErrors(page: Page): Promise<void> {
  const errorSelectors = [
    'text=抽選数が利用制限に該当します。',
    'text=サービス利用時間外です。',
  ];

  for (const selector of errorSelectors) {
    const message = page.locator(selector);
    if (await message.isVisible({ timeout: 500 })) {
      const text = await message.innerText().catch(() => selector);
      throwLoggedError(`[runFacilityAvailabilityPage:No.3] エラー検知: ${text}`);
    }
  }
}

function parseDisplayDate(value: string): { year: number; month: number; day: number } | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(/(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
}

function parseSlotTitle(title: string): { start: string; end: string } | undefined {
  const timeMatch = title.match(/(\d{1,2})時(?:(\d{1,2})分)?から(\d{1,2})時(?:(\d{1,2})分)?/);
  if (!timeMatch) {
    return undefined;
  }

  const [, startHour, startMinute, endHour, endMinute] = timeMatch;
  return {
    start: `${padHour(startHour)}:${padMinute(startMinute)}`,
    end: `${padHour(endHour)}:${padMinute(endMinute)}`,
  };
}

function parseEntryTime(time?: string | null): { start: string; end: string } | undefined {
  if (!time) {
    return undefined;
  }
  const match = time.trim().match(/(\d{1,2})(?::?(\d{2}))?\s*[-〜]\s*(\d{1,2})(?::?(\d{2}))?/);
  if (!match) {
    return undefined;
  }
  const [, startHour, startMinute, endHour, endMinute] = match;
  return {
    start: `${padHour(startHour)}:${padMinute(startMinute)}`,
    end: `${padHour(endHour)}:${padMinute(endMinute)}`,
  };
}

const padHour = (value?: string) => (value ?? '0').padStart(2, '0');
const padMinute = (value?: string) => (value ?? '0').padStart(2, '0');
const toMinutes = (time: string) => {
  const [hour, minute] = time.split(':');
  return parseInt(hour, 10) * 60 + parseInt(minute, 10);
};
