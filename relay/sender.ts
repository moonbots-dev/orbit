// Cloud side: signs a request, drops it in the mailbox and waits for the result.
import { Mailbox, branches, olderThan } from './mailbox';
import { MAX_LIFETIME_MS, newId, signRequest, type Action, type Presence, type Result } from './protocol';

const KEEP_MS = 24 * 60 * 60 * 1000;
export const ONLINE_MS = 90_000;

export interface SenderOptions { mailbox: Mailbox; device: string; privateKey: string }

export class Sender {
  readonly names;
  constructor(readonly options: SenderOptions) { this.names = branches(options.device); }

  async presence(): Promise<(Presence & { online: boolean }) | undefined> {
    await this.options.mailbox.fetch();
    const raw = await this.options.mailbox.read(this.names.presence, 'presence.json');
    if (!raw) return undefined;
    const presence = JSON.parse(new TextDecoder().decode(raw)) as Presence;
    return { ...presence, online: Date.now() - presence.seenAt < ONLINE_MS };
  }

  async send(action: Action, lifetimeMs = 10 * 60 * 1000) {
    const now = Date.now();
    const id = newId(now);
    const envelope = signRequest({ v: 1, id, device: this.options.device, issuedAt: now, expiresAt: now + Math.min(lifetimeMs, MAX_LIFETIME_MS), action }, this.options.privateKey);
    await this.options.mailbox.fetch();
    await this.options.mailbox.put(this.names.requests, [{ name: id + '.json', data: new TextEncoder().encode(JSON.stringify(envelope)) }], `request ${id} ${action.kind}`, { prune: olderThan(KEEP_MS) });
    return id;
  }

  async wait(id: string, timeoutMs: number, pollMs = 2000): Promise<Result | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.options.mailbox.fetch();
      const raw = await this.options.mailbox.read(this.names.results, id + '.json');
      if (raw) return JSON.parse(new TextDecoder().decode(raw)) as Result;
      if (Date.now() >= deadline) return undefined;
      await Bun.sleep(pollMs);
    }
  }

  attachment(name: string) { return this.options.mailbox.read(this.names.results, name); }
}
