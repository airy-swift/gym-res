type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

type FirestoreDocumentResponse = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

export type FirestoreRestDocument = {
  id: string;
  data: Record<string, unknown>;
  updateTime?: string;
};

export async function getFirestoreRestDocument(documentPath: string): Promise<FirestoreRestDocument | null> {
  const response = await fetch(buildFirestoreDocumentUrl(documentPath), {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firestore REST get failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as FirestoreDocumentResponse;
  const documentId = payload.name?.split("/").pop() ?? "";

  return {
    id: documentId,
    data: decodeFirestoreFields(payload.fields ?? {}),
    updateTime: payload.updateTime,
  };
}

export async function patchFirestoreRestDocument(
  documentPath: string,
  data: Record<string, unknown>,
  fieldPaths: string[],
): Promise<void> {
  const url = buildFirestoreDocumentUrl(documentPath);
  for (const fieldPath of fieldPaths) {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: encodeFirestoreFields(data),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firestore REST patch failed: ${response.status} ${errorText}`);
  }
}

function buildFirestoreDocumentUrl(documentPath: string): URL {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "";
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";

  if (!projectId || !apiKey) {
    throw new Error("Missing Firebase REST configuration.");
  }

  const normalizedPath = documentPath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId,
    )}/databases/(default)/documents/${normalizedPath}`,
  );
  url.searchParams.set("key", apiKey);
  return url;
}

function decodeFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function decodeFirestoreValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) {
    return null;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("integerValue" in value) {
    return Number(value.integerValue);
  }
  if ("doubleValue" in value) {
    return value.doubleValue;
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  }
  if ("mapValue" in value) {
    return decodeFirestoreFields(value.mapValue.fields ?? {});
  }
  return undefined;
}

function encodeFirestoreFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)]));
}

function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}
