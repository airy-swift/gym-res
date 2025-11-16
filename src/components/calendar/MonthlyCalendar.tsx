'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';

import { useReservationParticipants } from '@/components/providers/ReservationParticipantsProvider';
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
  deleteReservationDay,
  type ReservationDayRecord,
  type ReservationSlotEntry,
  type ReservationSlotId,
  type ReservationSlots,
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
const SCHOOL_SEARCH_BASE_URL =
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

const SCHOOL_SEARCH_DEFAULT_PARAMS: Array<[string, string]> = [
  ['u[0]', '76'],
  ['f[0]', '011002_0202'],
  ['f[1]', '011002_0214'],
  ['f[2]', '011002_0217'],
  ['f[3]', '011002_0285'],
  ['f[4]', '011002_0292'],
  ['f[5]', '011002_0302'],
  ['f[6]', '011002_0305'],
  ['f[7]', '011002_0330'],
  ['f[8]', '011002_0337'],
  ['f[9]', '011002_0338'],
  ['f[10]', '011002_0340'],
  ['f[11]', '011002_0341'],
  ['f[12]', '011002_0342'],
  ['f[13]', '011002_0344'],
  ['f[14]', '011002_0361'],
  ['f[15]', '011002_0366'],
  ['f[16]', '011002_0371'],
  ['f[17]', '011002_0391'],
  ['f[18]', '011002_0230'],
  ['f[19]', '011002_0242'],
  ['f[20]', '011002_0231'],
];

const SLOT_PT_PARAM_MAP: Record<
  ReservationSlotId,
  { key: string; value: string }
> = {
  morning: { key: 'pt[0]', value: '0' }, 
  afternoon: { key: 'pt[0]', value: '1' },
  night: { key: 'pt[0]', value: '2' },
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

const formatTimeValue = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [hourRaw, minuteRaw] = trimmed.split(':');
  if (!hourRaw) {
    return trimmed;
  }

  const hourNumber = Number(hourRaw);
  const normalizedHour = Number.isFinite(hourNumber) ? String(hourNumber) : hourRaw;

  if (typeof minuteRaw === 'undefined' || minuteRaw.length === 0) {
    return normalizedHour;
  }

  return `${normalizedHour}:${minuteRaw}`;
};

const formatTimeRange = (
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string | null => {
  const start = formatTimeValue(startTime);
  const end = formatTimeValue(endTime);
  if (!start || !end) {
    return null;
  }
  return `${start}〜${end}`;
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn('Navigator clipboard write failed, falling back to textarea copy.', error);
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return;
    } catch (error) {
      console.error('Fallback textarea copy failed.', error);
    }
  }

  throw new Error('クリップボードへのコピーに失敗しました。');
};

type SlotFacilityDetail = {
  reservationId: string;
  gymName: string;
  entries: ReservationSlotEntry[];
  participantNames: string[];
  totalEntries: number;
  isStruck: boolean;
  startTime: string | null;
  endTime: string | null;
};

type SlotDetail = {
  slotId: ReservationSlotId;
  facilities: SlotFacilityDetail[];
  totalEntries: number;
};

type MonthlyCalendarProps = {
  onRequestScreenshotUpload?: () => void;
  onRegisterReservationExport?: (handler: (() => Promise<string>) | null) => void;
};

const buildSlotDetails = (reservations: ReservationDayRecord[]): SlotDetail[] => {
  return SLOT_ORDER.map((slotId) => {
    const facilities: SlotFacilityDetail[] = [];

    reservations.forEach((reservation) => {
      const entries = reservation.slots?.[slotId] ?? [];
      if (!entries || entries.length === 0) {
        return;
      }

      const normalizedEntries = entries.map((entry) => ({
        ...entry,
        strike: entry.strike ?? false,
        startTime:
          typeof entry.startTime === 'string' && entry.startTime.length > 0
            ? entry.startTime
            : null,
        endTime:
          typeof entry.endTime === 'string' && entry.endTime.length > 0
            ? entry.endTime
            : null,
      }));

      const primaryEntry = normalizedEntries.find(
        (entry) => entry.startTime || entry.endTime,
      );

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
        startTime: primaryEntry?.startTime ?? null,
        endTime: primaryEntry?.endTime ?? null,
      });
    });

    facilities.sort((a, b) => Number(a.isStruck) - Number(b.isStruck));

    const totalEntries = facilities.reduce((sum, facility) => {
      if (facility.isStruck) {
        return sum;
      }
      return sum + facility.totalEntries;
    }, 0);

    return {
      slotId,
      facilities,
      totalEntries,
    };
  });
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

