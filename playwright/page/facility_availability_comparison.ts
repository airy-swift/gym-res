import type { Locator, Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { deriveUdParam, throwLoggedError, waitForTutorial } from '../util';

const COMPARISON_URL_PREFIX = 'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison';
const COMPARISON_TABLE_ROWS = 'table.AvailabilityFrames_gridTable tr';

export async function runFacilityAvailabilityComparisonPage(page: Page, entry: RepresentativeEntry): Promise<void> {
  await page.waitForURL(url => url.toString().startsWith(COMPARISON_URL_PREFIX), {
    timeout: 10_000,
  });

  await waitForTutorial(page);
  await page.locator('table.AvailabilityFrames_gridTable').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(1_000);

  const parts = splitRoomAndBooth(entry.room);
  const desiredDateIso = deriveUdParam(entry.date);
  if (!desiredDateIso) {
    throwLoggedError(`[runFacilityAvailabilityComparisonPage] 予約日付形式が不正です: ${entry.date}`);
  }

  const normalizedBooth = normalizeText(parts.booth);
  const boothRow = await findBoothRow(page, normalizedBooth);
  await boothRow.scrollIntoViewIfNeeded().catch(() => undefined);
  await boothRow.waitFor({ state: 'visible', timeout: 5_000 });

  await clickAvailableComparisonSlot(page, boothRow, desiredDateIso);
}

type RoomParts = { booth?: string };

function splitRoomAndBooth(room: string): RoomParts {
  const segments = room
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (segments.length === 0) {
    return { booth: undefined };
  }

  if (segments.length === 1) {
    return { booth: undefined };
  }

  const booth = segments.pop();
  return {
    booth,
  };
}

async function findBoothRow(page: Page, normalizedBoothName: string): Promise<Locator> {
  if (normalizedBoothName === '' || normalizedBoothName === '全面') {
    return page.locator(COMPARISON_TABLE_ROWS).nth(3);
  }
  const rows = page.locator(COMPARISON_TABLE_ROWS);
  // const fallbackCount = await rows.count();
  // if (fallbackCount === 3) {
  //   return rows.nth(2);
  // }

  const rowsMeta: Array<{ label: string; rowText: string; selector: string }> = await rows.evaluateAll((trs) => {
    const selectors = [
      'th.AvailabilityFrames_gridTable_tbody_rowTitle .v-btn__content',
      'th.AvailabilityFrames_gridTable_tbody_rowTitle button',
      'th.AvailabilityFrames_gridTable_tbody_rowTitle',
      'th',
      'td',
    ];
    return trs.map((tr) => {
      let label = '';
      let matchedSelector = '';
      for (const selector of selectors) {
        const el = tr.querySelector<HTMLElement>(selector);
        const text = (el?.textContent ?? '').trim();
        if (!text) {
          continue;
        }
        label = text;
        matchedSelector = selector;
        break;
      }
      const rowText = (tr.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        label,
        rowText,
        selector: matchedSelector,
      };
    });
  });

  const boothCandidates = buildBoothCandidates(normalizedBoothName);
  let fallbackIndex: number | undefined;

  for (let i = 0; i < rowsMeta.length; i += 1) {
    const row = rowsMeta[i];
    const normalizedLabel = normalizeComparisonLabel(row.label || row.rowText);
    if (!normalizedLabel) continue;

    if (boothCandidates.some(candidate => normalizedLabel === candidate)) {
      return rows.nth(i);
    }
    if (
      fallbackIndex === undefined
      && boothCandidates.some(candidate => normalizedLabel.includes(candidate) || candidate.includes(normalizedLabel))
    ) {
      fallbackIndex = i;
    }
  }

  if (fallbackIndex !== undefined) {
    return rows.nth(fallbackIndex);
  }

  throwLoggedError(
    `[runFacilityAvailabilityComparisonPage] ブース "${normalizedBoothName}" に一致する行が見つかりませんでした。`
  );
}


function normalizeText(value?: string | null): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
}

function normalizeComparisonLabel(value?: string | null): string {
  if (!value) {
    return '';
  }
  const normalized = value
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[()]/g, '');
  return normalizeText(normalized);
}

function buildBoothCandidates(normalizedBoothName: string): string[] {
  const candidates = new Set<string>();
  const booth = normalizeText(normalizedBoothName);
  if (!booth) {
    return [];
  }
  candidates.add(booth);
  candidates.add(booth.replace(/^半面/, ''));
  candidates.add(booth.replace(/^全面/, ''));
  return [...candidates].filter(value => value.length > 0);
}

async function clickAvailableComparisonSlot(page: Page, row: Locator, desiredDateIso: string): Promise<void> {
  const links = row.locator('a.AvailabilityFrames_dayFrame_content');
  const linkCount = await links.count();
  for (let i = 0; i < linkCount; i += 1) {
    const link = links.nth(i);
    const title = await link.getAttribute('title');
    if (!title || !title.includes('抽選申込可')) {
      continue;
    }

    const slotDate = await resolveSlotDate(link);
    if (slotDate !== desiredDateIso) {
      continue;
    }

    await ensureLinkVisible(link);
    const clicked = await tryClick(link);
    if (clicked) {
      return;
    }

    await page.waitForTimeout(1_000);
    await scrollComparisonTable(page, 'right');
    if (await tryClick(link)) {
      return;
    }
  }

  throwLoggedError('[runFacilityAvailabilityComparisonPage] 希望する日付の抽選枠を比較ページで見つけられませんでした。');
}


async function ensureLinkVisible(link: Locator): Promise<void> {
  await link.evaluate(element => {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  });
}

async function tryClick(link: Locator): Promise<boolean> {
  try {
    await link.click();
    return true;
  } catch {
    return false;
  }
}

async function scrollComparisonTable(page: Page, direction: 'left' | 'right'): Promise<void> {
  const table = page.locator('.AvailabilityFrames_gridTable');
  await table.waitFor({ state: 'visible' });

  const scrolled = await table.evaluateHandle((el) => {
    // el を起点に、横スクロール可能な祖先（含む）を探す
    const isScrollableX = (x: Element) => {
      const s = getComputedStyle(x);
      const overflowX = s.overflowX;
      const canScroll = overflowX === 'auto' || overflowX === 'scroll';
      return canScroll && (x as HTMLElement).scrollWidth > (x as HTMLElement).clientWidth + 1;
    };

    let cur: Element | null = el;
    while (cur) {
      if (isScrollableX(cur)) return cur as HTMLElement;
      cur = cur.parentElement;
    }
    return el as HTMLElement; // fallback
  });

  await scrolled.evaluate(
    (scroller: HTMLElement, scrollDirection: 'left' | 'right') => {
      scroller.scrollLeft = scrollDirection === 'left' ? 0 : scroller.scrollWidth;
    },
    direction,
  );
}

async function resolveSlotDate(link: Locator): Promise<string | undefined> {
  const timeElement = link.locator('time').first();
  const datetime = await timeElement.getAttribute('datetime').catch(() => undefined);
  if (datetime) {
    return datetime.split(' ')[0];
  }

  const href = await link.getAttribute('href');
  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href, 'https://yoyaku.harp.lg.jp');
    const dateParam = url.searchParams.get('d');
    return dateParam ?? undefined;
  } catch {
    return undefined;
  }
}
