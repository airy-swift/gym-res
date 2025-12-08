import { doc, getDoc, type DocumentData } from "firebase/firestore";

import { getFirestoreDb } from "./app";

export async function doesFirestoreDocExist(collectionPath: string, documentId: string): Promise<boolean> {
  try {
    const db = getFirestoreDb();
    const documentRef = doc(db, collectionPath, documentId);
    const snapshot = await getDoc(documentRef);
    return snapshot.exists();
  } catch (error) {
    console.error("Failed to check Firestore document", error);
    return false;
  }
}

export async function isValidGroupId(groupId: string): Promise<boolean> {
  return doesFirestoreDocExist("groups", groupId);
}

export type GroupDocumentData = {
  name?: string;
  urls?: string[];
  list?: Array<{
    gymName?: string;
    room?: string;
    date?: string;
    time?: string;
  }>;
} & DocumentData;

export type GroupDocument = GroupDocumentData & {
  id: string;
};

export async function getGroupDocument(groupId: string): Promise<GroupDocument | null> {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDoc(doc(db, "groups", groupId));

    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data() as GroupDocumentData | undefined;

    return {
      id: snapshot.id,
      ...(data ?? {}),
    };
  } catch (error) {
    console.error("Failed to fetch Firestore document", error);
    return null;
  }
}
