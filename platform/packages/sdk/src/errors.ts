export type ErrorCode =
  | 'unsupported'
  | 'invalid-value'
  | 'busy'
  | 'cancelled'
  | 'connection-lost'
  | 'timeout'
  | 'queue-full'
  | 'callback-failed'
  | 'incompatible-version';

/** Stable code and operation; applications never need to parse the message. */
export class OrbitError extends Error {
  readonly name = 'OrbitError';
  constructor(
    readonly code: ErrorCode,
    readonly operation: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

export function invalid(operation: string, message: string): never {
  throw new OrbitError('invalid-value', operation, message);
}
export function finite(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalid(name, `${name} must be a finite number from ${min} to ${max}.`);
  return value as number;
}
export function integer(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  const result = finite(value, min, max, name);
  if (!Number.isInteger(result)) invalid(name, `${name} must be an integer.`);
  return result;
}
export function object(
  value: unknown,
  operation = 'validate',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(operation, 'Expected an object.');
  return value as Record<string, unknown>;
}
export function asError(error: unknown, operation: string): OrbitError {
  return error instanceof OrbitError
    ? error
    : new OrbitError(
        'callback-failed',
        operation,
        error instanceof Error ? error.message : String(error),
      );
}
export function aborted(
  signal: AbortSignal | undefined,
  operation: string,
): void {
  if (signal?.aborted)
    throw new OrbitError('cancelled', operation, `${operation} was canceled.`);
}
export function rejectAsync(value: unknown, operation: string): void {
  if (
    value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  ) {
    // Observe a rejected async callback as well; never leak an unhandled rejection.
    Promise.resolve(value).catch(() => {});
    throw new OrbitError(
      'invalid-value',
      operation,
      'This callback must be synchronous. Start asynchronous work outside drawing and catch its result.',
    );
  }
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void,
    reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  // Remains rejectable/awaitable by callers, without global unhandled-rejection noise.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
