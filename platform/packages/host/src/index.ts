import { timingSafeEqual } from 'node:crypto';
import {
  OrbitError,
  type AdapterSession,
  type DeviceAdapter,
  type DeviceInfo,
  type Subscription,
} from '@orbit/sdk';
import { createSimulator, type Simulator } from '@orbit/sdk/simulation';
import {
  decodeMessage,
  MAX_MESSAGE_BYTES,
  type WireMessage,
} from '@orbit/sdk/protocol';
import type { ServerWebSocket } from 'bun';
import { previewPage } from './preview-page.js';

interface Client {
  phase: 'unauthenticated' | 'opening' | 'ready' | 'closed';
  timer?: ReturnType<typeof setTimeout>;
  session?: AdapterSession;
  subscriptions: Subscription[];
  pending: Map<number, AbortController>;
  lastFrame: number;
  rateAt: number;
  messages: number;
}
export interface HostOptions {
  /** Caller supplies a local credential. This host never publishes or persists it. */
  token: string;
  port?: number;
  origins?: readonly string[];
  simulator?: Simulator;
  /** Broker an already opened physical adapter. The caller owns its lifetime. */
  device?: { target: DeviceAdapter; info: DeviceInfo };
  /** Issue an ephemeral credential only to an explicitly allowed browser Origin. */
  localBootstrap?: boolean;
  /** Serve a local SDK canvas and virtual input controls. Default false. */
  preview?: boolean;
  /** Optional application service. Authenticated, loopback-only, no SDK protocol changes. */
  localService?: { handle(request: Request): Promise<Response> };
}

