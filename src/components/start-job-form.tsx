"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, onSnapshot, type Timestamp } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase";

type StartJobFormProps = {
  entryOptions: number[];
  groupId: string;
  className?: string;
  defaultEntryCount?: number;
  representativeEntryCount?: number;
};

const JOB_CACHE_KEY = "startJobPendingJob";
// Set to a job id to force showing its result for design/debug work.
const DEBUG_RESULT_JOB_ID = "";

type JobDocumentData = {
  status?: string;
  message?: string | null;
  progress?: string | null;
  createdAt?: Timestamp | null;
};

type CachedJobState = {
  firestoreJobId: string;
  githubJobId?: string | null;
  jobHtmlUrl?: string | null;
  cachedAt: number;
};

type DebugImageState = "idle" | "loading" | "unavailable";

export function StartJobForm({
  entryOptions,
  groupId,
  className,
  defaultEntryCount,
  representativeEntryCount,
}: StartJobFormProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [entryCount, setEntryCount] = useState(() => resolveDefaultEntryCount(entryOptions, defaultEntryCount));
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<{ status: string; message: string | null } | null>(null);
  const [jobHtmlUrl, setJobHtmlUrl] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<string | null>(null);
  const [jobDebugImageUrl, setJobDebugImageUrl] = useState<string | null>(null);
  const [debugImageState, setDebugImageState] = useState<DebugImageState>("idle");
  const [isInitialized, setIsInitialized] = useState(false);
  const workflowLinkTimeoutRef = useRef<number | null>(null);
  const latestJobIdRef = useRef<string | null>(null);
  const jobSnapshotUnsubscribeRef = useRef<null | (() => void)>(null);

  const firestore = useMemo(() => getFirestoreDb(), []);

  const formClassName = useMemo(() => {
    return ["space-y-6", className].filter(Boolean).join(" ").trim();
  }, [className]);

  const normalizedRepresentativeCount = useMemo(() => {
    if (typeof representativeEntryCount !== "number" || Number.isNaN(representativeEntryCount)) {
      return 0;
    }
    return Math.max(0, representativeEntryCount);
  }, [representativeEntryCount]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.confirm("抽選に応募しますがよろしいですか？")) {
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    setIsError(false);
    setJobHtmlUrl(null);
    setJobProgress('準備してます');
    setJobDebugImageUrl(null);
    setDebugImageState("idle");
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
          entryCount,
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
      latestJobIdRef.current = data.jobId;
      setJobDebugImageUrl(null);
      setJobStatus("pending");
      setJobResult(null);
      setPassword("");

      upsertCachedJobState({ firestoreJobId: data.jobId });

      scheduleWorkflowLinkFetch();
    } catch (error) {
      console.error("Failed to start job", error);
      setIsError(true);
      setFeedback("応募に失敗しました。しばらくしてから再度お試しください");
    } finally {
      setSubmitting(false);
    }
  }

  function scheduleWorkflowLinkFetch(delayMs = 1800) {
    if (workflowLinkTimeoutRef.current !== null) {
      window.clearTimeout(workflowLinkTimeoutRef.current);
      workflowLinkTimeoutRef.current = null;
    }

    workflowLinkTimeoutRef.current = window.setTimeout(async () => {
      try {
        const workflowResponse = await fetch("/api/internal/workflow");

        if (workflowResponse.ok) {
          const workflowData = (await workflowResponse
            .json()
            .catch(() => null)) as { actions_url?: string | null; job_url?: string | null } | null;

          const nextUrl = workflowData?.job_url || workflowData?.actions_url || null;

          if (nextUrl) {
            setJobHtmlUrl(nextUrl);
            const activeJobId = latestJobIdRef.current;

            if (activeJobId) {
              upsertCachedJobState({
                firestoreJobId: activeJobId,
                jobHtmlUrl: nextUrl,
                githubJobId: extractGitHubJobId(workflowData?.job_url || workflowData?.actions_url || null),
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch latest workflow URL", error);
      }
    }, delayMs);
  }

  function cancelActiveJob() {
    if (!window.confirm("応募の監視を中断してトップに戻りますか？")) {
      return;
    }

    if (jobSnapshotUnsubscribeRef.current) {
      jobSnapshotUnsubscribeRef.current();
      jobSnapshotUnsubscribeRef.current = null;
    }

    if (workflowLinkTimeoutRef.current !== null) {
      window.clearTimeout(workflowLinkTimeoutRef.current);
      workflowLinkTimeoutRef.current = null;
    }

    clearCachedJobState();
    latestJobIdRef.current = null;
    setJobId(null);
    setJobStatus(null);
    setJobResult(null);
    setJobProgress(null);
    setJobHtmlUrl(null);
    setJobDebugImageUrl(null);
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
    writeCookie("startJobEntryCount", String(entryCount));
  }, [isInitialized, entryCount]);

  useEffect(() => {
    if (!jobId) {
      jobSnapshotUnsubscribeRef.current = null;
      setJobStatus(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(firestore, "jobs", jobId),
      (snapshot) => {
        if (!snapshot.exists()) {
          clearCachedJobState();
          setJobStatus(null);
          setJobId(null);
          return;
        }

        const data = snapshot.data() as JobDocumentData | undefined;
        const status = data?.status ?? null;
        const message = data?.message ?? null;
        const progress = typeof data?.progress === "string" ? data?.progress : null;

        setJobStatus(status);
        setJobProgress(progress ?? null);

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

    jobSnapshotUnsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      if (jobSnapshotUnsubscribeRef.current === unsubscribe) {
        jobSnapshotUnsubscribeRef.current = null;
      }
    };
  }, [firestore, jobId]);

  useEffect(() => {
    return () => {
      if (workflowLinkTimeoutRef.current !== null) {
        window.clearTimeout(workflowLinkTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!jobResult) {
      return;
    }

    clearCachedJobState();
  }, [jobResult]);

  useEffect(() => {
    if (!jobId || jobStatus !== "pending") {
      return;
    }

    upsertCachedJobState({ firestoreJobId: jobId });
  }, [jobId, jobStatus]);

  useEffect(() => {
    if (!jobId || jobStatus !== "pending" || !jobHtmlUrl) {
      return;
    }

    upsertCachedJobState({
      firestoreJobId: jobId,
      jobHtmlUrl,
      githubJobId: extractGitHubJobId(jobHtmlUrl),
    });
  }, [jobId, jobHtmlUrl, jobStatus]);

  useEffect(() => {
    let isCancelled = false;

    async function resumeJobFromCache() {
      const cachedJob = readCachedJobState();

      if (!cachedJob?.firestoreJobId) {
        return;
      }

      try {
        const snapshot = await getDoc(doc(firestore, "jobs", cachedJob.firestoreJobId));

        if (!snapshot.exists()) {
          clearCachedJobState();
          return;
        }

        const data = snapshot.data() as JobDocumentData | undefined;
        const status = data?.status ?? null;
        const progress = typeof data?.progress === "string" ? data?.progress : null;
        const message = typeof data?.message === "string" ? data?.message : null;

        if (!status) {
          clearCachedJobState();
          return;
        }

        if (isCancelled) {
          return;
        }

        latestJobIdRef.current = cachedJob.firestoreJobId;
        setJobProgress(progress ?? null);

        if (status === "pending") {
          setJobId(cachedJob.firestoreJobId);
          setJobStatus("pending");
          setJobResult(null);

          if (cachedJob.jobHtmlUrl) {
            setJobHtmlUrl(cachedJob.jobHtmlUrl);
          } else {
            scheduleWorkflowLinkFetch(0);
          }
        } else {
          setJobId(null);
          setJobStatus(status);
          setJobResult({ status, message });
          setJobHtmlUrl(cachedJob.jobHtmlUrl ?? null);
        }
      } catch (error) {
        console.error("Failed to resume job listener", error);
        clearCachedJobState();
      }
    }

    void resumeJobFromCache();

    return () => {
      isCancelled = true;
    };
  }, [firestore]);

  useEffect(() => {
    if (!DEBUG_RESULT_JOB_ID) {
      return;
    }

    let isCancelled = false;

    async function loadDebugResultJob() {
      try {
        const snapshot = await getDoc(doc(firestore, "jobs", DEBUG_RESULT_JOB_ID));

        if (!snapshot.exists()) {
          console.warn(
            `[StartJobForm] DEBUG_RESULT_JOB_ID=${DEBUG_RESULT_JOB_ID} not found or inaccessible`,
          );
          return;
        }

        const data = snapshot.data() as JobDocumentData | undefined;
        const status = data?.status ?? null;
        const message = data?.message ?? null;
        const progress = typeof data?.progress === "string" ? data?.progress : null;

        if (!status || status === "pending") {
          console.warn(`[StartJobForm] DEBUG_RESULT_JOB_ID=${DEBUG_RESULT_JOB_ID} has no final status`);
          return;
        }

        if (isCancelled) {
          return;
        }

        clearCachedJobState();
        latestJobIdRef.current = DEBUG_RESULT_JOB_ID;
        setJobId(null);
        setJobStatus(status);
        setJobResult({ status, message });
        setJobProgress(progress ?? null);
        setJobHtmlUrl(null);
      } catch (error) {
        console.error("Failed to load debug job result", error);
      }
    }

    void loadDebugResultJob();

    return () => {
      isCancelled = true;
    };
  }, [firestore]);

  useEffect(() => {
    if (jobResult?.status !== "failed") {
      setDebugImageState("idle");
      return;
    }

    const jobIdForDebug = latestJobIdRef.current;

    if (!jobIdForDebug || typeof window === "undefined") {
      setDebugImageState("unavailable");
      return;
    }

    setDebugImageState("loading");
    setJobDebugImageUrl(null);

    let isCancelled = false;
    let attemptCount = 0;
    const maxAttempts = 6;

    const loadDebugImage = () => {
      if (isCancelled) {
        return;
      }

      const nextUrl = buildDebugImageUrl(jobIdForDebug);

      if (!nextUrl) {
        setDebugImageState("unavailable");
        return;
      }

      const image = new window.Image();

      image.onload = () => {
        if (isCancelled) {
          return;
        }

        setJobDebugImageUrl(nextUrl);
        setDebugImageState("idle");
      };

      image.onerror = () => {
        if (isCancelled) {
          return;
        }

        attemptCount += 1;

        if (attemptCount < maxAttempts) {
          window.setTimeout(loadDebugImage, 2000);
        } else {
          setDebugImageState("unavailable");
        }
      };

      image.src = nextUrl;
    };

    loadDebugImage();

    return () => {
      isCancelled = true;
    };
  }, [jobResult]);

  const isJobPending = jobStatus === "pending";
  const shouldShowForm = !jobResult;
  const formattedJobResultMessage = jobResult?.message
    ? jobResult.message.replace(/<br\s*\/?\>/gi, "\n")
    : null;

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
              placeholder="札幌公共施設予約システムのログインID"
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

          <div className="space-y-2">
            <label htmlFor="entryCount" className="text-sm font-medium text-stone-600">
              抽選応募個数
              {normalizedRepresentativeCount > 0 ? (
                <span className="ml-2 text-sm font-normal text-stone-500">
                  (代表が{normalizedRepresentativeCount}件指定しています)
                </span>
              ) : null}
            </label>
            <select
              id="entryCount"
              name="entryCount"
              value={entryCount}
              onChange={(event) => setEntryCount(Number(event.target.value))}
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-500 focus:bg-white"
            >
              {[...entryOptions].sort((a, b) => b - a).map((num) => (
                <option key={num} value={num}>
                  {formatEntryOptionLabel(num, normalizedRepresentativeCount)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl border border-sky-900/10 bg-sky-700 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "送信中..." : "実行"}
          </button>
          <p className="text-xs text-stone-700">
            2分 + 1件あたり30秒程かかります。
          </p>

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
                  <p className="text-base text-stone-600 whitespace-pre-line">
                    {formattedJobResultMessage ?? "特に言うことないです"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-red-600">応募が失敗しました (failed)</p>
                  <p className="text-base text-stone-600 whitespace-pre-line">
                    {formattedJobResultMessage ?? "何らかのエラーが発生しました。"}
                  </p>
                  {jobDebugImageUrl ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs text-stone-500">デバッグスクリーンショット</p>
                      <div className="overflow-hidden rounded-2xl border border-stone-200">
                        <Image
                          src={jobDebugImageUrl}
                          alt="Playwright debug screenshot"
                          className="h-auto w-full"
                          width={720}
                          height={405}
                          sizes="100vw"
                          priority={false}
                        />
                      </div>
                    </div>
                  ) : debugImageState === "loading" ? (
                    <p className="mt-4 text-xs text-stone-500">デバッグスクリーンショットを取得しています...</p>
                  ) : debugImageState === "unavailable" ? (
                    <p className="mt-4 text-xs text-stone-500">デバッグスクリーンショットを取得できませんでした。</p>
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
            <p className="text-lg">
              <a
                href={'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20'}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 underline"
              >
                申し込み状況 (→札幌公共施設予約管理システム)
              </a>
            </p>
        </div>
      )}

      {isJobPending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur">
          <div className="relative w-full max-w-xs rounded-[32px] border border-white/40 bg-white/90 px-8 py-10 text-center text-stone-900 shadow-2xl">
            <button
              type="button"
              onClick={cancelActiveJob}
              aria-label="応募の監視を中断"
              className="absolute left-4 top-4 text-red-600 transition hover:text-red-700"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
              >
                <path
                  d="M9 3h6m-8 4h10l-.8 12.4c-.06.9-.8 1.6-1.7 1.6H9.5c-.9 0-1.64-.7-1.7-1.6L7 7Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M10 11v6m4-6v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <span className="mx-auto mb-4 block h-12 w-12 animate-spin rounded-full border-4 border-stone-200 border-t-sky-600" />
            <p className="text-sm font-semibold">
              応募中...
              {jobProgress ? (
                <span className="ml-1 text-xs text-stone-500">({jobProgress})</span>
              ) : null}
            </p>
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
  if (!jobId) {
    return null;
  }

  const cacheBust = Date.now();
  return `https://raw.githubusercontent.com/airy-swift/gym-res/${jobId}/playwright/debug.png?ts=${cacheBust}`;
}

function formatEntryOptionLabel(value: number, representativeCount: number): string {
  if (representativeCount <= 0) {
    return String(value);
  }

  if (value === representativeCount) {
    return `${value}（これ以下は代表の指定に従います）`;
  }

  if (value === representativeCount + 1) {
    return `${value}（これ以上は追加で応募が少ない抽選を探索します / +10分くらい）`;
  }

  return String(value);
}

function resolveDefaultEntryCount(entryOptions: number[], fallback?: number): number {
  const sanitizedOptions = entryOptions.length > 0 ? entryOptions : [1];
  const base = sanitizedOptions[0] ?? 1;

  if (typeof fallback !== "number" || Number.isNaN(fallback)) {
    return base;
  }

  if (entryOptions.includes(fallback)) {
    return fallback;
  }

  const minOption = Math.min(...sanitizedOptions);
  const maxOption = Math.max(...sanitizedOptions);
  const clamped = Math.min(Math.max(fallback, minOption), maxOption);

  if (entryOptions.includes(clamped)) {
    return clamped;
  }

  return base;
}

function readCachedJobState(): CachedJobState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(JOB_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedJobState;

    if (!parsed || typeof parsed.firestoreJobId !== "string") {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error("Failed to parse cached job state", error);
    return null;
  }
}

function upsertCachedJobState(updates: Partial<CachedJobState> & { firestoreJobId?: string }) {
  if (typeof window === "undefined") {
    return;
  }

  const existing = readCachedJobState();
  const baseJobId = updates.firestoreJobId ?? existing?.firestoreJobId;

  if (!baseJobId) {
    return;
  }

  const nextState: CachedJobState = {
    firestoreJobId: baseJobId,
    githubJobId: updates.githubJobId ?? existing?.githubJobId ?? null,
    jobHtmlUrl: updates.jobHtmlUrl ?? existing?.jobHtmlUrl ?? null,
    cachedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(JOB_CACHE_KEY, JSON.stringify(nextState));
  } catch (error) {
    console.error("Failed to write cached job state", error);
  }
}

function clearCachedJobState() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(JOB_CACHE_KEY);
  } catch (error) {
    console.error("Failed to clear cached job state", error);
  }
}

function extractGitHubJobId(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const jobMatch = url.match(/\/job\/(\d+)/);

  if (jobMatch?.[1]) {
    return jobMatch[1];
  }

  const runMatch = url.match(/\/runs\/(\d+)/);

  return runMatch?.[1] ?? null;
}
