// Bun's rejects matchers are typed void; await still waits for runtime assertions.
/* oxlint-disable typescript/await-thenable */
import { describe, expect, test } from 'bun:test';
import orbit, { type Frame, type Scene } from '@orbit/sdk';
import { createManualClock, createSimulator } from '@orbit/sdk/simulation';
import {
  createReplay,
  parseRecording,
  recordInputs,
  serializeRecording,
} from '@orbit/sdk/replay';

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const circle = (frame: Frame, radius = 12) => {
  frame.clear('#09090c');
  frame.circle({ center: frame.center, radius, fill: '#ffe3c2' });
};
async function setup(latencyMs = 0) {
  const clock = createManualClock();
  const simulator = createSimulator({ clock, latencyMs });
  const puck = await orbit.connect({
    target: simulator.target,
    control: ['screen'],
    keepAlive: false,
  });
  return {
    clock,
    simulator,
    puck,
    close: async () => {
      await puck.close();
      await simulator.close();
    },
  };
}

describe('public drawing and device lifecycle', () => {
  test('draw is a complete immutable frame, copied before submission', async () => {
    const { puck, simulator, close } = await setup();
    try {
      const center = { x: 20, y: 30 };
      let retained: Frame | undefined;
      await puck.screen.draw((frame) => {
        retained = frame;
        frame.clear('#000000');
        frame.circle({ center, radius: 8, fill: '#ffffff' });
      });
      center.x = 200;
      expect(simulator.snapshot().scene?.commands[0]).toEqual({
        op: 'circle',
        value: { center: { x: 20, y: 30 }, radius: 8, fill: '#ffffff' },
      });
      expect(Object.isFrozen(simulator.snapshot().scene?.commands[0])).toBe(
        true,
      );
      expect(() => retained!.clear('#ffffff')).toThrow('finalized');
      await puck.screen.draw((frame) => circle(frame, 4));
      expect(simulator.snapshot().scene?.commands).toHaveLength(1);
    } finally {
      await close();
    }
  });
  test('malformed or async drawing never presents a partial frame', async () => {
    const { puck, simulator, close } = await setup();
    try {
      await puck.screen.draw(circle);
      const previous = simulator.snapshot().scene;
      await expect(
        puck.screen.draw((frame) => {
          frame.clear('#000000');
          frame.circle({ center: frame.center, radius: NaN, fill: '#ffffff' });
        }),
      ).rejects.toMatchObject({ code: 'invalid-value' });
      await expect(
        puck.screen.draw(async (frame) => {
          frame.clear('#ffffff');
          await Promise.resolve();
          frame.circle({ center: frame.center, radius: 2, fill: '#000000' });
        }),
      ).rejects.toMatchObject({ code: 'invalid-value' });
      await settle();
      expect(simulator.snapshot().scene).toBe(previous);
      await expect(
        puck.screen.draw((frame) => {
          frame.clear('#000000');
          frame.restore();
        }),
      ).rejects.toMatchObject({ code: 'invalid-value' });
      await expect(
        puck.screen.draw((frame) => {
          frame.clear('#000000');
          frame.text({} as never);
        }),
      ).rejects.toMatchObject({ code: 'unsupported' });
    } finally {
      await close();
    }
  });
  test('one controller, many observers, and release on close', async () => {
    const { puck, simulator, close } = await setup();
    const observer = await orbit.connect({
      target: simulator.target,
      keepAlive: false,
    });
    try {
      await expect(
        orbit.connect({ target: simulator.target, control: ['screen'] }),
      ).rejects.toMatchObject({ code: 'busy' });
      await expect(observer.screen.draw(circle)).rejects.toMatchObject({
        code: 'busy',
      });
      let frames = 0;
      observer.screen.on('frame', () => {
        frames++;
      });
      await puck.screen.draw(circle);
      expect(frames).toBe(1);
      await puck.close();
      await puck.closed;
      const next = await orbit.connect({
        target: simulator.target,
        control: ['screen'],
        keepAlive: false,
      });
      await next.screen.draw(circle);
      await next.close();
      expect(frames).toBe(2);
      await puck.close();
    } finally {
      await observer.close();
      await close();
    }
  });
  test('a slow target coalesces obsolete pending frames and bounds FIFO', async () => {
    const { puck, simulator, clock, close } = await setup(20);
    try {
      const first = puck.screen.draw((f) => circle(f, 1));
      const second = puck.screen.draw((f) => circle(f, 2));
      const third = puck.screen.draw((f) => circle(f, 3));
      expect(await second).toMatchObject({ status: 'superseded' });
      expect(puck.diagnostics.snapshot().pendingFrames).toBe(2);
      clock.advanceBy(20);
      await settle();
      await first;
      clock.advanceBy(20);
      await settle();
      await third;
      expect(simulator.snapshot().scene?.commands[0]).toMatchObject({
        value: { radius: 3 },
      });
      const fifo = Array.from({ length: 8 }, () =>
        puck.screen.draw(circle, { queue: 'fifo' }),
      );
      for (const promise of fifo) promise.catch(() => {});
      await expect(
        puck.screen.draw(circle, { queue: 'fifo' }),
      ).rejects.toMatchObject({ code: 'queue-full' });
      await puck.close();
      await Promise.allSettled(fifo);
    } finally {
      await close();
    }
  });
  test('deadlines and cancellation prevent delayed application', async () => {
    const { puck, simulator, clock, close } = await setup(100);
    try {
      const timeout = puck.screen.draw(circle, { timeoutMs: 10 });
      timeout.catch(() => {});
      clock.advanceBy(10);
      await expect(timeout).rejects.toMatchObject({ code: 'timeout' });
      const abort = new AbortController();
      const canceled = puck.screen.draw(circle, { signal: abort.signal });
      canceled.catch(() => {});
      abort.abort();
      await expect(canceled).rejects.toMatchObject({ code: 'cancelled' });
      clock.advanceBy(1000);
      await settle();
      expect(simulator.snapshot().scene).toBeNull();
    } finally {
      await close();
    }
  });
});