/** Bun-only, loopback-only broker. It shares one device among clients. */
export function createHost(options: HostOptions) {
  if (
    typeof options.token !== 'string' ||
    options.token.length < 16 ||
    options.token.length > 256
  )
    throw new Error('Provide an Orbit host token of 16–256 characters.');
  const secret = Buffer.from(options.token);
  const authorized = (value: unknown) =>
    typeof value === 'string' &&
    Buffer.byteLength(value) === secret.length &&
    timingSafeEqual(Buffer.from(value), secret);
  if (options.device && (options.simulator || options.preview))
    throw new Error(
      'A physical host cannot also enable virtual inputs or the simulator preview.',
    );
  if (options.localBootstrap && !options.origins?.length)
    throw new Error(
      'Local bootstrap requires an explicit browser Origin allowlist.',
    );
  const simulator = options.simulator ?? createSimulator();
  const device = options.device ?? simulator;
  const clients = new Set<ServerWebSocket<Client>>();
  const origins = options.origins ?? [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  const send = (ws: ServerWebSocket<Client>, value: WireMessage) =>
    ws.send(JSON.stringify(value));
  const cleanup = async (ws: ServerWebSocket<Client>) => {
    ws.data.phase = 'closed';
    clearTimeout(ws.data.timer);
    for (const sub of ws.data.subscriptions) sub.unsubscribe();
    for (const controller of ws.data.pending.values()) controller.abort();
    ws.data.pending.clear();
    await ws.data.session?.close();
    clients.delete(ws);
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 4401,
    maxRequestBodySize: 4096,
    async fetch(request, service) {
      const url = new URL(request.url),
        origin = request.headers.get('origin');
      if (
        ![`localhost:${service.port}`, `127.0.0.1:${service.port}`].includes(
          request.headers.get('host') ?? '',
        )
      )
        return new Response('Invalid host', { status: 403 });
      const ownOrigin = origin === `http://${request.headers.get('host')}`;
      if (
        origin &&
        !origins.includes(origin) &&
        !(options.preview && ownOrigin)
      )
        return new Response('Origin denied', { status: 403 });
      const cors: Record<string, string> = origin
        ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
        : {};
      if (url.pathname === '/computer' && options.localService) {
        const headers = { ...cors, 'Cache-Control': 'no-store' };
        if (request.method === 'OPTIONS')
          return new Response(null, {
            headers: {
              ...headers,
              'Access-Control-Allow-Methods': 'GET, POST',
              'Access-Control-Allow-Headers':
                'Authorization, Content-Type, X-Orbit-Owner',
            },
          });
        if (
          !authorized(
            request.headers.get('authorization')?.replace(/^Bearer /, ''),
          )
        )
          return new Response('Authentication required', {
            status: 401,
            headers,
          });
        try {
          const result = await options.localService.handle(request);
          for (const [key, value] of Object.entries(headers))
            result.headers.set(key, value);
          return result;
        } catch {
          return new Response('Computer service unavailable', {
            status: 503,
            headers,
          });
        }
      }
      if (request.method === 'OPTIONS' && url.pathname === '/devices')
        return new Response(null, {
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Authorization',
          },
        });
      if (options.preview && url.pathname.startsWith('/preview/')) {
        const headers = {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        };
        if (
          !authorized(
            request.headers.get('authorization')?.replace(/^Bearer /, ''),
          )
        )
          return new Response('Authentication required', { status: 401 });
        if (url.pathname === '/preview/snapshot' && request.method === 'GET')
          return Response.json(simulator.snapshot(), { headers });
        if (url.pathname === '/preview/input' && request.method === 'POST') {
          try {
            const bytes = await request.arrayBuffer();
            if (bytes.byteLength > 4096)
              return new Response('Input too large', { status: 413 });
            const event = JSON.parse(new TextDecoder().decode(bytes));
            switch (event?.type) {
              case 'touch':
                simulator.input.touch({
                  phase: event.phase,
                  contactId: event.contactId,
                  position: event.position,
                });
                break;
              case 'button':
                simulator.input.button({ id: event.id, phase: event.phase });
                break;
              case 'switch':
                simulator.input.switch({ id: event.id, value: event.value });
                break;
              case 'cancel':
                simulator.input.cancel();
                break;
              default:
                throw new Error('Unsupported virtual input.');
            }
            return Response.json({ ok: true }, { headers });
          } catch {
            return new Response('Invalid virtual input', { status: 400 });
          }
        }
        return new Response('Not found', { status: 404 });
      }
      if (request.method !== 'GET')
        return new Response('Method not allowed', { status: 405 });
      if (options.preview && url.pathname === '/')
        return new Response(
          previewPage({ token: options.token, deviceId: simulator.info.id }),
          {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'Referrer-Policy': 'no-referrer',
              'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
            },
          },
        );
      if (options.preview && url.pathname === '/preview.js')
        return new Response(
          Bun.file(new URL('./preview-browser.js', import.meta.url)),
          {
            headers: {
              'Content-Type': 'text/javascript',
              'Cache-Control': 'no-store',
            },
          },
        );
      if (url.pathname === '/bootstrap' && options.localBootstrap) {
        if (!origin || !origins.includes(origin))
          return new Response('Origin required', { status: 403 });
        return Response.json(
          { token: options.token, deviceId: device.info.id },
          {
            headers: {
              ...cors,
              'Cache-Control': 'no-store',
              'Referrer-Policy': 'no-referrer',
            },
          },
        );
      }
      if (url.pathname === '/health')
        return Response.json({
          version: 1,
          source: device.info.source,
          physicalDeviceOpened: device.info.source === 'physical',
        });
      if (url.pathname === '/devices') {
        const credential = request.headers
          .get('authorization')
          ?.replace(/^Bearer /, '');
        if (!authorized(credential))
          return new Response('Authentication required', {
            status: 401,
            headers: cors,
          });
        return Response.json(
          { version: 1, devices: [device.info] },
          { headers: cors },
        );
      }
      if (url.pathname !== '/session')
        return new Response('Not found', { status: 404 });
      if (clients.size >= 16)
        return new Response('Client limit reached', { status: 503 });
      if (
        service.upgrade(request, {
          data: {
            phase: 'unauthenticated',
            subscriptions: [],
            pending: new Map(),
            lastFrame: 0,
            rateAt: performance.now(),
            messages: 0,
          },
        })
      )
        return;
      return new Response('WebSocket upgrade required', { status: 426 });
    },
    websocket: {
      data: {} as Client,
      maxPayloadLength: MAX_MESSAGE_BYTES,
      backpressureLimit: MAX_MESSAGE_BYTES * 2,
      closeOnBackpressureLimit: true,
      idleTimeout: 0,
      open(ws) {
        clients.add(ws);
        ws.data.timer = setTimeout(
          () => ws.close(1008, 'Authentication timeout'),
          3000,
        );
      },
      async message(ws, raw) {
        let frameId: number | undefined;
        try {
          const now = performance.now();
          if (now - ws.data.rateAt >= 1000) {
            ws.data.rateAt = now;
            ws.data.messages = 0;
          }
          if (++ws.data.messages > 500) {
            ws.close(1008, 'Message rate exceeded');
            return;
          }
          if (typeof raw !== 'string')
            throw new OrbitError(
              'invalid-value',
              'host',
              'Expected JSON text.',
            );
          const m = decodeMessage(raw);
          if (m.kind === 'open') {
            if (ws.data.phase !== 'unauthenticated' || !authorized(m.token))
              throw new OrbitError(
                'connection-lost',
                'host',
                'Authentication failed.',
              );
            if (
              m.deviceId !== device.info.id ||
              !Array.isArray(m.control) ||
              m.control.some((x) => x !== 'screen') ||
              m.control.length > 1
            )
              throw new OrbitError(
                'invalid-value',
                'host',
                'Invalid device or control request.',
              );
            ws.data.phase = 'opening';
            const session = await device.target.open({ control: m.control });
            if ((ws.data.phase as string) === 'closed') {
              await session.close();
              return;
            }
            clearTimeout(ws.data.timer);
            ws.data.session = session;
            ws.data.phase = 'ready';
            send(ws, {
              version: 1,
              kind: 'hello',
              info: session.info,
              capabilities: session.capabilities,
            });
            ws.data.subscriptions.push(
              session.onInput((event) => {
                send(ws, { version: 1, kind: 'input', event });
              }),
              session.onFrame((event) => {
                send(ws, { version: 1, kind: 'frame', event });
              }),
              session.onDisconnect(() => ws.close(1011, 'Device disconnected')),
            );
            return;
          }
          if (ws.data.phase !== 'ready' || !ws.data.session)
            throw new OrbitError(
              'connection-lost',
              'host',
              'Authenticate before issuing commands.',
            );
          if (m.kind === 'pong') return;
          if (m.kind === 'cancel') {
            ws.data.pending.get(m.frameId as number)?.abort();
            return;
          }
          if (m.kind !== 'present')
            throw new OrbitError('unsupported', 'host', 'Unsupported command.');
          if (
            !Number.isSafeInteger(m.frameId) ||
            (m.frameId as number) <= ws.data.lastFrame
          )
            throw new OrbitError(
              'invalid-value',
              'host',
              'Frame IDs must increase.',
            );
          frameId = m.frameId as number;
          ws.data.lastFrame = frameId;
          if (ws.data.pending.size >= 8)
            throw new OrbitError(
              'queue-full',
              'host',
              'Too many pending frames.',
            );
          const controller = new AbortController();
          ws.data.pending.set(frameId, controller);
          try {
            const result = await ws.data.session.present(
              m.scene as never,
              frameId,
              {
                signal: controller.signal,
                acknowledgement: m.acknowledgement as never,
              },
            );
            if (ws.data.phase === 'ready')
              send(ws, { version: 1, kind: 'result', frameId, result });
          } finally {
            ws.data.pending.delete(frameId);
          }
        } catch (error) {
          const e =
            error instanceof OrbitError
              ? error
              : new OrbitError(
                  'invalid-value',
                  'host',
                  'Invalid host message.',
                );
          send(ws, {
            version: 1,
            kind: 'error',
            code: e.code,
            message: e.message,
            ...(frameId === undefined ? {} : { frameId }),
          });
          if (ws.data.phase !== 'ready') ws.close(1008, 'Handshake rejected');
        }
      },
      close(ws) {
        void cleanup(ws);
      },
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    port: server.port!,
    simulator,
    async close() {
      const connectedClients = [...clients];
      for (const ws of connectedClients) {
        await cleanup(ws);
        ws.close(1001, 'Host closed');
      }
      await server.stop(true);
      if (!options.simulator) await simulator.close();
    },
  };
}
