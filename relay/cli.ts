#!/usr/bin/env bun
// orbit relay — lets a cloud Claude Code session run commands on your laptop.
//
// Laptop:  setup, install, uninstall, agent, pause, resume, log
// Cloud:   status, run, open, screenshot, ping
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Agent, loadConfig, relayHome } from './agent';
import { Mailbox } from './mailbox';
import { DEFAULT_DENY_COMMANDS, type RelayConfig } from './policy';
import { generateKeys, isDevice, type Action, type Result } from './protocol';
import { Sender } from './sender';

const LABEL = 'dev.moonbots.orbit-relay';
const [command, ...rest] = process.argv.slice(2);

function flag(name: string, fallback?: string) {
  const index = rest.indexOf('--' + name);
  if (index < 0) return fallback;
  const value = rest[index + 1];
  rest.splice(index, 2);
  return value;
}
function fail(message: string): never { console.error(message); process.exit(1); }

async function sender() {
  const privateKey = process.env.ORBIT_RELAY_KEY ?? fail('ORBIT_RELAY_KEY is not set. Add it to the cloud environment secrets (printed by `relay setup` on the laptop).');
  const remote = process.env.ORBIT_RELAY_MAILBOX ?? fail('ORBIT_RELAY_MAILBOX is not set.');
  const device = process.env.ORBIT_RELAY_DEVICE ?? 'laptop';
  const dir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'orbit-relay', createHash('sha256').update(remote).digest('hex').slice(0, 12));
  return new Sender({ mailbox: await new Mailbox(dir, remote).init(), device, privateKey });
}

async function dispatch(action: Action) {
  const timeoutMs = Number(flag('wait', '600')) * 1000;
  const client = await sender();
  const presence = await client.presence();
  if (!presence?.online) console.error(`relay: ${client.options.device} looks offline${presence ? ` (last seen ${new Date(presence.seenAt).toISOString()})` : ''}; the request waits in the mailbox until it expires.`);
  const id = await client.send(action, Math.max(timeoutMs, 60_000));
  const result = await client.wait(id, timeoutMs + 5000);
  if (!result) fail(`relay: no result for ${id} yet`);
  return { client, result };
}

function report(result: Result) {
  if (result.stdout) process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : result.stderr + '\n');
  if (result.truncated) console.error('relay: output truncated');
  if (result.status !== 'ok') console.error(`relay: ${result.status}${result.reason ? ': ' + result.reason : ''}${result.exitCode != null ? ` (exit ${result.exitCode})` : ''}`);
  process.exit(result.status === 'ok' ? 0 : result.exitCode || 1);
}

