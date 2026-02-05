"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase";

type BulkConsoleFormProps = {
  groupId: string;
  entryOptions: number[];
  defaultEntryCount: number;
  defaultValue?: string;
  groupLabel?: string;
};

type ParsedEntry = {
  userId: string;
  password: string;
};

type ParseResult = {
  entries: ParsedEntry[];
  error?: string;
};

type BulkJobLocalStatus = "queued" | "dispatching" | "listening" | "error";

type BulkJobItem = {
  entryIndex: number;
  userLabel: string;
  jobId?: string;
  jobStatus?: string | null;
  progress?: string | null;
  message?: string | null;
  localStatus: BulkJobLocalStatus;
  startedAt?: number | null;
  elapsedSeconds?: number;
};

const DEFAULT_PLACEHOLDER = `1行目からいきなりid,passwordの形式で入力してください。下記の感じ↓\n00112233,password123\n44556677,password456`;
const MIN_DELAY_MS = 10_000;
const MAX_DELAY_MS = 30_000;
const MAX_WORKFLOW_FETCH_ATTEMPTS = 6;
const JOB_LISTEN_RETRY_DELAY_MS = 2_000;
const MAX_JOB_LISTEN_ATTEMPTS = 6;
const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "待機中",
  running: "実行中",
  completed: "完了",
  failed: "失敗",
  canceled: "キャンセル済み",
  cancelled: "キャンセル済み",
};
const LOCAL_STATUS_LABELS: Record<BulkJobLocalStatus, string> = {
  queued: "未実行",
  dispatching: "実行準備中",
  listening: "進行状況を監視中",
  error: "エラー",
};
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "canceled", "cancelled", "error", "aborted"]);

