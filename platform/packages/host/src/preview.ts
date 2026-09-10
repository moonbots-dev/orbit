import { createHost } from './index.js';
import type { Simulator } from '@orbit/sdk/simulation';

/** Optional Bun developer tool. Opens no browser and acquires no screen control. */
export function createPreview(options: {
  simulator: Simulator;
  port?: number;
}) {
  const host = createHost({
    token: crypto.randomUUID(),
    simulator: options.simulator,
    port: options.port ?? 4402,
    preview: true,
  });
  return { url: host.endpoint, close: () => host.close() };
}
