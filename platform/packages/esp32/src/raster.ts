import { createCanvas } from '@napi-rs/canvas';
import type { Scene } from '@orbit/sdk';
import { createCanvasRenderer } from '@orbit/sdk/canvas';
import { crc32 } from '@orbit/sdk/serial-protocol';

export function encodeRGB565(rgba: Uint8Array | Uint8ClampedArray) {
  if (rgba.length !== 240 * 240 * 4)
    throw new Error('Expected a 240 × 240 RGBA frame.');
  const pixels = new Uint8Array(240 * 240 * 2);
  const data = new DataView(pixels.buffer);
  const runs: number[] = [];
  let previous = -1,
    count = 0;
  const flush = () => {
    if (count)
      runs.push(count & 255, count >> 8, previous & 255, previous >> 8);
  };
  for (let i = 0; i < rgba.length; i += 4) {
    // Transparent canvas pixels sit on the physical screen's black background.
    const alpha = rgba[i + 3] / 255;
    const color =
      ((Math.round(rgba[i] * alpha) >> 3) << 11) |
      ((Math.round(rgba[i + 1] * alpha) >> 2) << 5) |
      (Math.round(rgba[i + 2] * alpha) >> 3);
    data.setUint16(i / 2, color, true);
    if (color === previous && count < 65535) count++;
    else {
      flush();
      previous = color;
      count = 1;
    }
  }
  flush();
  return { pixels, rle: Uint8Array.from(runs), crc: crc32(pixels) };
}

export function decodeRGB565(rle: Uint8Array): Uint8Array {
  if (rle.length % 4 || rle.length > 240 * 240 * 4)
    throw new Error('Invalid RLE length.');
  const pixels = new Uint8Array(240 * 240 * 2),
    out = new DataView(pixels.buffer);
  const input = new DataView(rle.buffer, rle.byteOffset, rle.byteLength);
  let position = 0;
  for (let i = 0; i < rle.length; i += 4) {
    const count = input.getUint16(i, true),
      color = input.getUint16(i + 2, true);
    if (!count || position + count > 57600)
      throw new Error('RLE exceeds framebuffer.');
    for (let j = 0; j < count; j++) out.setUint16(position++ * 2, color, true);
  }
  if (position !== 57600) throw new Error('Incomplete framebuffer.');
  return pixels;
}

export function createRasterizer() {
  const canvas = createCanvas(240, 240);
  const surface = Object.assign(canvas, {
    ownerDocument: { createElement: () => createCanvas(1, 1) },
  });
  const renderer = createCanvasRenderer(
    surface as unknown as HTMLCanvasElement,
    { shape: 'rectangle' }, // The LCD itself clips to a circle; do not encode invisible rounded corners.
  );
  return {
    render(scene: Scene) {
      renderer.draw(scene);
      return encodeRGB565(
        canvas.getContext('2d').getImageData(0, 0, 240, 240).data,
      );
    },
    close: () => renderer.dispose(),
  };
}
