// Bun's rejects matchers are typed void; await still waits for runtime assertions.
/* oxlint-disable typescript/await-thenable */
import { expect, test } from 'bun:test';
import orbit, {
  type DeviceAdapter,
  type Frame,
  type InputEvent,
} from '@orbit/sdk';
import { createSimulator } from '@orbit/sdk/simulation';
import {
  createReplay,
  parseRecording,
  recordInputs,
  serializeRecording,
} from '@orbit/sdk/replay';
import { createManualClock } from '@orbit/sdk/simulation';

test('reentrant input injection preserves ordering for every session', async () => {
  const simulator = createSimulator();
  const first = await orbit.connect({
    target: simulator.target,
    keepAlive: false,
  });
  const second = await orbit.connect({
    target: simulator.target,
    keepAlive: false,
  });
  const phases: string[] = [];
  try {
    first.touch.on('down', () => {
      expect(simulator.snapshot().contacts).toHaveLength(1);
      simulator.input.touch({ phase: 'up' });
    });
    second.inputs.on((event) => {
      if (event.type === 'touch') phases.push(event.phase);
    });
    simulator.input.touch({ phase: 'down', position: { x: 40, y: 40 } });
    expect(phases).toEqual(['down', 'up']);
    expect(first.touch.contacts).toEqual([]);
    expect(second.touch.contacts).toEqual([]);
    expect(second.diagnostics.snapshot().inputGaps).toBe(0);
  } finally {
    await first.close();
    await second.close();
    await simulator.close();
  }
});

test('a real input gap cancels a drag and survives raw recording/replay', async () => {
  const clock = createManualClock();
  const simulator = createSimulator({ clock });
  const lossy: DeviceAdapter = {
    kind: 'orbit-adapter',
    async open(options) {
      const session = await simulator.target.open(options);
      return {
        ...session,
        onInput(handler) {
          return session.onInput((event) => {
            if (event.sequence !== 2) handler(event);
          });
        },
      };
    },
  };
  const puck = await orbit.connect({ target: lossy, keepAlive: false });
  const cancellations: string[] = [],
    moves: InputEvent[] = [];
  const recorder = recordInputs(puck);
  puck.touch.on('cancel', (event) => {
    cancellations.push(event.reason);
    expect(puck.touch.contacts).toEqual([]);
  });
  puck.touch.on('move', (event) => {
    moves.push(event);
  });
  let recording;
  try {
    simulator.input.touch({ phase: 'down', position: { x: 50, y: 50 } });
    clock.advanceBy(5);
    simulator.input.imu({
      acceleration: [0, 0, 9.81],
      angularVelocity: [0, 0, 0],
    });
    clock.advanceBy(5);
    simulator.input.touch({ phase: 'move', position: { x: 60, y: 50 } });
    simulator.input.touch({ phase: 'up' });
    expect(cancellations).toEqual(['input-gap']);
    expect(moves).toHaveLength(0);
    expect(puck.touch.contacts).toEqual([]);
    recording = parseRecording(serializeRecording(recorder.stop()));
    expect(recording.entries.map((entry) => entry.event.sequence)).toEqual([
      1, 3, 4,
    ]);
  } finally {
    recorder.stop();
    await puck.close();
    await simulator.close();
  }
  const replayClock = createManualClock();
  const replay = createReplay(recording, { clock: replayClock });
  const reader = await orbit.connect({
    target: replay.target,
    keepAlive: false,
  });
  let replayCancels = 0;
  reader.touch.on('cancel', () => {
    replayCancels++;
  });
  try {
    replay.play();
    replayClock.advanceBy(10);
    expect(replayCancels).toBe(1);
    expect(reader.touch.contacts).toEqual([]);
  } finally {
    await reader.close();
    await replay.close();
  }
});

test('screen ownership is checked before calling user drawing code', async () => {
  const puck = await orbit.connect({ target: 'simulator', keepAlive: false });
  let calls = 0;
  try {
    await expect(
      puck.screen.draw((frame: Frame) => {
        calls++;
        frame.clear('#000000');
      }),
    ).rejects.toMatchObject({ code: 'busy' });
    expect(calls).toBe(0);
  } finally {
    await puck.close();
  }
  expect(() => puck.touch.on('down', () => {})).toThrow('closed');
  expect(() => puck.screen.on('frame', () => {})).toThrow('closed');
});

test('connection deadlines bound credential providers and dispose late adapters', async () => {
  const credentials = () => new Promise<string>(() => {});
  await expect(
    orbit.discover({
      host: { endpoint: 'http://127.0.0.1:4401', credentials },
      timeoutMs: 15,
    }),
  ).rejects.toMatchObject({ code: 'timeout' });
  await expect(
    orbit.connect({
      target: {
        host: { endpoint: 'http://127.0.0.1:4401', credentials },
        deviceId: 'missing',
      },
      timeoutMs: 15,
    }),
  ).rejects.toMatchObject({ code: 'timeout' });
  const simulator = createSimulator();
  let open!: () => void;
  let released!: () => void;
  const disposed = new Promise<void>((resolve) => {
    released = resolve;
  });
  const late: DeviceAdapter = {
    kind: 'orbit-adapter',
    async open(options) {
      await new Promise<void>((resolve) => {
        open = resolve;
      });
      // An adapter which ignores cancellation still must be cleaned up on return.
      const session = await simulator.target.open({ control: options.control });
      return {
        ...session,
        async close() {
          await session.close();
          released();
        },
      };
    },
  };
  try {
    await expect(
      orbit.connect({ target: late, control: ['screen'], timeoutMs: 15 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    open();
    await disposed;
    const next = await orbit.connect({
      target: simulator.target,
      control: ['screen'],
      keepAlive: false,
    });
    await next.close();
  } finally {
    await simulator.close();
  }
});
