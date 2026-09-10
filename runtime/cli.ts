#!/usr/bin/env bun
import { resolve, basename } from 'node:path';
import { compileProgram } from './compile';
import { readPackage } from './package';

const [command = 'dev', ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const file = args[0]?.startsWith('--') ? undefined : args[0];
if (command === 'build') {
  if (!file) throw new Error('Usage: orbit build program.ts [--out program.orbit]');
  const program = compileProgram(await Bun.file(file).text(), basename(file, '.ts'));
  const out = flag('--out') ?? file.replace(/\.[^.]+$/, '') + '.orbit';
  await Bun.write(out, JSON.stringify(program, null, 2));
  console.log(`Built ${out}`);
} else if (command === 'dev' || command === 'run') {
  if (command === 'run' && !file) throw new Error('Usage: orbit run program.orbit');
  if (file?.endsWith('.orbit')) readPackage(await Bun.file(file).json());
  const { startRuntime } = await import('./server');
  const runtime = await startRuntime({ program: file ? resolve(file) : undefined, port: flag('--port') === undefined ? 4410 : Number(flag('--port')), assets: flag('--assets'), usb: flag('--usb') });
  if (args.includes('--native')) console.log(`ORBIT_READY ${runtime.port}`);
  else console.log(`Orbit running: ${runtime.url}\n${file ? 'Save your file to reload. ' : ''}Ctrl+C stops the runtime.`);
  const stop = async () => { await runtime.close(); process.exit(0); };
  process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
} else console.log('orbit dev [program.ts] [--usb /dev/cu.…]\norbit build program.ts\norbit run program.orbit');
