import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../agent';
import { Mailbox } from '../mailbox';
import { DEFAULT_DENY_COMMANDS, decide, sandboxProfile, type RelayConfig } from '../policy';
import { generateKeys, newId, openEnvelope, signRequest, type Request } from '../protocol';
import { Sender } from '../sender';

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'relay-test-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function request(overrides: Partial<Request> = {}): Request {
  const now = Date.now();
  return { v: 1, id: newId(now), device: 'laptop', issuedAt: now, expiresAt: now + 60_000, action: { kind: 'ping' }, ...overrides };
}

async function world() {
  const base = temp();
  const origin = join(base, 'origin.git');
  Bun.spawnSync(['git', 'init', '--bare', '--quiet', origin]);
  const home = join(base, 'home');
  const root = join(home, 'orbit-workspace');
  mkdirSync(root, { recursive: true });
  const keys = generateKeys();
  const config: RelayConfig = { device: 'laptop', publicKey: keys.publicKey, mailbox: origin, roots: [root], path: process.env.PATH!, pollMs: 50, denyCommands: DEFAULT_DENY_COMMANDS };
  const state = join(base, 'state');
  mkdirSync(state);
  const agent = new Agent({ config, stateDir: state, home, sandbox: false, log: () => {} });
  await agent.mailbox.init();
  const sender = new Sender({ mailbox: await new Mailbox(join(base, 'cloud.git'), origin).init(), device: 'laptop', privateKey: keys.privateKey });
  const roundTrip = async (action: Parameters<Sender['send']>[0]) => {
    const id = await sender.send(action);
    await agent.tick();
    return (await sender.wait(id, 0))!;
  };
  return { agent, sender, config, home, root, state, keys, roundTrip };
}

test('signatures, device binding and expiry are enforced', () => {
  const keys = generateKeys(), other = generateKeys();
  const good = signRequest(request(), keys.privateKey);
  expect(openEnvelope(good, keys.publicKey, 'laptop').action.kind).toBe('ping');
  expect(() => openEnvelope(signRequest(request(), other.privateKey), keys.publicKey, 'laptop')).toThrow('bad signature');
  expect(() => openEnvelope({ ...good, payload: good.payload.replace('ping', 'screenshot') }, keys.publicKey, 'laptop')).toThrow('bad signature');
  expect(() => openEnvelope(signRequest(request({ device: 'desktop' }), keys.privateKey), keys.publicKey, 'laptop')).toThrow('another device');
  expect(() => openEnvelope(signRequest(request({ expiresAt: Date.now() - 1 }), keys.privateKey), keys.publicKey, 'laptop')).toThrow('expired');
  expect(() => openEnvelope(signRequest(request({ expiresAt: Date.now() + 2 * 3600_000 }), keys.privateKey), keys.publicKey, 'laptop')).toThrow('lifetime');
  expect(() => openEnvelope(signRequest(request({ id: '../../x' }), keys.privateKey), keys.publicKey, 'laptop')).toThrow('bad id');
  expect(() => openEnvelope(signRequest(request({ action: { kind: 'run', argv: [] } }), keys.privateKey), keys.publicKey, 'laptop')).toThrow('argv');
});

test('policy keeps commands inside the workspace and off the deny list', () => {
  const home = temp(), root = join(home, 'work');
  mkdirSync(root);
  const config = { roots: [root], denyCommands: DEFAULT_DENY_COMMANDS } as RelayConfig;
  expect(decide({ kind: 'run', argv: ['ls'] }, config, home)).toEqual({ ok: true, cwd: root });
  expect(decide({ kind: 'run', argv: ['ls'], cwd: '../' }, config, home).ok).toBe(false);
  expect(decide({ kind: 'run', argv: ['ls'], cwd: '/etc' }, config, home).ok).toBe(false);
  expect(decide({ kind: 'run', argv: ['/usr/bin/sudo', 'ls'] }, config, home).ok).toBe(false);
  expect(decide({ kind: 'run', argv: ['osascript', '-e', 'x'] }, config, home).ok).toBe(false);
  expect(decide({ kind: 'open', target: 'https://example.com' }, config, home).ok).toBe(true);
  expect(decide({ kind: 'open', target: 'build/Orbit.app' }, config, home).ok).toBe(true);
  expect(decide({ kind: 'open', target: 'evil.command' }, config, home).ok).toBe(false);
  expect(decide({ kind: 'open', target: join(home, '.ssh/id_ed25519') }, config, home).ok).toBe(false);
  expect(decide({ kind: 'open', app: 'Terminal' }, config, home).ok).toBe(false);
});

test('sandbox profile hides secrets and protects the relay config', () => {
  const profile = sandboxProfile('/Users/me', DEFAULT_DENY_COMMANDS);
  expect(profile).toContain('(deny file-read* file-write* (subpath "/Users/me/.ssh")');
  expect(profile).toContain('(subpath "/Users/me/Library/Keychains")');
  expect(profile).toMatch(/\(deny file-write\* [^\n]*"\/Users\/me\/\.orbit-relay"/);
  expect(profile).toContain('(literal "/usr/bin/osascript")');
  const unquoted = sandboxProfile('/Users/a "b"', []);
  expect(unquoted).toContain('"/Users/a \\"b\\"/.ssh"');
  expect(unquoted).not.toContain('process-exec');
});

test('a signed command runs on the laptop and its output comes back through the mailbox', async () => {
  const { agent, sender, root, roundTrip } = await world();
  writeFileSync(join(root, 'hello.txt'), 'hi from laptop');
  await agent.heartbeat();
  expect((await sender.presence())?.online).toBe(true);
  const result = await roundTrip({ kind: 'run', argv: ['cat', 'hello.txt'] });
  expect(result.status).toBe('ok');
  expect(result.stdout).toBe('hi from laptop');
  const failed = await roundTrip({ kind: 'run', argv: ['sh', '-c', 'echo oops >&2; exit 3'] });
  expect(failed).toMatchObject({ status: 'failed', exitCode: 3, stderr: 'oops\n' });
  const env = await roundTrip({ kind: 'run', argv: ['env'] });
  expect(env.stdout).not.toContain('ORBIT_RELAY');
  expect((await roundTrip({ kind: 'run', argv: ['sleep', '5'], timeoutMs: 200 })).status).toBe('timeout');
  expect((await roundTrip({ kind: 'run', argv: ['sudo', 'true'] })).status).toBe('denied');
});

test('forged, replayed and paused requests do not run', async () => {
  const { agent, sender, state, root, roundTrip } = await world();
  const forger = new Sender({ mailbox: sender.options.mailbox, device: 'laptop', privateKey: generateKeys().privateKey });
  const forged = await forger.send({ kind: 'run', argv: ['touch', 'forged'] });
  await agent.tick();
  expect((await sender.wait(forged, 0))).toMatchObject({ status: 'rejected', reason: 'bad signature' });
  expect(await Bun.file(join(root, 'forged')).exists()).toBe(false);

  const counted = await roundTrip({ kind: 'run', argv: ['sh', '-c', 'echo x >> count'] });
  expect(counted.status).toBe('ok');
  await agent.tick();
  const fresh = new Agent({ ...agent.options });
  await fresh.tick();
  expect(await Bun.file(join(root, 'count')).text()).toBe('x\n');

  writeFileSync(join(state, 'paused'), '');
  expect((await roundTrip({ kind: 'ping' })).status).toBe('denied');
});