describe('animation and input', () => {
  test('time starts at zero, excludes pauses and resets delta on resume', async () => {
    const { puck, clock, close } = await setup();
    try {
      const times: {
        elapsedMs: number;
        deltaMs: number;
        frameIndex: number;
      }[] = [];
      const animation = puck.screen.animate(
        (frame, time) => {
          times.push(time);
          circle(frame);
        },
        { fps: 20 },
      );
      clock.advanceBy(0);
      await settle();
      clock.advanceBy(50);
      await settle();
      expect(times).toEqual([
        { elapsedMs: 0, deltaMs: 0, frameIndex: 0 },
        { elapsedMs: 50, deltaMs: 50, frameIndex: 1 },
      ]);
      animation.pause();
      clock.advanceBy(500);
      await settle();
      expect(times).toHaveLength(2);
      animation.resume();
      clock.advanceBy(0);
      await settle();
      expect(times[2]).toEqual({ elapsedMs: 50, deltaMs: 0, frameIndex: 2 });
      await expect(puck.screen.draw(circle)).rejects.toMatchObject({
        code: 'busy',
      });
      animation.stop();
      await animation.finished;
      clock.advanceBy(500);
      expect(times).toHaveLength(3);
      await puck.screen.draw(circle);
    } finally {
      await close();
    }
  });
  test('animation failure stops the loop and rejects finished', async () => {
    const { puck, clock, close } = await setup();
    try {
      let errors = 0;
      const animation = puck.screen.animate(() => {
        throw new Error('bad character');
      });
      animation.onError(() => {
        errors++;
      });
      clock.advanceBy(0);
      await expect(animation.finished).rejects.toMatchObject({
        code: 'callback-failed',
      });
      expect(animation.state).toBe('stopped');
      expect(errors).toBe(1);
    } finally {
      await close();
    }
  });
  test('touches, buttons, switches and IMU are typed observations with cleanup', async () => {
    const { puck, simulator, close } = await setup();
    try {
      let down = 0,
        canceled = 0;
      const subscription = puck.touch.on('down', (touch) => {
        expect(touch.position).toEqual({ x: 80, y: 90 });
        down++;
      });
      puck.touch.on('cancel', () => {
        canceled++;
      });
      simulator.input.touch({ phase: 'down', position: { x: 80, y: 90 } });
      simulator.input.imu({
        acceleration: [0, 0, 9.81],
        angularVelocity: [0, 0.1, 0],
      });
      simulator.input.button({ id: 'talk', phase: 'down' });
      simulator.input.switch({ id: 'mute', value: true });
      expect(puck.imu.latest?.acceleration).toEqual([0, 0, 9.81]);
      expect(puck.buttons.get('talk')?.phase).toBe('down');
      expect(puck.switches.get('mute')?.value).toBe(true);
      subscription.unsubscribe();
      expect(subscription.active).toBe(false);
      simulator.input.cancel();
      expect(canceled).toBe(1);
      expect(puck.touch.contacts).toEqual([]);
      simulator.input.touch({ phase: 'down', position: { x: 80, y: 90 } });
      expect(down).toBe(1);
      await puck.close();
      expect(canceled).toBe(2);
    } finally {
      await close();
    }
  });
  test('bounded raw streams reject overflow and detach on abort', async () => {
    const { puck, simulator, close } = await setup();
    try {
      const iterator = puck.inputs
        .stream({ buffer: 1 })
        [Symbol.asyncIterator]();
      simulator.input.switch({ id: 'mute', value: true });
      simulator.input.switch({ id: 'mute', value: false });
      await expect(iterator.next()).rejects.toMatchObject({
        code: 'queue-full',
      });
      const controller = new AbortController();
      const other = puck.inputs
        .stream({ signal: controller.signal })
        [Symbol.asyncIterator]();
      const pending = other.next();
      pending.catch(() => {});
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    } finally {
      await close();
    }
  });
  test('closing/failing a connection cancels live interaction and animation', async () => {
    const { puck, simulator, clock, close } = await setup();
    try {
      const animation = puck.screen.animate((frame) => circle(frame));
      simulator.input.touch({ phase: 'down', position: { x: 10, y: 10 } });
      simulator.disconnect();
      await expect(puck.closed).rejects.toMatchObject({
        code: 'connection-lost',
      });
      await expect(animation.finished).rejects.toMatchObject({
        code: 'connection-lost',
      });
      expect(puck.touch.contacts).toEqual([]);
      clock.advanceBy(1000);
      await settle();
      expect(puck.status).toBe('closed');
    } finally {
      await close();
    }
  });
});

