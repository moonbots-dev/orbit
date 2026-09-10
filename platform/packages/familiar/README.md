# @orbit/familiar

Optional character behavior and eye geometry, extracted from the existing Orbit lab without changing the selected shapes or attention model. It uses the SDK's public drawing interface. Other characters can use `@orbit/sdk` alone.

```ts
import { Character, DEFAULT_SETTINGS, drawFamiliar } from '@orbit/familiar';

const settings = { ...DEFAULT_SETTINGS };
const character = new Character(42, settings);

const animation = puck.screen.animate((frame, timing) => {
  character.advance(timing.elapsedMs);
  drawFamiliar(frame, character.pose(), settings);
});

puck.touch.on('down', event => character.notice({
  x: (event.position.x / puck.screen.size.width - 0.5) * 1.16,
  y: (event.position.y / puck.screen.size.height - 0.5) * 0.58,
}));
```

`new Character(seed, settings)` creates independent seeded behavior. It exposes `blink()`, `notice(point)`, `advance(timeMs)` and `pose()`. Use monotonically increasing milliseconds from one origin. `notice` takes a normalized gaze target, approximately x: −0.59…0.59 and y: −0.30…0.28; the example converts screen coordinates. Settings are an ordinary mutable object so the lab can tune them. `drawFamiliar` scales the 240-unit eye geometry to the target viewport.

`projectEyes(pose, settings)` exposes the projected path geometry if you need to inspect it. `Settings` and `Pose` types are exported. Eye motion, personality and gesture interpretation live here or in your own program, not in the device SDK.
