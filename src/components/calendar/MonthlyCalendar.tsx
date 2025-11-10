'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

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
  updateReservationDay,
  type ReservationDayRecord,
  type ReservationSlotEntry,
  type ReservationSlotId,
} from '@/lib/firebase';

type CalendarDay = {
  date: SimpleDate;
  key: string;
  weekday: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  reservations: ReservationDayRecord[];
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const SLOT_LABELS: Record<ReservationSlotId, string> = {
  morning: '午前',
  afternoon: '午後',
  night: '夜',
};

const SLOT_ORDER: ReservationSlotId[] = ['morning', 'afternoon', 'night'];

const FACILITY_SEARCH_BASE_URL =
  'https://yoyaku.harp.lg.jp/sapporo/FacilitySearch/Index/';

const FACILITY_SEARCH_DEFAULT_PARAMS: Array<[string, string]> = [
  ['u[0]', '28'],
  ['f[0]', '011002_0004'],
  ['f[1]', '011002_0005'],
  ['f[2]', '011002_0010'],
  ['f[3]', '011002_0020'],
  ['f[4]', '011002_0030'],
  ['f[5]', '011002_0040'],
];

const SLOT_PT_PARAM_MAP: Record<
  ReservationSlotId,
  { key: string; value: string }
> = {
  morning: { key: 'pt[0]', value: '0' },
  afternoon: { key: 'pt[1]', value: '1' },
  night: { key: 'pt[2]', value: '2' },
};

const getReservationBackgroundClass = (count: number): string => {
  if (count <= 0) {
    return 'bg-white';
  }
  if (count === 1) {
    return 'bg-orange-50';
  }
  if (count === 2) {
    return 'bg-orange-100';
  }
  return 'bg-red-100';
};

const sanitizeGymName = (gymName: string | null | undefined): string =>
  gymName && gymName.trim().length > 0 ? gymName.trim() : '施設名未設定';

type SlotFacilityDetail = {
  reservationId: string;
  gymName: string;
  entries: ReservationSlotEntry[];
  participantNames: string[];
  totalEntries: number;
  isStruck: boolean;
};

type SlotDetail = {
  slotId: ReservationSlotId;
  facilities: SlotFacilityDetail[];
  totalEntries: number;
};

type MonthlyCalendarProps = {
  onRequestScreenshotUpload?: () => void;
};

const buildSlotDetails = (reservations: ReservationDayRecord[]): SlotDetail[] =>
  SLOT_ORDER.map((slotId) => {
    const facilities: SlotFacilityDetail[] = [];

    reservations.forEach((reservation) => {
      const entries = reservation.slots?.[slotId] ?? [];
      if (!entries || entries.length === 0) {
        return;
      }

      const normalizedEntries = entries.map((entry) => ({
        ...entry,
        strike: entry.strike ?? false,
      }));

      const participantNames = normalizedEntries
        .map((entry) => entry.name?.trim() ?? '')
        .filter((name) => name.length > 0);

      facilities.push({
        reservationId: reservation.id,
        gymName: sanitizeGymName(reservation.gymName),
        entries: normalizedEntries,
        participantNames,
        totalEntries: normalizedEntries.length,
        isStruck:
          normalizedEntries.length > 0
            ? normalizedEntries.every((entry) => entry.strike)
            : false,
      });
    });

    facilities.sort((a, b) => Number(a.isStruck) - Number(b.isStruck));

    const totalEntries = facilities.reduce(
      (sum, facility) => sum + facility.totalEntries,
      0,
    );

    return {
      slotId,
      facilities,
      totalEntries,
    };
  });

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
    toCalendarDay(reservationMap: ReservationMap) {
      return days.map<CalendarDay>((date) => {
        const key = toDateKey(date);
        const reservationsForDay: ReservationDayRecord[] = reservationMap[key] ?? [];
        return {
          date,
          key,
          weekday: getDayOfWeek(date),
          isCurrentMonth:
            date.year === monthAnchor.year && date.month === monthAnchor.month,
          isToday: isSameDate(date, today),
          reservations: reservationsForDay,
        };
      });
    },
  };
};

type ReservationMap = Record<string, ReservationDayRecord[]>;

const buildReservationMap = (reservations: ReservationDayRecord[]): ReservationMap => {
  const map: ReservationMap = {};
  reservations.forEach((reservation) => {
    if (!map[reservation.date]) {
      map[reservation.date] = [];
    }
    map[reservation.date]!.push(reservation);
  });
  return map;
};

