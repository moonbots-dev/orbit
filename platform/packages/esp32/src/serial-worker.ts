// This entry point runs in Node, never Bun: serialport's libuv binding requires it.
import { SerialPortStream } from '@serialport/stream';
import { nativeBinding } from './native-binding.js';
let pauseSerial: (() => void) | undefined;
const send = (message: unknown) => {
  if (!process.stdout.write(JSON.stringify(message) + '\n')) pauseSerial?.();
};
if (process.argv[2] === '--list') {
  try {
    send({ ports: await nativeBinding.list() });
  } catch (error) {
    send({ error: String(error) });
  }
} else {
  const port = new SerialPortStream({
    binding: nativeBinding,
    path: process.argv[2],
    baudRate: Number(process.argv[3]),
    autoOpen: false,
    lock: true,
    vmin: 0,
    vtime: 0,
  });
  pauseSerial = () => {
    port.pause();
  };
  process.stdout.on('drain', () => {
    port.resume();
  });
  port.on('data', (bytes: Buffer) =>
    send({ event: 'data', bytes: bytes.toString('base64') }),
  );
  port.on('error', (error) => send({ event: 'error', error: error.message }));
  port.on('close', () => send({ event: 'close' }));
  process.stdin.on('end', () => {
    if (port.isOpen) port.close(() => process.exit(0));
    else process.exit(0);
  });
  let incoming = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    incoming += chunk;
    if (incoming.length > 32768) process.exit(1);
    for (let newline; (newline = incoming.indexOf('\n')) >= 0;) {
      const line = incoming.slice(0, newline);
      incoming = incoming.slice(newline + 1);
      try {
        command(JSON.parse(line));
      } catch {
        process.exit(1);
      }
    }
  });
  function command(message: unknown) {
    const m = message as {
      id: number;
      op: string;
      bytes?: string;
      value?: { dtr: boolean; rts: boolean };
    };
    const done = (error?: Error | null) =>
      send({ id: m.id, error: error?.message });
    try {
      switch (m.op) {
        case 'open':
          port.open(done);
          break;
        case 'set':
          port.set(m.value!, done);
          break;
        case 'write':
          if (!m.bytes || m.bytes.length > 16384)
            throw new Error('Invalid serial write size.');
          void (async () => {
            const bytes = Buffer.from(m.bytes!, 'base64');
            // This CH343 path loses bytes in larger unpaced USB writes.
            for (let offset = 0; offset < bytes.length; offset += 64) {
              await new Promise<void>((resolve, reject) =>
                port.write(bytes.subarray(offset, offset + 64), (error) =>
                  error ? reject(error) : resolve(),
                ),
              );
              await new Promise((resolve) => setTimeout(resolve, 2));
            }
          })().then(
            () => done(),
            (error) => done(error),
          );
          break;
        case 'drain':
          port.drain(done);
          break;
        case 'close':
          if (port.isOpen) port.close(done);
          else done();
          break;
        default:
          throw new Error('Unknown serial operation.');
      }
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
