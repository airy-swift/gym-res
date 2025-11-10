import {
  collection,
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
};

export type ReservationSlots = Record<ReservationSlotId, ReservationSlotEntry[]>;

export type ReservationDay = {
  date: string;
  slots: ReservationSlots;
  confirmed: boolean;
  lastUpdatedBy: string | null;
  updatedAt: string;
};

export type ReservationDayUpdate = Omit<ReservationDay, 'updatedAt'> & {
  updatedAt?: string;
};

const reservationsCollection = () =>
  collection(getFirestoreDb(), RESERVATIONS_COLLECTION);

const reservationRangeQuery = (
  startDate: string,
  endDate: string,
): Query<ReservationDay> =>
  query(
    reservationsCollection(),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ) as Query<ReservationDay>;

export const reservationDoc = (date: string): DocumentReference<ReservationDay> =>
  doc(reservationsCollection(), date) as DocumentReference<ReservationDay>;

export const getReservationDay = async (
  date: string,
): Promise<ReservationDay | undefined> => {
  const snapshot = await getDoc(reservationDoc(date));
  return snapshot.exists() ? (snapshot.data() as ReservationDay) : undefined;
};

export const subscribeReservationDay = (
  date: string,
  cb: (reservation: ReservationDay | undefined) => void,
): Unsubscribe =>
  onSnapshot(reservationDoc(date), (snapshot) => {
    cb(snapshot.exists() ? (snapshot.data() as ReservationDay) : undefined);
  });

export const listReservationDaysInRange = async (
  startDate: string,
  endDate: string,
): Promise<ReservationDay[]> => {
  const snapshot = await getDocs(reservationRangeQuery(startDate, endDate));
  return snapshot.docs
    .map((docSnapshot) => docSnapshot.data() as ReservationDay)
    .sort((a, b) => a.date.localeCompare(b.date));
};

export const subscribeReservationDaysInRange = (
  startDate: string,
  endDate: string,
  cb: (reservations: ReservationDay[]) => void,
): Unsubscribe =>
  onSnapshot(reservationRangeQuery(startDate, endDate), (snapshot) => {
    const reservations = snapshot.docs
      .map((docSnapshot) => docSnapshot.data() as ReservationDay)
      .sort((a, b) => a.date.localeCompare(b.date));
    cb(reservations);
  });

export const saveReservationDay = async ({
  date,
  slots,
  confirmed,
  lastUpdatedBy,
  updatedAt,
}: ReservationDayUpdate) => {
  const payload: ReservationDay = {
    date,
    slots,
    confirmed,
    lastUpdatedBy,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };

  await setDoc(reservationDoc(date), payload, { merge: true });
};

