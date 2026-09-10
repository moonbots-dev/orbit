import { test, expect, afterEach } from 'bun:test';
import { startRuntime } from '../server';
import { compileProgram } from '../compile';
import { examples } from '../examples';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
let sockets: WebSocket[] = [];
afterEach(async () => { for (const ws of sockets) ws.close(); sockets = []; await runtime?.close(); runtime = undefined; });

async function setup(program?: string) {
  runtime = await startRuntime({ port: 0, program });
  const origin = new URL(runtime.url).origin;
  const { token } = await fetch(origin + '/api/bootstrap').then(r => r.json()) as { token: string };
  const headers = { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const events: any[] = [];
  const BunSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  const socket = new BunSocket(origin.replace('http:', 'ws:') + '/events', { headers: { Origin: origin }, protocols: ['orbit-' + token] });
  sockets.push(socket); socket.onmessage = e => events.push(JSON.parse(String(e.data)));
  const post = (route: string, value: object) => fetch(origin + '/api/' + route, { method: 'POST', headers, body: JSON.stringify(value) });
  return { origin, headers, events, post };
}
async function until(check: () => boolean, timeout = 5000) {
  const started = performance.now();
  while (!check()) { if (performance.now() - started > timeout) throw new Error('Timed out waiting for runtime event'); await Bun.sleep(25); }
}

test('compiler preserves top-level await and rejects unsupported imports and broken syntax', () => {
  for (const example of examples) expect(compileProgram(example.source).code).toContain('await');
  expect(() => compileProgram("import fs from 'node:fs';")).toThrow('imports');
  expect(() => compileProgram("await import('node:fs');")).toThrow('Dynamic');
  expect(() => compileProgram('const = ;')).toThrow();
});

test('runtime refuses unrelated origins and unauthorized mutations', async () => {
  const { origin, headers } = await setup();
  expect((await fetch(origin + '/api/bootstrap', { headers: { Origin: 'https://unrelated.test' } })).status).toBe(403);
  expect((await fetch(origin + '/api/status')).status).toBe(401);
  expect((await fetch(origin + '/api/stop', { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.test' } })).status).toBe(403);
  expect((await fetch(origin + '/api/stop', { method: 'POST', headers: { Authorization: headers.Authorization } })).status).toBe(403);
});

test('Familiar renders continuously; bad edits preserve it; touch and attention reach replacement program', async () => {
  const { events, post } = await setup();
  await until(() => events.filter(e => e.type === 'frame').length >= 5);
  expect(events.filter(e => e.type === 'error')).toEqual([]);
  const before = events.filter(e => e.type === 'frame').length;
  expect((await post('run', { source: 'const = ;' })).status).toBe(400);
  await until(() => events.filter(e => e.type === 'frame').length > before + 3);
  events.length = 0;
  await post('run', { source: examples[2].source });
  await until(() => events.some(e => e.type === 'ready'));
  await post('input', { type: 'attention', message: 'Hello 🌙' });
  await until(() => events.some(e => e.type === 'log' && e.message === 'Hello 🌙'));
  await post('input', { type: 'touch', phase: 'down', x: 120, y: 120 });
  await post('input', { type: 'touch', phase: 'up', x: 120, y: 120 });
  await until(() => events.some(e => e.type === 'log' && e.message === 'Acknowledged'));
  await post('stop', {});
  const atStop = events.length; await Bun.sleep(150);
  expect(events.slice(atStop).filter(e => e.type === 'frame')).toEqual([]);
}, 10000);

test('a blocked program is terminated without blocking the runtime API', async () => {
  const { events, post, origin, headers } = await setup();
  await post('run', { source: 'while (true) {}' });
  expect((await fetch(origin + '/api/status', { headers })).status).toBe(200);
  await until(() => events.some(e => e.type === 'error' && e.message.includes('stopped responding')), 7000);
  await post('run', { source: examples[0].source });
  const before = events.length;
  await until(() => events.slice(before).some(e => e.type === 'frame'));
}, 10000);

test('saving a TypeScript file reloads it; package execution uses reviewed source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-test-'));
  try {
    const file = join(directory, 'test.ts');
    await Bun.write(file, "console.log('first');");
    const { events } = await setup(file);
    await until(() => events.some(e => e.type === 'log' && e.message === 'first'));
    await Bun.write(file, "console.log('reloaded');");
    await until(() => events.some(e => e.type === 'log' && e.message === 'reloaded'));
    await runtime!.close(); runtime = undefined;
    const packaged = join(directory, 'test.orbit');
    await Bun.write(packaged, JSON.stringify({ ...compileProgram("console.log('reviewed source');"), code: "console.log('different code');" }));
    const next = await setup(packaged);
    await until(() => next.events.some(e => e.type === 'log' && e.message === 'reviewed source'));
    expect(next.events.some(e => e.message === 'different code')).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
