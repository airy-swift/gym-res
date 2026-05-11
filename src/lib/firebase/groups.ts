import type { DocumentData } from "firebase/firestore";

import type { GroupWhiteEntry } from "@/lib/auth/group-white-list";
import { getFirestoreRestDocument } from "@/lib/firebase/firestore-rest";

export async function doesFirestoreDocExist(collectionPath: string, documentId: string): Promise<boolean> {
  try {
    const document = await getFirestoreRestDocument(`${collectionPath}/${documentId}`);
    return document !== null;
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
  ids?: string;
  white?: Array<GroupWhiteEntry | string>;
  list?: Array<{
    gymName?: string;
    room?: string;
    date?: string;
    time?: string;
  }>;
  representatives?: string[];
} & DocumentData;

export type GroupDocument = GroupDocumentData & {
  id: string;
};

export async function getGroupDocument(groupId: string): Promise<GroupDocument | null> {
  try {
    const document = await getFirestoreRestDocument(`groups/${groupId}`);
    if (!document) {
      return null;
    }

    const data = document.data as GroupDocumentData | undefined;

    return {
      id: document.id,
      ...(data ?? {}),
    };
  } catch (error) {
    console.error("Failed to fetch Firestore document", error);
    return null;
  }
}
