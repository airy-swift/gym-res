import type { Page } from '@playwright/test';

const FACILITY_URL_PREFIX = 'https://yoyaku.harp.lg.jp/sapporo/FacilitySearch';
const ROOM_SELECTOR = '[id^="room-"]';
const MATCH_SUBSTRING = 'trip_origin';
const SLOT_SELECTOR = '.v-input__slot';

type RoomInfo = {
  id: string | null;
  text: string;
};


export async function runFacilitySearchPage(page: Page): Promise<void> {
  await page.waitForURL(url => url.toString().startsWith(FACILITY_URL_PREFIX), {
    timeout: 10_000,
  });

  // await page.locator('a[href*="/FacilityAvailability/Index/"]:not([href*="rc="]):not([title])').click();

  await page.waitForFunction(() => {
    return document.querySelectorAll('[id^="room-"]').length > 0;
  });

  const roomLocator = page.locator(ROOM_SELECTOR);
  const roomCount = await roomLocator.count();
  if (roomCount === 0) {
    console.log('No rooms matched the id pattern room-*');
    return;
  }

  const matchingRooms: RoomInfo[] = [];
  for (let index = 0; index < roomCount; index += 1) {
    const element = roomLocator.nth(index);
    const roomId = await element.getAttribute('id');
    const roomText = (await element.innerText()).trim();
    if (roomText.includes(MATCH_SUBSTRING)) {
      matchingRooms.push({ id: roomId, text: roomText });
    }
  }

  if (matchingRooms.length === 0) {
    return;
  }

  for (const room of matchingRooms) {
    if (!room.id) continue;
    const roomElement = page.locator(`#${room.id}`);
    const slots = roomElement.locator(SLOT_SELECTOR);
    const slotCount = await slots.count();
    for (let index = 0; index < slotCount; index += 1) {
      await slots.nth(index).click();
    }
  }

  await page.getByLabel("選択した室場の空きを一括で確認").click();
  // return true;


  

  // const availabilityButton = page.getByRole('link', { name: '空き状況', exact: true }).first();
  // await availabilityButton.waitFor({ state: 'visible', timeout: 10_000 });
  // await availabilityButton.click();
}
