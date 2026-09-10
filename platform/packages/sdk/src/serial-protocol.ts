const FLAG = 0x7e,
  ESCAPE = 0x7d;
export const MAX_PAYLOAD = 4096;
export type Frame = { kind: number; seq: number; payload: Uint8Array };
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function encodeFrame(frame: Frame): Uint8Array {
  if (
    !Number.isInteger(frame.kind) ||
    frame.kind < 0 ||
    frame.kind > 255 ||
    !Number.isInteger(frame.seq) ||
    frame.seq < 0 ||
    frame.seq > 0xffffffff ||
    frame.payload.length > MAX_PAYLOAD
  )
    throw new Error('Frame exceeds protocol limits.');
  const raw = new Uint8Array(12 + frame.payload.length),
    view = new DataView(raw.buffer);
  raw[0] = 1;
  raw[1] = frame.kind;
  view.setUint32(2, frame.seq, true);
  view.setUint16(6, frame.payload.length, true);
  raw.set(frame.payload, 8);
  view.setUint32(raw.length - 4, crc32(raw.subarray(0, raw.length - 4)), true);
  const bytes = [FLAG];
  for (const b of raw) {
    if (b === FLAG || b === ESCAPE) bytes.push(ESCAPE, b ^ 0x20);
    else bytes.push(b);
  }
  bytes.push(FLAG);
  return Uint8Array.from(bytes);
}
/** Fixed-size accumulation; invalid packets are discarded at a frame boundary. */
export class FrameDecoder {
  private buffer = new Uint8Array(MAX_PAYLOAD + 12);
  private length = 0;
  private escaped = false;
  private active = false;
  private discard = false;
  errors = 0;
  push(chunk: Uint8Array): Frame[] {
    const result: Frame[] = [];
    for (const byte of chunk) {
      if (byte === FLAG) {
        if (this.active && !this.discard && (this.length || this.escaped)) {
          const view = new DataView(this.buffer.buffer);
          if (
            this.escaped ||
            this.length < 12 ||
            this.buffer[0] !== 1 ||
            view.getUint16(6, true) !== this.length - 12 ||
            view.getUint32(this.length - 4, true) !==
              crc32(this.buffer.subarray(0, this.length - 4))
          )
            this.errors++;
          else
            result.push({
              kind: this.buffer[1],
              seq: view.getUint32(2, true),
              payload: this.buffer.slice(8, this.length - 4),
            });
        }
        this.active = true;
        this.length = 0;
        this.escaped = false;
        this.discard = false;
        continue;
      }
      if (!this.active || this.discard) continue;
      if (!this.escaped && byte === ESCAPE) {
        this.escaped = true;
        continue;
      }
      if (this.length === this.buffer.length) {
        this.discard = true;
        this.errors++;
        continue;
      }
      this.buffer[this.length++] = this.escaped ? byte ^ 0x20 : byte;
      this.escaped = false;
    }
    return result;
  }
}
