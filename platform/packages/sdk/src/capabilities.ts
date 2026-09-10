import type { Capabilities, DeviceInfo } from './types.js';
import { integer, invalid, object } from './errors.js';
import { deepFreeze } from './scene.js';

export function validateDeviceInfo(value: unknown): DeviceInfo {
  const p = object(value, 'device.info');
  const text = (key: string) => {
    if (
      typeof p[key] !== 'string' ||
      !(p[key] as string).length ||
      (p[key] as string).length > 160
    )
      invalid('device.info', `Invalid ${key}.`);
    return p[key] as string;
  };
  if (
    !['simulated', 'physical', 'replay'].includes(p.source as string) ||
    p.protocolVersion !== '1' ||
    (p.firmwareVersion !== null && typeof p.firmwareVersion !== 'string')
  )
    invalid('device.info', 'Invalid device version/source.');
  return deepFreeze({
    id: text('id'),
    model: text('model'),
    bootId: text('bootId'),
    source: p.source as DeviceInfo['source'],
    protocolVersion: '1',
    firmwareVersion: p.firmwareVersion as string | null,
  });
}
export function validateCapabilities(value: unknown): Capabilities {
  const c = object(value, 'capabilities'),
    v = object(c.viewport),
    s = object(c.screen),
    t = object(c.touch),
    i = object(c.imu),
    p = object(s.physicalSize);
  const size = (value: Record<string, unknown>) => ({
    width: integer(value.width, 16, 2048, 'width'),
    height: integer(value.height, 16, 2048, 'height'),
  });
  const viewport = size(v),
    physicalSize = size(p);
  if (
    !['circle', 'rectangle'].includes(s.shape as string) ||
    (s.shape === 'circle' && viewport.width !== viewport.height)
  )
    invalid('capabilities', 'Invalid display shape.');
  const list = (value: unknown, allowed?: readonly string[]) => {
    if (
      !Array.isArray(value) ||
      value.length > 32 ||
      value.some(
        (x) =>
          typeof x !== 'string' ||
          x.length > 64 ||
          (allowed && !allowed.includes(x)),
      )
    )
      invalid('capabilities', 'Invalid capability list.');
    if (new Set(value as string[]).size !== (value as string[]).length)
      invalid('capabilities', 'Duplicate capability values.');
    return value as string[];
  };
  const operations = list(s.operations, [
    'circle',
    'ellipse',
    'rect',
    'line',
    'path',
    'pixels',
    'transform',
    'clip',
    'opacity',
    'text',
    'image',
  ]);
  const acknowledgements = list(s.acknowledgements, [
    'accepted',
    'applied',
    'presentation-submitted',
  ]);
  if (
    !acknowledgements.length ||
    typeof c.profile !== 'string' ||
    c.profile.length > 100 ||
    typeof i.present !== 'boolean' ||
    i.accelerationUnit !== 'm/s²' ||
    i.angularVelocityUnit !== 'rad/s' ||
    typeof i.axes !== 'string' ||
    i.axes.length > 256 ||
    c.audio !== false ||
    c.hid !== false ||
    typeof c.physicalTransport !== 'boolean'
  )
    invalid('capabilities', 'Incompatible capability contract.');
  return deepFreeze({
    profile: c.profile,
    viewport,
    screen: {
      shape: s.shape as 'circle',
      physicalSize,
      operations: operations as Capabilities['screen']['operations'],
      maxFrameBytes: integer(s.maxFrameBytes, 128, 1_048_576, 'maxFrameBytes'),
      maxPrimitives: integer(s.maxPrimitives, 1, 1024, 'maxPrimitives'),
      maxPathSegments: integer(s.maxPathSegments, 1, 2048, 'maxPathSegments'),
      maxQueuedFrames: integer(s.maxQueuedFrames, 1, 32, 'maxQueuedFrames'),
      acknowledgements:
        acknowledgements as Capabilities['screen']['acknowledgements'],
    },
    touch: { maxContacts: integer(t.maxContacts, 1, 10, 'maxContacts') },
    imu: {
      present: i.present,
      accelerationUnit: 'm/s²',
      angularVelocityUnit: 'rad/s',
      axes: i.axes,
    },
    buttons: list(c.buttons),
    switches: list(c.switches),
    audio: false,
    hid: false,
    physicalTransport: c.physicalTransport,
  });
}
