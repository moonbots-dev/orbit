import { test, expect } from 'bun:test';
import orbit from '@orbit/sdk';
import { createSimulator } from '@orbit/sdk/simulation';
import {
  compileVectorScene,
  vectorTransaction,
} from '../packages/esp32/src/vector.js';
import { drawFamiliar, DEFAULT_SETTINGS } from '@orbit/familiar';

test('Familiar uses compact vector deltas without changing its public drawing code', async () => {
  const sim = createSimulator();
  const puck = await orbit.connect({
    target: sim.target,
    control: ['screen'],
    keepAlive: false,
  });
  try {
    const frame = puck.screen.createFrame();
    drawFamiliar(
      frame,
      { eyeX: 0, eyeY: 0, headX: 0, headY: 0, roll: 0, closed: 0 },
      DEFAULT_SETTINGS,
    );
    const a = compileVectorScene(frame.build());
    const next = puck.screen.createFrame();
    drawFamiliar(
      next,
      { eyeX: 0.3, eyeY: 0.1, headX: 0.2, headY: 0.1, roll: 0.1, closed: 0.5 },
      DEFAULT_SETTINGS,
    );
    const b = compileVectorScene(next.build());
    const initial = vectorTransaction(1, a),
      delta = vectorTransaction(2, b, { id: 1, scene: a }),
      unchanged = vectorTransaction(3, b, { id: 2, scene: b });
    expect(initial.length).toBeLessThan(900);
    expect(delta.length).toBeLessThan(500);
    expect(unchanged.length).toBe(20);
    const data = new DataView(delta.buffer, delta.byteOffset, delta.byteLength);
    expect(data.getUint32(4, true)).toBe(1);
    expect(data.getUint16(18, true)).toBe(2);
    const reset = vectorTransaction(4, b);
    expect(new DataView(reset.buffer).getUint32(4, true)).toBe(0);
    expect(a.crc).not.toBe(b.crc);
  } finally {
    await puck.close();
  }
});

test('retained scenes support shrinking layouts, background-only updates and explicit capacity failures', async () => {
  const sim = createSimulator();
  const puck = await orbit.connect({
    target: sim.target,
    control: ['screen'],
    keepAlive: false,
  });
  try {
    const f = puck.screen.createFrame();
    f.clear('#000000');
    f.circle({ center: { x: 120, y: 120 }, radius: 20, fill: '#ffffff' });
    const a = compileVectorScene(f.build());
    const g = puck.screen.createFrame();
    g.clear('#123456');
    const b = compileVectorScene(g.build());
    const reset = vectorTransaction(2, b, { id: 1, scene: a });
    expect(new DataView(reset.buffer).getUint32(4, true)).toBe(1);
    const h = puck.screen.createFrame();
    h.clear('#abcdef');
    const c = compileVectorScene(h.build());
    expect(vectorTransaction(3, c, { id: 2, scene: b }).length).toBe(20);
    expect(c.crc).not.toBe(b.crc);
    const big = puck.screen.createFrame();
    big.clear('#000000');
    big.pixels({
      x: 0,
      y: 0,
      width: 240,
      height: 240,
      format: 'rgb565-le',
      data: new Uint8Array(115200),
    });
    expect(() => compileVectorScene(big.build())).toThrow('64 KiB');
  } finally {
    await puck.close();
  }
});
