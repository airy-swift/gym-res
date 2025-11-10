'use client';

import { useMemo } from 'react';

import { MonthlyCalendar } from '@/components/calendar/MonthlyCalendar';
import { ScreenshotUpload } from '@/components/upload/ScreenshotUpload';
import {
  ReservationParticipantsProvider,
  useReservationParticipants,
} from '@/components/providers/ReservationParticipantsProvider';

const EditParticipantsButton = () => {
  const { participants, openEditor } = useReservationParticipants();

  const participantSummary = useMemo(() => {
    if (participants.length === 0) {
      return '予約者名未設定';
    }
    if (participants.length <= 2) {
      return participants.join('、');
    }
    return `${participants.slice(0, 2).join('、')}、ほか${participants.length - 2}名`;
  }, [participants]);

  return (
    <button
      type="button"
      onClick={openEditor}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 shadow-sm transition hover:border-zinc-300 hover:text-zinc-800"
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
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125L17.25 4.875" />
      </svg>
      <span>{participantSummary}</span>
    </button>
  );
};

const AppContent = () => (
  <div className="min-h-screen bg-zinc-50 py-8 sm:py-12">
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            体育館予約共有カレンダー
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 sm:text-base">
            体育館の抽選応募状況をチームで共有します。デフォルトで次月を表示し、日本時間（JST）で日程を管理します。
          </p>
        </div>
        <EditParticipantsButton />
      </header>

      <ScreenshotUpload />
      <MonthlyCalendar />
    </div>
  </div>
);

export const AppShell = () => (
  <ReservationParticipantsProvider>
    <AppContent />
  </ReservationParticipantsProvider>
);

