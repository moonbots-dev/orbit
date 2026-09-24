// Wire format shared by the cloud sender and the laptop agent.
// Requests are signed with Ed25519; the laptop holds only the public key.
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

export const MAX_LIFETIME_MS = 60 * 60 * 1000;
export const MAX_TIMEOUT_MS = 30 * 60 * 1000;
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
const ID = /^\d{13}-[0-9a-f]{16}$/;
const DEVICE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type Action =
  | { kind: 'ping' }
  | { kind: 'run'; argv: string[]; cwd?: string; timeoutMs?: number; stdin?: string }
  | { kind: 'open'; target?: string; app?: string }
  | { kind: 'screenshot' };

export interface Request { v: 1; id: string; device: string; issuedAt: number; expiresAt: number; action: Action }
export interface Envelope { payload: string; signature: string }

export type Status = 'ok' | 'failed' | 'timeout' | 'denied' | 'rejected' | 'expired';
export interface Result {
  v: 1; id: string; device: string; status: Status; reason?: string;
  exitCode?: number | null; stdout?: string; stderr?: string; truncated?: boolean;
  attachment?: string; startedAt: number; finishedAt: number;
}
export interface Presence {
  v: 1; device: string; hostname: string; platform: string; seenAt: number; paused: boolean;
  roots: string[]; serialPorts: string[];
}

export const newId = (now = Date.now()) => `${String(now).padStart(13, '0')}-${randomBytes(8).toString('hex')}`;
export const idTime = (id: string) => Number(id.slice(0, 13));
export const isId = (id: string) => ID.test(id);
export const isDevice = (device: string) => DEVICE.test(device);

export function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

export function signRequest(request: Request, privateKey: string): Envelope {
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const payload = JSON.stringify(request);
  return { payload, signature: sign(null, Buffer.from(payload), key).toString('base64') };
}

export function publicKeyOf(privateKey: string) {
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
}

// Throws with a reason when the envelope must not run. The signature is checked
// before any field of the payload is trusted.
export function openEnvelope(raw: unknown, publicKey: string, device: string, now = Date.now()): Request {
  const envelope = raw as Envelope;
  if (typeof envelope?.payload !== 'string' || typeof envelope?.signature !== 'string') throw new Error('malformed envelope');
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature, 'base64'))) throw new Error('bad signature');
  const request = JSON.parse(envelope.payload) as Request;
  if (request.v !== 1 || !isId(request.id)) throw new Error('bad id');
  if (request.device !== device) throw new Error('request is for another device');
  if (!Number.isFinite(request.issuedAt) || !Number.isFinite(request.expiresAt)) throw new Error('bad timestamps');
  if (request.issuedAt > now + CLOCK_SKEW_MS) throw new Error('issued in the future');
  if (request.expiresAt - request.issuedAt > MAX_LIFETIME_MS) throw new Error('lifetime too long');
  if (request.expiresAt <= now) throw new Error('expired');
  validateAction(request.action);
  return request;
}

function validateAction(action: Action) {
  const text = (value: unknown) => typeof value === 'string' && !value.includes('\0');
  switch (action?.kind) {
    case 'ping': case 'screenshot': return;
    case 'run':
      if (!Array.isArray(action.argv) || action.argv.length === 0 || !action.argv.every(text)) throw new Error('bad argv');
      if (action.cwd !== undefined && !text(action.cwd)) throw new Error('bad cwd');
      if (action.stdin !== undefined && typeof action.stdin !== 'string') throw new Error('bad stdin');
      if (action.timeoutMs !== undefined && !(action.timeoutMs > 0 && action.timeoutMs <= MAX_TIMEOUT_MS)) throw new Error('bad timeout');
      return;
    case 'open':
      if (action.target === undefined && action.app === undefined) throw new Error('open needs a target or app');
      if ((action.target !== undefined && !text(action.target)) || (action.app !== undefined && !text(action.app))) throw new Error('bad open');
      return;
    default: throw new Error('unknown action');
  }
}
