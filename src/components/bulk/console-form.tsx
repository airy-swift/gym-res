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
type WorkflowLinkState = "idle" | "pending" | "resolved" | "error";

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
  workflowUrl?: string | null;
  workflowLinkState?: WorkflowLinkState;
};

const DEFAULT_PLACEHOLDER = `1行目からいきなりid,passwordの形式で入力してください。下記の感じ↓\n00112233,password123\n44556677,password456`;
const JOB_TRIGGER_INTERVAL_MS = 10_000;
const WORKFLOW_FETCH_INITIAL_DELAY_MS = 1_800;
const WORKFLOW_FETCH_MAX_DELAY_MS = 10_000;
const JOB_LISTEN_INITIAL_DELAY_MS = 2_000;
const JOB_LISTEN_BACKOFF_FACTOR = 1.75;
const JOB_LISTEN_MAX_BACKOFF_MS = 20_000;
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
const NEGATIVE_TERMINAL_JOB_STATUSES = new Set(["failed", "canceled", "cancelled", "error", "aborted"]);

export function BulkConsoleForm({
  groupId,
  entryOptions,
  defaultEntryCount,
  defaultValue,
  groupLabel,
}: BulkConsoleFormProps) {
  const firestore = useMemo(() => getFirestoreDb(), []);
  const jobSubscriptionsRef = useRef<Record<string, () => void>>({});
  const jobRetryTimeoutsRef = useRef<Record<string, NodeJS.Timeout | null>>({});

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
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const workflowTimeoutsRef = useRef<Record<number, NodeJS.Timeout | null>>({});

  useEffect(() => {
    setEntryCount(resolvedDefaultEntryCount);
  }, [resolvedDefaultEntryCount]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearWorkflowLinkTimeout = useCallback((entryIndex: number) => {
    const timeoutId = workflowTimeoutsRef.current[entryIndex];
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    delete workflowTimeoutsRef.current[entryIndex];
  }, []);

  const clearAllWorkflowLinkTimeouts = useCallback(() => {
    Object.keys(workflowTimeoutsRef.current).forEach((key) => {
      clearWorkflowLinkTimeout(Number(key));
    });
    workflowTimeoutsRef.current = {};
  }, [clearWorkflowLinkTimeout]);

  const clearJobRetryTimeout = useCallback((jobId: string) => {
    const timeoutId = jobRetryTimeoutsRef.current[jobId];
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    delete jobRetryTimeoutsRef.current[jobId];
  }, []);

  const clearAllJobRetryTimeouts = useCallback(() => {
    Object.keys(jobRetryTimeoutsRef.current).forEach((jobId) => {
      clearJobRetryTimeout(jobId);
    });
  }, [clearJobRetryTimeout]);
  
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
    Object.entries(jobSubscriptionsRef.current).forEach(([jobId, unsubscribe]) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("Failed to cleanup job subscription", error);
      } finally {
        clearJobRetryTimeout(jobId);
      }
    });
    jobSubscriptionsRef.current = {};
    clearAllJobRetryTimeouts();
    jobRetryTimeoutsRef.current = {};
  }, [clearAllJobRetryTimeouts, clearJobRetryTimeout]);


  useEffect(
    () => () => {
      clearSubscriptions();
      clearTimer();
      clearAllWorkflowLinkTimeouts();
    },
    [clearSubscriptions, clearTimer, clearAllWorkflowLinkTimeouts],
  );

  const updateJobItem = useCallback((entryIndex: number, updates: Partial<BulkJobItem>) => {
    setJobItems((previous) =>
      previous.map((item, index) => (index === entryIndex ? { ...item, ...updates } : item)),
    );
  }, []);

  const fetchWorkflowLink = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/internal/workflow");

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as {
          job_url?: string | null;
          actions_url?: string | null;
        } | null;

        return data?.job_url || data?.actions_url || null;
      }
    } catch (error) {
      console.error("Failed to fetch workflow link", error);
    }
    return null;
  }, []);

  const scheduleWorkflowLinkFetch = useCallback(
    (entryIndex: number, delayMs = WORKFLOW_FETCH_INITIAL_DELAY_MS) => {
      clearWorkflowLinkTimeout(entryIndex);
      workflowTimeoutsRef.current[entryIndex] = setTimeout(async () => {
        const url = await fetchWorkflowLink();
        delete workflowTimeoutsRef.current[entryIndex];
        if (url) {
          updateJobItem(entryIndex, {
            workflowUrl: url,
            workflowLinkState: "resolved",
          });
          return;
        }

        const nextDelay = Math.min(
          Math.max(WORKFLOW_FETCH_INITIAL_DELAY_MS, Math.floor(delayMs * 1.5)),
          WORKFLOW_FETCH_MAX_DELAY_MS,
        );
        scheduleWorkflowLinkFetch(entryIndex, nextDelay);
      }, delayMs);
    },
    [clearWorkflowLinkTimeout, fetchWorkflowLink, updateJobItem],
  );

  const subscribeToJob = useCallback(
    (jobId: string, entryIndex: number, retryDelayMs = JOB_LISTEN_INITIAL_DELAY_MS) => {
      clearJobRetryTimeout(jobId);

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
            try {
              unsubscribe();
            } catch (cleanupError) {
              console.error(`Failed to cleanup job subscription after completion (${jobId})`, cleanupError);
            }
            delete jobSubscriptionsRef.current[jobId];
            clearJobRetryTimeout(jobId);
          }
        },
        (error) => {
          console.error(`Failed to listen to bulk job ${jobId}`, error);
          try {
            unsubscribe();
          } catch (cleanupError) {
            console.error(`Failed to cleanup broken job listener (${jobId})`, cleanupError);
          }
          delete jobSubscriptionsRef.current[jobId];

          const nextDelay = Math.min(
            Math.max(
              JOB_LISTEN_INITIAL_DELAY_MS,
              Math.floor(retryDelayMs * JOB_LISTEN_BACKOFF_FACTOR),
            ),
            JOB_LISTEN_MAX_BACKOFF_MS,
          );

          clearJobRetryTimeout(jobId);
          jobRetryTimeoutsRef.current[jobId] = setTimeout(() => {
            delete jobRetryTimeoutsRef.current[jobId];
            subscribeToJob(jobId, entryIndex, nextDelay);
          }, nextDelay);
        },
      );

      jobSubscriptionsRef.current[jobId] = unsubscribe;
    },
    [clearJobRetryTimeout, firestore, updateJobItem],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);

    if (hasStarted) {
      return;
    }

    clearSubscriptions();
    clearAllWorkflowLinkTimeouts();
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
        workflowUrl: null,
        workflowLinkState: "idle",
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
            workflowUrl: null,
            workflowLinkState: "pending",
          });
          subscribeToJob(jobId, index);
          scheduleWorkflowLinkFetch(index);
        } catch (jobError) {
          console.error("Failed to trigger bulk job", jobError);
          const message =
            jobError instanceof Error ? jobError.message : "応募のトリガーに失敗しました。再度お試しください";
          updateJobItem(index, {
            localStatus: "error",
            message,
            workflowLinkState: "error",
            workflowUrl: null,
          });
          continue;
        }

        if (index < normalizedEntries.length - 1) {
          await wait(JOB_TRIGGER_INTERVAL_MS);
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
            {jobItems.map((item) => {
              const formattedMessage = formatJobMessage(item.message);
              return (
                <li
                  key={item.jobId ?? `${item.entryIndex}-${item.userLabel}`}
                  className="rounded-xl border border-stone-100 px-3 py-2 text-xs text-stone-800"
                  style={resolveJobBackgroundStyle(item)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {renderStatusIcon(item)}
                      <span className="font-semibold text-stone-900">
                        {item.userLabel}
                        {item.workflowUrl ? (
                          <a
                            href={item.workflowUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex text-[11px] font-normal text-sky-600 underline"
                          >
                            進行状況
                          </a>
                        ) : item.workflowLinkState === "pending" ? (
                          <span className="ml-2 text-[11px] font-normal text-stone-400">進行状況URL取得中...</span>
                        ) : item.workflowLinkState === "error" ? (
                          <span className="ml-2 text-[11px] font-normal text-red-500">進行状況URLを取得できませんでした</span>
                        ) : null}
                      </span>
                    </div>
                    <span className="text-[11px] text-stone-500">{renderJobStatusLabel(item)}</span>
                  </div>
                  {formattedMessage ? (
                    <p className="mt-0.5 whitespace-pre-line text-[11px] text-stone-500">{formattedMessage}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

function renderJobStatusLabel(item: BulkJobItem): string {
  if (item.progress) {
    return item.progress;
  }

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

function formatJobMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }
  const normalized = message.replace(/<br\s*\/?\>/gi, "\n");
  return normalized.replace(/\n{2,}/g, "\n");
}

type StatusVisualVariant = "idle" | "pending" | "running" | "success" | "error";

type StatusIconConfig = {
  label: string;
  containerClass: string;
  iconClass: string;
  Icon: (props: IconProps) => JSX.Element;
};

const STATUS_ICON_CONFIG: Record<StatusVisualVariant, StatusIconConfig> = {
  idle: {
    label: "未実行",
    containerClass: "bg-stone-100 text-stone-500",
    iconClass: "h-3 w-3",
    Icon: DotIcon,
  },
  pending: {
    label: "実行準備中",
    containerClass: "bg-amber-100 text-amber-600",
    iconClass: "h-4 w-4",
    Icon: ClockIcon,
  },
  running: {
    label: "実行中",
    containerClass: "bg-sky-100 text-sky-600",
    iconClass: "h-4 w-4 animate-spin",
    Icon: SpinnerIcon,
  },
  success: {
    label: "完了",
    containerClass: "bg-emerald-100 text-emerald-600",
    iconClass: "h-4 w-4",
    Icon: CheckIcon,
  },
  error: {
    label: "エラー",
    containerClass: "bg-red-100 text-red-600",
    iconClass: "h-4 w-4",
    Icon: AlertIcon,
  },
};

function renderStatusIcon(item: BulkJobItem): JSX.Element {
  const variant = resolveStatusVariant(item);
  const config = STATUS_ICON_CONFIG[variant];
  const IconComponent = config.Icon;

  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full ${config.containerClass}`}
      aria-label={config.label}
    >
      <IconComponent className={config.iconClass} />
    </span>
  );
}

function resolveStatusVariant(item: BulkJobItem): StatusVisualVariant {
  if (item.localStatus === "error") {
    return "error";
  }

  const normalizedStatus = typeof item.jobStatus === "string" ? item.jobStatus.toLowerCase() : null;

  if (normalizedStatus === "completed") {
    return "success";
  }

  if (normalizedStatus && NEGATIVE_TERMINAL_JOB_STATUSES.has(normalizedStatus)) {
    return "error";
  }

  if (normalizedStatus === "running") {
    return "running";
  }

  if (normalizedStatus === "pending") {
    return "pending";
  }

  if (item.localStatus === "dispatching") {
    return "pending";
  }

  if (item.localStatus === "listening") {
    return "running";
  }

  return "idle";
}

type IconProps = { className?: string };

function SpinnerIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        className="opacity-85"
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 9v4m0 4h.01M10.29 3.86 2.82 17.01A1.5 1.5 0 0 0 4.13 19.25h15.74a1.5 1.5 0 0 0 1.31-2.24L13.7 3.86a1.5 1.5 0 0 0-2.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
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

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
