import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const GROUP_IDS_CRYPTO_VERSION = "v1";
const GROUP_IDS_CRYPTO_ALGORITHM = "aes-256-gcm";
const GROUP_IDS_CRYPTO_IV_LENGTH = 12;
const GROUP_IDS_FIXED_PASSPHRASE = "gym_reserver_hit_ids_v1_fixed_key";

function getGroupIdsEncryptionKey(): Buffer {
  return createHash("sha256").update(GROUP_IDS_FIXED_PASSPHRASE).digest();
}

export function encryptGroupIds(plainText: string): string {
  const key = getGroupIdsEncryptionKey();
  const iv = randomBytes(GROUP_IDS_CRYPTO_IV_LENGTH);
  const cipher = createCipheriv(GROUP_IDS_CRYPTO_ALGORITHM, key, iv);
  const encryptedBuffer = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    GROUP_IDS_CRYPTO_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    encryptedBuffer.toString("base64"),
  ].join(".");
}

export function decryptGroupIds(cipherText: string): string {
  const [version, ivBase64, tagBase64, payloadBase64] = cipherText.split(".");

  if (version !== GROUP_IDS_CRYPTO_VERSION || !ivBase64 || !tagBase64 || !payloadBase64) {
    throw new Error("Invalid ids payload format");
  }

  const key = getGroupIdsEncryptionKey();
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(tagBase64, "base64");
  const encryptedPayload = Buffer.from(payloadBase64, "base64");
  const decipher = createDecipheriv(GROUP_IDS_CRYPTO_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decryptedBuffer = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);

  return decryptedBuffer.toString("utf8");
}

export function decodeGroupIdsForDisplay(rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    return "";
  }

  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return "";
  }

  if (!trimmedValue.startsWith(`${GROUP_IDS_CRYPTO_VERSION}.`)) {
    return trimmedValue;
  }

  try {
    return decryptGroupIds(trimmedValue);
  } catch (error) {
    console.error("Failed to decrypt group ids payload", error);
    return "";
  }
}
