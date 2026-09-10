import {
  spawn as spawnChild,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('./serial-worker.js', import.meta.url));
type Callback = (error?: Error | null) => void;
const spawn = (args: string[]) => {
  const child = spawnChild('node', [worker, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', (error) => child.emit('error', error));
  let incoming = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    incoming += chunk;
    if (incoming.length > 262144) {
      child.kill();
      return;
    }
    for (let newline; (newline = incoming.indexOf('\n')) >= 0;) {
      const line = incoming.slice(0, newline);
      incoming = incoming.slice(newline + 1);
      try {
        child.emit('message', JSON.parse(line));
      } catch {
        child.kill();
        return;
      }
    }
  });
  return child;
};

/** Private transport boundary. Bun owns everything except the native USB handle. */
export class SerialConnection extends EventEmitter {
  isOpen = false;
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    { callback: Callback; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(private options: { path: string; baudRate: number }) {
    super();
  }
  open(callback: Callback) {
    this.child = spawn([this.options.path, String(this.options.baudRate)]);
    this.child.on('message', (message: unknown) => {
      const m = message as {
        id?: number;
        event?: string;
        error?: string;
        bytes?: string;
      };
      if (m.id) {
        const request = this.pending.get(m.id);
        if (!request) return;
        this.pending.delete(m.id);
        clearTimeout(request.timer);
        request.callback(m.error ? new Error(m.error) : undefined);
      } else if (m.event === 'data' && m.bytes)
        this.emit('data', Buffer.from(m.bytes, 'base64'));
      else if (m.event === 'error') this.emit('error', new Error(m.error));
      else if (m.event === 'close') {
        this.isOpen = false;
        this.emit('close');
      }
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('Serial helper exited.')));
    this.call('open', {}, (error) => {
      this.isOpen = !error;
      callback(error);
    });
  }
  private fail(error: Error) {
    this.isOpen = false;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const item of callbacks) {
      clearTimeout(item.timer);
      item.callback(error);
    }
    this.emit('close');
  }
  private call(op: string, args: object, callback: Callback) {
    if (
      !this.child ||
      this.child.killed ||
      !this.child.stdin.writable ||
      this.pending.size >= 32
    ) {
      callback(new Error('Serial helper is unavailable or busy.'));
      return;
    }
    const id = ++this.sequence;
    const finish = (error: Error) => {
      const item = this.pending.get(id);
      if (!item) return;
      this.pending.delete(id);
      clearTimeout(item.timer);
      item.callback(error);
    };
    const timer = setTimeout(
      () => finish(new Error(`Serial ${op} timed out.`)),
      3000,
    );
    this.pending.set(id, { callback, timer });
    this.child.stdin.write(
      JSON.stringify({ id, op, ...args }) + '\n',
      (error) => {
        if (error) finish(error);
      },
    );
  }
  set(value: { dtr: boolean; rts: boolean }, callback: Callback) {
    this.call('set', { value }, callback);
  }
  write(bytes: Uint8Array, callback: Callback) {
    this.call(
      'write',
      { bytes: Buffer.from(bytes).toString('base64') },
      callback,
    );
  }
  drain(callback: Callback) {
    this.call('drain', {}, callback);
  }
  close(callback: Callback) {
    const finish: Callback = (error) => {
      this.isOpen = false;
      this.child?.stdin.end();
      this.child?.kill();
      callback(error);
    };
    if (this.child && !this.child.killed && this.child.stdin.writable)
      this.call('close', {}, finish);
    else finish();
  }
}

export function listSerialPorts(): Promise<
  Array<{
    path: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
  }>
> {
  return new Promise((resolve, reject) => {
    const child = spawn(['--list']);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Serial discovery timed out.'));
    }, 3000);
    child.on('message', (value: unknown) => {
      const message = value as {
        ports?: Array<{
          path: string;
          serialNumber?: string;
          vendorId?: string;
          productId?: string;
        }>;
        error?: string;
      };
      clearTimeout(timer);
      if (message.ports) resolve(message.ports);
      else reject(new Error(message.error));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('Serial discovery exited before returning ports.'));
    });
  });
}
