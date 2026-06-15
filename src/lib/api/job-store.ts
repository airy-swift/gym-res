import { randomUUID } from 'node:crypto';

import { dispatchJobWorkflow } from '@/lib/github/dispatch';
import {
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

const CREDENTIAL_FIELD_PATHS = ['userId', 'password'];
const CLEAR_CREDENTIAL_FIELDS = ['updatedAt', ...CREDENTIAL_FIELD_PATHS];
const TERMINAL_FAILURE_STATUS = 'failed';

export function createJobId(): string {
  return randomUUID().replace(/-/g, '');
}

export async function createDispatchedJob(input: CreateJobInput): Promise<string> {
  const jobId = createJobId();

  await setFirestoreRestDocument(`jobs/${jobId}`, {
    status: 'pending',
    message: input.message,
    createdAt: new Date(),
    progress: input.progress,
    userId: input.userId,
    password: input.password,
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
