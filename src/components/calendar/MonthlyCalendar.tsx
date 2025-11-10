'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  addDays,
  addMonths,
  formatMonthLabel,
  getDayOfWeek,
  getNextMonth,
  getTodayInJst,
  isSameDate,
  toDateKey,
  type SimpleDate,
} from '@/lib/date/jst';
import {
  listReservationDaysInRange,
  subscribeReservationDaysInRange,
  type ReservationDay,
  type ReservationSlotId,
} from '@/lib/firebase';

type CalendarDay = {
  date: SimpleDate;
  key: string;
  weekday: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  reservation?: ReservationDay;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const SLOT_LABELS: Record<ReservationSlotId, string> = {
  morning: '午前',
  afternoon: '午後',
  night: '夜',
};

const buildCalendarGrid = (monthAnchor: SimpleDate, today: SimpleDate) => {
  const firstDayOfMonth: SimpleDate = {
    year: monthAnchor.year,
    month: monthAnchor.month,
    day: 1,
  };

  const firstWeekday = getDayOfWeek(firstDayOfMonth);
  const gridStart = addDays(firstDayOfMonth, -firstWeekday);

  const days: SimpleDate[] = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );

  return {
    days,
    gridStart,
    gridEnd: addDays(gridStart, 41),
    toCalendarDay(reservationMap: Record<string, ReservationDay | undefined>) {
      return days.map<CalendarDay>((date) => {
        const key = toDateKey(date);
        return {
          date,
          key,
          weekday: getDayOfWeek(date),
          isCurrentMonth:
            date.year === monthAnchor.year && date.month === monthAnchor.month,
          isToday: isSameDate(date, today),
          reservation: reservationMap[key],
        };
      });
    },
  };
};

type ReservationMap = Record<string, ReservationDay | undefined>;

const buildReservationMap = (reservations: ReservationDay[]): ReservationMap =>
  reservations.reduce<ReservationMap>((acc, reservation) => {
    acc[reservation.date] = reservation;
    return acc;
  }, {});

export const MonthlyCalendar = () => {
  const today = useMemo(() => getTodayInJst(), []);
  const [displayMonth, setDisplayMonth] = useState<SimpleDate>(() => ({
    ...getNextMonth(today),
    day: 1,
  }));
  const [reservations, setReservations] = useState<ReservationMap>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const calendar = useMemo(() => buildCalendarGrid(displayMonth, today), [
    displayMonth,
    today,
  ]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: ReturnType<typeof subscribeReservationDaysInRange> | null =
      null;

    const startKey = toDateKey(calendar.gridStart);
    const endKey = toDateKey(calendar.gridEnd);

    setIsLoading(true);

    const connect = async () => {
      try {
        const initial = await listReservationDaysInRange(startKey, endKey);
        if (!isMounted) {
          return;
        }
        setReservations(buildReservationMap(initial));
        setError(null);
        setIsLoading(false);

        unsubscribe = subscribeReservationDaysInRange(
          startKey,
          endKey,
          (nextReservations) => {
            if (!isMounted) {
              return;
            }
            setReservations(buildReservationMap(nextReservations));
          },
        );
      } catch (err) {
        console.error(err);
        if (!isMounted) {
          return;
        }
        setError(
          'Firebaseの設定を確認してください。環境変数をセットした後に再度読み込んでください。',
        );
        setIsLoading(false);
      }
    };

    void connect();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [calendar.gridEnd, calendar.gridStart]);

  const calendarDays = useMemo(
    () => calendar.toCalendarDay(reservations),
    [calendar, reservations],
  );

  const handlePrevMonth = () => {
    setDisplayMonth((prev) => ({
      ...addMonths({ ...prev, day: 1 }, -1),
      day: 1,
    }));
  };

  const handleNextMonth = () => {
    setDisplayMonth((prev) => ({
      ...addMonths({ ...prev, day: 1 }, 1),
      day: 1,
    }));
  };

  const monthLabel = formatMonthLabel(displayMonth);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-500 sm:text-sm">
              次月表示（日本時間）
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {monthLabel}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg font-semibold text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
              aria-label="前の月へ"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg font-semibold text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
              aria-label="次の月へ"
            >
              ›
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <div className="grid grid-cols-7 bg-zinc-50 text-center text-xs font-semibold uppercase tracking-wide text-zinc-600 sm:text-sm">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="p-2 sm:p-3">
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-zinc-100">
            {calendarDays.map((day) => {
              const reservationSlots = day.reservation?.slots;
              const hasSlotEntries = reservationSlots
                ? (Object.values(reservationSlots) as Array<
                    ReservationDay['slots'][ReservationSlotId]
                  >).some((entries) => entries.length > 0)
                : false;

              const cellClass = [
                'flex min-h-[92px] flex-col gap-2 bg-white p-2 text-left text-sm transition sm:min-h-[120px] sm:p-3',
                !day.isCurrentMonth && 'text-zinc-400',
              ]
                .filter(Boolean)
                .join(' ');

              const dateBadgeClass = [
                'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold sm:h-8 sm:w-8 sm:text-sm',
                day.isToday
                  ? 'bg-blue-600 text-white'
                  : day.weekday === 0
                  ? 'text-red-500'
                  : day.weekday === 6
                  ? 'text-blue-500'
                  : 'text-zinc-700',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div key={day.key} className={cellClass}>
                  <div className="flex items-center justify-between">
                    <span className={dateBadgeClass}>{day.date.day}</span>
                    {day.reservation?.confirmed && (
                      <span className="rounded-full border border-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 sm:text-xs">
                        確定
                      </span>
                    )}
                  </div>

                  {reservationSlots && hasSlotEntries ? (
                    <ul className="flex grow flex-col gap-1 text-xs leading-snug text-zinc-600 sm:text-sm">
                      {(Object.keys(SLOT_LABELS) as ReservationSlotId[]).map(
                        (slotId) => {
                          const entries = reservationSlots[slotId];
                          if (!entries || entries.length === 0) {
                            return null;
                          }

                          return (
                            <li
                              key={`${day.key}-${slotId}`}
                              className="flex items-start gap-1"
                            >
                              <span className="flex-shrink-0 rounded bg-zinc-100 px-1 text-[10px] font-medium text-zinc-500 sm:text-[11px]">
                                {SLOT_LABELS[slotId]}
                              </span>
                              <span className="grow break-words text-zinc-700">
                                {entries.map((entry) => entry.name).join('、')}
                              </span>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  ) : reservationSlots && day.isCurrentMonth ? (
                    <div className="flex grow items-center text-xs text-zinc-400">
                      予約なし
                    </div>
                  ) : isLoading ? (
                    <div className="flex grow items-center text-xs text-zinc-400">
                      読み込み中…
                    </div>
                  ) : day.isCurrentMonth ? (
                    <div className="flex grow items-center text-xs text-zinc-400">
                      予約なし
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

