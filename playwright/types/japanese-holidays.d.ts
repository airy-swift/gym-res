declare module 'japanese-holidays' {
  const JapaneseHolidays: {
    isHoliday(date: Date, furikae?: boolean): string | boolean;
  };

  export default JapaneseHolidays;
}
