import type { Capabilities, InputEvent, ObservationMetadata } from './types.js';
import { finite, integer, invalid, object } from './errors.js';
import { deepFreeze, point } from './scene.js';

export function validateInput(value: unknown, caps: Capabilities): InputEvent {
  const e = object(value, 'input');
  if (
    !['simulated', 'physical', 'replay'].includes(e.source as string) ||
    typeof e.bootId !== 'string' ||
    !e.bootId.length ||
    e.bootId.length > 160
  )
    invalid('input', 'Invalid input provenance.');
  const meta: ObservationMetadata = {
    sequence: integer(e.sequence, 1, Number.MAX_SAFE_INTEGER, 'sequence'),
    bootId: e.bootId as string,
    source: e.source as ObservationMetadata['source'],
    deviceTimeUs: integer(
      e.deviceTimeUs,
      0,
      Number.MAX_SAFE_INTEGER,
      'deviceTimeUs',
    ),
    receivedTimeMs: finite(
      e.receivedTimeMs,
      0,
      Number.MAX_SAFE_INTEGER,
      'receivedTimeMs',
    ),
  };
  let result: InputEvent;
  switch (e.type) {
    case 'touch': {
      const contactId = integer(
        e.contactId,
        0,
        caps.touch.maxContacts - 1,
        'contactId',
      );
      if (e.phase === 'cancel') {
        if (
          !['disconnected', 'input-gap', 'device-cancelled'].includes(
            e.reason as string,
          )
        )
          invalid('input', 'Invalid cancellation reason.');
        result = {
          ...meta,
          type: 'touch',
          phase: 'cancel',
          contactId,
          reason: e.reason as 'device-cancelled',
          ...(e.position === undefined ? {} : { position: point(e.position) }),
        };
      } else {
        if (!['down', 'move', 'up'].includes(e.phase as string))
          invalid('input', 'Invalid touch phase.');
        const position = point(e.position);
        finite(position.x, 0, caps.viewport.width, 'position.x');
        finite(position.y, 0, caps.viewport.height, 'position.y');
        result = {
          ...meta,
          type: 'touch',
          phase: e.phase as 'down',
          contactId,
          position,
        };
      }
      break;
    }
    case 'imu': {
      if (!caps.imu.present) invalid('imu', 'No IMU on this target.');
      const vector = (
        v: unknown,
        name: string,
      ): readonly [number, number, number] => {
        if (!Array.isArray(v) || v.length !== 3)
          invalid(name, 'Expected three axes.');
        return (v as unknown[]).map((n) => finite(n, -1e5, 1e5, name)) as [
          number,
          number,
          number,
        ];
      };
      result = {
        ...meta,
        type: 'imu',
        acceleration: vector(e.acceleration, 'acceleration'),
        angularVelocity: vector(e.angularVelocity, 'angularVelocity'),
      };
      break;
    }
    case 'button':
      if (
        !caps.buttons.includes(e.id as string) ||
        !['down', 'up', 'cancel'].includes(e.phase as string)
      )
        invalid('button', 'Unknown button or phase.');
      result = {
        ...meta,
        type: 'button',
        id: e.id as string,
        phase: e.phase as 'down',
      };
      break;
    case 'switch':
      if (
        !caps.switches.includes(e.id as string) ||
        typeof e.value !== 'boolean'
      )
        invalid('switch', 'Unknown switch or value.');
      result = {
        ...meta,
        type: 'switch',
        id: e.id as string,
        value: e.value as boolean,
      };
      break;
    case 'discontinuity':
      if (!['input-gap', 'disconnected', 'reset'].includes(e.reason as string))
        invalid('input', 'Unknown discontinuity.');
      result = { ...meta, type: 'discontinuity', reason: e.reason as 'reset' };
      break;
    default:
      return invalid('input', 'Unknown input kind.');
  }
  return deepFreeze(result);
}
