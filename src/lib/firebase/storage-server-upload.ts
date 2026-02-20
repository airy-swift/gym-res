import { createSign } from "node:crypto";

type UploadToStorageParams = {
  bucket: string;
  objectPath: string;
  body: Uint8Array;
  contentType: string;
};

type ServiceAccountConfig = {
  clientEmail: string;
  privateKey: string;
};

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

function getServiceAccountConfig(): ServiceAccountConfig | null {
  const clientEmail =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ||
    process.env.GOOGLE_CLIENT_EMAIL?.trim() ||
    "";
  const privateKeyRaw =
    process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    "";
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n").trim();

  if (!clientEmail || !privateKey) {
    return null;
  }

  return { clientEmail, privateKey };
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildSignedJwt(config: ServiceAccountConfig): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: config.clientEmail,
      scope: "https://www.googleapis.com/auth/devstorage.full_control",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );

  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(config.privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${unsigned}.${signature}`;
}

async function fetchAccessToken(config: ServiceAccountConfig): Promise<{ token: string; expiresAtMs: number }> {
  const assertion = buildSignedJwt(config);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to fetch OAuth token (${response.status}): ${payloadText}`);
  }

  const payload = JSON.parse(payloadText) as { access_token?: string; expires_in?: number };
  const accessToken = payload.access_token?.trim();
  const expiresInSec = typeof payload.expires_in === "number" ? payload.expires_in : 3600;

  if (!accessToken) {
    throw new Error("OAuth token response does not include access_token");
  }

  return {
    token: accessToken,
    expiresAtMs: Date.now() + Math.max(60, expiresInSec - 60) * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now()) {
    return cachedAccessToken.token;
  }

  const config = getServiceAccountConfig();
  if (!config) {
    throw new Error(
      "Missing FIREBASE_ADMIN_CLIENT_EMAIL/FIREBASE_ADMIN_PRIVATE_KEY (or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY).",
    );
  }

  cachedAccessToken = await fetchAccessToken(config);
  return cachedAccessToken.token;
}

export function hasServiceAccountUploadConfig(): boolean {
  return getServiceAccountConfig() !== null;
}

export async function uploadToStorageWithServiceAccount({
  bucket,
  objectPath,
  body,
  contentType,
}: UploadToStorageParams): Promise<void> {
  const accessToken = await getAccessToken();
  const endpoint = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
    },
    body: Buffer.from(body),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`GCS upload failed (${response.status}): ${payload}`);
  }
}
