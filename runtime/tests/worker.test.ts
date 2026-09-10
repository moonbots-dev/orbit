import { test, expect } from 'bun:test';
import { examples } from '../examples';

test('worker runs the same Familiar and sends attention responses', async () => {
  const worker = new Worker(new URL('../worker.ts', import.meta.url).href);
  const messages: any[] = [];
  worker.onmessage = ({ data }) => messages.push(data);
  worker.postMessage({ type: 'run', source: examples[2].source });
  try {
    const wait = async (predicate: () => boolean) => {
      const limit = performance.now() + 3000;
      while (!predicate()) { if (performance.now() > limit) throw new Error(JSON.stringify(messages)); await Bun.sleep(20); }
    };
    await wait(() => messages.filter(e => e.type === 'frame').length >= 4);
    expect(messages.some(e => e.type === 'error')).toBe(false);
    worker.postMessage({ type: 'input', value: { type: 'attention', message: 'A note for you' } });
    await wait(() => messages.some(e => e.type === 'log' && e.message === 'A note for you'));
  } finally { worker.terminate(); }
});
