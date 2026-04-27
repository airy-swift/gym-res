"use client";

import { useMemo, useState } from "react";

export type HitResultRowItem = {
  key: string;
  date: string;
  time: string;
  gymName: string;
  room: string;
  accountName: string;
  accountId: string;
};

type HitResultsListProps = {
  rows: HitResultRowItem[];
};

export function HitResultsList({ rows }: HitResultsListProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const LOGIN_URL = "https://yoyaku.harp.lg.jp/sapporo/Login";

  const rowMap = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.key,
          `${row.date || "-"} ${row.time || "-"} ${row.gymName || "-"} ${row.room || "-"} ${row.accountName || "-"}`,
        ]),
      ),
    [rows],
  );

  const copyRow = async (key: string) => {
    const text = rowMap.get(key);
    if (!text) {
      return;
    }

    await copyText(text);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1200);
  };

  const openLoginWithCopiedAccountId = async (accountId: string) => {
    const normalizedAccountId = accountId.trim();
    if (normalizedAccountId) {
      await copyText(normalizedAccountId);
    }
    window.location.href = LOGIN_URL;
  };

  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">表示できる抽選結果はありません。</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 transition hover:border-sky-400 hover:bg-sky-50">
            <button
              type="button"
              onClick={() => {
                void copyRow(row.key);
              }}
              className="min-w-0 flex-1 px-1 py-1 text-left"
            >
              <p className="text-xs font-mono text-stone-800">
                {row.date || "-"} / {row.time || "-"} / {row.gymName || "-"} / {row.room || "-"} / {row.accountName || "-"}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`text-[11px] font-semibold ${
                  copiedKey === row.key ? "text-green-700" : "text-stone-500"
                }`}
              >
                {copiedKey === row.key ? "コピー済み" : "クリックでコピー"}
              </span>
              <button
                type="button"
                onClick={() => {
                  void openLoginWithCopiedAccountId(row.accountId || "");
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 transition hover:border-sky-500 hover:text-sky-700"
                aria-label="ログインページを開く"
                title="リンク: クリックでログイン画面へ移動します。移動前にこの行のアカウントIDをコピーします。"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                  <path d="M10.59 13.41a1 1 0 0 1 0-1.41l3-3a3 3 0 1 1 4.24 4.24l-1.83 1.83a3 3 0 0 1-4.24 0 1 1 0 1 1 1.41-1.41 1 1 0 0 0 1.42 0l1.83-1.83a1 1 0 1 0-1.42-1.42l-3 3a1 1 0 0 1-1.41 0Zm2.82-2.82a1 1 0 0 1 0 1.41l-3 3a3 3 0 1 1-4.24-4.24l1.83-1.83a3 3 0 0 1 4.24 0 1 1 0 0 1-1.41 1.41 1 1 0 0 0-1.42 0l-1.83 1.83a1 1 0 1 0 1.42 1.42l3-3a1 1 0 0 1 1.41 0Z" />
                </svg>
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}
