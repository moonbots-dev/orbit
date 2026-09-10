import orbit from '@orbit/sdk';
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
