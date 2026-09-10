import * as sdk from '@orbit/sdk';
import * as familiar from '@orbit/familiar';
import { createSimulator } from '@orbit/sdk/simulation';
import { setRuntimeTarget, onAttention } from '@orbit/sdk/runtime';
import { compileProgram } from './compile';
import { applyInput } from './input';

const simulator = createSimulator();
setRuntimeTarget(simulator.target);
let lastFrame = 0, logs = 0;
setInterval(() => { logs = 0; postMessage({ type: 'alive' }); }, 250);
simulator.on('frame', ({ scene }) => {
  if (performance.now() - lastFrame < 24) return;
  lastFrame = performance.now();
  postMessage({ type: 'frame', scene });
});
const report = (error: unknown) => postMessage({ type: 'error', message: String(error).slice(0, 1000) });
console.log = (...values) => { if (logs++ < 15) postMessage({ type: 'log', message: values.map(String).join(' ').slice(0, 500) }); };
console.error = console.log;
addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => report(event.reason));
let started = false;
onmessage = async ({ data }) => {
  try {
    if (data.type === 'input') { applyInput(simulator, data.value); return; }
    if (data.type !== 'run' || started || typeof data.source !== 'string' || data.source.length > 100_000) throw new Error('Invalid program.');
    started = true;
    const modules: Record<string, unknown> = { '@orbit/sdk': sdk, '@orbit/familiar': familiar, '@orbit/sdk/runtime': { onAttention } };
    const require = (name: string) => { if (!(name in modules)) throw new Error('This playground supports @orbit/sdk, @orbit/familiar and @orbit/sdk/runtime.'); return modules[name]; };
    const program = compileProgram(data.source);
    postMessage({ type: 'ready', code: program.code });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('require', 'exports', program.code)(require, {});
  } catch (error) { report(error); }
};
