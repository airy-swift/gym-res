declare module 'japanese-holidays' {
  interface HolidayEntry {
    month: number;
    date: number;
    name: string;
  }

  interface JapaneseHolidays {
    getHolidaysOf(year: number, furikae?: boolean): HolidayEntry[];
    isHoliday(date: Date, furikae?: boolean): string | undefined;
    isHolidayAt(date: Date, furikae?: boolean): string | undefined;
  }

  const japaneseHolidays: JapaneseHolidays;
  export default japaneseHolidays;
}