switch (command) {
  case 'setup': {
    const mailbox = flag('mailbox') ?? fail('usage: relay setup --mailbox <private git url> [--device laptop] [--root ~/orbit ...]');
    const device = flag('device', 'laptop')!;
    if (!isDevice(device)) fail('device must be lowercase letters, digits and dashes');
    const roots: string[] = [];
    for (let root = flag('root'); root; root = flag('root')) roots.push(resolve(root.replace(/^~/, homedir())));
    if (roots.length === 0) roots.push(join(homedir(), 'orbit-workspace'));
    for (const root of roots) mkdirSync(root, { recursive: true });
    const keys = generateKeys();
    const config: RelayConfig = { device, publicKey: keys.publicKey, mailbox, roots, path: process.env.PATH ?? '/usr/bin:/bin', pollMs: 3000, denyCommands: DEFAULT_DENY_COMMANDS };
    mkdirSync(relayHome(), { recursive: true, mode: 0o700 });
    writeFileSync(join(relayHome(), 'config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    console.log(`Relay configured for "${device}". Workspace roots:\n  ${roots.join('\n  ')}\n`);
    console.log('Add these to your Claude Code cloud environment (environment variables / secrets).');
    console.log('The private key is shown once and is not stored on this computer.\n');
    console.log(`ORBIT_RELAY_KEY=${keys.privateKey}`);
    console.log(`ORBIT_RELAY_MAILBOX=${mailbox}`);
    console.log(`ORBIT_RELAY_DEVICE=${device}\n`);
    console.log('Then run `bun run relay install` to start the agent at login.');
    break;
  }
  case 'install': {
    if (platform() !== 'darwin') fail('install sets up a macOS LaunchAgent; on other systems run `bun run relay agent` under your service manager.');
    const config = loadConfig();
    // Run from a copy the sandbox cannot write, so a relayed command cannot rewrite the agent.
    const app = join(relayHome(), 'app');
    rmSync(app, { recursive: true, force: true });
    mkdirSync(app, { recursive: true });
    for (const file of ['cli.ts', 'agent.ts', 'mailbox.ts', 'policy.ts', 'protocol.ts', 'sender.ts']) cpSync(join(import.meta.dir, file), join(app, file));
    const plist = join(homedir(), 'Library/LaunchAgents', LABEL + '.plist');
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${join(app, 'cli.ts')}</string><string>agent</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${config.path}</string><key>HOME</key><string>${homedir()}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${join(relayHome(), 'agent.log')}</string>
  <key>StandardErrorPath</key><string>${join(relayHome(), 'agent.log')}</string>
</dict></plist>
`);
    chmodSync(plist, 0o644);
    Bun.spawnSync(['launchctl', 'bootout', `gui/${process.getuid!()}/${LABEL}`]);
    const load = Bun.spawnSync(['launchctl', 'bootstrap', `gui/${process.getuid!()}`, plist]);
    if (load.exitCode !== 0) fail(new TextDecoder().decode(load.stderr));
    console.log('Relay agent installed and running. Logs: ~/.orbit-relay/agent.log');
    break;
  }
  case 'uninstall': {
    Bun.spawnSync(['launchctl', 'bootout', `gui/${process.getuid!()}/${LABEL}`]);
    rmSync(join(homedir(), 'Library/LaunchAgents', LABEL + '.plist'), { force: true });
    console.log('Relay agent stopped and removed. Config left in ~/.orbit-relay.');
    break;
  }
  case 'agent': {
    const agent = new Agent({ config: loadConfig(), stateDir: relayHome() });
    console.log(`relay: agent for ${agent.options.config.device} polling ${agent.options.config.mailbox}`);
    await agent.run();
    break;
  }
  case 'pause': writeFileSync(join(relayHome(), 'paused'), ''); console.log('Relay paused. Requests are refused until `relay resume`.'); break;
  case 'resume': rmSync(join(relayHome(), 'paused'), { force: true }); console.log('Relay resumed.'); break;
  case 'log': {
    const file = join(relayHome(), 'audit.jsonl');
    console.log(existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').slice(-Number(rest[0] ?? 20)).join('\n') : 'No requests yet.');
    break;
  }

  case 'status': {
    const presence = await (await sender()).presence();
    if (!presence) fail('No heartbeat from the laptop yet.');
    console.log(JSON.stringify(presence, null, 2));
    process.exit(presence.online ? 0 : 2);
  }
  case 'ping': report((await dispatch({ kind: 'ping' })).result); break;
  case 'run': {
    const cwd = flag('cwd');
    const timeout = flag('timeout');
    const argv = rest[0] === '--' ? rest.slice(1) : rest;
    if (argv.length === 0) fail('usage: relay run [--cwd dir] [--timeout seconds] [--wait seconds] -- command args...');
    report((await dispatch({ kind: 'run', argv, cwd, timeoutMs: timeout ? Number(timeout) * 1000 : undefined })).result);
    break;
  }
  case 'open': {
    const app = flag('app');
    report((await dispatch({ kind: 'open', app, target: rest[0] })).result);
    break;
  }
  case 'screenshot': {
    const out = flag('out', 'screenshot.png')!;
    const { client, result } = await dispatch({ kind: 'screenshot' });
    if (result.attachment) {
      const data = await client.attachment(result.attachment);
      if (data) { writeFileSync(out, data); console.log(out); }
    }
    report({ ...result, stdout: '' });
    break;
  }
  default:
    console.log(`orbit relay

Laptop:
  setup --mailbox <private git url> [--device laptop] [--root <dir>]...
  install | uninstall        start/stop the agent at login (macOS)
  agent                      run the agent in the foreground
  pause | resume             refuse/accept requests
  log [n]                    last n audited requests

Cloud (needs ORBIT_RELAY_KEY, ORBIT_RELAY_MAILBOX, ORBIT_RELAY_DEVICE):
  status                     is the laptop online, which serial ports are plugged in
  run [--cwd d] [--timeout s] [--wait s] -- cmd args...
  open [--app Name] [path|url]
  screenshot [--out file.png]
  ping`);
}
