export type JobRequestInput = {
  userId: string;
  password: string;
  entryCount: number;
  groupId: string;
  label?: string;
};

type JobInputResult =
  | { ok: true; input: JobRequestInput }
  | { ok: false; error: string };

export function parseJobInput(body: unknown): JobInputResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Expected a JSON object' };
  }

  const { userId, password, entryCount, groupId, label } = body as Record<string, unknown>;

  if (!isSingleLineString(userId) || !isSingleLineString(password) || !isSingleLineString(groupId)) {
    return { ok: false, error: 'userId, password, and groupId must be non-empty single-line strings' };
  }

  if (groupId.includes('/') || groupId === '.' || groupId === '..') {
    return { ok: false, error: 'Invalid groupId' };
  }

  if (typeof entryCount !== 'number' || !Number.isSafeInteger(entryCount) || entryCount < 1) {
    return { ok: false, error: 'entryCount must be a positive integer' };
  }

  if (label !== undefined && (typeof label !== 'string' || /[\r\n\0]/.test(label))) {
    return { ok: false, error: 'label must be a single-line string' };
  }

  return { ok: true, input: { userId, password, entryCount, groupId, label } };
}

function isSingleLineString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value);
}
