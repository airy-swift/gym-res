export type RepresentativeEntry = {
  gymName: string;
  room: string;
  date: string;
  time: string;
};

export type Job = {
  jobId: string;
  entryCount?: number;
};

export const entriesAreEqual = (
  lhs: RepresentativeEntry,
  rhs: RepresentativeEntry,
): boolean => (
  lhs.gymName === rhs.gymName &&
  lhs.room === rhs.room &&
  lhs.date === rhs.date &&
  lhs.time === rhs.time
);

export class FixedQueue<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('capacity must be > 0');
    }
    this.buf = new Array(capacity);
  }

  enqueue(item: T) {
    // 次に入る位置（満杯なら head を上書き＝自動 dequeue）
    const idx = (this.head + this.size) % this.capacity;

    if (this.size === this.capacity) {
      // 満杯 → 最古を捨てる（head を1つ進める）
      this.buf[idx] = item;
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.buf[idx] = item;
      this.size++;
    }
  }

  dequeue(): T | undefined {
    if (this.size === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.size--;
    return item;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.size; i++) {
      out.push(this.buf[(this.head + i) % this.capacity]!);
    }
    return out;
  }

  get length() {
    return this.size;
  }
}
