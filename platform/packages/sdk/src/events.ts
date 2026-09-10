import { asError, rejectAsync, type OrbitError } from './errors.js';
export interface Subscription {
  readonly active: boolean;
  unsubscribe(): void;
}

export class Events<T extends object> {
  private listeners = new Map<keyof T, Set<(event: never) => unknown>>();
  constructor(
    private readonly onError: (error: OrbitError) => void = () => {},
  ) {}
  on<K extends keyof T>(name: K, handler: (event: T[K]) => void): Subscription {
    if (typeof handler !== 'function')
      throw new TypeError('Event handler must be a function.');
    const listeners = this.listeners.get(name) ?? new Set();
    this.listeners.set(name, listeners);
    const callback = handler as (event: never) => unknown;
    listeners.add(callback);
    return {
      get active() {
        return listeners.has(callback);
      },
      unsubscribe() {
        listeners.delete(callback);
      },
    };
  }
  emit<K extends keyof T>(name: K, event: T[K]): void {
    const listeners = this.listeners.get(name);
    if (!listeners) return;
    // Listeners registered during a callback start with the next event.
    const snapshot = [...listeners];
    for (const callback of snapshot) {
      if (!listeners.has(callback)) continue;
      try {
        rejectAsync(callback(event as never), `event.${String(name)}`);
      } catch (error) {
        this.onError(asError(error, `event.${String(name)}`));
      }
    }
  }
  clear(): void {
    for (const listeners of this.listeners.values()) listeners.clear();
    this.listeners.clear();
  }
}
