import type { OperationOptions } from './types.js';
import { aborted, deferred, finite, OrbitError } from './errors.js';

/** A real-time deadline bounds setup, including caller-supplied async work. */
export async function withDeadline<T>(
  operation: string,
  options: OperationOptions,
  start: (signal: AbortSignal) => Promise<T>,
  disposeLate?: (value: T) => Promise<void>,
): Promise<T> {
  aborted(options.signal, operation);
  const timeoutMs = finite(
    options.timeoutMs ?? 5000,
    1,
    2_147_483_647,
    'timeoutMs',
  );
  const controller = new AbortController();
  const cancelled = deferred<never>();
  const cancel = (code: 'cancelled' | 'timeout') => {
    if (controller.signal.aborted) return;
    const error = new OrbitError(
      code,
      operation,
      `${operation} ${code === 'timeout' ? 'timed out' : 'was canceled'}.`,
    );
    cancelled.reject(error);
    controller.abort(error);
  };
  const abort = () => cancel('cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => cancel('timeout'), timeoutMs);
  const task = Promise.resolve().then(() => start(controller.signal));
  void task
    .then((value) => {
      if (controller.signal.aborted) return disposeLate?.(value);
    })
    .catch(() => {});
  try {
    return await Promise.race([task, cancelled.promise]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
