"use client";

import { type FormEvent, useState } from "react";

type GroupUrlsFormProps = {
  groupId: string;
  initialValue: string;
};

export function GroupUrlsForm({ groupId, initialValue }: GroupUrlsFormProps) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);

    const urls = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    try {
      const response = await fetch("/api/groups/urls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ groupId, urls }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "保存に失敗しました" }));
        setStatus("error");
        setMessage(data.error ?? "保存に失敗しました");
        return;
      }

      setStatus("success");
      setMessage("保存しました");
    } catch (error) {
      console.error("Failed to save urls", error);
      setStatus("error");
      setMessage("保存に失敗しました。時間を置いて再実行してください。");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="group-urls" className="block text-sm font-medium text-stone-600">
          抽選応募URLリスト
        </label>
        <textarea
          id="group-urls"
          name="group-urls"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-2 min-h-[320px] w-full rounded-3xl border border-stone-200 bg-white/90 p-5 text-sm text-stone-900 shadow-inner outline-none transition focus:border-sky-500"
          placeholder="https://example.com/1\nhttps://example.com/2"
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
        <p className={`text-center text-sm ${status === "error" ? "text-red-600" : "text-stone-700"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
