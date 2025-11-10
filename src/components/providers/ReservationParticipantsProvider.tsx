'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'reservation-participants';

type ReservationParticipantsContextValue = {
  participants: string[];
  participantName: string;
  isReady: boolean;
  openEditor: () => void;
};

const ReservationParticipantsContext =
  createContext<ReservationParticipantsContextValue | null>(null);

type ReservationParticipantsProviderProps = {
  children: ReactNode;
};

type EditorState = {
  isOpen: boolean;
  draft: string;
};

const normalizeName = (value: string): string => value.trim();

export const ReservationParticipantsProvider = ({
  children,
}: ReservationParticipantsProviderProps) => {
  const [participantName, setParticipantName] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>({ isOpen: false, draft: '' });

  const persistParticipant = useCallback((name: string) => {
    setParticipantName(name);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(name));
    } catch (error) {
      console.error('Failed to persist participant name', error);
    }
  }, []);

  const openEditor = useCallback(() => {
    setEditorState({
      isOpen: true,
      draft: participantName,
    });
  }, [participantName]);

  const closeEditor = useCallback(() => {
    if (normalizeName(participantName).length === 0) {
      return;
    }
    setEditorState({ isOpen: false, draft: '' });
  }, [participantName]);

  const handleSubmit = useCallback(() => {
    const normalized = normalizeName(editorState.draft);
    if (normalized.length === 0) {
      return;
    }
    persistParticipant(normalized);
    setEditorState({ isOpen: false, draft: '' });
  }, [editorState.draft, persistParticipant]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string;
        if (typeof parsed === 'string') {
          setParticipantName(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load participant name from storage', error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (normalizeName(participantName).length === 0) {
      setEditorState((prev) => ({
        ...prev,
        isOpen: true,
        draft: prev.draft.length > 0 ? prev.draft : '',
      }));
    }
  }, [isLoaded, participantName]);

  const normalizedParticipantName = useMemo(
    () => normalizeName(participantName),
    [participantName],
  );

  const participantsArray = useMemo(
    () => (normalizedParticipantName.length > 0 ? [normalizedParticipantName] : []),
    [normalizedParticipantName],
  );

  const canDismissEditor = normalizedParticipantName.length > 0;

  const contextValue = useMemo<ReservationParticipantsContextValue>(
    () => ({
      participants: participantsArray,
      participantName,
      isReady: participantsArray.length > 0,
      openEditor,
    }),
    [openEditor, participantName, participantsArray],
  );

  return (
    <ReservationParticipantsContext.Provider value={contextValue}>
      {children}

      {editorState.isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 px-0 py-0 sm:px-3 sm:py-6 sm:flex sm:items-center sm:justify-center"
        >
          <div className="mx-auto flex min-h-[100vh] w-full max-w-lg flex-col bg-white p-4 shadow-2xl sm:min-h-0 sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900">表示名の設定</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  予約の申請に使用するあなたの名前を入力してください。後から編集できます。
                </p>
              </div>
              {canDismissEditor ? (
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
                >
                  閉じる
                </button>
              ) : null}
            </div>

            <div className="mt-4">
              <input
                type="text"
                value={editorState.draft}
                onChange={(event) =>
                  setEditorState((prev) => ({ ...prev, draft: event.target.value }))
                }
                placeholder="山田太郎"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {normalizeName(editorState.draft).length === 0 ? (
              <p className="mt-2 text-xs text-red-500">名前を入力してください。</p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              {canDismissEditor ? (
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-800"
                >
                  キャンセル
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={normalizeName(editorState.draft).length === 0}
                className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ReservationParticipantsContext.Provider>
  );
};

export const useReservationParticipants = () => {
  const context = useContext(ReservationParticipantsContext);
  if (!context) {
    throw new Error(
      'useReservationParticipants must be used within a ReservationParticipantsProvider',
    );
  }
  return context;
};

