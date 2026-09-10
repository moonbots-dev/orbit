import type {
  AdapterSession,
  DeviceAdapter,
  DeviceInfo,
  DiscoverOptions,
  FrameResult,
  HostOptions,
  InputEvent,
  ScreenEvent,
} from './types.js';
import { Events } from './events.js';
import { realtimeClock } from './clock.js';
import { aborted, asError, deferred, invalid, OrbitError } from './errors.js';
import { decodeMessage, type WireMessage } from './protocol.js';
import { deepFreeze } from './scene.js';
import { validateCapabilities, validateDeviceInfo } from './capabilities.js';
import { withDeadline } from './operation.js';

function endpoint(host: HostOptions): URL {
  const url = new URL(host.endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalid(
      'host.endpoint',
      'Use an HTTP(S) endpoint without embedded credentials or query parameters.',
    );
  if (
    url.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    invalid('host.endpoint', 'Plain HTTP is only supported on loopback.');
  return url;
}
export async function discover(
  options: DiscoverOptions,
): Promise<readonly DeviceInfo[]> {
  aborted(options.signal, 'discover');
  const url = new URL('/devices', endpoint(options.host));
  return withDeadline('discover', options, async (signal) => {
    const token = await options.host.credentials?.();
    aborted(signal, 'discover');
    const response = await fetch(url, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok)
      throw new OrbitError(
        'connection-lost',
        'discover',
        `Host rejected discovery (${response.status}).`,
      );
    const value = (await response.json()) as {
      version?: number;
      devices?: DeviceInfo[];
    };
    if (
      value.version !== 1 ||
      !Array.isArray(value.devices) ||
      value.devices.length > 128
    )
      invalid('discover', 'Invalid host device list.');
    return deepFreeze(value.devices.map(validateDeviceInfo));
  });
}

export function hostAdapter(
  host: HostOptions,
  deviceId: string,
): DeviceAdapter {
  return {
    kind: 'orbit-adapter',
    async open(options): Promise<AdapterSession> {
      aborted(options.signal, 'connect');
      const url = new URL('/session', endpoint(host));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = await host.credentials?.();
      aborted(options.signal, 'connect');
      const ready = deferred<AdapterSession>(),
        events = new Events<{
          input: InputEvent;
          frame: ScreenEvent;
          disconnect: string;
        }>();
      const pending = new Map<
        number,
        ReturnType<typeof deferred<FrameResult>>
      >();
      const socket = new WebSocket(url);
      let closed = false,
        connected = false;
      const timer = setTimeout(
        () =>
          fail(
            new OrbitError('timeout', 'connect', 'Host handshake timed out.'),
          ),
        options.timeoutMs ?? 5000,
      );
      const send = (message: WireMessage) => {
        if (socket.readyState !== WebSocket.OPEN)
          throw new OrbitError('connection-lost', 'host', 'Socket is closed.');
        socket.send(JSON.stringify(message));
      };
      const abort = () =>
        fail(new OrbitError('cancelled', 'connect', 'Connection canceled.'));
      function fail(error: OrbitError): void {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        ready.reject(error);
        for (const item of pending.values()) item.reject(error);
        pending.clear();
        if (connected) events.emit('disconnect', error.message);
        events.clear();
        socket.close();
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => {
        if (!closed)
          send({
            version: 1,
            kind: 'open',
            token,
            deviceId,
            control: options.control,
          });
      });
      socket.addEventListener('error', () =>
        fail(
          new OrbitError(
            'connection-lost',
            'connect',
            'Could not reach the Orbit host.',
          ),
        ),
      );
      socket.addEventListener('close', () =>
        fail(
          new OrbitError(
            'connection-lost',
            'connection',
            'Host connection closed.',
          ),
        ),
      );
      socket.addEventListener('message', (message) => {
        try {
          if (typeof message.data !== 'string')
            invalid('host', 'Expected JSON text.');
          const value = decodeMessage(message.data);
          if (value.kind === 'hello') {
            if (connected) invalid('host', 'Duplicate handshake.');
            const info = validateDeviceInfo(value.info),
              capabilities = validateCapabilities(value.capabilities);
            if (
              !info ||
              info.id !== deviceId ||
              info.protocolVersion !== '1' ||
              !capabilities?.screen ||
              !capabilities.viewport ||
              capabilities.screen.maxFrameBytes > 1_048_576
            )
              invalid('host', 'Invalid device capabilities.');
            connected = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            ready.resolve({
              info: deepFreeze(info),
              capabilities: deepFreeze(capabilities),
              clock: realtimeClock,
              onInput: (handler) => events.on('input', handler),
              onFrame: (handler) => events.on('frame', handler),
              onDisconnect: (handler) => events.on('disconnect', handler),
              present(scene, frameId, opts = {}) {
                aborted(opts.signal, 'present');
                if (closed)
                  return Promise.reject(
                    new OrbitError(
                      'connection-lost',
                      'present',
                      'Host is disconnected.',
                    ),
                  );
                const result = deferred<FrameResult>();
                pending.set(frameId, result);
                const cancel = () => {
                  pending.delete(frameId);
                  result.reject(
                    new OrbitError(
                      'cancelled',
                      'present',
                      'Presentation canceled.',
                    ),
                  );
                  if (!closed) send({ version: 1, kind: 'cancel', frameId });
                };
                opts.signal?.addEventListener('abort', cancel, { once: true });
                result.promise
                  .finally(() =>
                    opts.signal?.removeEventListener('abort', cancel),
                  )
                  .catch(() => {});
                try {
                  send({
                    version: 1,
                    kind: 'present',
                    frameId,
                    scene,
                    acknowledgement: opts.acknowledgement ?? 'accepted',
                  });
                } catch (error) {
                  pending.delete(frameId);
                  result.reject(error);
                }
                return result.promise;
              },
              async close() {
                if (closed) return;
                closed = true;
                for (const item of pending.values())
                  item.reject(
                    new OrbitError('cancelled', 'present', 'Session closed.'),
                  );
                pending.clear();
                events.clear();
                await new Promise<void>((resolve) => {
                  const timeout = setTimeout(resolve, 1500);
                  socket.addEventListener(
                    'close',
                    () => {
                      clearTimeout(timeout);
                      resolve();
                    },
                    { once: true },
                  );
                  socket.close(1000, 'Session closed');
                });
              },
            });
          } else if (value.kind === 'input' && connected)
            events.emit('input', value.event as InputEvent);
          else if (value.kind === 'frame' && connected)
            events.emit('frame', value.event as ScreenEvent);
          else if (value.kind === 'result') {
            const item = pending.get(value.frameId as number);
            pending.delete(value.frameId as number);
            item?.resolve(value.result as FrameResult);
          } else if (value.kind === 'error') {
            const error = new OrbitError(
              (value.code as OrbitError['code']) ?? 'invalid-value',
              'host',
              String(value.message),
            );
            if (typeof value.frameId === 'number') {
              pending.get(value.frameId)?.reject(error);
              pending.delete(value.frameId);
            } else fail(error);
          } else if (value.kind === 'ping') send({ version: 1, kind: 'pong' });
        } catch (error) {
          fail(asError(error, 'host'));
        }
      });
      return ready.promise;
    },
  };
}
