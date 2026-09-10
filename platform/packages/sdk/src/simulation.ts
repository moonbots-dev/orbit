import type {
  AdapterSession,
  Capabilities,
  DeviceAdapter,
  DeviceInfo,
  FrameResult,
  InputEvent,
  Point,
  Scene,
  ScreenEvent,
} from './types.js';
import type { Clock } from './clock.js';
import { realtimeClock } from './clock.js';
import { Events } from './events.js';
import {
  aborted,
  deferred,
  finite,
  integer,
  invalid,
  OrbitError,
} from './errors.js';
import { deepFreeze, validateScene } from './scene.js';
import { validateInput } from './input.js';
export { createManualClock } from './clock.js';
export type { Clock, ManualClock } from './clock.js';

export interface SimulationOptions {
  profile?:
    | 'puck-240-v1'
    | {
        id: string;
        width: number;
        height: number;
        shape: 'circle' | 'rectangle';
        maxContacts?: number;
      };
  seed?: number;
  clock?: Clock;
  /** Artificial presentation delay for backpressure tests. Default zero. */
  latencyMs?: number;
}

export function createSimulator(options: SimulationOptions = {}) {
  const profile = options.profile ?? 'puck-240-v1';
  if (typeof profile === 'string' && profile !== 'puck-240-v1')
    invalid('profile', 'Unknown simulation profile.');
  const p =
    typeof profile === 'string'
      ? {
          id: profile,
          width: 240,
          height: 240,
          shape: 'circle' as const,
          maxContacts: 1,
        }
      : profile;
  if (
    typeof p.id !== 'string' ||
    !p.id.length ||
    p.id.length > 100 ||
    !['circle', 'rectangle'].includes(p.shape)
  )
    invalid('profile', 'Invalid profile.');
  const size = {
    width: integer(p.width, 16, 2048, 'width'),
    height: integer(p.height, 16, 2048, 'height'),
  };
  if (p.shape === 'circle' && size.width !== size.height)
    invalid('profile', 'A circular viewport must be square.');
  const clock = options.clock ?? realtimeClock;
  const latency = finite(options.latencyMs ?? 0, 0, 60_000, 'latencyMs');
  const seed = integer(options.seed ?? 42, 0, 0xffffffff, 'seed');
  const capabilities: Capabilities = deepFreeze({
    profile: p.id,
    viewport: size,
    screen: {
      shape: p.shape,
      physicalSize: size,
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
      maxQueuedFrames: 8,
      acknowledgements: ['accepted', 'applied', 'presentation-submitted'],
    },
    touch: { maxContacts: integer(p.maxContacts ?? 1, 1, 10, 'maxContacts') },
    imu: {
      present: true,
      accelerationUnit: 'm/s²',
      angularVelocityUnit: 'rad/s',
      axes: 'x right, y down, z out of screen; right-hand angular velocity',
    },
    buttons: ['talk'],
    switches: ['mute'],
    audio: false,
    hid: false,
    physicalTransport: false,
  });
  let boot = 0,
    sequence = 0,
    closed = false,
    scene: Scene | null = null,
    lastFrame: ScreenEvent | null = null;
  const id = `sim-${crypto.randomUUID()}`;
  let info: DeviceInfo;
  const renewInfo = () => {
    info = deepFreeze({
      id,
      model: p.id,
      source: 'simulated',
      bootId: `${id}-${seed}-${boot++}`,
      protocolVersion: '1',
      firmwareVersion: null,
    });
  };
  renewInfo();
  const contacts = new Map<number, Point>(),
    held = new Set<string>();
  const switches = new Map<string, boolean>();
  const observers = new Events<{ input: InputEvent; frame: ScreenEvent }>();
  const sessions = new Set<{
    controlled: boolean;
    events: Events<{ disconnect: string }>;
    cancelPending: Set<() => void>;
    owned: Set<{ unsubscribe(): void }>;
  }>();
  const pendingInputs: InputEvent[] = [];
  let dispatching = false;
  const check = () => {
    if (closed)
      throw new OrbitError(
        'connection-lost',
        'simulation',
        'Simulator is closed.',
      );
  };
  const emit = (payload: object, commit?: (event: InputEvent) => void) => {
    check();
    const event = validateInput(
      {
        ...payload,
        sequence: sequence + 1,
        bootId: info.bootId,
        source: 'simulated',
        deviceTimeUs: Math.round(clock.now() * 1000),
        receivedTimeMs: clock.now(),
      },
      capabilities,
    );
    sequence++;
    commit?.(event);
    pendingInputs.push(event);
    // Reentrant input handlers may inject another observation. Every observer
    // must receive the original event before the newly injected event.
    if (!dispatching) {
      dispatching = true;
      try {
        while (pendingInputs.length)
          observers.emit('input', pendingInputs.shift()!);
      } finally {
        dispatching = false;
      }
    }
    return event;
  };
  const cancelInputs = () => {
    const previousContacts = [...contacts],
      previousButtons = [...held];
    contacts.clear();
    held.clear();
    for (const [contactId, position] of previousContacts)
      emit({
        type: 'touch',
        phase: 'cancel',
        contactId,
        position,
        reason: 'device-cancelled',
      });
    for (const id of previousButtons)
      emit({ type: 'button', id, phase: 'cancel' });
  };
  const disconnect = (reason = 'Simulated connection loss') => {
    if (closed) return;
    cancelInputs();
    emit({ type: 'discontinuity', reason: 'disconnected' });
    const existingSessions = [...sessions];
    for (const session of existingSessions) {
      for (const cancel of session.cancelPending) cancel();
      session.events.emit('disconnect', reason);
      session.events.clear();
      for (const sub of session.owned) sub.unsubscribe();
      session.owned.clear();
    }
    sessions.clear();
  };
  const target: DeviceAdapter = {
    kind: 'orbit-adapter',
    async open(options): Promise<AdapterSession> {
      check();
      aborted(options.signal, 'connect');
      const controlled = options.control.includes('screen');
      if (controlled && [...sessions].some((s) => s.controlled))
        throw new OrbitError(
          'busy',
          'connect',
          'This screen is controlled by another session.',
        );
      const owned = new Set<{ unsubscribe(): void }>();
      const session = {
        controlled,
        events: new Events<{ disconnect: string }>(),
        cancelPending: new Set<() => void>(),
        owned,
      };
      sessions.add(session);
      const own = <T extends { unsubscribe(): void }>(s: T): T => {
        owned.add(s);
        return s;
      };
      return {
        info,
        capabilities,
        clock,
        onInput: (handler) => own(observers.on('input', handler)),
        onFrame: (handler) => own(observers.on('frame', handler)),
        onDisconnect: (handler) => session.events.on('disconnect', handler),
        present(raw, frameId, opts = {}) {
          if (!sessions.has(session))
            return Promise.reject(
              new OrbitError(
                'connection-lost',
                'present',
                'Session is closed.',
              ),
            );
          if (!controlled)
            return Promise.reject(
              new OrbitError(
                'busy',
                'present',
                'Connect with control: ["screen"] to draw.',
              ),
            );
          aborted(opts.signal, 'present');
          const validated = validateScene(raw, size, capabilities.screen);
          const acknowledgement = opts.acknowledgement ?? 'accepted';
          if (!capabilities.screen.acknowledgements.includes(acknowledgement))
            throw new OrbitError(
              'unsupported',
              'present',
              'Unsupported acknowledgement.',
            );
          const pending = deferred<FrameResult>();
          let timer: { cancel(): void } | undefined;
          const cleanup = () => {
            timer?.cancel();
            session.cancelPending.delete(cancel);
            opts.signal?.removeEventListener('abort', cancel);
          };
          const cancel = () => {
            cleanup();
            pending.reject(
              new OrbitError('cancelled', 'present', 'Presentation canceled.'),
            );
          };
          const apply = () => {
            cleanup();
            if (!sessions.has(session)) {
              pending.reject(
                new OrbitError(
                  'connection-lost',
                  'present',
                  'Session is closed.',
                ),
              );
              return;
            }
            scene = validated;
            lastFrame = deepFreeze({ scene, frameId, hostTimeMs: clock.now() });
            observers.emit('frame', lastFrame);
            pending.resolve({
              status: 'acknowledged',
              frameId,
              acknowledgement,
              hostTimeMs: clock.now(),
              deviceTimeUs: Math.round(clock.now() * 1000),
            });
          };
          session.cancelPending.add(cancel);
          opts.signal?.addEventListener('abort', cancel, { once: true });
          if (latency) timer = clock.after(latency, apply);
          else apply();
          return pending.promise;
        },
        async close() {
          sessions.delete(session);
          const pending = [...session.cancelPending];
          for (const cancel of pending) cancel();
          for (const sub of owned) sub.unsubscribe();
          owned.clear();
          session.events.clear();
        },
      };
    },
  };
  return {
    target,
    clock,
    capabilities,
    get info() {
      return info;
    },
    input: {
      touch(event: {
        phase: 'down' | 'move' | 'up' | 'cancel';
        contactId?: number;
        position?: Point;
      }) {
        check();
        const contactId = event.contactId ?? 0;
        if (event.phase === 'down' && contacts.has(contactId))
          invalid('touch', 'Contact is already down.');
        if (event.phase !== 'down' && !contacts.has(contactId))
          invalid('touch', 'Contact must be down before movement or release.');
        const position = event.position ?? contacts.get(contactId);
        emit(
          {
            type: 'touch',
            ...event,
            contactId,
            position,
            ...(event.phase === 'cancel' ? { reason: 'device-cancelled' } : {}),
          },
          (result) => {
            if (
              result.type === 'touch' &&
              (result.phase === 'down' || result.phase === 'move')
            )
              contacts.set(contactId, result.position);
            else contacts.delete(contactId);
          },
        );
      },
      imu(event: {
        acceleration: readonly [number, number, number];
        angularVelocity: readonly [number, number, number];
      }) {
        emit({ type: 'imu', ...event });
      },
      button(event: { id: string; phase: 'down' | 'up' | 'cancel' }) {
        if (event.phase === 'down' && held.has(event.id)) return;
        if (event.phase !== 'down' && !held.has(event.id)) return;
        emit({ type: 'button', ...event }, () => {
          if (event.phase === 'down') held.add(event.id);
          else held.delete(event.id);
        });
      },
      switch(event: { id: string; value: boolean }) {
        emit({ type: 'switch', ...event }, () =>
          switches.set(event.id, event.value),
        );
      },
      cancel: cancelInputs,
    },
    on: (event: 'frame', handler: (event: ScreenEvent) => void) =>
      observers.on(event, handler),
    snapshot: () =>
      deepFreeze({
        info,
        capabilities,
        scene,
        lastFrame,
        contacts: [...contacts].map(([contactId, position]) => ({
          contactId,
          position,
        })),
        switches: Object.fromEntries(switches),
      }),
    disconnect: ({ reason }: { reason?: string } = {}) => disconnect(reason),
    reset() {
      check();
      disconnect('Simulator reset');
      sequence = 0;
      scene = null;
      lastFrame = null;
      switches.clear();
      renewInfo();
    },
    async close() {
      if (closed) return;
      disconnect('Simulator closed');
      closed = true;
      observers.clear();
    },
  };
}
export type Simulator = ReturnType<typeof createSimulator>;
