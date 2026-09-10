import orbit from '@orbit/sdk';
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
