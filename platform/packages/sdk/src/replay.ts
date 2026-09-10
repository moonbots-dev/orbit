import type {
  Capabilities,
  DeviceAdapter,
  DeviceInfo,
  InputEvent,
  Puck,
} from './types.js';
import type { Clock } from './clock.js';
import { realtimeClock } from './clock.js';
import { Events } from './events.js';
import { finite, integer, invalid, object } from './errors.js';
import { deepFreeze } from './scene.js';
import { validateInput } from './input.js';
import { validateCapabilities, validateDeviceInfo } from './capabilities.js';
import { createSimulator } from './simulation.js';

export interface InputRecording {
  readonly version: 1;
  readonly kind: 'orbit-input-recording';
  readonly device: DeviceInfo;
  readonly capabilities: Capabilities;
  readonly durationMs: number;
  readonly stoppedBy: 'manual' | 'limit' | 'closed';
  readonly entries: readonly {
    readonly atMs: number;
    readonly event: InputEvent;
  }[];
}
export function recordInputs(
  puck: Puck,
  options: { maxBytes?: number; maxDurationMs?: number } = {},
) {
  if (
    puck.status !== 'connected' ||
    puck.touch.contacts.length ||
    puck.buttons.ids.some((id) => puck.buttons.get(id)?.phase === 'down')
  )
    invalid(
      'recordInputs',
      'Start recording on a connected device with no contacts or buttons held.',
    );
  const maxBytes = integer(
    options.maxBytes ?? 8_000_000,
    4096,
    8_000_000,
    'maxBytes',
  );
  const maxDurationMs = finite(
    options.maxDurationMs ?? 120_000,
    1,
    3_600_000,
    'maxDurationMs',
  );
  const at = puck.clock.now(),
    entries: { atMs: number; event: InputEvent }[] = [];
  const events = new Events<{
    limit: { reason: 'bytes' | 'duration' | 'entries' };
  }>();
  let result: InputRecording | undefined;
  let bytes =
    new TextEncoder().encode(
      JSON.stringify({ device: puck.info, capabilities: puck.capabilities }),
    ).length + 512;
  const stop = (reason: InputRecording['stoppedBy']) => {
    if (!result) {
      input.unsubscribe();
      disconnected.unsubscribe();
      timer.cancel();
      result = deepFreeze({
        version: 1,
        kind: 'orbit-input-recording',
        device: puck.info,
        capabilities: puck.capabilities,
        durationMs: Math.min(maxDurationMs, puck.clock.now() - at),
        stoppedBy: reason,
        entries: [...entries],
      });
    }
    return result;
  };
  const limit = (reason: 'bytes' | 'duration' | 'entries') => {
    stop('limit');
    events.emit('limit', { reason });
    events.clear();
  };
  const input = puck.inputs.on((event) => {
    const entry = { atMs: puck.clock.now() - at, event };
    const size = new TextEncoder().encode(JSON.stringify(entry)).length + 1;
    if (entries.length >= 100_000) {
      limit('entries');
      return;
    }
    if (bytes + size > maxBytes) {
      limit('bytes');
      return;
    }
    if (entry.atMs > maxDurationMs) {
      limit('duration');
      return;
    }
    bytes += size;
    entries.push(entry);
  });
  const disconnected = puck.on('disconnect', () => {
    stop('closed');
    events.clear();
  });
  const timer = puck.clock.after(maxDurationMs, () => limit('duration'));
  return {
    stop: () => {
      const record = stop('manual');
      events.clear();
      return record;
    },
    on: (
      _: 'limit',
      handler: (event: { reason: 'bytes' | 'duration' | 'entries' }) => void,
    ) => events.on('limit', handler),
    get active() {
      return !result;
    },
  };
}

