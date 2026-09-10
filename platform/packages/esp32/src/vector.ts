import {
  OrbitError,
  type Scene,
  type DrawCommand,
  type Paint,
  type PathGeometry,
  type Color,
  type Point,
} from '@orbit/sdk';
import { crc32 } from '@orbit/sdk/serial-protocol';

const MAX_SCENE = 65536;
class Writer {
  bytes: number[] = [];
  u8(n: number) {
    this.bytes.push(n & 255);
  }
  u16(n: number) {
    this.u8(n);
    this.u8(n >>> 8);
  }
  u32(n: number) {
    this.u16(n);
    this.u16(n >>> 16);
  }
  f32(n: number) {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, n, true);
    this.bytes.push(...new Uint8Array(b));
  }
  signed(n: number) {
    let v = ((n << 1) ^ (n >> 31)) >>> 0;
    do {
      this.u8((v & 127) | (v > 127 ? 128 : 0));
      v >>>= 7;
    } while (v);
  }
  color(c: Color) {
    const s = c.slice(1);
    for (let i = 0; i < 6; i += 2) this.u8(parseInt(s.slice(i, i + 2), 16));
    this.u8(s.length === 8 ? parseInt(s.slice(6), 16) : 255);
  }
  append(bytes: Uint8Array | readonly number[]) {
    for (const b of bytes) this.u8(b);
  }
  done() {
    return Uint8Array.from(this.bytes);
  }
}
function paint(w: Writer, p: Paint) {
  w.u8((p.fill ? 1 : 0) | (p.stroke ? 2 : 0));
  if (p.fill) w.color(p.fill);
  if (p.stroke) {
    w.color(p.stroke.color);
    w.f32(p.stroke.width);
  }
}
function geometry(w: Writer, p: PathGeometry) {
  w.u8(p.fillRule === 'evenodd' ? 1 : 0);
  const groups = new Writer();
  let count = 0,
    x = 0,
    y = 0;
  const point = (p: Point) => {
    const nx = Math.round(p.x * 16),
      ny = Math.round(p.y * 16);
    groups.signed(nx - x);
    groups.signed(ny - y);
    x = nx;
    y = ny;
  };
  for (let i = 0; i < p.segments.length; i++) {
    const s = p.segments[i];
    count++;
    if (s.type === 'move') {
      groups.u8(1);
      point(s.to);
    } else if (s.type === 'line') {
      let end = i + 1;
      while (p.segments[end]?.type === 'line') end++;
      groups.u8(2);
      groups.u16(end - i);
      for (; i < end; i++) point((p.segments[i] as { to: Point }).to);
      i--;
    } else if (s.type === 'quadratic') {
      groups.u8(3);
      point(s.control);
      point(s.to);
    } else if (s.type === 'cubic') {
      groups.u8(4);
      point(s.control1);
      point(s.control2);
      point(s.to);
    } else groups.u8(5);
  }
  w.u16(count);
  w.append(groups.done());
}
function encodeCommand(c: DrawCommand): Uint8Array {
  const w = new Writer();
  switch (c.op) {
    case 'circle':
      w.u8(1);
      [c.value.center.x, c.value.center.y, c.value.radius].forEach((n) =>
        w.f32(n),
      );
      paint(w, c.value);
      break;
    case 'ellipse':
      w.u8(2);
      [
        c.value.center.x,
        c.value.center.y,
        c.value.radiusX,
        c.value.radiusY,
      ].forEach((n) => w.f32(n));
      paint(w, c.value);
      break;
    case 'rect':
      w.u8(14);
      [
        c.value.x,
        c.value.y,
        c.value.width,
        c.value.height,
        c.value.cornerRadius ?? 0,
      ].forEach((n) => w.signed(Math.round(n * 16)));
      paint(w, c.value);
      break;
    case 'line':
      w.u8(4);
      [c.value.from.x, c.value.from.y, c.value.to.x, c.value.to.y].forEach(
        (n) => w.f32(n),
      );
      paint(w, { stroke: c.value.stroke });
      break;
    case 'path':
      w.u8(5);
      geometry(w, c.value);
      paint(w, c.value);
      break;
    case 'save':
      w.u8(6);
      break;
    case 'restore':
      w.u8(7);
      break;
    case 'translate':
      w.u8(8);
      w.f32(c.x);
      w.f32(c.y);
      break;
    case 'scale':
      w.u8(9);
      w.f32(c.x);
      w.f32(c.y);
      break;
    case 'rotate':
      w.u8(10);
      w.f32(c.value);
      break;
    case 'opacity':
      w.u8(11);
      w.f32(c.value);
      break;
    case 'clip':
      w.u8(12);
      geometry(w, c.value);
      break;
    case 'pixels':
      w.u8(13);
      w.f32(c.value.x);
      w.f32(c.value.y);
      w.u16(c.value.width);
      w.u16(c.value.height);
      w.u8(c.value.format === 'rgba8888' ? 0 : 1);
      w.append(c.value.data);
      break;
  }
  return w.done();
}
export interface VectorScene {
  records: Uint8Array[];
  background: Uint8Array;
  crc: number;
  byteLength: number;
}
export function compileVectorScene(scene: Scene): VectorScene {
  if (scene.size.width !== 240 || scene.size.height !== 240)
    throw new OrbitError(
      'invalid-value',
      'esp32.vector',
      'Expected a 240 × 240 scene.',
    );
  const records = scene.commands.map(encodeCommand),
    bg = new Writer();
  bg.color(scene.background);
  const canonical = new Writer();
  canonical.append(bg.done());
  canonical.u16(records.length);
  for (const record of records) {
    canonical.u32(record.length);
    canonical.append(record);
  }
  const bytes = canonical.done();
  if (bytes.length > MAX_SCENE)
    throw new OrbitError(
      'invalid-value',
      'esp32.vector',
      'Compiled drawing exceeds the device’s 64 KiB scene capacity. Reduce geometry or pixel assets.',
    );
  return {
    records,
    background: bg.done(),
    crc: crc32(bytes),
    byteLength: bytes.length,
  };
}
const equal = (a: Uint8Array | undefined, b: Uint8Array) =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i]);
/** Base is exclusively the last applied scene; callers invalidate it after uncertain delivery. */
export function vectorTransaction(
  id: number,
  scene: VectorScene,
  previous?: { id: number; scene: VectorScene },
): Uint8Array {
  const reset = !previous;
  const changed = scene.records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record, index }) =>
        reset || !equal(previous?.scene.records[index], record),
    );
  const w = new Writer();
  w.u32(id);
  w.u32(reset ? 0 : previous!.id);
  w.u32(scene.crc);
  w.append(scene.background);
  w.u16(scene.records.length);
  w.u16(changed.length);
  for (const { record, index } of changed) {
    w.u16(index);
    w.u32(record.length);
    w.append(record);
  }
  return w.done();
}
