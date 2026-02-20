"use client";

import { useMemo, useState } from "react";

export type HitResultRowItem = {
  key: string;
  date: string;
  time: string;
  gymName: string;
  room: string;
};

type HitResultsListProps = {
  rows: HitResultRowItem[];
};

export function HitResultsList({ rows }: HitResultsListProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const rowMap = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.key,
          `${row.date || "-"}\t${row.time || "-"}\t${row.gymName || "-"}\t${row.room || "-"}`,
        ]),
      ),
    [rows],
  );

  const copyRow = async (key: string) => {
    const text = rowMap.get(key);
    if (!text) {
      return;
    }

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

    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1200);
  };

  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">表示できる抽選結果はありません。</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            onClick={() => {
              void copyRow(row.key);
            }}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-left transition hover:border-sky-400 hover:bg-sky-50"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-mono text-stone-800">
                {row.date || "-"} / {row.time || "-"} / {row.gymName || "-"} / {row.room || "-"}
              </p>
              <span
                className={`text-[11px] font-semibold ${
                  copiedKey === row.key ? "text-green-700" : "text-stone-500"
                }`}
              >
                {copiedKey === row.key ? "コピー済み" : "クリックでコピー"}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
