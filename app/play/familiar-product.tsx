'use client';

import { useEffect, useRef, useState } from 'react';
import { Character, DEFAULT_SETTINGS, projectEyes } from '@orbit/familiar';
import Device from '../device';

export default function FamiliarProduct({
  shell,
  view,
  paused,
  quiet,
  greeting,
  onHello,
  onQuiet,
}: {
  shell: string;
  view: string;
  paused: boolean;
  quiet: boolean;
  greeting: number;
  onHello: () => void;
  onQuiet: () => void;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const character = useRef<Character | null>(null);
  const live = useRef({ paused, quiet });
  const visible = useRef(true);

  useEffect(() => {
    live.current = { paused, quiet };
  }, [paused, quiet]);

  useEffect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const familiar = new Character(70319, { ...DEFAULT_SETTINGS });
    familiar.advance(1200);
    character.current = familiar;
    let time = 1200,
      previous = 0,
      frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    if (root.current) observer.observe(root.current);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const delta = previous ? Math.min(now - previous, 60) : 0;
      previous = now;
      if (!visible.current || document.hidden) return;
      if (!live.current.paused && !reducedMotion.matches) {
        time += delta;
        familiar.advance(time);
      }
      const scene = projectEyes(familiar.pose(), familiar.settings);
      ctx.setTransform(3, 0, 0, 3, 0, 0);
      ctx.fillStyle = scene.background;
      ctx.fillRect(0, 0, 240, 240);
      ctx.save();
      ctx.beginPath();
      ctx.arc(120, 120, scene.clipRadius, 0, Math.PI * 2);
      ctx.clip();
      for (const eye of scene.paths) {
        ctx.fillStyle = live.current.quiet ? '#b5a88e' : eye.fill;
        ctx.beginPath();
        eye.points.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };
    draw(0);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      character.current = null;
    };
  }, [canvas]);

  useEffect(() => {
    if (!greeting) return;
    character.current?.notice({ x: 0.08, y: -0.08 });
    character.current?.blink();
  }, [canvas, greeting]);

  return (
    <div ref={root} className="ol-product-canvas">
      <canvas
        ref={setCanvas}
        width={720}
        height={720}
        hidden
        aria-hidden="true"
      />
      {canvas && (
        <Device
          shell={shell}
          accent="#ff7446"
          mode={quiet ? 'muted' : 'ready'}
          displayCanvas={canvas}
          view={view}
          diameterMm={48}
          depthMm={12}
          onTalk={onHello}
          onMute={onQuiet}
        />
      )}
    </div>
  );
}