const filterReservationEntriesByParticipant = (
  entries: ReservationSlotEntry[] | undefined,
  participantName: string,
): ReservationSlotEntry[] =>
  (entries ?? []).filter(
    (entry) => (entry.name?.trim() ?? '') === participantName,
  );

const filterReservationsByParticipant = (
  reservations: ReservationDayRecord[],
  participantName: string,
): ReservationDayRecord[] =>
  reservations
    .map((reservation) => {
      const filteredSlots = SLOT_ORDER.reduce((acc, slotId) => {
        acc[slotId] = filterReservationEntriesByParticipant(
          reservation.slots?.[slotId],
          participantName,
        );
        return acc;
      }, {} as ReservationSlots);

      const hasEntries = SLOT_ORDER.some((slotId) => filteredSlots[slotId]?.length);
      if (!hasEntries) {
        return null;
      }

      return {
        ...reservation,
        slots: filteredSlots,
      };
    })
    .filter((reservation): reservation is ReservationDayRecord => reservation !== null);

export const MonthlyCalendar = ({
  onRequestScreenshotUpload,
  onRegisterReservationExport,
}: MonthlyCalendarProps) => {
  const { participantName } = useReservationParticipants();
  const normalizedParticipantName = useMemo(() => participantName.trim(), [participantName]);
  const canFilterByParticipant = normalizedParticipantName.length > 0;
  const [showOwnReservationsOnly, setShowOwnReservationsOnly] = useState(false);
  const today = useMemo(() => getTodayInJst(), []);
  const [displayMonth, setDisplayMonth] = useState<SimpleDate>(() => ({
    ...getNextMonth(today),
    day: 1,
  }));
  const [reservations, setReservations] = useState<ReservationMap>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

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

    const connect = async () => {
      if (isMounted) {
        setIsLoading(true);
      }
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

const displayCalendarDays = useMemo(() => {
  if (!canFilterByParticipant || !showOwnReservationsOnly) {
    return calendarDays;
  }

    return calendarDays.map((day) => ({
      ...day,
      reservations: filterReservationsByParticipant(
        day.reservations,
        normalizedParticipantName,
      ),
    }));
  }, [calendarDays, canFilterByParticipant, normalizedParticipantName, showOwnReservationsOnly]);

  const selectedDay = useMemo(() => {
    if (!selectedDayKey) {
      return null;
    }
    return displayCalendarDays.find((day) => day.key === selectedDayKey) ?? null;
  }, [displayCalendarDays, selectedDayKey]);

  const isDetailDialogOpen = Boolean(selectedDay);

  const openDetailDialog = useCallback((day: CalendarDay) => {
    setSelectedDayKey(day.key);
  }, []);

  const closeDetailDialog = useCallback(() => {
    setSelectedDayKey(null);
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

  const handleDeleteReservation = useCallback(
    async (facility: SlotFacilityDetail) => {
      if (!selectedDay) {
        return;
      }

      const cautionMessage =
        '予約情報は基本的に消さず、タップで横線を引く運用を推奨しています。本当に削除しますか？';
      if (!window.confirm(cautionMessage)) {
        return;
      }
      if (!window.confirm('重複や実験などの理由で、この予約を完全に削除してもよろしいですか？')) {
        return;
      }

      const targetReservation = selectedDay.reservations.find(
        (reservation) => reservation.id === facility.reservationId,
      );

      if (!targetReservation) {
        return;
      }

      setReservations((prev) => {
        const dayReservations = prev[targetReservation.date];
        if (!dayReservations) {
          return prev;
        }

        const updatedDayReservations = dayReservations.filter(
          (reservation) => reservation.id !== targetReservation.id,
        );

        const next = { ...prev };
        if (updatedDayReservations.length > 0) {
          next[targetReservation.date] = updatedDayReservations;
        } else {
          delete next[targetReservation.date];
        }
        return next;
      });

      setSelectedDayKey((prev) => {
        if (!prev) {
          return prev;
        }
        if (selectedDay && prev === selectedDay.key && selectedDay.reservations.length <= 1) {
          return null;
        }
        return prev;
      });

      try {
        await deleteReservationDay(targetReservation.id);
      } catch (error) {
        console.error('Failed to delete reservation', error);
      }
    },
    [selectedDay],
  );

  const buildReservationSearchUrl = useCallback(
    (
      slotId: ReservationSlotId,
      baseUrl: string,
      defaultParams: Array<[string, string]>,
    ): string | null => {
      if (!selectedDay) {
        return null;
      }

      const url = new URL(baseUrl);
      defaultParams.forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set('ud', toDateKey(selectedDay.date));

      const slotParam = SLOT_PT_PARAM_MAP[slotId];
      if (slotParam) {
        url.searchParams.set(slotParam.key, slotParam.value);
      }

      return url.toString();
    },
    [selectedDay],
  );

  const buildFacilitySearchUrl = useCallback(
    (slotId: ReservationSlotId): string | null =>
      buildReservationSearchUrl(
        slotId,
        FACILITY_SEARCH_BASE_URL,
        FACILITY_SEARCH_DEFAULT_PARAMS,
      ),
    [buildReservationSearchUrl],
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

  const buildSchoolSearchUrl = useCallback(
    (slotId: ReservationSlotId): string | null =>
      buildReservationSearchUrl(
        slotId,
        SCHOOL_SEARCH_BASE_URL,
        SCHOOL_SEARCH_DEFAULT_PARAMS,
      ),
    [buildReservationSearchUrl],
  );

  const openSchoolSearchPage = useCallback(
    (slotId: ReservationSlotId) => {
      const url = buildSchoolSearchUrl(slotId);
      if (!url) {
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [buildSchoolSearchUrl],
  );

  const handleToggleFacilityStrike = useCallback(
    async (slotId: ReservationSlotId, facility: SlotFacilityDetail) => {
      if (!selectedDay) {
        return;
      }

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
  const monthPrefix = `${displayMonth.year}-${String(displayMonth.month).padStart(2, '0')}`;
  const effectiveShowOwnReservationsOnly = canFilterByParticipant && showOwnReservationsOnly;

  const copyCurrentMonthReservations = useCallback(async () => {
    const records = Object.values(reservations)
      .flat()
      .filter((reservation) => reservation.date.startsWith(monthPrefix))
      .sort((a, b) => a.date.localeCompare(b.date));

    const lines: string[] = [];

    records.forEach((reservation) => {
      const gymName = sanitizeGymName(reservation.gymName);
      const [yearStr, monthStr, dayStr] = reservation.date.split('-');
      const simpleDate: SimpleDate | null = yearStr && monthStr && dayStr
        ? {
            year: Number(yearStr),
            month: Number(monthStr),
            day: Number(dayStr),
          }
        : null;
      if (!simpleDate || !simpleDate.year || !simpleDate.month || !simpleDate.day) {
        return;
      }
      const weekdayLabel = WEEKDAYS[getDayOfWeek(simpleDate)] ?? '';

      SLOT_ORDER.forEach((slotId) => {
        const slotEntries = reservation.slots?.[slotId] ?? [];
        const activeEntries = slotEntries.filter((entry) => !entry.strike);
        if (activeEntries.length === 0) {
          return;
        }

        activeEntries.forEach((entry) => {
          const monthNumeric = Number(monthStr);
          const dayNumeric = Number(dayStr);
          if (!monthNumeric || !dayNumeric) {
            return;
          }

          const timeSegment = formatTimeRange(entry.startTime, entry.endTime);
          const line = timeSegment
            ? `　${monthNumeric}月${dayNumeric}日（${weekdayLabel}）${timeSegment}\n　　@${gymName}`
            : `　${monthNumeric}月${dayNumeric}日（${weekdayLabel}）\n　　@${gymName}`;
          lines.push(line);
        });
      });
    });

    const exportText = lines.length > 0 ? lines.join('\n') : '対象データなし';

    await copyTextToClipboard(exportText);

    return exportText;
  }, [monthPrefix, reservations]);

  useEffect(() => {
    if (!onRegisterReservationExport) {
      return;
    }
    onRegisterReservationExport(copyCurrentMonthReservations);
    return () => {
      onRegisterReservationExport(null);
    };
  }, [copyCurrentMonthReservations, onRegisterReservationExport]);

  const filterButtonClassName = [
    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
    effectiveShowOwnReservationsOnly
      ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm'
      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900',
    !canFilterByParticipant ? 'cursor-not-allowed opacity-60 hover:border-zinc-200 hover:text-zinc-600' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const filterButtonTitle = canFilterByParticipant
    ? '自分の予約のみを表示'
    : '予約者名を設定すると利用できます';
  const filterStateLabelClassName = effectiveShowOwnReservationsOnly
    ? 'text-xs font-semibold uppercase tracking-wide text-emerald-700'
    : 'text-xs font-semibold uppercase tracking-wide text-zinc-400';

  return (
    <div className="flex flex-col gap-4 sm:px-0">
      <div className="flex flex-col gap-6 border border-zinc-200 bg-white p-0 shadow-sm sm:rounded-2xl sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-black sm:text-3xl sm:text-zinc-900">
              {monthLabel}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                canFilterByParticipant
                  ? setShowOwnReservationsOnly((prev) => !prev)
                  : undefined
              }
              disabled={!canFilterByParticipant}
              aria-pressed={effectiveShowOwnReservationsOnly}
              title={filterButtonTitle}
              className={filterButtonClassName}
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
                  d="M3 4.5h18M5.25 9.75h13.5M8.25 15h7.5M10.5 19.5h3"
                />
              </svg>
              <div className="flex items-center gap-2">
                <span>自分の予約のみ</span>
                <span className={filterStateLabelClassName}>
                  {effectiveShowOwnReservationsOnly ? 'ON' : 'OFF'}
                </span>
              </div>
            </button>
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

        <div className="overflow-hidden border border-zinc-200 sm:rounded-xl">
          <div className="grid grid-cols-7 bg-zinc-50 text-center text-xs font-semibold uppercase tracking-wide text-zinc-600 sm:text-sm">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="p-2 sm:p-3">
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-zinc-100">
            {displayCalendarDays.map((day) => {
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
              const totalActiveEntries = slotDetails.reduce(
                (sum, detail) => sum + detail.totalEntries,
                0,
              );
              const totalStruckFacilities = slotDetails.reduce((sum, detail) => {
                const struckCount = detail.facilities.filter(
                  (facility) => facility.isStruck,
                ).length;
                return sum + struckCount;
              }, 0);
              const hasActiveFacilities = slotDetails.some((detail) =>
                detail.facilities.some((facility) => !facility.isStruck),
              );
              const hasDisplayEntries = hasActiveFacilities || totalStruckFacilities > 0;

              const backgroundClass = getReservationBackgroundClass(totalActiveEntries);

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

                  {hasDisplayEntries ? (
                    <div className="flex grow flex-col gap-1 text-[10px] leading-tight text-zinc-600 sm:text-[11px]">
                      <ul className="flex flex-col gap-1 text-[9px] text-zinc-500 sm:text-[10px]">
                        {(() => {
                          const items: ReactElement[] = [];

                          slotDetails.forEach((detail) => {
                            const activeFacilities = detail.facilities.filter(
                              (facility) => !facility.isStruck,
                            );

                            activeFacilities.forEach((facility, facilityIndex) => {
                              const facilityLabel =
                                facility.gymName && facility.gymName.length > 0
                                  ? facility.gymName
                                  : '施設名未設定';
                              const participantsLabel =
                                facility.participantNames.length > 0
                                  ? `（${facility.participantNames.join('、')}）`
                                  : '';

                              items.push(
                                <li
                                  key={`${day.key}-${detail.slotId}-${facility.reservationId}-${facilityIndex}`}
                                  className="text-zinc-600"
                                >
                                  <span className="rounded bg-zinc-100 px-1 text-[9px] font-medium text-zinc-500 sm:text-[10px]">
                                    {SLOT_LABELS[detail.slotId]}
                                  </span>
                                  <span
                                    className="mt-1 block text-[10px] font-medium text-zinc-600 sm:mt-0 sm:inline sm:pl-1.5 sm:whitespace-nowrap line-clamp-1"
                                    aria-label={`${facilityLabel}${participantsLabel}`}
                                    title={`${facilityLabel}${participantsLabel}`}
                                  >
                                    {facilityLabel}
                                  </span>
                                </li>,
                              );
                            });
                          });

                          if (totalStruckFacilities > 0) {
                            items.push(
                              <li
                                key={`${day.key}-struck-summary`}
                                className="text-zinc-400"
                              >
                                <span className="mt-1 block text-[10px] font-medium sm:mt-0 sm:inline">
                                  {`${totalStruckFacilities}件省略`}
                                </span>
                              </li>,
                            );
                          }

                          return items;
                        })()}
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

      {selectedDay ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 px-4 py-6 sm:px-3 sm:py-6 sm:flex sm:items-center sm:justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDetailDialog();
            }
          }}
        >
          <div className="relative mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[calc(100vh-3rem)] sm:max-h-[90vh]">
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
                className="inline-flex items-center justify-center rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
                aria-label="ダイアログを閉じる"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-4 w-4 sm:hidden"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
                </svg>
                <span className="hidden sm:inline">閉じる</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="flex flex-col gap-4">
                {selectedSlotDetails.map((detail) => {
                  const hasEntries = detail.facilities.length > 0;
                  const slotBackground = getReservationBackgroundClass(detail.totalEntries);

                  return (
                    <div
                      key={`${selectedDay.key}-${detail.slotId}`}
                      className={`rounded-xl border border-zinc-200 px-4 py-3 transition hover:ring-2 hover:ring-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${slotBackground}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-700">
                            {SLOT_LABELS[detail.slotId]}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-800"
                              onClick={() => openFacilitySearchPage(detail.slotId)}
                            >
                              <span aria-hidden="true" className="text-base">🏟</span>
                              体育館
                              <span aria-hidden="true" className="text-xs text-blue-500">
                                ↗
                              </span>
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-800"
                              onClick={() => openSchoolSearchPage(detail.slotId)}
                            >
                              <span aria-hidden="true" className="text-base">🏫</span>
                              学校
                              <span aria-hidden="true" className="text-xs text-blue-500">
                                ↗
                              </span>
                            </button>
                          </div>
                        </div>
                        <span className="text-xs font-medium text-zinc-500">
                          {hasEntries ? `${detail.facilities.length}件` : '予約なし'}
                        </span>
                      </div>
                      {hasEntries ? (
                        <ul className="mt-3 space-y-1 text-xs text-zinc-700 sm:text-sm">
                          {detail.facilities.map((facility, index) => {
                            const participantLabel =
                              facility.participantNames.length > 0
                                ? `（${facility.participantNames.join('、')}）`
                                : '（予約者名未設定）';
                            const timeRangeLabel =
                              facility.startTime && facility.endTime
                                ? `${facility.startTime}~${facility.endTime}`
                                : facility.startTime
                                ? `${facility.startTime}~`
                                : facility.endTime
                                ? `~${facility.endTime}`
                                : null;
                            const facilityTextClass = facility.isStruck
                              ? 'break-words text-zinc-400 line-through decoration-zinc-400'
                              : 'break-words text-zinc-700';
                            const canDeleteReservation =
                              normalizedParticipantName.length > 0 &&
                              facility.participantNames.some(
                                (name) => name.trim() === normalizedParticipantName,
                              );
                            return (
                              <li
                                key={`${facility.reservationId}-${detail.slotId}-${index}`}
                                className="flex items-start gap-2"
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
                                    {timeRangeLabel ? ` ${timeRangeLabel}` : ''}
                                  </span>
                                </button>
                                {canDeleteReservation ? (
                                  <button
                                    type="button"
                                    aria-label="予約を削除"
                                    className="mt-1 rounded-full p-1 text-zinc-400 transition hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteReservation(facility);
                                    }}
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
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l6 6M15 9l-6 6" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 7V5h4v2" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7l1 12h10l1-12" />
                                    </svg>
                                  </button>
                                ) : null}
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
