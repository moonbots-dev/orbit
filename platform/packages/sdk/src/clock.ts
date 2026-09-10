import { finite, invalid } from './errors.js';
export interface Timer {
  cancel(): void;
}
export interface Clock {
  now(): number;
  after(delayMs: number, callback: () => void): Timer;
}
export interface ManualClock extends Clock {
  advanceBy(deltaMs: number): void;
}

/** No timers are created until after() is explicitly called. */
export const realtimeClock: Clock = {
  now: () => performance.now(),
  after(delayMs, callback) {
    finite(delayMs, 0, 2_147_483_647, 'delayMs');
    const id = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};

/** Stable timestamp then registration ordering; bounded work per advancement. */
export function createManualClock({
  startMs = 0,
}: { startMs?: number } = {}): ManualClock {
  let time = finite(startMs, 0, Number.MAX_SAFE_INTEGER, 'startMs'),
    sequence = 0,
    advancing = false;
  const work = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    after(delayMs, callback) {
      finite(delayMs, 0, 2_147_483_647, 'delayMs');
      if (work.size >= 10_000)
        invalid('clock.after', 'Too many pending timers.');
      const id = ++sequence;
      work.set(id, { at: time + delayMs, callback });
      return {
        cancel: () => {
          work.delete(id);
        },
      };
    },
    advanceBy(deltaMs) {
      finite(deltaMs, 0, 86_400_000, 'deltaMs');
      if (advancing)
        invalid(
          'clock.advanceBy',
          'Recursive clock advancement is not allowed.',
        );
      const end = time + deltaMs;
      advancing = true;
      try {
        let count = 0;
        for (;;) {
          let next: [number, { at: number; callback: () => void }] | undefined;
          for (const entry of work)
            if (entry[1].at <= end && (!next || entry[1].at < next[1].at))
              next = entry;
          if (!next) break;
          if (++count > 100_000)
            invalid(
              'clock.advanceBy',
              'Timer work exceeded the advancement budget.',
            );
          work.delete(next[0]);
          time = next[1].at;
          next[1].callback();
        }
        time = end;
      } finally {
        advancing = false;
      }
    },
  };
}
