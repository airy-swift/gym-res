export type RepresentativeEntry = {
  gymName: string;
  room: string;
  date: string;
  time: string;
  accountName?: string;
  accountId?: string;
};

export type Job = {
  jobId: string;
  entryCount?: number;
};