export function parseRecording(text: string): InputRecording {
  if (new TextEncoder().encode(text).length > 8_000_000)
    invalid('recording', 'Recording exceeds 8 MB.');
  const r = object(JSON.parse(text), 'recording');
  if (
    r.version !== 1 ||
    r.kind !== 'orbit-input-recording' ||
    !['manual', 'limit', 'closed'].includes(r.stoppedBy as string)
  )
    invalid(
      'recording',
      'Incompatible recording format. Legacy lab recordings require their explicit lab-v1 reader.',
    );
  const capabilities = validateCapabilities(r.capabilities),
    device = validateDeviceInfo(r.device);
  const durationMs = finite(r.durationMs, 0, 3_600_000, 'durationMs');
  if (!Array.isArray(r.entries) || r.entries.length > 100_000)
    invalid('recording', 'Invalid entries.');
  let previous = 0;
  const last = new Map<string, { sequence: number; at: number }>();
  const entries = (r.entries as unknown[]).map((raw) => {
    const e = object(raw),
      atMs = finite(e.atMs, previous, durationMs, 'atMs');
    previous = atMs;
    const event = validateInput(e.event, capabilities),
      prior = last.get(event.bootId);
    if (
      prior &&
      (event.sequence <= prior.sequence || event.deviceTimeUs < prior.at)
    )
      invalid('recording', 'Out-of-order device observations.');
    last.set(event.bootId, {
      sequence: event.sequence,
      at: event.deviceTimeUs,
    });
    return { atMs, event };
  });
  return deepFreeze({
    version: 1,
    kind: 'orbit-input-recording',
    device,
    capabilities,
    durationMs,
    stoppedBy: r.stoppedBy as 'manual',
    entries,
  });
}
export function serializeRecording(recording: InputRecording): string {
  return JSON.stringify(parseRecording(JSON.stringify(recording)), null, 2);
}

/** Recorded input is read-only. Program output still goes to an isolated simulator. */
export function createReplay(
  raw: InputRecording,
  { clock = realtimeClock }: { clock?: Clock } = {},
) {
  const recording = parseRecording(JSON.stringify(raw));
  const simulator = createSimulator({
    clock,
    profile: {
      id: recording.capabilities.profile,
      ...recording.capabilities.viewport,
      shape: recording.capabilities.screen.shape,
      maxContacts: recording.capabilities.touch.maxContacts,
    },
  });
  const events = new Events<{ input: InputEvent }>();
  let state: 'paused' | 'playing' | 'ended' | 'closed' = 'paused',
    position = 0,
    started = 0,
    speed = 1,
    index = 0;
  let timer: { cancel(): void } | undefined,
    run = 0;
  const nowPosition = () =>
    state === 'playing'
      ? Math.min(
          recording.durationMs,
          position + (clock.now() - started) * speed,
        )
      : position;
  const target: DeviceAdapter = {
    kind: 'orbit-adapter',
    async open(options) {
      if (state === 'closed') invalid('replay', 'Replay is closed.');
      const session = await simulator.target.open(options);
      const subscriptions = new Set<{ unsubscribe(): void }>();
      return {
        ...session,
        info: { ...session.info, source: 'replay' },
        capabilities: {
          ...session.capabilities,
          imu: recording.capabilities.imu,
          touch: recording.capabilities.touch,
          buttons: recording.capabilities.buttons,
          switches: recording.capabilities.switches,
        },
        onInput(handler) {
          const s = events.on('input', handler);
          subscriptions.add(s);
          return s;
        },
        async close() {
          for (const s of subscriptions) s.unsubscribe();
          await session.close();
        },
      };
    },
  };
  const schedule = () => {
    if (state !== 'playing') return;
    const nextAt =
      index < recording.entries.length
        ? recording.entries[index].atMs
        : recording.durationMs;
    timer = clock.after(Math.max(0, (nextAt - nowPosition()) / speed), () => {
      if (state !== 'playing') return;
      const at = nowPosition();
      while (
        index < recording.entries.length &&
        recording.entries[index].atMs <= at + 1e-7
      ) {
        const entry = recording.entries[index++];
        events.emit(
          'input',
          deepFreeze({
            ...entry.event,
            source: 'replay',
            bootId: `replay-${run}-${entry.event.bootId}`,
            receivedTimeMs: clock.now(),
          }),
        );
      }
      if (index === recording.entries.length && at >= recording.durationMs) {
        position = recording.durationMs;
        state = 'ended';
      } else schedule();
    });
  };
  return {
    target,
    get state() {
      return state;
    },
    get positionMs() {
      return nowPosition();
    },
    durationMs: recording.durationMs,
    play(options: { speed?: number } = {}) {
      if (state === 'closed') invalid('replay', 'Replay is closed.');
      if (state === 'ended')
        invalid('replay', 'Restart and reconnect before replaying again.');
      position = nowPosition();
      timer?.cancel();
      speed = finite(options.speed ?? 1, 0.01, 100, 'speed');
      started = clock.now();
      state = 'playing';
      schedule();
    },
    pause() {
      if (state !== 'playing') return;
      position = nowPosition();
      state = 'paused';
      timer?.cancel();
    },
    restart() {
      if (state === 'closed') invalid('replay', 'Replay is closed.');
      timer?.cancel();
      simulator.reset();
      events.clear();
      state = 'paused';
      position = 0;
      index = 0;
      run++;
    },
    async close() {
      if (state === 'closed') return;
      timer?.cancel();
      state = 'closed';
      events.clear();
      await simulator.close();
    },
  };
}
