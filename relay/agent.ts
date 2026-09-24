// Laptop side: polls the mailbox, verifies each signed request, runs it inside
// the policy and pushes the result back. Dials out only; opens no ports.
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, hostname, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mailbox, branches, olderThan, type Entry } from './mailbox';
import { decide, sandboxProfile, type RelayConfig } from './policy';
import { openEnvelope, isId, type Action, type Presence, type Request, type Result } from './protocol';

const OUTPUT_LIMIT = 256 * 1024;
const HEARTBEAT_MS = 30_000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const PASSED_ENV = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR'];

export const relayHome = (home = homedir()) => join(home, '.orbit-relay');

export function loadConfig(dir = relayHome()): RelayConfig {
  return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as RelayConfig;
}

export interface AgentOptions { config: RelayConfig; stateDir: string; home?: string; sandbox?: boolean; log?: (line: string) => void }

export class Agent {
  readonly mailbox: Mailbox;
  readonly names;
  private handled = new Set<string>();
  private unsent: { id: string; files: Entry[]; result: Result }[] = [];
  private lastBeat = 0;
  private home: string;
  private sandbox: boolean;
  private log: (line: string) => void;

  constructor(readonly options: AgentOptions) {
    this.home = options.home ?? homedir();
    this.sandbox = options.sandbox ?? platform() === 'darwin';
    this.log = options.log ?? (line => console.log(line));
    this.mailbox = new Mailbox(join(options.stateDir, 'mailbox.git'), options.config.mailbox);
    this.names = branches(options.config.device);
  }

  get paused() { return existsSync(join(this.options.stateDir, 'paused')); }

  async run(signal?: AbortSignal) {
    await this.mailbox.init();
    while (!signal?.aborted) {
      try { await this.tick(); } catch (error) { this.log(`relay: ${(error as Error).message}`); }
      await Bun.sleep(this.options.config.pollMs);
    }
  }

  async tick(now = Date.now()) {
    await this.mailbox.fetch();
    if (now - this.lastBeat >= HEARTBEAT_MS) await this.heartbeat(now);
    await this.flush();
    const done = new Set((await this.mailbox.list(this.names.results)).map(name => name.split('.')[0]));
    for (const name of await this.mailbox.list(this.names.requests)) {
      const id = name.replace(/\.json$/, '');
      if (!isId(id) || done.has(id) || this.handled.has(id)) continue;
      // A request runs at most once, even if its result cannot be pushed right away.
      this.handled.add(id);
      const raw = await this.mailbox.read(this.names.requests, name);
      const { result, attachment } = await this.handle(id, raw);
      this.audit(result);
      const files: Entry[] = [{ name: id + '.json', data: new TextEncoder().encode(JSON.stringify(result)) }];
      if (attachment) files.push(attachment);
      this.unsent.push({ id, files, result });
      await this.flush();
    }
  }

  private async flush() {
    while (this.unsent.length) {
      const { id, files, result } = this.unsent[0];
      await this.mailbox.put(this.names.results, files, `result ${id} ${result.status}`, { prune: olderThan(KEEP_MS) });
      this.unsent.shift();
    }
  }

  async heartbeat(now = Date.now()) {
    const presence: Presence = {
      v: 1, device: this.options.config.device, hostname: hostname(), platform: platform(), seenAt: now,
      paused: this.paused, roots: this.options.config.roots, serialPorts: serialPorts(),
    };
    await this.mailbox.put(this.names.presence, [{ name: 'presence.json', data: new TextEncoder().encode(JSON.stringify(presence)) }], 'presence', { replace: true });
    this.lastBeat = now;
  }

