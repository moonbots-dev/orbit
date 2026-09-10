import { SerialConnection, listSerialPorts } from './serial.js';
import {
  OrbitError,
  type AdapterSession,
  type Capabilities,
  type DeviceAdapter,
  type DeviceInfo,
  type FrameOptions,
  type FrameResult,
  type InputEvent,
  type Scene,
  type ScreenEvent,
  type Subscription,
} from '@orbit/sdk';
import { encodeFrame, FrameDecoder, crc32 } from '@orbit/sdk/serial-protocol';
import {
  compileVectorScene,
  vectorTransaction,
  type VectorScene,
} from './vector.js';

export interface ESP32Options {
  /** Explicit serial path. Opening a port never flashes firmware. */
  port: string;
  baudRate?: number;
  signal?: AbortSignal;
}
export interface DeviceStatistics {
  bootId: string;
  deviceTimeUs: number;
  framesApplied: number;
  lastFrameId: number;
  frameCRC: number;
  lcdTransferUs: number;
  renderUs: number;
  clearUs: number;
  drawUs: number;
  convertUs: number;
  sceneCRC: number;
  vectorBytes: number;
  changedPixels: number;
  wireErrors: number;
  sensorErrors: number;
  droppedInputs: number;
  imuSamples: number;
  touchEvents: number;
  imuHz: number;
  touchHz: number;
  brightness: number;
}
interface Hello {
  id: string;
  bootId: string;
  firmware: string;
  width: number;
  height: number;
  baud: number;
  touchId: number;
  imuId: number;
  psramBytes: number;
  displayReady: boolean;
  renderer: string;
  imuHz: number;
  touchHz: number;
  brightness: number;
}

class Channel<T> {
  private callbacks = new Set<(value: T) => void>();
  on(callback: (value: T) => void): Subscription {
    this.callbacks.add(callback);
    const callbacks = this.callbacks;
    return {
      get active() {
        return callbacks.has(callback);
      },
      unsubscribe: () => {
        callbacks.delete(callback);
      },
    };
  }
  emit(value: T) {
    const current = [...this.callbacks];
    for (const cb of current) if (this.callbacks.has(cb)) cb(value);
  }
  clear() {
    this.callbacks.clear();
  }
}
const clock = {
  now: () => performance.now(),
  after(delayMs: number, callback: () => void) {
    const id = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};
const checkSignal = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw new OrbitError('cancelled', 'esp32', 'Operation canceled.');
};
const words = (...values: number[]) => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  return bytes;
};

