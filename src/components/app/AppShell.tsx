'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const AppContent = () => {
  const [openScreenshotUpload, setOpenScreenshotUpload] = useState<(() => void) | null>(null);
  const [copyReservationsHandler, setCopyReservationsHandler] = useState<
    (() => Promise<string | void>) | null
  >(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [lastCopiedText, setLastCopiedText] = useState<string>('');
  const copyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRegisterOpenDialog = useCallback((handler: (() => void) | null) => {
    setOpenScreenshotUpload(() => handler ?? null);
  }, []);

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current) {
        clearTimeout(copyStatusTimerRef.current);
      }
    };
  }, []);

  const handleCopyReservations = useCallback(async () => {
    if (typeof copyReservationsHandler !== 'function') {
      return;
    }

    try {
      const result = await copyReservationsHandler();
      if (typeof result === 'string') {
        setLastCopiedText(result);
      } else {
        setLastCopiedText('');
      }
      setCopyStatus('copied');
    } catch (error) {
      console.error('Failed to copy reservations', error);
      setCopyStatus('error');
      setLastCopiedText('');
    } finally {
      if (copyStatusTimerRef.current) {
        clearTimeout(copyStatusTimerRef.current);
      }
      copyStatusTimerRef.current = setTimeout(() => {
        setCopyStatus('idle');
        copyStatusTimerRef.current = null;
      }, 2000);
    }
  }, [copyReservationsHandler]);

  const handleRegisterReservationExport = useCallback(
    (handler: (() => Promise<void>) | null) => {
      setCopyReservationsHandler(() => handler);
    },
    [],
  );

  return (
    <div className="min-h-screen bg-zinc-50 py-0 sm:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-0 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              体育館予約共有カレンダー
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyReservations}
                disabled={!copyReservationsHandler}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-200 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
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
                    d="M8 7h8a2 2 0 012 2v9a2 2 0 01-2 2H8a2 2 0 01-2-2V9a2 2 0 012-2z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 7V5a2 2 0 00-2-2H10a2 2 0 00-2 2v2"
                  />
                </svg>
                <span>予約情報をコピー</span>
              </button>
            </div>
          </div>
          <EditParticipantsButton />
        </header>

        <ScreenshotUpload onRegisterOpenDialog={handleRegisterOpenDialog} />
        <MonthlyCalendar
          onRequestScreenshotUpload={openScreenshotUpload ?? undefined}
          onRegisterReservationExport={handleRegisterReservationExport}
        />
      </div>

      {copyStatus !== 'idle' ? (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div
            className={`max-w-full rounded-2xl px-4 py-3 text-sm shadow-lg sm:px-5 sm:py-3 ${copyStatus === 'copied' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}
          >
            <div className="flex items-start gap-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="mt-1 h-4 w-4 flex-shrink-0"
                aria-hidden="true"
              >
                {copyStatus === 'copied' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                )}
              </svg>
              <div className="flex min-w-0 flex-col gap-2">
                <span className="font-semibold">
                  {copyStatus === 'copied'
                    ? 'この月の予約をコピーしました'
                    : '予約情報のコピーに失敗しました'}
                </span>
                {copyStatus === 'copied' && lastCopiedText ? (
                  <span className="whitespace-pre-wrap break-words text-xs text-white/90">
                    {lastCopiedText}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const AppShell = () => (
  <ReservationParticipantsProvider>
    <AppContent />
  </ReservationParticipantsProvider>
);
