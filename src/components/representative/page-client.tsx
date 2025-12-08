"use client";

import { useCallback, useState } from "react";
import type { DragEvent } from "react";
import { doc, updateDoc } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase";

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL = process.env.NEXT_PUBLIC_GEMINI_MODEL ?? "gemini-2.5-flash";

export type RepresentativeEntry = {
  gymName: string;
  room: string;
  date: string;
  time: string;
};

type Props = {
  groupId: string;
  groupName?: string | null;
  initialEntries?: RepresentativeEntry[];
};

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function RepresentativePageClient({ groupId, groupName, initialEntries = [] }: Props) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [entries, setEntries] = useState<RepresentativeEntry[]>(initialEntries);
  const [infoMessage, setInfoMessage] = useState<string | null>(
    initialEntries.length > 0 ? "Firestore から読み込みました" : null,
  );
  const [editingEntry, setEditingEntry] = useState<RepresentativeEntry | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const file = Array.from(files).find((candidate) => candidate.type.startsWith("image/"));

    if (!file) {
      setStatus("error");
      setError("画像ファイルのみ対応しています。");
      return;
    }

    setStatus("uploading");
    setError(null);

    try {
      if (!GEMINI_API_KEY) {
        throw new Error("NEXT_PUBLIC_GEMINI_API_KEY が設定されていません");
      }

      const base64 = await convertFileToBase64(file);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `画像を読み取り、体育館などの予約情報を抽出してください。施設名は "gymName"、部屋名は "room"で大抵体育館名の後ろに記述されている。日付は "date"(取得できるyyyy年M月D日(W)の形式が望ましい)、時間帯は "time" として扱いおおよそ(x:xx-x:xx)のような時間帯の形式となる想定である。抽選応募の候補が複数あれば配列にまとめてください。必ず JSON 形式で {"entries":[{"gymName":"...","room":"...","date":"yyyy年M月D日(W)","time":"HH:MM-HH:MM"},...]} のように返してください。不要な説明文は書かず、JSON のみを返答してください。`,
                  },
                  {
                    inline_data: {
                      mime_type: file.type || "image/png",
                      data: base64,
                    },
                  },
                ],
              },
            ],
          }),
        },
      );

      const payload = await response.json();

      if (!response.ok) {
        console.error("Gemini API error", payload);
        throw new Error(payload?.error?.message ?? "Gemini API呼び出しに失敗しました");
      }

      const text = extractTextFromGeminiResponse(payload);

      if (!text) {
        throw new Error("GeminiからJSONレスポンスを取得できませんでした。");
      }

      const parsedEntries = parseEntriesFromGeminiText(text);

      if (!parsedEntries || parsedEntries.length === 0) {
        throw new Error("Geminiの応答を解析できませんでした。");
      }

      const mergedEntries = [...entries, ...parsedEntries];

      await saveEntriesToGroup(groupId, mergedEntries);

      setEntries(mergedEntries);
      setInfoMessage("Firestoreに追加しました");
      setStatus("success");
    } catch (uploadError) {
      console.error("画像解析に失敗しました", uploadError);
      setStatus("error");
      setError(
        uploadError instanceof Error ? uploadError.message : "アップロード中にエラーが発生しました。",
      );
    }
  }, [entries, groupId, groupName]);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    const includesFiles = event.dataTransfer?.types?.includes("Files");
    if (!includesFiles) {
      return;
    }

    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer?.files ?? null);
  }, [handleFiles]);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    const includesFiles = event.dataTransfer?.types?.includes("Files");
    if (!includesFiles) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditingEntry(entries[index]);
  }, [entries]);

  const handleDelete = useCallback(async (index: number) => {
    const confirmed = window.confirm("この候補を削除しますか？");
    if (!confirmed) {
      return;
    }

    const updatedEntries = entries.filter((_, entryIndex) => entryIndex !== index);
    await saveEntriesToGroup(groupId, updatedEntries);
    setEntries(updatedEntries);
    setInfoMessage("候補を削除しました");
  }, [entries, groupId]);

  const handleDialogClose = useCallback(() => {
    setEditingEntry(null);
    setEditingIndex(null);
  }, []);

  const handleDialogSave = useCallback(async () => {
    if (editingEntry == null || editingIndex == null) {
      return;
    }

    const updatedEntries = entries.map((entry, index) => (index === editingIndex ? editingEntry : entry));
    await saveEntriesToGroup(groupId, updatedEntries);
    setEntries(updatedEntries);
    setInfoMessage("候補を更新しました");
    handleDialogClose();
  }, [editingEntry, editingIndex, entries, groupId, handleDialogClose]);

  const handleEditingFieldChange = useCallback((field: keyof RepresentativeEntry, value: string) => {
    setEditingEntry((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  return (
    <main
      className="relative min-h-screen bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <section className="mx-auto w-full max-w-3xl space-y-6 rounded-[32px] border border-stone-200/70 bg-white/80 p-10 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Representative</p>
        <h1 className="text-2xl font-semibold text-stone-900">サークル: {groupName ?? groupId}</h1>
        {infoMessage ? <p className="text-xs text-stone-500">{infoMessage}</p> : null}

        <div className="space-y-3 rounded-3xl border border-stone-200 bg-white/70 p-6">
          <p className="text-sm font-semibold text-stone-700">抽選応募先 (メンバーがコレを利用したときこのリストのそれぞれに応募します)</p>

          {entries.length === 0 ? (
            <p className="text-sm text-stone-500">まだ解析結果はありません。画像をドロップして取得してください。</p>
          ) : (
            <ul className="space-y-3 text-sm text-stone-800">
              {entries.map((entry, index) => (
                <li
                  key={`${entry.gymName}-${entry.room}-${entry.date}-${entry.time}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-stone-100 bg-white/80 px-4 py-3 shadow-sm"
                >
                  <div>
                    <p className="font-semibold text-stone-900">{entry.gymName || "施設名不明"} / {entry.room || "ルーム名不明"}</p>
                    <p className="mt-2 text-xs text-stone-600">
                      {entry.date || "日付不明"} / {entry.time || "時間帯不明"}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-stone-200 bg-white/80 p-2 text-stone-600 transition hover:border-stone-400 hover:text-stone-900"
                      onClick={() => handleEdit(index)}
                      aria-label="編集"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-stone-200 bg-white/80 p-2 text-stone-600 transition hover:border-red-300 hover:text-red-600"
                      onClick={() => handleDelete(index)}
                      aria-label="削除"
                    >
                      🗑️
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {status === "error" && (
            <p className="text-xs text-red-600">{error ?? "解析に失敗しました"}</p>
          )}
        </div>
      </section>

      {isDragging ? (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-sky-900/10">
          <div className="rounded-3xl border-2 border-dashed border-sky-600/70 bg-white/80 px-10 py-6 text-center text-sm font-semibold text-sky-900 shadow-lg">
            このページ上に画像をドロップしてください
          </div>
        </div>
      ) : null}

      {status === "uploading" ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/25 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-[32px] border border-white/30 bg-white/90 px-8 py-10 text-center text-sm text-stone-900 shadow-2xl">
            <span className="mx-auto mb-4 block h-12 w-12 animate-spin rounded-full border-4 border-stone-200 border-t-sky-600" />
            <p className="font-semibold">Geminiに送信中...</p>
            <p className="mt-2 text-xs text-stone-500">処理が完了するまで、このページでお待ちください。</p>
          </div>
        </div>
      ) : null}

      {editingEntry != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-[32px] border border-stone-200 bg-white px-8 py-10 text-stone-900 shadow-2xl">
            <h2 className="text-lg font-semibold">応募先の編集</h2>

            <div className="space-y-2 text-sm">
              <label className="block text-xs font-semibold text-stone-600" htmlFor="edit-gymName">
                施設名
              </label>
              <input
                id="edit-gymName"
                className="w-full rounded-xl border border-stone-200 px-4 py-2"
                value={editingEntry.gymName}
                onChange={(event) => handleEditingFieldChange("gymName", event.target.value)}
              />
            </div>

            <div className="space-y-2 text-sm">
              <label className="block text-xs font-semibold text-stone-600" htmlFor="edit-room">
                ルーム
              </label>
              <input
                id="edit-room"
                className="w-full rounded-xl border border-stone-200 px-4 py-2"
                value={editingEntry.room}
                onChange={(event) => handleEditingFieldChange("room", event.target.value)}
              />
            </div>

            <div className="space-y-2 text-sm">
              <label className="block text-xs font-semibold text-stone-600" htmlFor="edit-date">
                日付
              </label>
              <input
                id="edit-date"
                className="w-full rounded-xl border border-stone-200 px-4 py-2"
                value={editingEntry.date}
                onChange={(event) => handleEditingFieldChange("date", event.target.value)}
              />
            </div>

            <div className="space-y-2 text-sm">
              <label className="block text-xs font-semibold text-stone-600" htmlFor="edit-time">
                時間帯
              </label>
              <input
                id="edit-time"
                className="w-full rounded-xl border border-stone-200 px-4 py-2"
                value={editingEntry.time}
                onChange={(event) => handleEditingFieldChange("time", event.target.value)}
              />
            </div>

            <div className="flex justify-end gap-3 text-sm">
              <button
                type="button"
                onClick={handleDialogClose}
                className="rounded-full border border-stone-200 px-4 py-2 text-stone-500 transition hover:border-stone-400 hover:text-stone-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDialogSave}
                className="rounded-full border border-sky-600 bg-sky-600 px-4 py-2 text-white transition hover:bg-sky-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

async function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const base64 = result.split(",").pop() ?? result;
        resolve(base64);
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });
}

function extractTextFromGeminiResponse(payload: any): string | null {
  if (!payload?.candidates || !Array.isArray(payload.candidates)) {
    return null;
  }

  const parts = payload.candidates[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return null;
  }

  return parts
    .map((part: any) => part?.text || "")
    .filter((text: string) => text.length > 0)
    .join("\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseEntriesFromGeminiText(text: string): RepresentativeEntry[] | null {
  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("Failed to parse Gemini JSON", error, cleaned);
    return null;
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).entries)
      ? (parsed as any).entries
      : null;

  if (!entries) {
    return null;
  }

  const toStringOrEmpty = (value: unknown): string => {
    if (typeof value === "string") {
      return value;
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  };

  return entries
    .filter((entry: unknown) => entry && typeof entry === "object")
    .map((entry: any) => ({
      gymName: toStringOrEmpty(entry.gymName ?? entry.gym_name),
      room: toStringOrEmpty(entry.room ?? entry.Room),
      date: toStringOrEmpty(entry.date ?? entry.Date),
      time: toStringOrEmpty(entry.time ?? entry.Time),
    }))
    .filter((entry: RepresentativeEntry) => entry.gymName || entry.room || entry.date || entry.time);
}

async function saveEntriesToGroup(groupId: string, entries: RepresentativeEntry[]) {
  const db = getFirestoreDb();
  await updateDoc(doc(db, "groups", groupId), {
    list: entries,
  });
}
