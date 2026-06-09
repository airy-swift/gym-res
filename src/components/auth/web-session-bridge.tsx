"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/app";
import { buildAuthPath } from "@/lib/navigation/group-paths";

type WebSessionBridgeProps = {
  groupId: string;
  nextPath: string;
};

type BridgeStatus = "checking" | "restoring" | "failed";

export function WebSessionBridge({ groupId, nextPath }: WebSessionBridgeProps) {
  const router = useRouter();
  const auth = useMemo(() => getFirebaseAuth(), []);
  const [status, setStatus] = useState<BridgeStatus>("checking");
  const [errorMessage, setErrorMessage] = useState("");

  const authPath = useMemo(() => buildAuthPath(groupId, nextPath), [groupId, nextPath]);

  const completeLogin = useCallback(async (user: User) => {
    setStatus("restoring");
    setErrorMessage("");

    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupId,
        idToken,
      }),
    });

    const payload = (await response.json()) as { authorized?: boolean; error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "ログイン処理に失敗しました。");
    }

    if (!payload.authorized) {
      router.replace(authPath);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }, [authPath, groupId, nextPath, router]);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (cancelled) {
        return;
      }

      if (!user) {
        router.replace(authPath);
        return;
      }

      void completeLogin(user).catch(error => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Googleログイン状態の復元に失敗しました。";
        setErrorMessage(message);
        setStatus("failed");
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth, authPath, completeLogin, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white/80 p-8 shadow-sm">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Google アカウント</p>
          <h1 className="text-xl font-semibold text-stone-900">
            {status === "failed" ? "認証状態を確認できませんでした" : "認証状態を確認中です"}
          </h1>
          <p className="text-sm text-stone-600">
            {status === "restoring"
              ? "ログイン済みの Google アカウントを確認しています。"
              : "このページの表示権限を確認しています。"}
          </p>
          {errorMessage ? (
            <div className="space-y-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>{errorMessage}</p>
              <button
                type="button"
                onClick={() => router.replace(authPath)}
                className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300"
              >
                ログイン画面へ
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
