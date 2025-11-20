import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  type DocumentReference,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';

import { getFirestoreDb } from './app';

export const RESERVATIONS_COLLECTION = 'reservations';

export type ReservationSlotId = 'morning' | 'afternoon' | 'night';

export type ReservationSource = 'ai' | 'manual';

export type ReservationSlotEntry = {
  name: string;
  source: ReservationSource;
  strike: boolean;
  startTime: string | null;
  endTime: string | null;
  fixed?: boolean | null;
};

export type ReservationSlots = Record<ReservationSlotId, ReservationSlotEntry[]>;

export type ReservationDay = {
  date: string;
  gymName: string;
  slots: ReservationSlots;
  confirmed: boolean;
  lastUpdatedBy: string | null;
  updatedAt: string;
  fixed?: boolean | null;
};

export type ReservationDayRecord = ReservationDay & {
  id: string;
};

export type ReservationDayUpdate = Omit<ReservationDay, 'updatedAt'> & {
  updatedAt?: string;
};

const reservationsCollection = () =>
  collection(getFirestoreDb(), RESERVATIONS_COLLECTION);

const generateReservationDocumentId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const reservationRangeQuery = (
  startDate: string,
  endDate: string,
): Query<ReservationDay> =>
  query(
    reservationsCollection(),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ) as Query<ReservationDay>;

const normalizeTime = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeSlotEntries = (
  entries: ReservationSlotEntry[] | undefined,
): ReservationSlotEntry[] =>
  Array.isArray(entries)
    ? entries.map((entry) => ({
        ...entry,
        strike: entry.strike ?? false,
        startTime: normalizeTime(entry.startTime),
        endTime: normalizeTime(entry.endTime),
        fixed: entry.fixed ?? false,
      }))
    : [];

const normalizeReservationSlots = (slots: ReservationSlots): ReservationSlots => ({
  morning: normalizeSlotEntries(slots?.morning),
  afternoon: normalizeSlotEntries(slots?.afternoon),
  night: normalizeSlotEntries(slots?.night),
});

const toReservationDayRecord = (docId: string, data: ReservationDay): ReservationDayRecord => ({
  id: docId,
  ...data,
  slots: normalizeReservationSlots(data.slots),
});

export const reservationDoc = (id: string): DocumentReference<ReservationDay> =>
  doc(reservationsCollection(), id) as DocumentReference<ReservationDay>;

export const getReservationDay = async (
  id: string,
): Promise<ReservationDay | undefined> => {
  const snapshot = await getDoc(reservationDoc(id));
  return snapshot.exists() ? (snapshot.data() as ReservationDay) : undefined;
};

export const subscribeReservationDay = (
  id: string,
  cb: (reservation: ReservationDay | undefined) => void,
): Unsubscribe =>
  onSnapshot(reservationDoc(id), (snapshot) => {
    cb(snapshot.exists() ? (snapshot.data() as ReservationDay) : undefined);
  });

export const listReservationDaysInRange = async (
  startDate: string,
  endDate: string,
): Promise<ReservationDayRecord[]> => {
  const snapshot = await getDocs(reservationRangeQuery(startDate, endDate));
  return snapshot.docs
    .map((docSnapshot) =>
      toReservationDayRecord(docSnapshot.id, docSnapshot.data() as ReservationDay),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
};

export const subscribeReservationDaysInRange = (
  startDate: string,
  endDate: string,
  cb: (reservations: ReservationDayRecord[]) => void,
): Unsubscribe =>
  onSnapshot(reservationRangeQuery(startDate, endDate), (snapshot) => {
    const reservations = snapshot.docs
      .map((docSnapshot) =>
        toReservationDayRecord(docSnapshot.id, docSnapshot.data() as ReservationDay),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    cb(reservations);
  });

export const createReservationDay = async ({
  date,
  gymName,
  slots,
  confirmed,
  lastUpdatedBy,
  updatedAt,
  fixed,
}: ReservationDayUpdate): Promise<string> => {
  const normalizedSlots = normalizeReservationSlots(slots);

  const payload: ReservationDay = {
    date,
    gymName,
    slots: normalizedSlots,
    confirmed,
    lastUpdatedBy,
    updatedAt: updatedAt ?? new Date().toISOString(),
    fixed: fixed ?? false,
  };

  const id = generateReservationDocumentId();
  await setDoc(reservationDoc(id), payload);
  return id;
};

export const updateReservationDay = async (
  id: string,
  { date, gymName, slots, confirmed, lastUpdatedBy, updatedAt, fixed }: ReservationDayUpdate,
) => {
  const normalizedSlots = normalizeReservationSlots(slots);

  const payload: ReservationDay = {
    date,
    gymName,
    slots: normalizedSlots,
    confirmed,
    lastUpdatedBy,
    updatedAt: updatedAt ?? new Date().toISOString(),
    fixed: fixed ?? false,
  };

  await setDoc(reservationDoc(id), payload, { merge: true });
};

export const deleteReservationDay = async (id: string): Promise<void> => {
  await deleteDoc(reservationDoc(id));
};
