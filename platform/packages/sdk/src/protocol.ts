import { integer, invalid, object, OrbitError } from './errors.js';
export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1_100_000;
export type WireKind =
  | 'open'
  | 'hello'
  | 'input'
  | 'frame'
  | 'present'
  | 'result'
  | 'error'
  | 'cancel'
  | 'ping'
  | 'pong';
export interface WireMessage {
  version: 1;
  kind: WireKind;
  [key: string]: unknown;
}
export function validateMessage(value: unknown): WireMessage {
  const message = object(value, 'protocol');
  if (message.version !== 1)
    throw new OrbitError(
      'incompatible-version',
      'protocol',
      'Expected Orbit protocol version 1.',
    );
  if (
    ![
      'open',
      'hello',
      'input',
      'frame',
      'present',
      'result',
      'error',
      'cancel',
      'ping',
      'pong',
    ].includes(message.kind as string)
  )
    invalid('protocol', 'Unknown message kind.');
  return message as WireMessage;
}
export function encodeMessage(message: WireMessage): Uint8Array {
  const data = new TextEncoder().encode(
    JSON.stringify(validateMessage(message)),
  );
  if (data.length > MAX_MESSAGE_BYTES)
    invalid('protocol', 'Message exceeds byte limit.');
  return data;
}
export function decodeMessage(text: string): WireMessage {
  if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES)
    invalid('protocol', 'Message exceeds byte limit.');
  try {
    return validateMessage(JSON.parse(text));
  } catch (error) {
    if (error instanceof OrbitError) throw error;
    return invalid('protocol', 'Invalid JSON message.');
  }
}
/** Optional 4-byte little-endian length framing for stream transports (not ESP32 firmware). */
export function createDecoder({
  maxBytes = MAX_MESSAGE_BYTES,
}: { maxBytes?: number } = {}) {
  integer(maxBytes, 1, MAX_MESSAGE_BYTES, 'maxBytes');
  let buffer = new Uint8Array(4),
    used = 0,
    length: number | undefined;
  const reset = () => {
    buffer = new Uint8Array(4);
    used = 0;
    length = undefined;
  };
  return {
    push(chunk: Uint8Array): WireMessage[] {
      const messages: WireMessage[] = [];
      let offset = 0;
      try {
        while (offset < chunk.length) {
          const take = Math.min(buffer.length - used, chunk.length - offset);
          buffer.set(chunk.subarray(offset, offset + take), used);
          used += take;
          offset += take;
          if (used !== buffer.length) continue;
          if (length === undefined) {
            length = new DataView(buffer.buffer).getUint32(0, true);
            if (!length || length > maxBytes)
              invalid('decoder', 'Invalid message length.');
            buffer = new Uint8Array(length);
            used = 0;
          } else {
            if (messages.length >= 1024)
              invalid('decoder', 'Too many messages in one chunk.');
            messages.push(
              decodeMessage(
                new TextDecoder('utf-8', { fatal: true }).decode(buffer),
              ),
            );
            reset();
          }
        }
      } catch (error) {
        reset();
        if (error instanceof OrbitError) throw error;
        invalid('decoder', 'Invalid stream encoding.');
      }
      return messages;
    },
    reset,
  };
}
