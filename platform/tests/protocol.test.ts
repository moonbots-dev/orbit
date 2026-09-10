import { expect, test } from 'bun:test';
import {
  createDecoder,
  decodeMessage,
  encodeMessage,
  MAX_MESSAGE_BYTES,
} from '@orbit/sdk/protocol';

const wire = () => {
  const payload = encodeMessage({ version: 1, kind: 'ping' });
  const data = new Uint8Array(payload.length + 4);
  new DataView(data.buffer).setUint32(0, payload.length, true);
  data.set(payload, 4);
  return data;
};

test('stream decoder handles split headers, split payloads and multiple frames per chunk', () => {
  const bytes = wire(),
    decoder = createDecoder({ maxBytes: 32 });
  expect(decoder.push(bytes.slice(0, 2))).toEqual([]);
  expect(decoder.push(bytes.slice(2, 8))).toEqual([]);
  expect(decoder.push(bytes.slice(8))).toEqual([{ version: 1, kind: 'ping' }]);
  const multiple = new Uint8Array(bytes.length * 3);
  for (let i = 0; i < 3; i++) multiple.set(bytes, bytes.length * i);
  expect(decoder.push(multiple)).toHaveLength(3);
});

test('protocol rejects oversized lengths, malformed envelopes and incompatible versions', () => {
  const decoder = createDecoder({ maxBytes: 32 });
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, 33, true);
  expect(() => decoder.push(header)).toThrow('length');
  expect(decoder.push(wire())).toHaveLength(1);
  expect(() => decodeMessage('{')).toThrow('JSON');
  expect(() => decodeMessage('{"version":2,"kind":"ping"}')).toThrow(
    'version 1',
  );
  expect(() =>
    encodeMessage({
      version: 1,
      kind: 'ping',
      data: 'x'.repeat(MAX_MESSAGE_BYTES),
    }),
  ).toThrow('limit');
});
