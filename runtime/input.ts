import type { Simulator } from '@orbit/sdk/simulation';
import { dispatchAttention } from '@orbit/sdk/runtime';

export function applyInput(simulator: Simulator | undefined, value: any) {
  if (!value || typeof value !== 'object') throw new Error('Invalid input.');
  if (value.type === 'attention') {
    if (typeof value.message !== 'string') throw new Error('Message required.');
    dispatchAttention(value.message);
    return;
  }
  if (!simulator) throw new Error('Virtual inputs are unavailable on a physical device.');
  if (value.type === 'cancel') { simulator.input.cancel(); return; }
  if (value.type === 'touch') {
    const point = { x: Number(value.x), y: Number(value.y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > 240 || point.y > 240) throw new Error('Touch outside screen.');
    if (['down', 'move', 'up', 'cancel'].includes(value.phase)) simulator.input.touch({ phase: value.phase, position: point });
    else throw new Error('Invalid touch phase.');
  } else if (value.type === 'button') {
    if (value.down === true) simulator.input.button({ id: 'talk', phase: 'down' });
    else if (value.down === false) simulator.input.button({ id: 'talk', phase: 'up' });
    else throw new Error('Invalid button.');
  } else if (value.type === 'mute' && typeof value.value === 'boolean') simulator.input.switch({ id: 'mute', value: value.value });
  else if (value.type === 'tilt') {
    const x = Number(value.x), y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1) throw new Error('Invalid tilt.');
    simulator.input.imu({ acceleration: [x * 9.80665, y * 9.80665, Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 9.80665], angularVelocity: [0, 0, 0] });
  } else throw new Error('Unknown input.');
}
