import type { Color, Frame, PathSegment } from '@orbit/sdk';
import type { Pose, Settings } from './types.js';
import { projectEyes } from './geometry.js';
export { Character } from './character.js';
export { DEFAULT_SETTINGS } from './types.js';
export type { Settings, Pose } from './types.js';
export { projectEyes } from './geometry.js';

/** Render the selected contour through ordinary SDK paths, on any viewport. */
export function drawFamiliar(
  frame: Frame,
  pose: Pose,
  settings: Settings,
): void {
  const scene = projectEyes(pose, settings);
  frame.clear(scene.background as Color);
  frame.save();
  frame.translate(frame.center.x, frame.center.y);
  const scale = Math.min(frame.size.width, frame.size.height) / 240;
  frame.scale(scale, scale);
  frame.translate(-120, -120);
  const clip: PathSegment[] = Array.from({ length: 80 }, (_, i) => ({
    type: i ? 'line' : 'move',
    to: {
      x: 120 + Math.cos((i / 80) * Math.PI * 2) * scene.clipRadius,
      y: 120 + Math.sin((i / 80) * Math.PI * 2) * scene.clipRadius,
    },
  }));
  clip.push({ type: 'close' });
  frame.clip({ segments: clip });
  for (const eye of scene.paths) {
    const segments: PathSegment[] = eye.points.map((point, i) => ({
      type: i ? 'line' : 'move',
      to: point,
    }));
    segments.push({ type: 'close' });
    frame.path({ segments, fill: eye.fill as Color });
  }
  frame.restore();
}