export function BulkConsoleForm({
  groupId,
  entryOptions,
  defaultEntryCount,
  defaultValue,
  groupLabel,
}: BulkConsoleFormProps) {
  const firestore = useMemo(() => getFirestoreDb(), []);
  const jobSubscriptionsRef = useRef<Record<string, () => void>>({});

  const [csvText, setCsvText] = useState(defaultValue ?? "");
  const resolvedDefaultEntryCount = useMemo(() => {
    return sanitizeEntryCount(defaultEntryCount, entryOptions);
  }, [defaultEntryCount, entryOptions]);
  const normalizedGroupLabel = useMemo(() => deriveGroupLabel(groupLabel), [groupLabel]);
  const [entryCount, setEntryCount] = useState(resolvedDefaultEntryCount);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [jobItems, setJobItems] = useState<BulkJobItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [workflowUrl, setWorkflowUrl] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const workflowTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setEntryCount(resolvedDefaultEntryCount);
  }, [resolvedDefaultEntryCount]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearWorkflowTimeout = useCallback(() => {
    if (workflowTimeoutRef.current) {
      clearTimeout(workflowTimeoutRef.current);
      workflowTimeoutRef.current = null;
    }
  }, []);
  
  useEffect(() => {
    if (!hasStarted) {
      clearTimer();
      return;
    }

    const hasActiveJob = jobItems.some((item) => item.startedAt && !isTerminalItem(item));

    if (!hasActiveJob) {
      clearTimer();
      return;
    }

    timerRef.current = setInterval(() => {
      setJobItems((previous) =>
        previous.map((item) => {
          if (!item.startedAt || isTerminalItem(item)) {
            return item;
          }

          const elapsedSeconds = Math.max(0, Math.floor((Date.now() - item.startedAt) / 1000));

          if (item.elapsedSeconds === elapsedSeconds) {
            return item;
          }

          return { ...item, elapsedSeconds };
        }),
      );
    }, 1000);

    return () => {
      clearTimer();
    };
  }, [hasStarted, jobItems, clearTimer]);

  const clearSubscriptions = useCallback(() => {
    Object.values(jobSubscriptionsRef.current).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("Failed to cleanup job subscription", error);
      }
    });
    jobSubscriptionsRef.current = {};
  }, []);


  useEffect(
    () => () => {
      clearSubscriptions();
      clearTimer();
      clearWorkflowTimeout();
    },
    [clearSubscriptions, clearTimer, clearWorkflowTimeout],
  );

  const updateJobItem = useCallback((entryIndex: number, updates: Partial<BulkJobItem>) => {
    setJobItems((previous) =>
      previous.map((item, index) => (index === entryIndex ? { ...item, ...updates } : item)),
    );
  }, []);

  const fetchWorkflowLink = useCallback(async () => {
    try {
      const response = await fetch("/api/internal/workflow");

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as {
          job_url?: string | null;
          actions_url?: string | null;
        } | null;

        const url = data?.job_url || data?.actions_url || null;

        if (url) {
          setWorkflowUrl(url);
          return true;
        }
      }
    } catch (error) {
      console.error("Failed to fetch workflow link", error);
    }
    return false;
  }, []);

  const scheduleWorkflowLinkFetch = useCallback(
    (delayMs = 1800, attempt = 0) => {
      if (attempt >= MAX_WORKFLOW_FETCH_ATTEMPTS) {
        return;
      }
      clearWorkflowTimeout();
      workflowTimeoutRef.current = setTimeout(async () => {
        const success = await fetchWorkflowLink();
        workflowTimeoutRef.current = null;
        if (!success) {
          scheduleWorkflowLinkFetch(2000, attempt + 1);
        }
      }, delayMs);
    },
    [clearWorkflowTimeout, fetchWorkflowLink],
  );

  const subscribeToJob = useCallback(
    (jobId: string, entryIndex: number, attempt = 0) => {
      const unsubscribe = onSnapshot(
        doc(firestore, "jobs", jobId),
        (snapshot) => {
          if (!snapshot.exists()) {
            return;
          }

          const data = snapshot.data() as {
            status?: string;
            message?: string | null;
            progress?: string | null;
            createdAt?: { seconds?: number; nanoseconds?: number };
          };
          const createdAtMs = data?.createdAt ? inferTimestampMs(data.createdAt) : null;
          const status = typeof data.status === "string" ? data.status : null;
          updateJobItem(entryIndex, {
            jobStatus: status,
            progress: typeof data.progress === "string" ? data.progress : null,
            message: data.message ?? null,
            localStatus: "listening",
            startedAt: createdAtMs ?? undefined,
            elapsedSeconds:
              createdAtMs != null ? Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000)) : undefined,
          });

          if (status && TERMINAL_JOB_STATUSES.has(status)) {
            unsubscribe();
            delete jobSubscriptionsRef.current[jobId];
          }
        },
        (error) => {
          console.error("Failed to listen to bulk job", error);
          unsubscribe();
          delete jobSubscriptionsRef.current[jobId];

          if (attempt < MAX_JOB_LISTEN_ATTEMPTS) {
            setTimeout(() => {
              subscribeToJob(jobId, entryIndex, attempt + 1);
            }, JOB_LISTEN_RETRY_DELAY_MS);
          } else {
            updateJobItem(entryIndex, {
              localStatus: "error",
              message: "進行状況を取得できませんでした",
            });
          }
        },
      );

      jobSubscriptionsRef.current[jobId] = unsubscribe;
    },
    [firestore, updateJobItem],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);
    clearSubscriptions();
    if (hasStarted) {
      return;
    }
    setJobItems([]);

    const parsed = parseCsv(csvText);

    if (parsed.error) {
      setGlobalError(parsed.error);
      return;
    }

    if (parsed.entries.length === 0) {
      setGlobalError("実行対象のアカウントがありません");
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm("CSVに含まれるアカウントで応募を開始します。よろしいですか？");
      if (!confirmed) {
        return;
      }
    }

    const normalizedEntries = parsed.entries.map((entry, index) => ({
      userId: entry.userId.trim(),
      password: entry.password.trim(),
      label: entry.userId.trim() || `アカウント${index + 1}`,
    }));

    setHasStarted(true);
    setWorkflowUrl(null);
    setJobItems(
      normalizedEntries.map((entry, index) => ({
        entryIndex: index,
        userLabel: entry.label,
        jobStatus: null,
        progress: null,
        message: null,
        localStatus: "queued",
        startedAt: null,
        elapsedSeconds: undefined,
      })),
    );

    setSubmitting(true);

    try {
      for (let index = 0; index < normalizedEntries.length; index += 1) {
        const entry = normalizedEntries[index];
        updateJobItem(index, { localStatus: "dispatching" });

        try {
          const jobId = await triggerJob({
            userId: entry.userId,
            password: entry.password,
            entryCount,
            groupId,
            label: normalizedGroupLabel,
          });

          updateJobItem(index, {
            jobId,
            jobStatus: "pending",
            localStatus: "listening",
            progress: "準備中...",
            startedAt: Date.now(),
            elapsedSeconds: 0,
          });
          subscribeToJob(jobId, index);

          if (!workflowUrl) {
            scheduleWorkflowLinkFetch();
          }
        } catch (jobError) {
          console.error("Failed to trigger bulk job", jobError);
          const message =
            jobError instanceof Error ? jobError.message : "応募のトリガーに失敗しました。再度お試しください";
          updateJobItem(index, {
            localStatus: "error",
            message,
          });
          continue;
        }

        if (index < normalizedEntries.length - 1) {
          const delayMs = randomDelayMs(MIN_DELAY_MS, MAX_DELAY_MS);
          await wait(delayMs);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {!hasStarted ? (
        <>
          <div className="space-y-2">
            <label htmlFor="bulk-csv" className="text-sm font-medium text-stone-700">
              ID / パスワード CSV
            </label>
            <textarea
              id="bulk-csv"
              name="bulk-csv"
              className="min-h-[260px] w-full rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm text-stone-900 outline-none transition focus:border-sky-500"
              placeholder={DEFAULT_PLACEHOLDER}
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="entry-count" className="text-sm font-medium text-stone-700">
              抽選応募個数
            </label>
            <select
              id="entry-count"
              name="entry-count"
              value={entryCount}
              onChange={(event) => setEntryCount(Number(event.target.value))}
              disabled={submitting}
              className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-sky-500"
            >
              {[...entryOptions].sort((a, b) => b - a).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl border border-sky-900/10 bg-sky-700 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "トリガー送信中..." : "一括実行"}
          </button>
        </>
      ) : null}

      {globalError ? <p className="text-center text-sm text-red-600">{globalError}</p> : null}

      {jobItems.length > 0 ? (
        <div className="space-y-2 rounded-3xl border border-stone-200 bg-white/70 p-4">
          <div className="flex items-center justify-between text-[11px] text-stone-500">
            <span className="font-semibold text-stone-700">実行状況</span>
            <span>{jobItems.filter((item) => isTerminalItem(item)).length}/{jobItems.length}</span>
          </div>
          <ul className="space-y-1">
            {jobItems.map((item) => (
              <li
                key={item.jobId ?? `${item.entryIndex}-${item.userLabel}`}
                className="rounded-xl border border-stone-100 px-3 py-2 text-xs text-stone-800"
                style={resolveJobBackgroundStyle(item)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-stone-900">{item.userLabel} {workflowUrl ? (
                  <a
                    href={workflowUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex text-[11px] text-sky-600 font-normal underline"
                  >
                    進行状況
                  </a>
                ) : (
                  <p className="mt-0.5 text-[11px] text-stone-400">進行状況url取得中...</p>
                )}
                </span>
                  <span className="text-[11px] text-stone-500">{renderJobStatusLabel(item)}</span>
                </div>
                {item.progress ? <p className="text-[11px] text-stone-500">{item.progress}</p> : null}
                {item.message ? <p className="mt-0.5 text-[11px] text-stone-500">{item.message}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

function renderJobStatusLabel(item: BulkJobItem): string {
  if (!isTerminalItem(item) && typeof item.elapsedSeconds === "number" && item.elapsedSeconds >= 0) {
    return formatElapsed(item.elapsedSeconds);
  }

  if (item.jobStatus) {
    return JOB_STATUS_LABELS[item.jobStatus] ?? item.jobStatus;
  }

  return LOCAL_STATUS_LABELS[item.localStatus] ?? item.localStatus;
}

function parseCsv(input: string): ParseResult {
  if (!input.trim()) {
    return { entries: [], error: "CSVテキストを入力してください" };
  }

  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { entries: [], error: "CSVテキストを入力してください" };
  }

  const entries: ParsedEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const parts = line.split(",").map((part) => part.trim());

    if (parts.length < 2) {
      return { entries: [], error: `${index + 1}行目がCSV形式 (id,password) になっていません` };
    }

    const [userId, password] = parts;

    if (!userId || !password) {
      return { entries: [], error: `${index + 1}行目にIDまたはパスワードが不足しています` };
    }

    entries.push({ userId, password });
  }

  return { entries };
}

function sanitizeEntryCount(value: number, entryOptions: number[]): number {
  if (entryOptions.includes(value)) {
    return value;
  }
  return entryOptions[0] ?? 1;
}

function deriveGroupLabel(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().slice(0, 1);
  return normalized || undefined;
}

function resolveJobBackgroundStyle(item: BulkJobItem): CSSProperties {
  const ratio = parseProgressRatio(item.progress ?? null);

  if (ratio === null) {
    if (item.jobStatus && TERMINAL_JOB_STATUSES.has(item.jobStatus)) {
      return { backgroundColor: "rgba(34,197,94,0.12)" };
    }
    if (item.localStatus === "error" || item.jobStatus === "failed") {
      return { backgroundColor: "rgba(248,113,113,0.15)" };
    }
    return {};
  }

  const percentage = Math.min(100, Math.max(0, ratio * 100));
  const progressColor = "rgba(59,130,246,0.25)";
  return {
    background: `linear-gradient(90deg, ${progressColor} ${percentage}%, transparent ${percentage}%)`,
  };
}

function parseProgressRatio(text: string | null): number | null {
  if (!text) {
    return null;
  }

  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) {
    return null;
  }

  const current = Number(match[1]);
  const total = Number(match[2]);

  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return Math.min(1, Math.max(0, current / total));
}

function inferTimestampMs(timestamp: { seconds?: number; nanoseconds?: number }): number | null {
  if (typeof timestamp?.seconds === "number") {
    const nanos = typeof timestamp.nanoseconds === "number" ? timestamp.nanoseconds : 0;
    return timestamp.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  return null;
}

function isTerminalItem(item: BulkJobItem): boolean {
  if (item.localStatus === "error") {
    return true;
  }

  if (!item.jobStatus) {
    return false;
  }

  return TERMINAL_JOB_STATUSES.has(item.jobStatus);
}

function formatElapsed(seconds?: number): string {
  if (typeof seconds !== "number" || seconds < 0) {
    return "";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}時間${minutes}分${secs}秒`;
  }

  if (minutes > 0) {
    return `${minutes}分${secs}秒`;
  }

  return `${secs}秒`;
}

async function triggerJob({
  userId,
  password,
  entryCount,
  groupId,
  label,
}: {
  userId: string;
  password: string;
  entryCount: number;
  groupId: string;
  label?: string;
}): Promise<string> {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
      password,
      entryCount,
      groupId,
      label,
    }),
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let errorMessage = "応募のトリガーに失敗しました";

    try {
      const data = JSON.parse(rawBody) as { error?: string };
      errorMessage = (data.error ?? rawBody) || errorMessage;
    } catch {
      if (rawBody) {
        errorMessage = rawBody;
      }
    }

    throw new Error(errorMessage);
  }

  const payload = (await response.json().catch(() => null)) as { jobId?: string } | null;

  if (!payload?.jobId) {
    throw new Error("ジョブIDを取得できませんでした");
  }

  return payload.jobId;
}

function randomDelayMs(min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
