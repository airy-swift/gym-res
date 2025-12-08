"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase";

const GITHUB_OWNER =
  process.env.NEXT_PUBLIC_GITHUB_OWNER ??
  process.env.NEXT_PUBLIC_GITHUB_REPOSITORY?.split("/")?.[0] ??
  null;
const GITHUB_REPO =
  process.env.NEXT_PUBLIC_GITHUB_REPO ??
  process.env.NEXT_PUBLIC_GITHUB_REPOSITORY?.split("/")?.[1] ??
  null;

type StartJobFormProps = {
  entryOptions: number[];
  groupId: string;
  className?: string;
};

export function StartJobForm({ entryOptions, groupId, className }: StartJobFormProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<{ status: string; message: string | null } | null>(null);
  const [jobHtmlUrl, setJobHtmlUrl] = useState<string | null>(null);
  const [jobDebugImageUrl, setJobDebugImageUrl] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const workflowLinkTimeoutRef = useRef<number | null>(null);

  const firestore = useMemo(() => getFirestoreDb(), []);

  const formClassName = useMemo(() => {
    return ["space-y-6", className].filter(Boolean).join(" ").trim();
  }, [className]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.confirm("抽選に応募しますがよろしいですか？")) {
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    setIsError(false);
    setJobHtmlUrl(null);
    setJobDebugImageUrl(null);
    if (workflowLinkTimeoutRef.current !== null) {
      window.clearTimeout(workflowLinkTimeoutRef.current);
      workflowLinkTimeoutRef.current = null;
    }

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: loginId,
          password,
          entryCount: 1,
          groupId,
        }),
      });

      if (!response.ok) {
        const rawBody = await response.text();
        let errorMessage = "応募に失敗しました";
        try {
          const data = JSON.parse(rawBody) as { error?: string };
          errorMessage = (data.error ?? rawBody) || errorMessage;
        } catch {
          if (rawBody) {
            errorMessage = rawBody;
          }
        }

        setIsError(true);
        setFeedback(errorMessage);
        return;
      }

      const data = (await response
        .json()
        .catch(() => null)) as { jobId?: string } | null;

      if (!data?.jobId) {
        throw new Error("Missing jobId from server response");
      }

      setJobId(data.jobId);
      setJobDebugImageUrl(buildDebugImageUrl(data.jobId));
      setJobStatus("pending");
      setJobResult(null);
      setPassword("");

      workflowLinkTimeoutRef.current = window.setTimeout(async () => {
        try {
      const workflowResponse = await fetch("/api/internal/workflow");

          if (workflowResponse.ok) {
            const workflowData = (await workflowResponse
              .json()
              .catch(() => null)) as { actions_url?: string | null; job_url?: string | null } | null;

            if (workflowData?.job_url || workflowData?.actions_url) {
              setJobHtmlUrl(workflowData.job_url || workflowData.actions_url || null);
            }
          }
        } catch (error) {
          console.error("Failed to fetch latest workflow URL", error);
        }
      }, 1200);
    } catch (error) {
      console.error("Failed to start job", error);
      setIsError(true);
      setFeedback("応募に失敗しました。しばらくしてから再度お試しください");
    } finally {
      setSubmitting(false);
    }
  }

  function readCookie(name: string) {
    if (typeof document === "undefined") {
      return null;
    }

    const cookies = document.cookie.split(";").map((cookie) => cookie.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith(`${name}=`)) {
        return decodeURIComponent(cookie.slice(name.length + 1));
      }
    }
    return null;
  }

  function writeCookie(name: string, value: string) {
    if (typeof document === "undefined") {
      return;
    }

    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 30};SameSite=Lax`;
  }

  useEffect(() => {
    const savedLoginId = readCookie("startJobLoginId");
    const savedPassword = readCookie("startJobPassword");

    if (savedLoginId) {
      setLoginId(savedLoginId);
    }

    if (savedPassword) {
      setPassword(savedPassword);
    }

    setIsInitialized(true);
  }, [entryOptions]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    writeCookie("startJobLoginId", loginId);
  }, [isInitialized, loginId]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    writeCookie("startJobPassword", password);
  }, [isInitialized, password]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    // Keep legacy cookie cleanup for compatibility.
    writeCookie("startJobEntryCount", "1");
  }, [isInitialized]);

  useEffect(() => {
    if (!jobId) {
      setJobStatus(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(firestore, "jobs", jobId),
      (snapshot) => {
        if (!snapshot.exists()) {
          return;
        }

        const data = snapshot.data() as { status?: string; message?: string | null } | undefined;
        const status = data?.status ?? null;
        const message = data?.message ?? null;

        setJobStatus(status);

        if (status && status !== "pending") {
          setJobResult({ status, message });
          setJobId(null);
          if (workflowLinkTimeoutRef.current !== null) {
            window.clearTimeout(workflowLinkTimeoutRef.current);
            workflowLinkTimeoutRef.current = null;
          }
        }
      },
      (error) => {
        console.error("Failed to listen job status", error);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [firestore, jobId]);

  useEffect(() => {
    return () => {
      if (workflowLinkTimeoutRef.current !== null) {
        window.clearTimeout(workflowLinkTimeoutRef.current);
      }
    };
  }, []);

  const isJobPending = jobStatus === "pending";
  const shouldShowForm = !jobResult;

  return (
    <>
      {shouldShowForm ? (
        <form className={formClassName} onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="loginId" className="text-sm font-medium text-stone-600">
              ID
            </label>
            <input
              id="loginId"
              name="loginId"
              type="text"
              placeholder="8桁くらいの数字"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-500 focus:bg-white"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-stone-600">
              パスワード
            </label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="********"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-500 focus:bg-white"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl border border-sky-900/10 bg-sky-700 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "送信中..." : "実行"}
          </button>

          {feedback ? (
            <p className={`text-center text-sm ${isError ? "text-red-600" : "text-stone-700"}`}>
              {feedback}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="space-y-4 rounded-3xl border border-stone-200 bg-white/80 p-8 text-center shadow-sm">
          {jobResult?.status === "completed" ? (
            <>
              <p className="text-lg font-semibold text-stone-900">抽選応募完了！</p>
              <p className="text-base text-stone-600">{jobResult.message ?? "特に言うことないです"}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-red-600">応募が失敗しました (failed)</p>
              <p className="text-base text-stone-600">{jobResult?.message ?? "何らかのエラーが発生しました。"}</p>
              {jobDebugImageUrl ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-stone-500">デバッグスクリーンショット</p>
                  <div className="overflow-hidden rounded-2xl border border-stone-200">
                    <img
                      src={jobDebugImageUrl}
                      alt="Playwright debug screenshot"
                      className="h-auto w-full"
                      loading="lazy"
                    />
                  </div>
                </div>
              ) : null}
            </>
          )}

          {jobHtmlUrl && (
            <p className="text-xs">
              <a
                href={jobHtmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 underline"
              >
                GitHub Actions の進行状況はこちら
              </a>
            </p>
          )}
        </div>
      )}

      {isJobPending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur">
          <div className="w-full max-w-xs rounded-[32px] border border-white/40 bg-white/90 px-8 py-10 text-center text-stone-900 shadow-2xl">
            <span className="mx-auto mb-4 block h-12 w-12 animate-spin rounded-full border-4 border-stone-200 border-t-sky-600" />
            <p className="text-sm font-semibold">応募中...</p>
            <p className="mt-2 text-xs text-stone-700">
              ページ閉じても実行されるけど応募完了/エラーは分かんなくなるよ！札幌予約管理システムからの応募完了メールに期待して！
            </p>
            <div className="mt-4 text-xs font-semibold">
              {jobHtmlUrl ? (
                <a
                  href={jobHtmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-700 underline"
                >
                  進行状況
                </a>
              ) : (
                <span className="text-stone-400">進行状況 (取得中...)</span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function buildDebugImageUrl(jobId: string | null): string | null {
  if (!jobId || !GITHUB_OWNER || !GITHUB_REPO) {
    return null;
  }

  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${jobId}/playwright/debug.png`;
}
