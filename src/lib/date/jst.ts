export type SimpleDate = {
  year: number;
  month: number;
  day: number;
};

const pad = (value: number) => value.toString().padStart(2, '0');

const utcFromSimpleDate = ({ year, month, day }: SimpleDate) =>
  new Date(Date.UTC(year, month - 1, day));

const simpleDateFromUtc = (date: Date): SimpleDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

export const toDateKey = (date: SimpleDate): string =>
  `${date.year}-${pad(date.month)}-${pad(date.day)}`;

export const getTodayInJst = (): SimpleDate => {
  const formatter = new Intl.DateTimeFormat('ja-JP-u-ca-gregory', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  if (!year || !month || !day) {
    throw new Error('Failed to determine the current date in JST.');
  }

  return { year, month, day };
};

export const getDayOfWeek = ({ year, month, day }: SimpleDate): number =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

export const addDays = (date: SimpleDate, days: number): SimpleDate => {
  const next = utcFromSimpleDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return simpleDateFromUtc(next);
};

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const addMonths = (date: SimpleDate, months: number): SimpleDate => {
  const totalMonths = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return { year, month, day };
};

export const getNextMonth = (date: SimpleDate): SimpleDate =>
  addMonths({ ...date, day: 1 }, 1);

export const isSameDate = (a: SimpleDate, b: SimpleDate): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day;

export const formatMonthLabel = ({ year, month }: SimpleDate): string =>
  new Intl.DateTimeFormat('ja-JP-u-ca-gregory', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, 1)));

