'use client';
import { useEffect, useRef, useState } from 'react';
import { Code2, Circle, SlidersHorizontal, BookOpen, Play, Square, ArrowUpRight, Download, RotateCcw, Bell, Pin, X, Box } from 'lucide-react';
import { createCanvasRenderer } from '@orbit/sdk/canvas';
import type { Scene } from '@orbit/sdk';
import Device from '../app/device';
import { examples } from '../runtime/examples';
import './studio.css';

const sourceKey = 'orbit.studio.source.v1';
const api = [
  ['orbit.connect(options)', 'Open the device supplied by this runtime. Use target: “runtime” and control: [“screen”].'],
  ['puck.screen.draw(frame => …)', 'Draw one complete frame. Clear first, then add primitives.'],
  ['puck.screen.animate((frame, timing) => …)', 'Animate with elapsedMs, deltaMs and frameIndex. Returns pause(), resume(), stop(), finished.'],
  ['frame.clear(color)', 'Set the background. Colors are #RRGGBB or #RRGGBBAA.'],
  ['frame.circle / ellipse / rect / line / path', 'Draw primitives with fill or stroke. frame.center and frame.size give the viewport.'],
  ['frame.save / restore / translate / rotate / scale', 'Transform a group of shapes. Angles are radians.'],
  ['puck.touch.on(“down” | “move” | “up”, handler)', 'Read position.x and position.y in 240 × 240 screen coordinates.'],
  ['puck.imu.on(“sample”, handler)', 'Read acceleration in m/s² and angularVelocity in rad/s.'],
  ['puck.buttons.on(“down” | “up”, handler)', 'Read button events. The virtual button is named “talk”.'],
  ['puck.switches.on(“change”, handler)', 'Read switch events. The virtual switch is named “mute”.'],
  ['onAttention(({ message }) => …)', 'Import from @orbit/sdk/runtime. React to an agent or the simulator’s attention button.'],
  ['puck.close()', 'Release the screen, stop animation and remove subscriptions.'],
];

