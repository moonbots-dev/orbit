import orbit from '@orbit/sdk';
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
