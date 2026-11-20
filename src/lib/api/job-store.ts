import { randomUUID } from 'node:crypto';

import { dispatchJobWorkflow } from '@/lib/github/dispatch';
import { decryptJobCredentials, encryptJobCredentials } from '@/lib/security/job-credentials-crypto';
import {
  FirestorePreconditionError,
  getFirestoreRestDocument,
  patchFirestoreRestDocument,
  setFirestoreRestDocument,
} from '@/lib/firebase/firestore-rest';

export type CreateJobInput = {
  userId: string;
  password: string;
  entryCount: number;
  groupId: string;
  label?: string;
  message: string;
  progress: string;
};

export type JobPatchInput = {
  status?: string;
  message?: string;
  progress?: string;
  clearCredentials?: boolean;
};

const CREDENTIAL_FIELD_PATHS = ['userId', 'password', 'encryptedCredentials'];
const CLEAR_CREDENTIAL_FIELDS = ['updatedAt', ...CREDENTIAL_FIELD_PATHS];
const TERMINAL_FAILURE_STATUS = 'failed';

export function createJobId(): string {
  return randomUUID().replace(/-/g, '');
}

export async function createDispatchedJob(input: CreateJobInput): Promise<string> {
  const jobId = createJobId();
  const encryptedCredentials = encryptJobCredentials(jobId, { userId: input.userId, password: input.password });

  await setFirestoreRestDocument(`jobs/${jobId}`, {
    status: 'pending',
    message: input.message,
    createdAt: new Date(),
    progress: input.progress,
    encryptedCredentials,
    entryCount: input.entryCount,
    groupId: input.groupId,
  });

  try {
    await dispatchJobWorkflow(jobId, input.label);
  } catch (error) {
    try {
      await markJobAsFailed(jobId, 'GitHub Actions dispatch failed');
    } catch (updateError) {
      console.error('Failed to mark job as failed after dispatch error', updateError);
    }
    throw error;
  }

  return jobId;
}

export async function getJobDocument(jobId: string) {
  return getFirestoreRestDocument(`jobs/${jobId}`);
}

// 復号した認証情報は、内部トークンで認証済みのAPIからだけ取得する。
export async function getJobDocumentForRunner(jobId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const document = await getJobDocument(jobId);
    if (!document) return null;

    const { encryptedCredentials, userId, password, ...metadata } = document.data;
    if (typeof encryptedCredentials === 'string') {
      return { ...document, data: { ...metadata, ...decryptJobCredentials(jobId, encryptedCredentials) } };
    }
    if (typeof userId === 'string' && typeof password === 'string') {
      // 削除処理との競合時は古い認証情報を書き戻さず、最新状態を読み直す。
      if (!document.updateTime) throw new Error('Job update time is required to migrate credentials');
      try {
        await patchFirestoreRestDocument(`jobs/${jobId}`, {
          encryptedCredentials: encryptJobCredentials(jobId, { userId, password }),
        }, CREDENTIAL_FIELD_PATHS, document.updateTime);
      } catch (error) {
        if (error instanceof FirestorePreconditionError) continue;
        throw error;
      }
      return { ...document, data: { ...metadata, userId, password } };
    }
    return { ...document, data: metadata };
  }
  throw new Error('Job changed repeatedly while migrating credentials');
}

export async function patchJobDocument(jobId: string, input: JobPatchInput): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  const updateFields = ['updatedAt'];

  if (input.status !== undefined) {
    updates.status = input.status;
    updateFields.push('status');
  }

  if (input.message !== undefined) {
    updates.message = input.message;
    updateFields.push('message');
  }

  if (input.progress !== undefined) {
    updates.progress = input.progress;
    updateFields.push('progress');
  }

  if (input.clearCredentials) {
    updateFields.push(...CREDENTIAL_FIELD_PATHS);
  }

  await patchFirestoreRestDocument(`jobs/${jobId}`, updates, updateFields);
}

export async function clearJobCredentials(jobId: string): Promise<void> {
  await patchFirestoreRestDocument(`jobs/${jobId}`, { updatedAt: new Date() }, CLEAR_CREDENTIAL_FIELDS);
}

export async function markJobAsFailed(jobId: string, message: string): Promise<void> {
  await patchJobDocument(jobId, {
    status: TERMINAL_FAILURE_STATUS,
    message,
    clearCredentials: true,
  });
}

export function formatHistoryTimestamp(date: Date): string {
  const pad = (value: number, length = 2) => value.toString().padStart(length, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const milliseconds = pad(date.getMilliseconds(), 3);

  return `${year}-${month}-${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
}
