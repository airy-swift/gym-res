"use client";

import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, getRedirectResult, signInWithPopup, signInWithRedirect, type User } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/app";

type GoogleLoginButtonProps = {
  groupId: string;
  nextPath: string;
};

export function GoogleLoginButton({ groupId, nextPath }: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const auth = useMemo(() => getFirebaseAuth(), []);

  const completeLogin = async (user: User) => {
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
      throw new Error("このアカウントではアクセスできません。管理者に確認してください。");
    }

    window.location.href = nextPath;
  };

  useEffect(() => {
    let cancelled = false;

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
    };
  }, [auth]);

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
      {errorMessage ? (
        <p className="text-xs text-red-600">{errorMessage}</p>
      ) : null}
    </div>
  );
}
