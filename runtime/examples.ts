export const examples = [
  { id: 'familiar', name: 'The Familiar', description: 'The original eyes. Touch to get its attention.', source: `import orbit from '@orbit/sdk';
import { Character, DEFAULT_SETTINGS, drawFamiliar } from '@orbit/familiar';
import { onAttention } from '@orbit/sdk/runtime';

const puck = await orbit.connect({ target: 'runtime', control: ['screen'] });
const character = new Character(70319, { ...DEFAULT_SETTINGS });
character.advance(1200);

puck.touch.on('down', ({ position }) => {
  character.notice({ x: (position.x - 120) / 120, y: (position.y - 120) / 120 });
  character.blink();
});
onAttention(() => {
  character.notice({ x: 0, y: -0.2 });
  character.blink();
});

const animation = puck.screen.animate((frame, timing) => {
  character.advance(1200 + timing.elapsedMs);
  drawFamiliar(frame, character.pose(), character.settings);
}, { fps: 30 });

await animation.finished;
` },
  { id: 'draw', name: 'Follow your finger', description: 'A tiny drawing program built from touch and circles.', source: `import orbit from '@orbit/sdk';
import type { Point } from '@orbit/sdk';

const puck = await orbit.connect({ target: 'runtime', control: ['screen'] });
const trail: Point[] = [];
const remember = ({ position }: { position: Point }) => {
  trail.push(position);
  if (trail.length > 35) trail.shift();
};
puck.touch.on('down', remember);
puck.touch.on('move', remember);

const animation = puck.screen.animate((frame, timing) => {
  frame.clear('#171722');
  if (!trail.length) {
    frame.circle({ center: frame.center, radius: 18 + Math.sin(timing.elapsedMs / 500) * 3, fill: '#b3a1f5' });
  }
  trail.forEach((point, index) => {
    frame.circle({ center: point, radius: 3 + index / 4, fill: index === trail.length - 1 ? '#ff855e' : '#b3a1f5' });
  });
}, { fps: 30 });
await animation.finished;
` },
  { id: 'attention', name: 'An agent needs you', description: 'Send an attention event. Tap to acknowledge it.', source: `import orbit from '@orbit/sdk';
import { Character, DEFAULT_SETTINGS, drawFamiliar } from '@orbit/familiar';
import { onAttention } from '@orbit/sdk/runtime';

const puck = await orbit.connect({ target: 'runtime', control: ['screen'] });
const character = new Character(70319, { ...DEFAULT_SETTINGS });
let attentionUntil = 0;
onAttention(({ message }) => {
  console.log(message);
  attentionUntil = Date.now() + 10000;
  character.notice({ x: 0, y: -0.2 });
  character.blink();
});
puck.touch.on('down', () => {
  attentionUntil = 0;
  character.blink();
  console.log('Acknowledged');
});
const animation = puck.screen.animate((frame, timing) => {
  character.advance(1200 + timing.elapsedMs);
  drawFamiliar(frame, character.pose(), character.settings);
  if (Date.now() < attentionUntil) {
    frame.circle({ center: { x: 120, y: 182 }, radius: 4 + Math.sin(timing.elapsedMs / 300), fill: '#ff855e' });
  }
}, { fps: 30 });
await animation.finished;
` },
] as const;
