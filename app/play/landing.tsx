'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Mic,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Fingerprint,
  SlidersHorizontal,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import FamiliarProduct from './familiar-product';
import './landing.css';

const finishes = [
  { name: 'Lilac', color: '#b3a1f5' },
  { name: 'Chalk', color: '#fff9e8' },
  { name: 'Graphite', color: '#555361' },
];

const sdkExample = `import orbit from '@orbit/sdk';

const puck = await orbit.connect({
  target: 'simulator',
  control: ['screen'],
});

try {
  await puck.screen.draw(frame => {
    frame.clear('#09090c');
    frame.circle({
      center: frame.center,
      radius: 24,
      fill: '#ffe3c2',
    });
  });
} finally {
  await puck.close();
}`;

export default function Landing({
  publicSite = false,
}: {
  publicSite?: boolean;
}) {
  const [finish, setFinish] = useState(0);
  const [view, setView] = useState('angle');
  const [paused, setPaused] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [greeting, setGreeting] = useState(0);
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'failed'>(
    'ready',
  );
  const hello = () => {
    setQuiet(false);
    setPaused(false);
    setGreeting((n) => n + 1);
  };
  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(sdkExample);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="orbit-landing" id="top">
      <a className="ol-skip" href="#main">
        Skip to content
      </a>
      <header className="ol-header">
        <Link
          href={publicSite ? '/' : '/play'}
          className="ol-wordmark"
          aria-label="Orbit home"
        >
          <span className="ol-brand-dot" aria-hidden="true" />
          orbit<span className="ol-wordmark-period">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#experience">The experience</a>
          <a href="#object">The object</a>
          <a href="#build">Make it yours</a>
        </nav>
        <Link
          href={publicSite ? '/sim' : '/lab'}
          className="ol-header-link"
        >
          {publicSite ? 'Make your Orbit' : 'Open the lab'}{' '}
          <ArrowUpRight size={17} />
        </Link>
      </header>
      <main id="main">
        <section className="ol-hero" aria-labelledby="hero-title">
          <div className="ol-hero-copy">
            <p className="ol-eyebrow">
              <span /> A LITTLE DEVICE. YOUR AI.
            </p>
            <h1 id="hero-title">
              Take your
              <br />
              agent
              <br />
              <em>with you.</em>
            </h1>
            <p className="ol-intro">
              An expressive little device for the AI you use every day. Keep
              useful context close, talk through your work, and make it your
              own.
            </p>
            <a href="#experience" className="ol-button">
              Meet Orbit <ArrowDown size={19} />
            </a>
            <p className="ol-prototype-note">
              Launching on Kickstarter soon.
            </p>
          </div>
          <div className="ol-product" id="familiar">
            <div className="ol-stage">
              <div className="ol-stage-disc" aria-hidden="true" />
              <div className="ol-stage-top">
                <span>FAMILIAR / 001</span>
                <span className="ol-status-dot">
                  {quiet ? 'A quiet moment' : 'A little presence'}
                </span>
              </div>
              <FamiliarProduct
                shell={finishes[finish].color}
                view={view}
                paused={paused}
                quiet={quiet}
                greeting={greeting}
                onHello={hello}
                onQuiet={() => setQuiet((v) => !v)}
              />
              <div className="ol-stage-foot">
                <span>Same little face. A world of possibilities.</span>
                <button
                  onClick={() => setPaused((v) => !v)}
                  aria-label={
                    paused
                      ? 'Resume Familiar animation'
                      : 'Pause Familiar animation'
                  }
                >
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
              </div>
            </div>
            <div className="ol-product-controls">
              <div className="ol-finishes" aria-label="Shell finish">
                {finishes.map((f, i) => (
                  <button
                    key={f.name}
                    style={{ '--swatch': f.color } as React.CSSProperties}
                    onClick={() => setFinish(i)}
                    aria-label={`${f.name} shell`}
                    aria-pressed={finish === i}
                  />
                ))}
                <span>{finishes[finish].name}</span>
              </div>
              <div className="ol-views" aria-label="Device view">
                {[
                  ['angle', '¾'],
                  ['front', 'Front'],
                  ['side', 'Side'],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="ol-hello" onClick={hello}>
                Say hello <RotateCcw size={15} />
              </button>
            </div>
            <p className="ol-model-note">
              Explore the form. Turn the device or tap its screen.
              <br />
              Interactive preview · no microphone access.
            </p>
          </div>
        </section>
        <div className="ol-manifesto">
          <span>In your pocket.</span>
          <span>On your desk.</span>
          <span>A little more within reach.</span>
          <span aria-hidden="true">↗</span>
        </div>
        <section
          className="ol-section ol-experience"
          id="experience"
          aria-labelledby="experience-title"
        >
          <p className="ol-eyebrow">01 / THE EXPERIENCE</p>
          <div className="ol-section-heading">
            <h2 id="experience-title">
              Life happens
              <br />
              between prompts.
            </h2>
            <p>
              A conversation. A half-formed idea. The thing you meant to come
              back to. We’re making a little device that helps your AI stay
              closer to your day.
            </p>
          </div>
          <Tabs defaultValue="memory" className="ol-experience-tabs">
            <TabsList
              className="ol-tab-list"
              aria-label="Explore Orbit experiences"
            >
              <TabsTrigger value="memory">
                <span>01</span> Remember
              </TabsTrigger>
              <TabsTrigger value="computer">
                <span>02</span> Do
              </TabsTrigger>
              <TabsTrigger value="yours">
                <span>03</span> Make
              </TabsTrigger>
            </TabsList>
            <TabsContent value="memory">
              <div className="ol-experience-panel">
                <div className="ol-experience-copy">
                  <span className="ol-label">THE DIRECTION</span>
                  <h3>
                    Pick up where
                    <br />
                    your mind left off.
                  </h3>
                  <p>
                    Find the idea, the decision, and the conversation around it.
                    Useful memory your existing AI tools can return to, so you
                    don’t have to explain everything again.
                  </p>
                  <p className="ol-detail-note">
                    We’re exploring transcripts, speaker recognition, and shared
                    memory through MCP.
                  </p>
                </div>
                <div className="ol-memory-example">
                  <div className="ol-example-top">
                    <span>BACK TO THAT IDEA</span>
                    <span>Illustrative example</span>
                  </div>
                  <p className="ol-example-question">
                    “Where did we land
                    <br />
                    on the enclosure?”
                  </p>
                  <div className="ol-memory-note">
                    <span className="ol-note-heading">
                      FROM THE CONVERSATION
                    </span>
                    <p>
                      Keep the circular body. Test whether the mute switch is
                      easy to find by feel.
                    </p>
                    <div>
                      <span className="ol-note-dot" /> A decision, with its
                      context.
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="computer">
              <div className="ol-experience-panel">
                <div className="ol-experience-copy">
                  <span className="ol-label">YOUR COMPUTER, WITHIN REACH</span>
                  <h3>
                    Lean back.
                    <br />
                    Stay in control.
                  </h3>
                  <p>
                    Move your thumb to point. Hold still to dictate through your
                    Mac. A little less reaching for the keyboard, a little more
                    staying with your thought.
                  </p>
                  {!publicSite && (
                    <Link href="/lab?device=esp32" className="ol-text-link">
                      Try computer control <ArrowUpRight size={17} />
                    </Link>
                  )}
                </div>
                <div className="ol-computer-example">
                  <div className="ol-example-top">
                    <span>COMPUTER CONTEXT</span>
                    <span>One surface. Three gestures.</span>
                  </div>
                  <div className="ol-gesture">
                    <MousePointer2 size={22} />
                    <span>
                      Slide<small>Move the pointer</small>
                    </span>
                    <strong>Point</strong>
                  </div>
                  <div className="ol-gesture">
                    <Fingerprint size={22} />
                    <span>
                      Tap<small>A quick touch and release</small>
                    </span>
                    <strong>Click</strong>
                  </div>
                  <div className="ol-gesture">
                    <Mic size={22} />
                    <span>
                      Hold still<small>Release when you’re finished</small>
                    </span>
                    <strong>Dictate</strong>
                  </div>
                  <p>
                    From a thought to words on your screen.
                  </p>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="yours">
              <div className="ol-experience-panel">
                <div className="ol-experience-copy">
                  <span className="ol-label">MADE TO BE YOURS</span>
                  <h3>
                    A little character.
                    <br />A lot of possibility.
                  </h3>
                  <p>
                    The Familiar is a starting point. Draw your own face, try a
                    gesture, or build a small program around the way you work.
                    Start with a virtual device and take it from there.
                  </p>
                  <a href="#build" className="ol-text-link">
                    Meet the SDK <ArrowDown size={17} />
                  </a>
                </div>
                <div className="ol-make-example">
                  <div className="ol-example-top">
                    <span>YOUR TAKE ON ORBIT</span>
                    <span>Built to experiment with.</span>
                  </div>
                  <div className="ol-make-row">
                    <Sparkles size={24} />
                    <div>
                      <h4>Give it character.</h4>
                      <p>Draw shapes. Animate expressions.</p>
                    </div>
                  </div>
                  <div className="ol-make-row">
                    <Fingerprint size={24} />
                    <div>
                      <h4>Find your own gestures.</h4>
                      <p>Work with touch, motion, and buttons.</p>
                    </div>
                  </div>
                  <div className="ol-make-row">
                    <SlidersHorizontal size={24} />
                    <div>
                      <h4>Try it before you build it.</h4>
                      <p>Explore on the simulator first.</p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </section>
        <section
          className="ol-object-wrap"
          id="object"
          aria-labelledby="object-title"
        >
          <div className="ol-section ol-object">
            <div className="ol-object-intro">
              <p className="ol-eyebrow">02 / THE OBJECT</p>
              <h2 id="object-title">
                A little presence.
                <br />A familiar face.
              </h2>
              <p>
                Soft edges. A simple circle. A face that takes its time looking
                around. Something that feels at home in your hand, and a little
                more alive on your desk.
              </p>
              <div className="ol-dimensions">
                <div>
                  <strong>
                    48<span>mm</span>
                  </strong>
                  <span>ACROSS</span>
                </div>
                <div>
                  <strong>
                    12<span>mm</span>
                  </strong>
                  <span>DEEP</span>
                </div>
                <span className="ol-form-label">
                  CURRENT
                  <br />
                  FORM STUDY
                </span>
              </div>
              <p className="ol-detail-note">
                A form we’re exploring, with electronics, acoustics, and
                assembly still to work through.
              </p>
              <a
                href="/cad/orbit-form-study.scad"
                download
                className="ol-text-link"
              >
                Download the CAD study <Download size={17} />
              </a>
            </div>
            <div className="ol-object-details">
              <article>
                <span>01</span>
                <div>
                  <h3>A face, with feeling.</h3>
                  <p>
                    A circular touchscreen gives the Familiar room to look,
                    blink, and react. Subtle movement does the talking.
                  </p>
                </div>
              </article>
              <article>
                <span>02</span>
                <div>
                  <h3>Something to feel for.</h3>
                  <p>
                    A separate physical button is part of the form study. We’re
                    exploring what should be a touch, a hold, or a click.
                  </p>
                </div>
              </article>
              <article>
                <span>03</span>
                <div>
                  <h3>A clear way to go quiet.</h3>
                  <p>
                    A physical mute switch you can see and feel. A small detail
                    we want to get right.
                  </p>
                </div>
              </article>
              <a
                href="#familiar"
                className="ol-text-link"
                onClick={() => setView('side')}
              >
                Take a closer look <ArrowUpRight size={17} />
              </a>
            </div>
          </div>
        </section>
        <section
          className="ol-build-wrap"
          id="build"
          aria-labelledby="build-title"
        >
          <div className="ol-section ol-build">
            <div className="ol-build-copy">
              <p className="ol-eyebrow">03 / MAKE IT YOURS</p>
              <h2 id="build-title">
                Small device.
                <br />
                Open invitation.
              </h2>
              <p>
                Change an expression. Map a gesture. Build a little program that
                makes your day easier.
              </p>
              <p>
                Our TypeScript SDK gives you the screen, touch, and motion
                inputs to work with. The virtual device gives you somewhere to
                start.
              </p>
              {publicSite ? (
                <a href="/sim" className="ol-button">
                  Make your Orbit <ArrowUpRight size={19} />
                </a>
              ) : (
                <Link href="/lab" className="ol-button">
                  Explore the lab <ArrowUpRight size={19} />
                </Link>
              )}
              <span className="ol-build-note">
                {publicSite
                  ? 'Open source · Bun + TypeScript'
                  : 'Local developer preview · Bun + TypeScript'}
              </span>
            </div>
            <div className="ol-code-example">
              <div className="ol-code-top">
                <span>
                  <i /> Your first frame <small>TypeScript</small>
                </span>
                <button
                  onClick={copyExample}
                  aria-label="Copy TypeScript example"
                >
                  {copyState === 'copied' ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}{' '}
                  {copyState === 'copied' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre>
                <code>{sdkExample}</code>
              </pre>
              <p className="ol-code-note" aria-live="polite">
                {copyState === 'failed'
                  ? 'Copy wasn’t available. You can select the code above.'
                  : publicSite
                    ? 'Edit it live in the simulator. No device needed.'
                    : 'Draw a frame on an isolated virtual device. The SDK is currently available in this local workspace.'}
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="ol-footer">
        <Link href={publicSite ? '/' : '/play'} className="ol-wordmark">
          orbit.
        </Link>
        <p>Your AI, a little closer.</p>
        <Link href={publicSite ? '#top' : '/companion'}>
          {publicSite ? 'Back to top' : 'Open companion'}{' '}
          <ArrowUpRight size={17} />
        </Link>
        <span>
          Take your agent with you.
          {!publicSite && (
            <Link href="/paper">
              Explore the earlier form studies <ArrowUpRight size={14} />
            </Link>
          )}
        </span>
      </footer>
    </div>
  );
}
