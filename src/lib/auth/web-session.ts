import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const WEB_SESSION_COOKIE = "gr_web_id_token";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type FirebaseLookupResponse = {
  users?: Array<{
    localId?: string;
  }>;
  error?: {
    message?: string;
  };
};

export async function resolveWebUserIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get(WEB_SESSION_COOKIE)?.value?.trim() ?? "";
  if (!idToken) {
    return null;
  }

  return verifyFirebaseIdToken(idToken);
}

export function setWebSessionCookie(response: NextResponse, idToken: string): void {
  response.cookies.set({
    name: WEB_SESSION_COOKIE,
    value: idToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function verifyFirebaseIdToken(idToken: string): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.error("NEXT_PUBLIC_FIREBASE_API_KEY is not set.");
    return null;
  }

  const normalizedToken = idToken.trim();
  if (!normalizedToken) {
    return null;
  }

  try {
    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ idToken: normalizedToken }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to verify Firebase ID token", response.status, errorText);
      return null;
    }

    const payload = (await response.json()) as FirebaseLookupResponse;
    const uid = payload.users?.[0]?.localId?.trim() ?? "";
    return uid || null;
  } catch (error) {
    console.error("Failed to verify Firebase ID token", error);
    return null;
  }
}