/** Open one shared physical connection; sessions on target negotiate screen control. */
export async function openESP32(options: ESP32Options) {
  checkSignal(options.signal);
  if (!options.port || typeof options.port !== 'string')
    throw new OrbitError(
      'invalid-value',
      'esp32.open',
      'Choose a serial port explicitly.',
    );
  const serial = new SerialConnection({
    path: options.port,
    baudRate: options.baudRate ?? 921600,
  });
  const decoder = new FrameDecoder();
  const inputs = new Channel<InputEvent>(),
    frames = new Channel<ScreenEvent>();
  type Session = {
    control: boolean;
    closed: boolean;
    abort: AbortController;
    tasks: Set<Promise<unknown>>;
    subscriptions: Subscription[];
    disconnect: Channel<string>;
  };
  const sessions = new Set<Session>();
  let closed = false,
    closing: Promise<void> | undefined,
    requestId = 0,
    wireFrameId = 0,
    lastHeard = performance.now();
  let handshake: Hello | undefined,
    statistics: DeviceStatistics | undefined,
    currentFrame: ScreenEvent | null = null;
  let rendering = false;
  // oxlint-disable-next-line prefer-const -- close() also runs before handshake initialization.
  let timer: ReturnType<typeof setInterval> | undefined; // Initialized after a successful handshake; close also runs during setup.
  const pending = new Map<
    number,
    {
      resolve(value: Record<string, unknown>): void;
      reject(error: unknown): void;
      cleanup(): void;
    }
  >();
  let writes = Promise.resolve();
  let appliedVector: { id: number; scene: VectorScene } | undefined;

  function fail(error: unknown): void {
    if (closed) return;
    const e = error instanceof Error ? error : new Error(String(error));
    void close(e.message);
  }
  serial.on('error', fail);
  serial.on('close', () => {
    if (!closed)
      fail(
        new OrbitError(
          'connection-lost',
          'esp32',
          'USB serial connection closed.',
        ),
      );
  });
  serial.on('data', (bytes: Buffer) => {
    try {
      for (const packet of decoder.push(bytes)) {
        const value = JSON.parse(new TextDecoder().decode(packet.payload));
        if (!value || typeof value !== 'object') continue;
        lastHeard = performance.now();
        if (handshake && value.bootId && value.bootId !== handshake.bootId) {
          fail(
            new OrbitError(
              'connection-lost',
              'esp32',
              'ESP32 restarted; reconnect to its new boot.',
            ),
          );
          return;
        }
        if (packet.kind === 0x90)
          inputs.emit({
            ...value,
            source: 'physical',
            receivedTimeMs: performance.now(),
          } as InputEvent);
        else if (packet.kind === 0x91) statistics = value as DeviceStatistics;
        else if (packet.kind === 0x81 || packet.kind === 0x82) {
          const request = pending.get(packet.seq);
          if (!request) continue;
          pending.delete(packet.seq);
          request.cleanup();
          if (value.ok !== true)
            request.reject(
              new OrbitError(
                'invalid-value',
                'esp32.command',
                `Firmware rejected command: ${String(value.code)}`,
              ),
            );
          else request.resolve(value);
        }
      }
    } catch (error) {
      fail(error);
    }
  });

  function rpc(
    kind: number,
    payload: Uint8Array = new Uint8Array(),
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    checkSignal(signal);
    if (closed)
      return Promise.reject(
        new OrbitError('connection-lost', 'esp32', 'USB connection is closed.'),
      );
    if (pending.size >= 16)
      return Promise.reject(
        new OrbitError('queue-full', 'esp32', 'Serial command queue is full.'),
      );
    const seq = ++requestId,
      bytes = encodeFrame({ kind, seq, payload });
    const started = performance.now();
    if (process.env.ORBIT_DEBUG_USB)
      console.log('usb send', seq, kind, bytes.length);
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const cancel = (code: 'timeout' | 'cancelled') => {
        const item = pending.get(seq);
        if (!item) return;
        pending.delete(seq);
        item.cleanup();
        reject(
          new OrbitError(
            code,
            'esp32.command',
            `Serial command ${kind} ${code}.`,
          ),
        );
      };
      const abort = () => cancel('cancelled');
      const timeout = setTimeout(() => cancel('timeout'), 2000);
      pending.set(seq, {
        resolve,
        reject,
        cleanup() {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      writes = writes
        .then(async () => {
          if (!pending.has(seq)) return;
          // One bounded packet per helper request; native writes are paced there.
          await new Promise<void>((done, fail) =>
            serial.write(bytes, (error) => (error ? fail(error) : done())),
          );
        })
        .catch((error) => {
          const item = pending.get(seq);
          if (item) {
            pending.delete(seq);
            item.cleanup();
            item.reject(error);
          }
        });
    });
    return result.finally(() => {
      if (process.env.ORBIT_DEBUG_USB)
        console.log(
          'usb done',
          seq,
          kind,
          Math.round(performance.now() - started),
          'ms',
        );
    });
  }

  function close(reason = 'USB adapter closed'): Promise<void> {
    if (closing) return closing;
    closed = true;
    clearInterval(timer);
    options.signal?.removeEventListener('abort', lifetimeAbort);
    for (const item of pending.values()) {
      item.cleanup();
      item.reject(new OrbitError('connection-lost', 'esp32', reason));
    }
    pending.clear();
    const current = [...sessions];
    for (const session of current) {
      session.abort.abort();
      session.disconnect.emit(reason);
      session.disconnect.clear();
      for (const sub of session.subscriptions) sub.unsubscribe();
    }
    sessions.clear();
    inputs.clear();
    frames.clear();
    appliedVector = undefined;
    closing = writes.then(
      () =>
        new Promise<void>((resolve) => {
          serial.close(() => resolve());
        }),
    );
    return closing;
  }
  const lifetimeAbort = () => {
    void close('USB adapter aborted');
  };
  options.signal?.addEventListener('abort', lifetimeAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) =>
      serial.open((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      serial.set({ dtr: false, rts: false }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    // CH343 control-line changes can restart the board. Retry HELLO after boot;
    // a request sent while the ROM owns UART will not reach the application.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        handshake = (await rpc(
          1,
          undefined,
          options.signal,
        )) as unknown as Hello;
        break;
      } catch (error) {
        if (
          !(error instanceof OrbitError) ||
          error.code !== 'timeout' ||
          attempt === 2
        )
          throw error;
      }
    }
    if (!handshake) throw new Error('ESP32 did not finish booting.');
    if (
      !handshake.displayReady ||
      handshake.width !== 240 ||
      handshake.height !== 240 ||
      !handshake.touchId ||
      handshake.firmware !== 'orbit-usb-1.1.0' ||
      handshake.renderer !== 'vector-v1' ||
      typeof handshake.bootId !== 'string' ||
      typeof handshake.id !== 'string'
    )
      throw new OrbitError(
        'incompatible-version',
        'esp32.open',
        'Expected orbit-usb-1.1.0 with the vector-v1 renderer and a working 240px touchscreen. Firmware installation is a separate step.',
      );
  } catch (error) {
    await close('USB setup failed');
    throw error;
  }
  const info: DeviceInfo = Object.freeze({
    id: handshake.id,
    model: 'Waveshare ESP32-S3-Touch-LCD-1.28',
    source: 'physical',
    bootId: handshake.bootId,
    protocolVersion: '1',
    firmwareVersion: handshake.firmware,
  });
  const capabilities: Capabilities = {
    profile: 'waveshare-s3-touch-240-usb-v1',
    viewport: { width: 240, height: 240 },
    screen: {
      shape: 'circle',
      physicalSize: { width: 240, height: 240 },
      operations: [
        'circle',
        'ellipse',
        'rect',
        'line',
        'path',
        'pixels',
        'transform',
        'clip',
        'opacity',
      ],
      maxFrameBytes: 1_048_576,
      maxPrimitives: 1024,
      maxPathSegments: 2048,
      maxQueuedFrames: 2,
      acknowledgements: ['accepted', 'applied', 'presentation-submitted'],
    },
    touch: { maxContacts: 1 },
    imu: {
      present: handshake.imuId === 5,
      accelerationUnit: 'm/s²',
      angularVelocityUnit: 'rad/s',
      axes: 'QMI8658 sensor-native XYZ; orientation relative to screen is not calibrated',
    },
    buttons: ['boot'],
    switches: [],
    audio: false,
    hid: false,
    physicalTransport: true,
  };

  async function present(
    session: Session,
    scene: Scene,
    frameId: number,
    opts: FrameOptions = {},
  ): Promise<FrameResult> {
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, session.abort.signal])
      : session.abort.signal;
    checkSignal(signal);
    if (closed || session.closed)
      throw new OrbitError(
        'connection-lost',
        'esp32.present',
        'Session is closed.',
      );
    if (!session.control || rendering)
      throw new OrbitError(
        'busy',
        'esp32.present',
        'Screen is already controlled or presenting another frame.',
      );
    const acknowledgement = opts.acknowledgement ?? 'accepted';
    if (!capabilities.screen.acknowledgements.includes(acknowledgement))
      throw new OrbitError(
        'unsupported',
        'esp32.present',
        'Unsupported acknowledgement.',
      );
    rendering = true;
    const id = ++wireFrameId;
    try {
      const started = performance.now();
      const immutable = structuredClone(scene);
      const vector = compileVectorScene(immutable);
      const payload = vectorTransaction(id, vector, appliedVector);
      const compiled = performance.now();
      // A lost reply may still mean the board applied the update. Never reuse an uncertain base.
      appliedVector = undefined;
      let applied: DeviceStatistics;
      if (payload.length <= 4096) {
        applied = (await rpc(
          8,
          payload,
          signal,
        )) as unknown as DeviceStatistics;
      } else {
        await rpc(9, words(id, payload.length, crc32(payload)), signal);
        for (let offset = 0; offset < payload.length; offset += 2048) {
          checkSignal(signal);
          const part = payload.subarray(offset, offset + 2048);
          const chunk = new Uint8Array(8 + part.length);
          chunk.set(words(id, offset));
          chunk.set(part, 8);
          await rpc(10, chunk, signal);
        }
        applied = (await rpc(
          11,
          words(id),
          signal,
        )) as unknown as DeviceStatistics;
      }
      if (applied.lastFrameId !== id || applied.sceneCRC !== vector.crc)
        throw new OrbitError(
          'invalid-value',
          'esp32.present',
          'Drawing acknowledgement does not match the submitted scene.',
        );
      appliedVector = { id, scene: vector };
      statistics = applied;
      if (process.env.ORBIT_PROFILE_USB)
        console.log(
          JSON.stringify({
            type: 'usb-frame-timing',
            renderer: 'vector-v1',
            bytes: payload.length,
            sceneBytes: vector.byteLength,
            compileMs: compiled - started,
            renderMs: applied.renderUs / 1000,
            clearMs: applied.clearUs / 1000,
            drawMs: applied.drawUs / 1000,
            convertMs: applied.convertUs / 1000,
            lcdMs: applied.lcdTransferUs / 1000,
            totalMs: performance.now() - started,
          }),
        );
      currentFrame = {
        scene: immutable,
        frameId,
        hostTimeMs: performance.now(),
      };
      frames.emit(currentFrame);
      return {
        status: 'acknowledged',
        frameId,
        acknowledgement,
        hostTimeMs: currentFrame.hostTimeMs,
        deviceTimeUs: applied.deviceTimeUs,
      };
    } catch (error) {
      if (!closed) await rpc(5, words(id)).catch(() => {});
      throw error;
    } finally {
      rendering = false;
    }
  }
  const target: DeviceAdapter = {
    kind: 'orbit-adapter',
    async open(opts): Promise<AdapterSession> {
      checkSignal(opts.signal);
      if (closed)
        throw new OrbitError(
          'connection-lost',
          'esp32.open',
          'USB adapter is closed.',
        );
      const control = opts.control.includes('screen');
      if (control && [...sessions].some((s) => s.control))
        throw new OrbitError(
          'busy',
          'esp32.open',
          'Another program controls this physical screen.',
        );
      const session: Session = {
        control,
        closed: false,
        abort: new AbortController(),
        tasks: new Set(),
        subscriptions: [],
        disconnect: new Channel(),
      };
      sessions.add(session);
      const own = (subscription: Subscription) => {
        session.subscriptions.push(subscription);
        return subscription;
      };
      return {
        info,
        capabilities,
        clock,
        onInput: (cb) => own(inputs.on(cb)),
        onFrame: (cb) => own(frames.on(cb)),
        onDisconnect: (cb) => own(session.disconnect.on(cb)),
        present(scene, id, options) {
          const task = present(session, scene, id, options);
          session.tasks.add(task);
          void task.finally(() => session.tasks.delete(task)).catch(() => {});
          return task;
        },
        async close() {
          if (session.closed) return;
          session.closed = true;
          session.abort.abort();
          for (const sub of session.subscriptions) sub.unsubscribe();
          session.disconnect.clear();
          await Promise.allSettled(session.tasks);
          sessions.delete(session);
        },
      };
    },
  };
  timer = setInterval(() => {
    if (performance.now() - lastHeard > 4000) {
      fail(new Error('ESP32 heartbeat timed out.'));
      return;
    }
    void rpc(7)
      .then((value) => {
        statistics = value as unknown as DeviceStatistics;
      })
      .catch(fail);
  }, 1000);
  return {
    target,
    info,
    capabilities,
    clock,
    on: (_: 'frame', callback: (event: ScreenEvent) => void) =>
      frames.on(callback),
    snapshot: () =>
      structuredClone({
        info,
        capabilities,
        scene: currentFrame?.scene ?? null,
        lastFrame: currentFrame,
        statistics,
        decoderErrors: decoder.errors,
      }),
    statistics: async () => {
      statistics = (await rpc(7)) as unknown as DeviceStatistics;
      return { ...statistics, decoderErrors: decoder.errors };
    },
    async configure(options: {
      imuHz?: number;
      touchHz?: number;
      brightness?: number;
    }) {
      const previous = statistics ?? handshake!;
      const imuHz = options.imuHz ?? previous.imuHz,
        touchHz = options.touchHz ?? previous.touchHz,
        brightness = options.brightness ?? previous.brightness;
      if (
        !Number.isInteger(imuHz) ||
        imuHz < 0 ||
        imuHz > 100 ||
        !Number.isInteger(touchHz) ||
        touchHz < 10 ||
        touchHz > 120 ||
        !Number.isInteger(brightness) ||
        brightness < 0 ||
        brightness > 255
      )
        throw new OrbitError(
          'invalid-value',
          'esp32.configure',
          'Use imuHz 0–100, touchHz 10–120, and brightness 0–255.',
        );
      const payload = new Uint8Array(5),
        view = new DataView(payload.buffer);
      view.setUint16(0, imuHz, true);
      view.setUint16(2, touchHz, true);
      payload[4] = brightness;
      const result = await rpc(6, payload);
      statistics = undefined;
      handshake = result as unknown as Hello;
      return { imuHz, touchHz, brightness };
    },
    close: () => close(),
  };
}
export type ESP32Device = Awaited<ReturnType<typeof openESP32>>;
export async function listESP32Ports() {
  return (await listSerialPorts())
    .filter(
      (p) =>
        p.vendorId?.toLowerCase() === '1a86' &&
        p.productId?.toLowerCase() === '55d3',
    )
    .map((p) => ({
      port: p.path.replace('/dev/tty.', '/dev/cu.'),
      serialNumber: p.serialNumber,
    }));
}