export const MonthlyCalendar = ({ onRequestScreenshotUpload }: MonthlyCalendarProps) => {
  const today = useMemo(() => getTodayInJst(), []);
  const [displayMonth, setDisplayMonth] = useState<SimpleDate>(() => ({
    ...getNextMonth(today),
    day: 1,
  }));
  const [reservations, setReservations] = useState<ReservationMap>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);

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

  const openDetailDialog = useCallback((day: CalendarDay) => {
    setSelectedDay(day);
    setIsDetailDialogOpen(true);
  }, []);

  const closeDetailDialog = useCallback(() => {
    setIsDetailDialogOpen(false);
    setSelectedDay(null);
  }, []);

  useEffect(() => {
    if (!isDetailDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDetailDialog();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDetailDialog, isDetailDialogOpen]);

  const selectedSlotDetails = selectedDay
    ? buildSlotDetails(selectedDay.reservations)
    : [];

  const buildFacilitySearchUrl = useCallback(
    (slotId: ReservationSlotId): string | null => {
      if (!selectedDay) {
        return null;
      }

      const url = new URL(FACILITY_SEARCH_BASE_URL);
      FACILITY_SEARCH_DEFAULT_PARAMS.forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set('ud', toDateKey(selectedDay.date));

      const slotParam = SLOT_PT_PARAM_MAP[slotId];
      url.searchParams.set(slotParam.key, slotParam.value);

      return url.toString();
    },
    [selectedDay],
  );

  const openFacilitySearchPage = useCallback(
    (slotId: ReservationSlotId) => {
      const url = buildFacilitySearchUrl(slotId);
      if (!url) {
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [buildFacilitySearchUrl],
  );

  const handleSlotCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, slotId: ReservationSlotId) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFacilitySearchPage(slotId);
      }
    },
    [openFacilitySearchPage],
  );

  const handleToggleFacilityStrike = useCallback(
    async (slotId: ReservationSlotId, facility: SlotFacilityDetail) => {
      if (!selectedDay) {
        return;
      }

      const targetDayKey = selectedDay.key;

      const targetReservation = selectedDay.reservations.find(
        (reservation) => reservation.id === facility.reservationId,
      );

      if (!targetReservation) {
        return;
      }

      const nextStrike = !facility.isStruck;
      const updatedSlotEntries = (targetReservation.slots?.[slotId] ?? []).map(
        (entry) => ({
          ...entry,
          strike: nextStrike,
        }),
      );

      const updatedReservation: ReservationDayRecord = {
        ...targetReservation,
        slots: {
          ...targetReservation.slots,
          [slotId]: updatedSlotEntries,
        },
      };

      setSelectedDay((prev) => {
        if (!prev || prev.key !== targetDayKey) {
          return prev;
        }

        return {
          ...prev,
          reservations: prev.reservations.map((reservation) =>
            reservation.id === updatedReservation.id ? updatedReservation : reservation,
          ),
        };
      });

      setReservations((prev) => {
        const dayReservations = prev[updatedReservation.date];
        if (!dayReservations) {
          return prev;
        }

        return {
          ...prev,
          [updatedReservation.date]: dayReservations.map((reservation) =>
            reservation.id === updatedReservation.id ? updatedReservation : reservation,
          ),
        };
      });

      try {
        await updateReservationDay(updatedReservation.id, {
          date: updatedReservation.date,
          gymName: updatedReservation.gymName,
          slots: updatedReservation.slots,
          confirmed: updatedReservation.confirmed,
          lastUpdatedBy: updatedReservation.lastUpdatedBy,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Failed to update strike status', error);
      }
    },
    [selectedDay],
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
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {monthLabel}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onRequestScreenshotUpload ? (
              <button
                type="button"
                onClick={onRequestScreenshotUpload}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 7.5l.46-1.382A1.5 1.5 0 018.64 5.25h6.72a1.5 1.5 0 011.431.868l.459 1.382M4.5 7.5h15a1.5 1.5 0 011.5 1.5v8.25a1.5 1.5 0 01-1.5 1.5h-15a1.5 1.5 0 01-1.5-1.5V9a1.5 1.5 0 011.5-1.5z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15.75a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z"
                  />
                </svg>
                <span>予約画像をアップロード</span>
              </button>
            ) : null}
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
              if (!day.isCurrentMonth) {
                return (
                  <div
                    key={day.key}
                    className="flex min-h-[92px] flex-col gap-2 bg-zinc-50 p-2 text-left sm:min-h-[120px] sm:p-3"
                    aria-hidden="true"
                  />
                );
              }

              const reservationsForDay = day.reservations;
              const slotDetails = buildSlotDetails(reservationsForDay);
              const totalEntries = slotDetails.reduce(
                (sum, detail) => sum + detail.totalEntries,
                0,
              );
              const hasSlotEntries = totalEntries > 0;

              const backgroundClass = getReservationBackgroundClass(totalEntries);

              const cellClass = [
                'flex min-h-[92px] flex-col gap-2 rounded-lg p-2 text-left text-sm transition sm:min-h-[120px] sm:p-3',
                backgroundClass,
                'cursor-pointer hover:ring-2 hover:ring-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
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
                <div
                  key={day.key}
                  role="button"
                  tabIndex={0}
                  aria-label={`${day.date.month}月${day.date.day}日の予約を確認`}
                  className={cellClass}
                  onClick={() => openDetailDialog(day)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetailDialog(day);
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className={dateBadgeClass}>{day.date.day}</span>
                  </div>

                  {hasSlotEntries ? (
                    <div className="flex grow flex-col gap-1 text-[10px] leading-tight text-zinc-600 sm:text-[11px]">
                      <ul className="flex flex-col gap-1 text-[9px] text-zinc-500 sm:text-[10px]">
                        {slotDetails.map((detail) => {
                          if (detail.totalEntries === 0) {
                            return null;
                          }

                          const facilityNames = Array.from(
                            new Set(
                              detail.facilities.map((facility) => facility.gymName),
                            ),
                          );

                          const slotSummary =
                            facilityNames.length > 0
                              ? facilityNames.join('／')
                              : '施設名未設定';

                          return (
                            <li
                              key={`${day.key}-${detail.slotId}`}
                              className="flex items-start gap-1"
                            >
                              <span className="flex-shrink-0 rounded bg-zinc-100 px-1 text-[9px] font-medium text-zinc-500 sm:text-[10px]">
                                {SLOT_LABELS[detail.slotId]}
                              </span>
                              <span className="grow break-words text-zinc-600">
                                {slotSummary}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : isLoading ? (
                    <div className="flex grow items-center text-xs text-zinc-400">
                      読み込み中…
                    </div>
                  ) : (
                    <div className="flex grow items-center text-xs text-zinc-400">
                      予約なし
                    </div>
                  )}
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

      {isDetailDialogOpen && selectedDay ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDetailDialog();
            }
          }}
        >
          <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-semibold text-zinc-900">
                  {`${selectedDay.date.year}年${selectedDay.date.month}月${selectedDay.date.day}日（${
                    WEEKDAYS[selectedDay.weekday]
                  }）`}
                </h2>
                <span className="text-xs text-zinc-500">
                  枠をタップすると予約画面を開きます
                </span>
              </div>
              <button
                type="button"
                onClick={closeDetailDialog}
                className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
              >
                閉じる
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="flex flex-col gap-4">
                {selectedSlotDetails.map((detail) => {
                  const hasEntries = detail.totalEntries > 0;
                  const slotBackground = getReservationBackgroundClass(detail.totalEntries);

                  return (
                    <div
                      key={`${selectedDay.key}-${detail.slotId}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${SLOT_LABELS[detail.slotId]}枠の予約詳細と公式サイトを開く`}
                      className={`rounded-xl border border-zinc-200 px-4 py-3 transition hover:ring-2 hover:ring-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${slotBackground}`}
                      onClick={() => openFacilitySearchPage(detail.slotId)}
                      onKeyDown={(event) => handleSlotCardKeyDown(event, detail.slotId)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-zinc-700">
                          {SLOT_LABELS[detail.slotId]}
                        </span>
                        <span className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                          <span>{hasEntries ? `${detail.totalEntries}件` : '予約なし'}</span>
                          <span aria-hidden="true" className="text-base text-zinc-400">
                            ↗
                          </span>
                        </span>
                      </div>
                      {hasEntries ? (
                        <ul className="mt-3 space-y-1 text-xs text-zinc-700 sm:text-sm">
                          {detail.facilities.map((facility, index) => {
                            const participantLabel =
                              facility.participantNames.length > 0
                                ? `（${facility.participantNames.join('、')}）`
                                : '（予約者名未設定）';
                            const facilityTextClass = facility.isStruck
                              ? 'break-words text-zinc-400 line-through decoration-zinc-400'
                              : 'break-words text-zinc-700';
                            return (
                              <li
                                key={`${facility.reservationId}-${detail.slotId}-${index}`}
                                className="flex items-start"
                              >
                                <button
                                  type="button"
                                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                                    event.stopPropagation();
                                    void handleToggleFacilityStrike(detail.slotId, facility);
                                  }}
                                  className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-400"
                                  />
                                  <span className={facilityTextClass}>
                                    {`${facility.gymName}${participantLabel}`}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