export default function Studio() {
  const [source, setSource] = useState<string>(examples[0].source);
  const [panel, setPanel] = useState('home'), [desktop, setDesktop] = useState(false), [hud, setHud] = useState(false);
  const [state, setState] = useState('Starting'), [error, setError] = useState(''), [logs, setLogs] = useState<string[]>([]);
  const [object, setObject] = useState(false), [shell, setShell] = useState('#b3a1f5'), [mute, setMute] = useState(false);
  const [tilt, setTilt] = useState([0, 0]), [physical, setPhysical] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const renderer = useRef<ReturnType<typeof createCanvasRenderer> | null>(null);
  const latest = useRef<Scene | null>(null), worker = useRef<Worker | null>(null), ws = useRef<WebSocket | null>(null);
  const token = useRef(''), local = useRef(false), runId = useRef(0), lastAlive = useRef(0), deadline = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const compiled = useRef(''), compiledSource = useRef(''), currentSource = useRef<string>(examples[0].source), contact = useRef(false);
  const log = (message: string) => setLogs(previous => [...previous.slice(-29), message.slice(0, 500)]);
  const native = (action: string) => (window as any).webkit?.messageHandlers?.orbit?.postMessage(action);
  async function request(path: string, body?: object) {
    const response = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token.current, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error ?? 'The desktop runtime is unavailable.');
    return data;
  }
  function receive(value: any) {
    if (value.type === 'frame') {
      try { latest.current = value.scene; renderer.current?.draw(value.scene); }
      catch (e) { setError(String(e)); }
    } else if (value.type === 'alive') lastAlive.current = performance.now();
    else if (value.type === 'ready') { compiled.current = value.code ?? ''; compiledSource.current = currentSource.current; setState('Running'); }
    else if (value.type === 'error') { setError(value.message); setState('Needs a fix'); }
    else if (value.type === 'log') log(value.message);
    else if (value.type === 'status') {
      setState(value.state === 'running' ? 'Running' : 'Stopped'); setPhysical(!!value.physical);
      if (value.source) { currentSource.current = value.source; setSource(value.source); }
    }
  }
  function stopWorker() { worker.current?.terminate(); worker.current = null; clearInterval(deadline.current); }
  function runBrowser(text: string) {
    stopWorker(); const id = ++runId.current; setState('Starting'); setError(''); compiled.current = '';
    const instance = new Worker(new URL('../runtime/worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance; lastAlive.current = performance.now() + 10000;
    instance.onmessage = ({ data }) => { if (id === runId.current) receive(data); };
    instance.onerror = event => { setError(event.message); setState('Needs a fix'); stopWorker(); };
    instance.postMessage({ type: 'run', source: text });
    deadline.current = setInterval(() => {
      if (document.hidden) { lastAlive.current = performance.now(); return; }
      if (performance.now() - lastAlive.current > 4000) { stopWorker(); setState('Stopped'); setError('Your program stopped responding. Edit it and run again.'); }
    }, 1000);
  }
  async function run(text = currentSource.current) {
    setError(''); setLogs([]); currentSource.current = text;
    try {
      if (local.current) await request('run', { source: text });
      else { try { localStorage.setItem(sourceKey, text); } catch {} runBrowser(text); }
    } catch (e) { setError(String(e)); }
  }
  function input(value: object) {
    if (local.current) void request('input', value).catch(e => setError(String(e)));
    else worker.current?.postMessage({ type: 'input', value });
  }
  async function stop() {
    if (local.current) await request('stop', {}); else stopWorker(); setState('Stopped');
  }
  useEffect(() => {
    if (!canvas) return;
    const drawing = createCanvasRenderer(canvas); renderer.current = drawing;
    if (latest.current) drawing.draw(latest.current);
    return () => { drawing.dispose(); renderer.current = null; };
  }, [canvas]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    const isDesktop = params.get('desktop') === '1' && location.hostname === '127.0.0.1';
    local.current = isDesktop; setDesktop(isDesktop); setHud(params.get('hud') === '1');
    if (isDesktop) {
      void (async () => {
        const response = await fetch('/api/bootstrap'); const bootstrap = await response.json() as { token: string };
        if (cancelled) return;
        token.current = bootstrap.token;
        const socket = new WebSocket(location.origin.replace('http:', 'ws:') + '/events', 'orbit-' + token.current); ws.current = socket;
        socket.onmessage = ({ data }) => { if (!cancelled) receive(JSON.parse(data)); };
        socket.onclose = () => { if (!cancelled) { setState('Disconnected'); setError('The desktop runtime disconnected. Reopen Orbit to reconnect.'); } };
      })().catch(e => { if (!cancelled) setError(String(e)); });
    } else {
      let saved = examples[0].source as string;
      try { saved = localStorage.getItem(sourceKey) ?? saved; } catch { /* Private browsing can disable storage. */ }
      currentSource.current = saved; setSource(saved); runBrowser(saved);
    }
    return () => { cancelled = true; stopWorker(); ws.current?.close(); };
  }, []);
  function download(name: string, text: string) {
    if ((window as any).webkit?.messageHandlers?.orbit) {
      (window as any).webkit.messageHandlers.orbit.postMessage({ action: 'save-file', name, text }); return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(240, (event.clientX - rect.left) / rect.width * 240)), y: Math.max(0, Math.min(240, (event.clientY - rect.top) / rect.height * 240)) };
  };
  const release = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!contact.current) return; contact.current = false; input({ type: 'touch', phase: 'up', ...point(event) });
  };
  return <div className={`orbit-studio ${hud ? 'is-hud' : ''} ${panel !== 'home' ? 'has-panel' : ''}`} style={{ '--shell': shell } as React.CSSProperties}>
    {!hud && <aside className="os-rail" aria-label="Orbit navigation">
      <a href={desktop ? '#home' : '/'} className="os-logo" aria-label="Orbit home">o<span>·</span></a>
      <nav>{[['home', Circle, 'Home'], ['code', Code2, 'Code'], ['inputs', SlidersHorizontal, 'Inputs'], ['api', BookOpen, 'API']].map(([id, Icon, label]) => {
        const Glyph = Icon as typeof Circle; return <button key={String(id)} title={String(label)} aria-label={String(label)} aria-pressed={panel === id} onClick={() => setPanel(String(id))}><Glyph size={21} /></button>;
      })}</nav>
      <a href="https://orbit.moon-bots.com" title="Orbit website" aria-label="Orbit website"><ArrowUpRight size={20} /></a>
    </aside>}
    <main className="os-home">
      <header className="os-top"><div><span className="os-kicker">{desktop ? 'YOUR ORBIT' : 'MEET YOUR ORBIT'}</span><span className="os-running"><i className={state === 'Running' ? 'live' : ''} />{physical ? 'USB device' : 'Virtual device'} · {state}</span></div>
        {desktop && <button className="os-icon" aria-label={hud ? 'Close floating Orbit' : 'Show floating Orbit'} title={hud ? 'Close' : 'Float on desktop'} onClick={() => native(hud ? 'hide-hud' : 'show-hud')}>{hud ? <X size={17}/> : <Pin size={18}/>}</button>}
        {!desktop && <a className="os-top-link" href="https://github.com/moonbots-dev/orbit">Get the source <ArrowUpRight size={15}/></a>}
      </header>
      <div className="os-stage">
        <div className={`os-face ${object && !hud ? 'as-object' : ''}`}>
          <canvas ref={setCanvas} width={720} height={720} aria-label="Orbit touchscreen. Touch or drag to interact." className={object && !hud ? 'os-texture' : ''}
            onPointerDown={event => { if (physical || contact.current) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); contact.current = true; input({ type: 'touch', phase: 'down', ...point(event) }); }}
            onPointerMove={event => { if (contact.current) input({ type: 'touch', phase: 'move', ...point(event) }); }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}/>
          {object && canvas && !hud && <Device shell={shell} accent="#ff855e" mode="ready" displayCanvas={canvas} diameterMm={48} depthMm={12} onTalk={() => input({ type: 'attention', message: 'Hello, Orbit.' })} onMute={() => { setMute(!mute); input({ type: 'mute', value: !mute }); }} />}
        </div>
      </div>
      {!hud && <footer className="os-home-foot"><div><h1>A little presence.<br/><em>Entirely yours.</em></h1><p>{physical ? 'Your program is drawing on the connected puck.' : 'Touch the face. Change a line. Make it your own.'}</p></div>
        <div className="os-home-actions"><button className="os-primary" onClick={() => setPanel('code')}><Code2 size={17}/> Make it yours</button><button className="os-secondary" onClick={() => setObject(!object)}><Box size={16}/>{object ? 'Face view' : 'Object view'}</button></div>
      </footer>}
      {hud && <button className="os-hud-open" onClick={() => native('show-main')}>Open Orbit ↗</button>}
    </main>
    {!hud && panel !== 'home' && <section className="os-panel" aria-label={panel}>
      <header><div><span className="os-kicker">{panel === 'code' ? 'YOUR NEXT LITTLE IDEA' : panel === 'inputs' ? 'PLAY WITH THE INPUTS' : 'THE TOOLS ARE YOURS'}</span><h2>{panel === 'code' ? 'Make it yours.' : panel === 'inputs' ? 'Give it a nudge.' : 'Small API. Full control.'}</h2></div><button className="os-icon" aria-label="Close panel" onClick={() => setPanel('home')}><X size={18}/></button></header>
      {panel === 'code' && <>
        <label className="os-select-label">Start from <select aria-label="Example program" defaultValue="familiar" onChange={event => { const example = examples.find(e => e.id === event.target.value)!; setSource(example.source); currentSource.current = example.source; void run(example.source); }}>{examples.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <div className="os-editor-top"><span>orbit.ts</span><span>TypeScript</span></div>
        <textarea aria-label="Orbit TypeScript program" spellCheck={false} value={source} onChange={event => { setSource(event.target.value); currentSource.current = event.target.value; }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void run(); } }} />
        <div className="os-code-actions"><button className="os-primary" onClick={() => void run()}><Play size={15}/> Run</button><button className="os-secondary" onClick={() => void stop().catch(e => setError(String(e)))}><Square size={14}/> Stop</button><button className="os-icon" title="Download TypeScript" aria-label="Download TypeScript" onClick={() => download('orbit.ts', source)}><Download size={18}/></button><button className="os-icon" title="Restore Familiar" aria-label="Restore Familiar" onClick={() => { setSource(examples[0].source); currentSource.current = examples[0].source; void run(); }}><RotateCcw size={17}/></button></div>
        <p className="os-small">⌘ Enter to run. {desktop ? 'Desktop programs run locally with Bun permissions.' : 'Your code runs in this browser. Source stays on this device.'}</p>
        <button className="os-secondary" onClick={() => {
          if (!compiled.current || compiledSource.current !== source) { setError('Run this version first, then export its package.'); return; }
          download('my-orbit.orbit', JSON.stringify({ version: 1, name: 'My Orbit', source, code: compiled.current }, null, 2));
        }}>Export .orbit package <Download size={16}/></button>
        <details><summary>Use with your AI coding agent</summary><p>Download orbit.ts and ask your agent to edit it. In the Orbit repository, run <code>bun run orbit dev orbit.ts</code>. Save the file to reload it here.</p><button className="os-secondary" onClick={() => { void navigator.clipboard.writeText("Build an Orbit program in TypeScript using @orbit/sdk. Start with orbit.connect({ target: 'runtime', control: ['screen'] }). Draw with puck.screen.animate((frame, timing) => { ... }); frame.clear('#09090c') first. Use frame.circle, ellipse, rect, line or path. Use puck.touch.on('down'/'move'/'up', handler). Screen coordinates are 240 × 240. No browser DOM or Node imports. Read SDK API.md and the example orbit.ts in the repository. Preserve clean lifecycle; await animation.finished.").then(() => log('Agent instructions copied.')).catch(e => setError(String(e))); }}>Copy agent instructions</button></details>
      </>}
      {panel === 'inputs' && <div className="os-inputs"><p>Send the same kinds of events a physical Orbit provides.</p><button className="os-primary" onClick={() => input({ type: 'attention', message: 'Your agent has something for you.' })}><Bell size={17}/> Ask for attention</button><button className="os-secondary" disabled={physical} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); input({ type: 'button', down: true }); }} onPointerUp={() => input({ type: 'button', down: false })} onPointerCancel={() => input({ type: 'button', down: false })} onLostPointerCapture={() => input({ type: 'button', down: false })} onKeyDown={event => { if (event.key === ' ' && !event.repeat) input({ type: 'button', down: true }); }} onKeyUp={event => { if (event.key === ' ') input({ type: 'button', down: false }); }}>Hold the side button</button><label className="os-toggle">Mute switch<input type="checkbox" checked={mute} disabled={physical} onChange={event => { setMute(event.target.checked); input({ type: 'mute', value: event.target.checked }); }}/></label>
        {['Tilt left / right', 'Tilt forward / back'].map((label, i) => <label className="os-slider" key={label}>{label}<input type="range" min={-0.7} max={0.7} step={0.01} value={tilt[i]} disabled={physical} onChange={event => { const next = [...tilt]; next[i] = Number(event.target.value); setTilt(next); input({ type: 'tilt', x: next[0], y: next[1] }); }}/></label>)}
        <div className="os-finishes"><span>Shell finish</span>{['#b3a1f5', '#fff9e8', '#555361'].map((color, i) => <button key={color} aria-label={['Lilac shell','Chalk shell','Graphite shell'][i]} aria-pressed={shell === color} style={{ background: color }} onClick={() => setShell(color)}/>)}</div><p className="os-small">Inputs affect programs that subscribe to them. Try “An agent needs you” in Code.</p></div>}
      {panel === 'api' && <div className="os-api">{api.map(([name, description]) => <article key={name}><code>{name}</code><p>{description}</p></article>)}<a href="/sdk-api.md" download className="os-secondary">Download the full API <Download size={16}/></a></div>}
      {(error || logs.length > 0) && <div className="os-console" aria-live="polite">{error && <p className="os-error">{error}</p>}{logs.slice(-5).map((line, i) => <p key={i}>{line}</p>)}</div>}
    </section>}
    {panel === 'home' && error && <div className="os-toast" role="alert">{error}<button onClick={() => setPanel('code')}>Open code</button></div>}
  </div>;
}
