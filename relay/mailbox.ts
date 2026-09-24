// A git repository both sides can reach (a private GitHub repo) used as a
// mailbox. Each branch has exactly one writer, so pushes never race:
//   requests-<device>  cloud  → laptop  (signed envelopes)
//   results-<device>   laptop → cloud
//   presence-<device>  laptop → cloud  (single commit, replaced on each heartbeat)
import { existsSync, mkdirSync } from 'node:fs';
import { idTime } from './protocol';

export interface Entry { name: string; data: Uint8Array }

export class Mailbox {
  constructor(readonly dir: string, readonly remote: string) {}

  async init() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.dir + '/HEAD')) await this.git(['init', '--bare', '--quiet']);
    await this.git(['config', 'remote.origin.url', this.remote]);
    return this;
  }

  async fetch() {
    await this.git(['fetch', '--quiet', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
  }

  async list(branch: string): Promise<string[]> {
    if (!(await this.has(branch))) return [];
    const out = await this.git(['ls-tree', '--name-only', 'refs/remotes/origin/' + branch]);
    return new TextDecoder().decode(out).split('\n').filter(Boolean);
  }

  async read(branch: string, name: string): Promise<Uint8Array | undefined> {
    try { return await this.git(['cat-file', 'blob', `refs/remotes/origin/${branch}:${name}`]); } catch { return undefined; }
  }

  // Adds files to a branch. `replace` makes a parentless commit holding only
  // these files; otherwise existing files are kept except those `prune` drops.
  async put(branch: string, files: Entry[], message: string, options: { replace?: boolean; prune?: (name: string) => boolean } = {}) {
    for (let attempt = 0; ; attempt++) {
      const parent = options.replace || !(await this.has(branch)) ? undefined : await this.rev(branch);
      const entries = new Map<string, string>();
      if (parent) {
        const tree = new TextDecoder().decode(await this.git(['ls-tree', parent]));
        for (const line of tree.split('\n').filter(Boolean)) {
          const name = line.slice(line.indexOf('\t') + 1);
          if (!options.prune?.(name)) entries.set(name, line);
        }
      }
      for (const file of files) {
        const sha = new TextDecoder().decode(await this.git(['hash-object', '-w', '--stdin'], file.data)).trim();
        entries.set(file.name, `100644 blob ${sha}\t${file.name}`);
      }
      const tree = new TextDecoder().decode(await this.git(['mktree'], new TextEncoder().encode([...entries.values()].join('\n') + '\n'))).trim();
      const commit = new TextDecoder().decode(await this.git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message])).trim();
      try {
        await this.git(['push', '--quiet', ...(options.replace ? ['--force'] : []), 'origin', `${commit}:refs/heads/${branch}`]);
        await this.git(['update-ref', 'refs/remotes/origin/' + branch, commit]);
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        await this.fetch();
      }
    }
  }

  private async has(branch: string) {
    try { await this.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branch]); return true; } catch { return false; }
  }
  private async rev(branch: string) {
    return new TextDecoder().decode(await this.git(['rev-parse', 'refs/remotes/origin/' + branch])).trim();
  }

  private async git(args: string[], input?: Uint8Array): Promise<Uint8Array> {
    const proc = Bun.spawn(['git', '--git-dir', this.dir, ...args], {
      stdin: input ?? 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, GIT_AUTHOR_NAME: 'Orbit Relay', GIT_AUTHOR_EMAIL: 'relay@orbit.local', GIT_COMMITTER_NAME: 'Orbit Relay', GIT_COMMITTER_EMAIL: 'relay@orbit.local', GIT_TERMINAL_PROMPT: '0' },
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).arrayBuffer().then(b => new Uint8Array(b)), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`git ${args[0]} failed: ${err.trim()}`);
    return out;
  }
}

export const branches = (device: string) => ({ requests: `requests-${device}`, results: `results-${device}`, presence: `presence-${device}` });

// Mailbox files are named <id>.<ext>; ids begin with their creation time.
export const olderThan = (ms: number, now = Date.now()) => (name: string) => {
  const time = idTime(name);
  return Number.isFinite(time) && time < now - ms;
};
