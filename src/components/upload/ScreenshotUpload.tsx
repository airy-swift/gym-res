'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useReservationParticipants } from '@/components/providers/ReservationParticipantsProvider';
import {
  createReservationDay,
  type ReservationSlotId,
  type ReservationSlots,
} from '@/lib/firebase';
import {
  analyzeReservationImage,
  type GeminiReservationAnalysisResult,
} from '@/lib/gemini/client';

type AnalysisStatus = 'idle' | 'uploading' | 'analyzing' | 'saving';

type ReviewReservationEntry = {
  id: string;
  slot: ReservationSlotId;
  names: string[];
};

type ReviewReservation = {
  id: string;
  date: string;
  gymName: string;
  entries: ReviewReservationEntry[];
};

type ReviewState = {
  reservations: ReviewReservation[];
  confirmed: boolean;
};

const SLOT_LABELS: Record<ReservationSlotId, string> = {
  morning: '午前',
  afternoon: '午後',
  night: '夜',
};

const SLOT_ORDER: ReservationSlotId[] = ['morning', 'afternoon', 'night'];

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64 = result.split(',')[1];
        if (!base64) {
          reject(new Error('画像データを読み込めませんでした。'));
        } else {
          resolve(base64);
        }
      } else {
        reject(new Error('画像データの解析に失敗しました。'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const initialReviewState = (): ReviewState => ({
  reservations: [],
  confirmed: false,
});

const createReservationId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createReservationEntryId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const convertAnalysesToReview = (
  analyses: GeminiReservationAnalysisResult,
): ReviewState => {
  const reservations: ReviewReservation[] = analyses.map((analysis) => {
    const entries: ReviewReservationEntry[] = [];

    SLOT_ORDER.forEach((slot) => {
      if ((analysis.slots[slot] ?? []).length > 0) {
        entries.push({
          id: createReservationEntryId(),
          slot,
          names: analysis.slots[slot] ?? [],
        });
      }
    });

    if (entries.length === 0) {
      entries.push({
        id: createReservationEntryId(),
        slot: 'morning',
        names: [],
      });
    }

    return {
      id: createReservationId(),
      date: analysis.date ?? '',
      gymName: analysis.gymName ?? '',
      entries,
    };
  });

  return {
    reservations,
    confirmed: false,
  };
};

const validateImageFile = (file: File | undefined): File => {
  if (!file) {
    throw new Error('画像ファイルが見つかりません。');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('画像ファイルのみアップロード可能です。');
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error('画像ファイルサイズが大きすぎます (最大 15MB)。');
  }

  return file;
};

type ScreenshotUploadProps = {
  onRegisterOpenDialog?: (open: (() => void) | null) => void;
};

export const ScreenshotUpload = ({ onRegisterOpenDialog }: ScreenshotUploadProps) => {
  const { participants, participantName, isReady: areParticipantsReady, openEditor } =
    useReservationParticipants();
  const [isDragging, setIsDragging] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>(() => initialReviewState());

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetState = useCallback(() => {
    setReviewState(initialReviewState());
    setError(null);
    setStatus('idle');
    setIsDialogOpen(false);
  }, []);

  const handleDragEnter = useCallback(
    (event: DragEvent) => {
      if (!areParticipantsReady) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const hasFiles = Array.from(event.dataTransfer?.items ?? []).some(
        (item) => item.kind === 'file',
      );
      if (hasFiles) {
        setDragDepth((prev) => prev + 1);
        setIsDragging(true);
      }
    },
    [areParticipantsReady],
  );

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((prev) => {
      const next = Math.max(prev - 1, 0);
      if (next === 0) {
        setIsDragging(false);
      }
      return next;
    });
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!areParticipantsReady) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = 'copy';
  }, [areParticipantsReady]);

  const processFile = useCallback(async (file: File) => {
    if (!areParticipantsReady) {
      setError('予約者名を設定してから解析を実行してください。');
      return;
    }
    setError(null);
    setStatus('uploading');

    try {
      const base64 = await readFileAsBase64(file);
      setStatus('analyzing');
      const analyses = await analyzeReservationImage({
        base64Data: base64,
        mimeType: file.type,
        participants,
      });
      const review = convertAnalysesToReview(analyses);
      if (review.reservations.length === 0) {
        throw new Error('解析結果が空でした。画像を確認してください。');
      }
      setReviewState(review);
      setIsDialogOpen(true);
      setStatus('idle');
    } catch (err) {
      console.error(err);
      setStatus('idle');
      setIsDialogOpen(false);
      setError((err as Error).message);
    }
  }, [areParticipantsReady, participants]);

  const openFilePicker = useCallback(() => {
    if (!areParticipantsReady) {
      setError('予約者名を設定してから画像をアップロードしてください。');
      openEditor();
      return;
    }
    fileInputRef.current?.click();
  }, [areParticipantsReady, openEditor]);

  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      try {
        const validated = validateImageFile(file);
        await processFile(validated);
      } catch (err) {
        setError((err as Error).message);
        setStatus('idle');
      }
    },
    [processFile],
  );

  useEffect(() => {
    if (!onRegisterOpenDialog) {
      return;
    }
    onRegisterOpenDialog(openFilePicker);
    return () => {
      onRegisterOpenDialog(null);
    };
  }, [onRegisterOpenDialog, openFilePicker]);

  const handleDrop = useCallback(
    async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragDepth(0);
      setIsDragging(false);

      if (!event.dataTransfer?.files?.length) {
        return;
      }

      if (!areParticipantsReady) {
        setError('予約者名を設定してから画像をアップロードしてください。');
        return;
      }

      try {
        const file = validateImageFile(event.dataTransfer.files[0]);
        await processFile(file);
      } catch (err) {
        setError((err as Error).message);
        setStatus('idle');
      }
    },
    [areParticipantsReady, processFile],
  );

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  const updateReservation = useCallback(
    (reservationId: string, updater: (prev: ReviewReservation) => ReviewReservation) => {
      setReviewState((prev) => ({
        ...prev,
        reservations: prev.reservations.map((reservation) =>
          reservation.id === reservationId ? updater(reservation) : reservation,
        ),
      }));
    },
    [],
  );

  const updateReservationEntrySlot = useCallback(
    (reservationId: string, entryId: string, slot: ReservationSlotId) => {
      updateReservation(reservationId, (prevReservation) => ({
        ...prevReservation,
        entries: prevReservation.entries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                slot,
              }
            : entry,
        ),
      }));
    },
    [updateReservation],
  );

  const buildReservationSlots = useCallback(
    (reservation: ReviewReservation): ReservationSlots => {
      const base: ReservationSlots = {
        morning: [],
        afternoon: [],
        night: [],
      };

      reservation.entries.forEach((entry) => {
        const hasAiNames = entry.names.length > 0;
        const targetNames = hasAiNames ? entry.names : participants;
        const sanitizedNames = targetNames
          .map((rawName) => rawName.trim())
          .filter((name) => name.length > 0);

        base[entry.slot] = sanitizedNames.map((name) => ({
          name,
          source: hasAiNames ? 'ai' : 'manual',
          strike: false,
        }));
      });

      return base;
    },
    [participants],
  );

  const handleConfirm = useCallback(async () => {
    if (status === 'saving') {
      return;
    }

    setStatus('saving');

    try {
      await Promise.all(
        reviewState.reservations.map(async (reservation) => {
          const trimmedDate = reservation.date.trim();
          if (trimmedDate.length === 0) {
            throw new Error('予約日が未入力の項目があります。');
          }

          const trimmedGymName = reservation.gymName.trim();
          const slots = buildReservationSlots(reservation);

          await createReservationDay({
            date: trimmedDate,
            gymName: trimmedGymName,
            slots,
            confirmed: true,
            lastUpdatedBy:
              participantName && participantName.trim().length > 0
                ? participantName.trim()
                : null,
            updatedAt: new Date().toISOString(),
          });
        }),
      );

      resetState();
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? `予約データの保存に失敗しました: ${err.message}`
          : '予約データの保存に失敗しました。',
      );
      setStatus('idle');
    }
  }, [buildReservationSlots, participantName, resetState, reviewState, status]);

  const isConfirmEnabled = useMemo(() => {
    if (!reviewState.confirmed || reviewState.reservations.length === 0) {
      return false;
    }

    return reviewState.reservations.every((reservation) => {
      if (!reservation.date || reservation.date.trim().length === 0) {
        return false;
      }

      if (reservation.entries.length === 0) {
        return false;
      }

      return true;
    });
  }, [reviewState]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInputChange}
        className="hidden"
      />
      {!areParticipantsReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:text-base">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>予約者名を設定すると解析を開始できます。</p>
            <button
              type="button"
              onClick={openEditor}
              className="inline-flex items-center justify-center rounded-full border border-amber-300 px-4 py-1.5 text-sm font-medium text-amber-700 transition hover:border-amber-400 hover:text-amber-900"
            >
              予約者名を設定する
            </button>
          </div>
        </div>
      ) : null}

      {isDragging && areParticipantsReady ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-blue-600/10 backdrop-blur-sm">
          <div className="rounded-2xl border border-blue-500 bg-white/90 px-6 py-5 text-center text-blue-600 shadow-lg">
            <p className="text-base font-semibold">スクリーンショットをここにドロップ</p>
            <p className="mt-1 text-sm text-blue-500">
              体育館予約画面の画像をアップロードして解析します
            </p>
          </div>
        </div>
      ) : null}

      {status !== 'idle' ? (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-zinc-900/80 px-6 py-6 text-center text-white shadow-2xl">
            <div className="relative flex h-12 w-12 items-center justify-center">
              <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">
                {status === 'uploading'
                  ? '画像を読み込み中…'
                  : status === 'analyzing'
                  ? 'Geminiで解析中…'
                  : 'Firebaseに保存中…'}
              </p>
              <p className="text-xs text-white/70">完了するまで画面を閉じずにお待ちください。</p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {isDialogOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/30 px-0 py-0 sm:px-3 sm:py-6 sm:flex sm:items-center sm:justify-center"
        >
          <div className="relative mx-auto flex min-h-[100vh] w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:min-h-0 sm:rounded-2xl sm:max-h-[90vh]">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900">解析結果の確認</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  日付・施設名・時間帯を確認してから確定してください。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsDialogOpen(false);
                  resetState();
                }}
                className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
                aria-label="ダイアログを閉じる"
              >
                閉じる
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="flex flex-col gap-4">
                {reviewState.reservations.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    解析結果が取得できませんでした。別の画像でお試しください。
                  </div>
                ) : (
                  reviewState.reservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 shadow-sm"
                    >
                      <div className="space-y-2">
                        {reservation.entries.map((entry, entryIndex) => (
                          <div
                            key={entry.id}
                            className="flex flex-wrap items-center gap-3 rounded-lg border border-white bg-white/80 px-4 py-3 shadow-inner sm:flex-nowrap"
                          >
                            <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                              <span className={entryIndex > 0 ? 'sr-only' : ''}>予約日</span>
                              <input
                                type="date"
                                value={reservation.date}
                                onChange={(event) =>
                                  updateReservation(reservation.id, (prevReservation) => ({
                                    ...prevReservation,
                                    date: event.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </label>

                            <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                              <span className={entryIndex > 0 ? 'sr-only' : ''}>施設名</span>
                              <input
                                type="text"
                                value={reservation.gymName}
                                onChange={(event) =>
                                  updateReservation(reservation.id, (prevReservation) => ({
                                    ...prevReservation,
                                    gymName: event.target.value,
                                  }))
                                }
                                placeholder="例）北区体育館"
                                className="w-full max-w-[220px] rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </label>

                            <label className="flex flex-1 min-w-[120px] flex-col gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                              <span>時間帯</span>
                              <select
                                value={entry.slot}
                                onChange={(event) =>
                                  updateReservationEntrySlot(
                                    reservation.id,
                                    entry.id,
                                    event.target.value as ReservationSlotId,
                                  )
                                }
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              >
                                {SLOT_ORDER.map((slot) => (
                                  <option key={slot} value={slot}>
                                    {SLOT_LABELS[slot]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={reviewState.confirmed}
                    onChange={(event) =>
                      setReviewState((prev) => ({
                        ...prev,
                        confirmed: event.target.checked,
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>入力内容を確認しました。登録対象の時間帯をチェック済みです。</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setIsDialogOpen(false);
                  resetState();
                }}
                className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isConfirmEnabled}
                className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                確認して登録へ進む
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

