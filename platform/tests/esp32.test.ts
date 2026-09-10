import { expect, test } from 'bun:test';
import {
  createRasterizer,
  decodeRGB565,
  encodeRGB565,
} from '../packages/esp32/src/raster.js';
import { crc32, encodeFrame, FrameDecoder } from '@orbit/sdk/serial-protocol';

test('physical framebuffer RLE roundtrips exact quantized RGB565 including alpha', () => {
  const rgba = new Uint8ClampedArray(240 * 240 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 97) % 256;
  const encoded = encodeRGB565(rgba);
  expect(decodeRGB565(encoded.rle)).toEqual(encoded.pixels);
  expect(crc32(encoded.pixels)).toBe(encoded.crc);
});
test('physical RLE rejects malformed, empty, short and overflowing frames', () => {
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array(3),
    new Uint8Array(4),
    new Uint8Array([1, 0, 0, 0]),
    new Uint8Array([255, 255, 0, 0]),
  ])
    expect(() => decodeRGB565(bytes)).toThrow();
});
test('serial decoding survives arbitrary chunk boundaries and rejects corrupted CRC', () => {
  const payload = new Uint8Array([0x7e, 0x7d, 0, 255]);
  const good = encodeFrame({ kind: 3, seq: 123, payload });
  const decoder = new FrameDecoder();
  const results = [...good].flatMap((byte) =>
    decoder.push(new Uint8Array([byte])),
  );
  expect(results).toEqual([{ kind: 3, seq: 123, payload }]);
  const corrupt = good.slice();
  corrupt[2] ^= 1;
  expect(decoder.push(corrupt)).toEqual([]);
  expect(decoder.errors).toBeGreaterThan(0);
  expect(decoder.push(good)).toHaveLength(1);
});
test('host canvas renders SDK scenes into a complete physical framebuffer', () => {
  const raster = createRasterizer();
  try {
    const frame = raster.render({
      version: 1,
      size: { width: 240, height: 240 },
      background: '#000000',
      commands: [
        {
          op: 'circle',
          value: { center: { x: 120, y: 120 }, radius: 20, fill: '#ffffff' },
        },
      ],
    });
    expect(decodeRGB565(frame.rle)).toEqual(frame.pixels);
    expect(frame.rle.length).toBeLessThan(10000);
  } finally {
    raster.close();
  }
});
