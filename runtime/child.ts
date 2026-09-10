import * as sdk from '@orbit/sdk';
import * as familiar from '@orbit/familiar';
import { createSimulator } from '@orbit/sdk/simulation';
import { setRuntimeTarget, onAttention } from '@orbit/sdk/runtime';
import { applyInput } from './input';
import { readPackage } from './package';

const send = (message: object) => process.stdout.write(JSON.stringify(message) + '\n');
let logs = 0;
console.log = (...values: unknown[]) => { if (logs++ < 15) send({ type: 'log', message: values.map(String).join(' ').slice(0, 500) }); };
console.error = console.log;
const interval = setInterval(() => { logs = 0; send({ type: 'alive' }); }, 250);
const simulator = createSimulator();
let device: { target: import('@orbit/sdk').DeviceAdapter; close(): Promise<void> } | undefined;
if (process.env.ORBIT_RUNTIME_USB) {
  const { openESP32 } = await import('@orbit/esp32');
  device = await openESP32({ port: process.env.ORBIT_RUNTIME_USB });
}
const target = device?.target ?? simulator.target;
setRuntimeTarget(target);
const observer = await sdk.default.connect({ target, control: [] });
observer.screen.on('frame', ({ scene }) => send({ type: 'frame', scene }));
const close = async () => {
  clearInterval(interval);
  await observer.close();
  await device?.close();
  await simulator.close();
  process.exit(0);
};
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
process.on('unhandledRejection', error => { send({ type: 'error', message: String(error).slice(0, 1000) }); void close(); });
void (async () => {
  let pending = ''; const decoder = new TextDecoder();
  for await (const bytes of Bun.stdin.stream().values()) {
    pending += decoder.decode(bytes, { stream: true });
    if (pending.length > 32000) { send({ type: 'error', message: 'Input buffer exceeded.' }); await close(); break; }
    const lines = pending.split('\n'); pending = lines.pop()!;
    for (const line of lines) {
      try { applyInput(device ? undefined : simulator, JSON.parse(line)); }
      catch (error) { send({ type: 'log', message: String(error) }); }
    }
  }
})();
try {
  const program = readPackage(await Bun.file(process.argv[2]).json());
  const modules: Record<string, unknown> = { '@orbit/sdk': sdk, '@orbit/familiar': familiar, '@orbit/sdk/runtime': { onAttention } };
  const require = (name: string) => { if (!(name in modules)) throw new Error(`Unsupported import: ${name}`); return modules[name]; };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  send({ type: 'ready', physical: !!device });
  await new AsyncFunction('require', 'exports', program.code)(require, {});
} catch (error) { send({ type: 'error', message: String(error).slice(0, 1000) }); await close(); }
