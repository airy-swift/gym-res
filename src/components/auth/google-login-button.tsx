"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/app";

type GoogleLoginButtonProps = {
  groupId: string;
  nextPath?: string;
};

type AccessStatus = "checking" | "full" | "pending" | null;

export function GoogleLoginButton({ groupId }: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessStatus, setAccessStatus] = useState<AccessStatus>(null);
  const auth = useMemo(() => getFirebaseAuth(), []);

  const completeLogin = useCallback(async (user: User) => {
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

    setCurrentUser(user);
    setAccessStatus(payload.authorized ? "full" : "pending");
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (cancelled) {
        return;
      }

      setCurrentUser(user);
      if (!user) {
        setAccessStatus(null);
        return;
      }

      setAccessStatus("checking");
      setIsLoading(true);
      completeLogin(user)
        .catch(error => {
          const message = error instanceof Error ? error.message : "Googleログインに失敗しました。";
          setErrorMessage(message);
        })
        .finally(() => {
          setIsLoading(false);
        });
    });

    const restoreFromRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (!result || cancelled) {
          return;
        }
        setIsLoading(true);
        await completeLogin(result.user);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Googleログインに失敗しました。";
        setErrorMessage(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void restoreFromRedirect();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth, completeLogin]);

  const handleLogin = async () => {
    setIsLoading(true);
    setErrorMessage("");

    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await completeLogin(result.user);
    } catch (error) {
      const shouldFallbackToRedirect =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "auth/popup-blocked";

      if (shouldFallbackToRedirect) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const message = error instanceof Error ? error.message : "Googleログインに失敗しました。";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-3">
      {currentUser ? (
        <div className="space-y-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Google アカウント</p>
            <p className="mt-1 font-semibold text-stone-900">{getGoogleAccountName(currentUser)}</p>
          </div>
          {accessStatus === "checking" ? (
            <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">
              アクセス権限を確認中です。
            </p>
          ) : accessStatus === "full" ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              アクセス権限: フル
            </p>
          ) : (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              管理者に問い合わせてアクセス権限の付与依頼をしてください。
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            void handleLogin();
          }}
          disabled={isLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-900 transition hover:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "認証中..." : "Googleでログイン"}
        </button>
      )}
      {errorMessage ? (
        <p className="text-xs text-red-600">{errorMessage}</p>
      ) : null}
    </div>
  );
}

function getGoogleAccountName(user: User): string {
  return user.displayName?.trim() || user.email?.trim() || "Googleアカウント";
}