test('a raw input tape is independent of the character that consumes it', async () => {
  const { puck, simulator, clock, close } = await setup();
  let recording;
  try {
    const capture = recordInputs(puck);
    clock.advanceBy(20);
    simulator.input.touch({ phase: 'down', position: { x: 60, y: 80 } });
    clock.advanceBy(10);
    simulator.input.touch({ phase: 'up', position: { x: 60, y: 80 } });
    recording = parseRecording(serializeRecording(capture.stop()));
  } finally {
    await close();
  }
  const outputs: Scene[] = [];
  for (const radius of [8, 16]) {
    const replayClock = createManualClock();
    const replay = createReplay(recording, { clock: replayClock });
    const device = await orbit.connect({
      target: replay.target,
      control: ['screen'],
      keepAlive: false,
    });
    try {
      device.screen.on('frame', ({ scene }) => {
        outputs.push(scene);
      });
      device.touch.on('down', (touch) => {
        expect(touch.source).toBe('replay');
        device.screen
          .draw((frame) => {
            frame.clear('#000000');
            frame.circle({ center: touch.position, radius, fill: '#ffffff' });
          })
          .catch(() => {});
      });
      replay.play();
      replayClock.advanceBy(30);
      await settle();
      expect(replay.state).toBe('ended');
    } finally {
      await device.close();
      await replay.close();
    }
  }
  expect(outputs).toHaveLength(2);
  expect(outputs[0].commands[0]).toMatchObject({
    value: { center: { x: 60, y: 80 }, radius: 8 },
  });
  expect(outputs[1].commands[0]).toMatchObject({
    value: { center: { x: 60, y: 80 }, radius: 16 },
  });
});

test('recording duration limit stops capture and marks the result', async () => {
  const { puck, simulator, clock, close } = await setup();
  try {
    const capture = recordInputs(puck, { maxDurationMs: 10 });
    let hit = false;
    capture.on('limit', () => {
      hit = true;
    });
    clock.advanceBy(10);
    simulator.input.switch({ id: 'mute', value: true });
    const recording = capture.stop();
    expect(hit).toBe(true);
    expect(recording.entries).toHaveLength(0);
    expect(recording.stoppedBy).toBe('limit');
  } finally {
    await close();
  }
});
