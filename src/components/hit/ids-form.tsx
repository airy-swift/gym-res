"use client";

import { type FormEvent, useState } from "react";

type HitIdsFormProps = {
  groupId: string;
  initialValue: string;
};

export function HitIdsForm({ groupId, initialValue }: HitIdsFormProps) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/groups/hit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ groupId, ids: value }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({ error: "保存に失敗しました" }))) as { error?: string };
        setStatus("error");
        setMessage(data.error ?? "保存に失敗しました");
        return;
      }

      setStatus("success");
      setMessage("保存しました");
    } catch (error) {
      console.error("Failed to save ids", error);
      setStatus("error");
      setMessage("保存に失敗しました。時間を置いて再実行してください。");
    }
  }

  async function handleTestRun() {
    setTestStatus("running");
    setTestMessage(null);

    try {
      const response = await fetch("/api/hit/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ groupId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({ error: "テスト実行に失敗しました" }))) as { error?: string };
        setTestStatus("error");
        setTestMessage(data.error ?? "テスト実行に失敗しました");
        return;
      }

      setTestStatus("success");
      setTestMessage("テスト実行を開始しました。GitHub Actions の Hit Runner を確認してください。");
    } catch (error) {
      console.error("Failed to trigger hit test", error);
      setTestStatus("error");
      setTestMessage("テスト実行に失敗しました。時間を置いて再実行してください。");
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <textarea
          id="hit-ids"
          name="hit-ids"
          className="min-h-[260px] w-full rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm text-stone-900 outline-none transition focus:border-sky-500"
          placeholder={"1行目からいきなりid,passwordの形式で入力してください。下記の感じ↓\n00112233,password123\n44556677,password456"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={status === "saving"}
        />
      </div>

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full rounded-2xl border border-sky-900/10 bg-sky-700 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "saving" ? "保存中..." : "保存"}
      </button>

      {message ? (
        <p className={`text-center text-sm ${status === "error" ? "text-red-600" : "text-stone-700"}`}>{message}</p>
      ) : null}

      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
        <p className="text-xs text-stone-600">
          任意のタイミングで抽選状況確認をテスト実行できます（このサークルのみ対象）。
        </p>
        <button
          type="button"
          disabled={status === "saving" || testStatus === "running"}
          onClick={handleTestRun}
          className="mt-3 w-full rounded-2xl border border-stone-900/10 bg-stone-800 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {testStatus === "running" ? "テスト実行中..." : "Hit テスト実行"}
        </button>
        {testMessage ? (
          <p className={`mt-2 text-center text-sm ${testStatus === "error" ? "text-red-600" : "text-stone-700"}`}>
            {testMessage}
          </p>
        ) : null}
      </div>
    </form>
  );
}