  async handle(id: string, raw: Uint8Array | undefined): Promise<{ result: Result; attachment?: Entry }> {
    const startedAt = Date.now();
    const base = { v: 1 as const, id, device: this.options.config.device, startedAt };
    let request: Request;
    try {
      request = openEnvelope(JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())), this.options.config.publicKey, this.options.config.device);
      if (request.id !== id) throw new Error('id does not match file name');
    } catch (error) {
      const reason = (error as Error).message;
      return { result: { ...base, status: reason === 'expired' ? 'expired' : 'rejected', reason, finishedAt: Date.now() } };
    }
    if (this.paused) return { result: { ...base, status: 'denied', reason: 'relay is paused on the laptop', finishedAt: Date.now() } };
    const decision = decide(request.action, this.options.config, this.home);
    if (!decision.ok) return { result: { ...base, status: 'denied', reason: decision.reason, finishedAt: Date.now() } };
    this.log(`relay: ${id} ${describe(request.action)}`);
    return this.execute(request.action, decision.cwd, base);
  }

  private async execute(action: Action, cwd: string, base: Omit<Result, 'status' | 'finishedAt'>): Promise<{ result: Result; attachment?: Entry }> {
    switch (action.kind) {
      case 'ping': return { result: { ...base, status: 'ok', stdout: 'pong', finishedAt: Date.now() } };
      case 'run': {
        const argv = this.sandbox ? ['sandbox-exec', '-p', sandboxProfile(this.home, this.options.config.denyCommands), ...action.argv] : action.argv;
        return { result: { ...base, ...(await spawnCapture(argv, cwd, this.env(), action.timeoutMs ?? 120_000, action.stdin)), finishedAt: Date.now() } };
      }
      case 'open': {
        const argv = ['open', ...(action.app ? ['-a', action.app] : []), ...(action.target ? [action.target] : [])];
        return { result: { ...base, ...(await spawnCapture(argv, cwd, this.env(), 30_000)), finishedAt: Date.now() } };
      }
      case 'screenshot': {
        const dir = mkdtempSync(join(tmpdir(), 'orbit-relay-'));
        try {
          const file = join(dir, 'screen.png');
          const outcome = await spawnCapture(['screencapture', '-x', '-t', 'png', file], cwd, this.env(), 30_000);
          if (outcome.status !== 'ok' || !existsSync(file)) return { result: { ...base, ...outcome, finishedAt: Date.now() } };
          const name = base.id + '.png';
          return { result: { ...base, ...outcome, attachment: name, finishedAt: Date.now() }, attachment: { name, data: readFileSync(file) } };
        } finally { rmSync(dir, { recursive: true, force: true }); }
      }
    }
  }

  // Commands get a minimal environment: no tokens or credentials leak in from the agent's own.
  private env() {
    const env: Record<string, string> = { PATH: this.options.config.path };
    for (const key of PASSED_ENV) if (process.env[key]) env[key] = process.env[key]!;
    return env;
  }

  private audit(result: Result) {
    const { stdout, stderr, ...entry } = result;
    try { appendFileSync(join(this.options.stateDir, 'audit.jsonl'), JSON.stringify(entry) + '\n'); } catch {}
  }
}

async function spawnCapture(argv: string[], cwd: string, env: Record<string, string>, timeoutMs: number, stdin?: string) {
  let proc;
  try {
    proc = Bun.spawn(argv, { cwd, env, stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    return { status: 'failed' as const, exitCode: null, stderr: (error as Error).message };
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); setTimeout(() => proc.kill('SIGKILL'), 3000); }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([capped(proc.stdout), capped(proc.stderr), proc.exited]);
  clearTimeout(timer);
  return {
    status: timedOut ? 'timeout' as const : exitCode === 0 ? 'ok' as const : 'failed' as const,
    exitCode, stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated,
  };
}

async function capped(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  for await (const chunk of stream) {
    if (size >= OUTPUT_LIMIT) { truncated = true; continue; }
    chunks.push(chunk.subarray(0, OUTPUT_LIMIT - size));
    size += chunk.length;
    if (size > OUTPUT_LIMIT) truncated = true;
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

function serialPorts() {
  try { return readdirSync('/dev').filter(n => /^(cu\.(usb|wch|SLAB)|ttyUSB|ttyACM)/.test(n)).map(n => '/dev/' + n); } catch { return []; }
}

const describe = (action: Action) => action.kind === 'run' ? 'run ' + JSON.stringify(action.argv) : action.kind === 'open' ? `open ${action.app ?? ''} ${action.target ?? ''}`.trim() : action.kind;
