import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type JobCredentials = { userId: string; password: string };

function getEncryptionKey(): Buffer {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) {
    throw new Error('INTERNAL_API_TOKEN is required to protect job credentials');
  }
  return createHash('sha256').update('gym_reserver_job_credentials_v1\0').update(token).digest();
}

export function encryptJobCredentials(jobId: string, credentials: JobCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(jobId, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptJobCredentials(jobId: string, payload: string): JobCredentials {
  try {
    const [version, iv, tag, encrypted, extra] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted || extra !== undefined) {
      throw new Error('Invalid encrypted credentials');
    }
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(jobId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plainText = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
    const credentials: unknown = JSON.parse(plainText);
    if (typeof credentials !== 'object' || credentials === null
      || !('userId' in credentials) || typeof credentials.userId !== 'string'
      || !('password' in credentials) || typeof credentials.password !== 'string') {
      throw new Error('Invalid credentials');
    }
    return { userId: credentials.userId, password: credentials.password };
  } catch {
    throw new Error('Failed to decrypt job credentials');
  }
}
