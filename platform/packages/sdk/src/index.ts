import type { ConnectOptions, DeviceAdapter, Orbit, Puck } from './types.js';
import { createSession } from './client.js';
import { createSimulator } from './simulation.js';
import { discover, hostAdapter } from './host-client.js';
import { aborted, finite, invalid } from './errors.js';
import { withDeadline } from './operation.js';
import { validateCapabilities, validateDeviceInfo } from './capabilities.js';
import { getRuntimeTarget } from './runtime.js';

async function connect(options: ConnectOptions): Promise<Puck> {
  aborted(options.signal, 'connect');
  finite(options.timeoutMs ?? 5000, 1, 2_147_483_647, 'timeoutMs');
  if (options.control?.some((value) => value !== 'screen'))
    invalid('connect.control', 'Only screen control is supported.');
  let target: DeviceAdapter;
  let owned: ReturnType<typeof createSimulator> | undefined;
  if (options.target === 'runtime') {
    target = getRuntimeTarget();
  } else if (options.target === 'simulator') {
    owned = createSimulator({ clock: options.clock });
    target = owned.target;
  } else if (
    options.target &&
    'kind' in options.target &&
    options.target.kind === 'orbit-adapter'
  )
    target = options.target;
  else if (options.target && 'host' in options.target)
    target = hostAdapter(options.target.host, options.target.deviceId);
  else
    return invalid(
      'connect.target',
      'Choose simulator, an adapter, or an explicit host/device ID.',
    );
  let adapter: Awaited<ReturnType<DeviceAdapter['open']>> | undefined;
  try {
    adapter = await withDeadline(
      'connect',
      options,
      (signal) =>
        target.open({
          control: options.control ?? [],
          signal,
          timeoutMs: options.timeoutMs,
        }),
      (late) => late.close(),
    );
    aborted(options.signal, 'connect');
    const connection = adapter;
    adapter = {
      info: validateDeviceInfo(connection.info),
      capabilities: validateCapabilities(connection.capabilities),
      clock: connection.clock,
      onInput: connection.onInput.bind(connection),
      onFrame: connection.onFrame.bind(connection),
      onDisconnect: connection.onDisconnect.bind(connection),
      present: connection.present.bind(connection),
      close: connection.close.bind(connection),
    };
    if (owned) {
      const close = adapter.close.bind(adapter);
      const simulator = owned;
      adapter = {
        ...adapter,
        close: async () => {
          await close();
          await simulator.close();
        },
      };
    }
    return createSession(adapter, options);
  } catch (error) {
    await adapter?.close();
    await owned?.close();
    throw error;
  }
}
const orbit: Orbit = Object.freeze({ connect, discover });
export default orbit;
export { OrbitError } from './errors.js';
export type * from './types.js';
