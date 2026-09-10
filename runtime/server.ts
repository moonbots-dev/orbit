import { join, resolve, sep } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { watch } from 'node:fs';
import { compileProgram } from './compile';
import { readPackage } from './package';
import { examples } from './examples';

export async function startRuntime(options: { port?: number; assets?: string; program?: string; usb?: string } = {}) {
  if (options.usb && process.platform === 'darwin') {
    const owners = Bun.spawn(['/usr/sbin/lsof', '-t', options.usb], { stdout: 'pipe', stderr: 'pipe' });
    if ((await new Response(owners.stdout).text()).trim()) throw new Error('This USB port is already in use. Stop its existing bridge before running Orbit with --usb.');
    await owners.exited;
  }
  const root = resolve(import.meta.dir, '..');
  const assets = resolve(options.assets ?? join(root, 'dist/landing'));
  const scratch = await mkdtemp(join(tmpdir(), 'orbit-run-'));
  const token = crypto.randomUUID();
  const clients = new Set<any>();
  let scene: unknown, child: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;
  let source = examples[0].source as string, state = 'starting', error = '', lastAlive = 0;
  let closed = false, revision = 0, restarting: Promise<void> = Promise.resolve();
  const broadcast = (value: object) => {
    const payload = JSON.stringify(value);
    for (const ws of clients) { if (ws.getBufferedAmount() > 500000) ws.close(); else ws.send(payload); }
  };
  async function stopChild() {
    const previous = child; child = undefined;
    if (!previous) return;
    previous.kill('SIGTERM');
    await Promise.race([previous.exited, Bun.sleep(600)]);
    if (previous.exitCode === null) { previous.kill('SIGKILL'); await previous.exited; }
  }
  async function replace(program: ReturnType<typeof readPackage>) {
    await stopChild();
    if (closed) return;
    const path = join(scratch, `${++revision}.orbit`);
    await Bun.write(path, JSON.stringify(program));
    source = program.source; state = 'running'; error = ''; lastAlive = performance.now();
    const childPath = join(import.meta.dir, await Bun.file(join(import.meta.dir, 'child.js')).exists() ? 'child.js' : 'child.ts');
    const processHandle = Bun.spawn([process.execPath, childPath, path], {
      cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, ORBIT_RUNTIME_USB: options.usb ?? '' },
    });
    child = processHandle;
    broadcast({ type: 'status', state, source, physical: !!options.usb });
    const read = async (stream: ReadableStream<Uint8Array>, protocol: boolean) => {
      let pending = ''; const decoder = new TextDecoder();
      for await (const bytes of stream.values()) {
        if (child !== processHandle) return;
        pending += decoder.decode(bytes, { stream: true });
        if (pending.length > 1_500_000) { error = 'Program output exceeded its limit.'; await stopChild(); return; }
        const lines = pending.split('\n'); pending = lines.pop()!;
        for (const line of lines) {
          if (!protocol) { broadcast({ type: 'log', message: line.slice(0, 500) }); continue; }
          try {
            const value = JSON.parse(line);
            if (value.type === 'alive') { lastAlive = performance.now(); continue; }
            if (value.type === 'ready') value.code = program.code;
            if (value.type === 'frame') scene = value.scene;
            if (value.type === 'error') error = value.message;
            if (['frame', 'log', 'error', 'ready'].includes(value.type)) broadcast(value);
          } catch { /* Non-protocol stdout is ignored. */ }
        }
      }
    };
    void read(processHandle.stdout, true); void read(processHandle.stderr, false);
    void processHandle.exited.then(() => {
      if (child !== processHandle) return;
      child = undefined; state = 'stopped';
      broadcast({ type: 'status', state, error });
    });
  }
  const run = (program: ReturnType<typeof readPackage>) => {
    restarting = restarting.catch(() => {}).then(() => replace(program));
    return restarting;
  };
  const server = Bun.serve({
    hostname: '127.0.0.1', port: options.port ?? 4410,
    maxRequestBodySize: 2_100_000,
    async fetch(request, server) {
      const url = new URL(request.url), origin = `http://127.0.0.1:${server.port}`;
      if (url.host !== `127.0.0.1:${server.port}`) return new Response('Invalid host', { status: 403 });
      const sentOrigin = request.headers.get('origin');
      if (sentOrigin && sentOrigin !== origin) return new Response('Invalid origin', { status: 403 });
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
      if (url.pathname.startsWith('/api/')) {
        if (request.headers.get('authorization') !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 });
        if (url.pathname === '/api/status' && request.method === 'GET') return Response.json({ state, source, error, physical: !!options.usb });
        if (request.method !== 'POST' || sentOrigin !== origin) return new Response('POST from local app required', { status: 403 });
        try {
          if (url.pathname === '/api/run') {
            const body = await request.json() as any;
            if (typeof body.source !== 'string') throw new Error('Source required.');
            const program = compileProgram(body.source);
            await run(program);
          } else if (url.pathname === '/api/stop') {
            restarting = restarting.catch(() => {}).then(async () => { await stopChild(); state = 'stopped'; broadcast({ type: 'status', state }); });
            await restarting;
          }
          else if (url.pathname === '/api/input') {
            const value = await request.json(); const line = JSON.stringify(value);
            if (line.length > 2000) throw new Error('Input too large.');
            child?.stdin.write(line + '\n'); child?.stdin.flush();
          } else return new Response('Not found', { status: 404 });
          return Response.json({ ok: true });
        } catch (e) { return Response.json({ error: String(e) }, { status: 400 }); }
      }
      if (url.pathname === '/events') {
        // The token is sent as a WebSocket subprotocol, never in a query string.
        if (sentOrigin !== origin || request.headers.get('sec-websocket-protocol') !== `orbit-${token}`) return new Response('Unauthorized', { status: 401 });
        if (server.upgrade(request)) return;
        return new Response('Upgrade required', { status: 400 });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
      if (path === '/' || path === '/sim' || path === '/sim/') path = '/sim/index.html';
      const file = resolve(assets, '.' + path);
      if (!file.startsWith(assets + sep) || path.includes('..')) return new Response('Not found', { status: 404 });
      const blob = Bun.file(file);
      if (!await blob.exists()) return new Response('Not found', { status: 404 });
      const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'" };
      if (/orbit-worker-.*\.js$/.test(path)) headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";
      return new Response(blob, { headers });
    },
    websocket: {
      open(ws) { clients.add(ws); ws.send(JSON.stringify({ type: 'status', state, source, physical: !!options.usb })); if (scene) ws.send(JSON.stringify({ type: 'frame', scene })); },
      message() {}, close(ws) {
        clients.delete(ws);
        // A window disappearing must never leave a virtual contact held down.
        child?.stdin.write(JSON.stringify({ type: 'cancel' }) + '\n'); child?.stdin.flush();
      },
    },
  });
  const watchdog = setInterval(() => {
    if (child && performance.now() - lastAlive > 4000) {
      error = 'Program stopped responding. Edit it and run again.';
      broadcast({ type: 'error', message: error });
      void stopChild().then(() => { state = 'stopped'; broadcast({ type: 'status', state }); });
    }
  }, 1000);
  async function loadFile() {
    if (!options.program) return run(compileProgram(source));
    const text = await Bun.file(options.program).text();
    const packaged = options.program.endsWith('.orbit') ? readPackage(JSON.parse(text)) : undefined;
    // The reviewed source is authoritative, including for downloaded packages.
    return run(compileProgram(packaged?.source ?? text, packaged?.name));
  }
  try { await loadFile(); }
  catch (e) { closed = true; clearInterval(watchdog); await stopChild(); server.stop(true); await rm(scratch, { recursive: true, force: true }); throw e; }
  let timer: ReturnType<typeof setTimeout>;
  const watcher = options.program ? watch(resolve(options.program, '..'), (_, file) => {
    if (!file || resolve(resolve(options.program!, '..'), String(file)) !== resolve(options.program!)) return;
    clearTimeout(timer); timer = setTimeout(() => { void loadFile().catch(e => broadcast({ type: 'error', message: String(e) })); }, 180);
  }) : undefined;
  return {
    url: `http://127.0.0.1:${server.port}/sim?desktop=1`, port: server.port,
    async close() { closed = true; clearTimeout(timer); clearInterval(watchdog); watcher?.close(); await restarting; await stopChild(); server.stop(true); await rm(scratch, { recursive: true, force: true }); },
  };
}
