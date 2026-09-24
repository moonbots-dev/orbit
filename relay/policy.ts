// What the laptop agent is willing to do without asking. Requests inside the
// configured roots run unattended; the macOS sandbox keeps secrets unreadable
// and stops a command from rewriting the relay's own trust settings.
import { realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { Action } from './protocol';

export interface RelayConfig {
  device: string;
  publicKey: string;
  mailbox: string;
  roots: string[];
  path: string;
  pollMs: number;
  denyCommands: string[];
}

export const DEFAULT_DENY_COMMANDS = [
  'sudo', 'su', 'doas', 'login', 'passwd', 'security', 'dscl', 'launchctl', 'osascript',
  'csrutil', 'spctl', 'systemsetup', 'tccutil', 'profiles', 'sandbox-exec', 'open',
];

// Readable by nobody the relay starts.
export const SECRET_PATHS = [
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gh', '.config/gcloud', '.netrc',
  '.npmrc', '.pypirc', '.git-credentials', '.config/git/credentials', '.password-store',
  'Library/Keychains', 'Library/Cookies', 'Library/Messages', 'Library/Mail', 'Library/Safari',
  'Library/Application Support/Google/Chrome', 'Library/Application Support/Firefox',
  'Library/Application Support/Arc', 'Library/Application Support/BraveSoftware',
  'Library/Application Support/Claude', 'Library/Application Support/com.apple.TCC',
  '.claude', '.claude.json',
];

// Readable but never writable: the relay's trust anchor and places that would
// let a command persist or run outside the sandbox later.
export const PROTECTED_PATHS = [
  '.orbit-relay', 'Library/LaunchAgents', '.zshrc', '.zprofile', '.zshenv', '.zlogin', '.bashrc',
  '.bash_profile', '.profile', '.config/fish', '.gitconfig', '.config/git',
];

const OPEN_DENIED = /\.(command|tool|terminal|sh|zsh|bash|scpt|scptd|applescript|workflow|pkg|mpkg|dmg|mobileconfig|webloc|inetloc)$/i;

export type Decision = { ok: true; cwd: string } | { ok: false; reason: string };

const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
export const inside = (path: string, root: string) => {
  const rel = relative(real(root), real(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export function decide(action: Action, config: RelayConfig, home: string): Decision {
  const roots = config.roots;
  if (roots.length === 0) return { ok: false, reason: 'no workspace roots configured' };
  const withinRoots = (path: string) => roots.some(root => inside(path, root));
  const secret = (path: string) => SECRET_PATHS.concat(PROTECTED_PATHS).some(p => inside(path, join(home, p)));
  switch (action.kind) {
    case 'ping': case 'screenshot': return { ok: true, cwd: roots[0] };
    case 'run': {
      const cwd = resolve(roots[0], action.cwd ?? '.');
      if (!withinRoots(cwd)) return { ok: false, reason: `cwd ${cwd} is outside the workspace roots` };
      const command = basename(action.argv[0]);
      if (config.denyCommands.includes(command)) return { ok: false, reason: `${command} is on the deny list` };
      return { ok: true, cwd };
    }
    case 'open': {
      const target = action.target;
      if (target !== undefined && !/^https?:\/\//i.test(target)) {
        const path = resolve(roots[0], target);
        if (!withinRoots(path) || secret(path)) return { ok: false, reason: `${path} is outside the workspace roots` };
        if (OPEN_DENIED.test(path)) return { ok: false, reason: 'opening scripts and installers is not allowed' };
      }
      if (action.app !== undefined && /^(Terminal|iTerm|iTerm2|Script Editor|Automator|Warp|Ghostty|kitty|Alacritty)(\.app)?$/i.test(basename(action.app))) {
        return { ok: false, reason: `${action.app} could run commands outside the sandbox` };
      }
      return { ok: true, cwd: roots[0] };
    }
  }
}

const quote = (path: string) => '"' + path.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// Seatbelt profile applied to every `run` on macOS, inherited by child processes.
export function sandboxProfile(home: string, denyCommands: string[]) {
  const homeReal = real(home);
  const secret = SECRET_PATHS.map(p => `(subpath ${quote(join(homeReal, p))})`).join(' ');
  const protectedPaths = PROTECTED_PATHS.map(p => `(subpath ${quote(join(homeReal, p))})`).join(' ');
  const binaries = denyCommands.flatMap(c => ['/usr/bin/', '/bin/', '/usr/sbin/', '/sbin/', '/opt/homebrew/bin/', '/usr/local/bin/'].map(d => `(literal ${quote(d + c)})`)).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read* file-write* ${secret})`,
    `(deny file-write* ${protectedPaths})`,
    ...(binaries ? [`(deny process-exec ${binaries})`] : []),
    '(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))',
  ].join('\n');
}
