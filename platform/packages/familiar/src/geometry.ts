import type { Pose, Settings } from './types.js';
export function projectEyes(pose: Pose, settings: Settings) {
  const ay = pose.headX + (pose.eyeX - pose.headX) * 0.32;
  const ax = pose.headY + (pose.eyeY - pose.headY) * 0.32;
  return {
    version: 1,
    size: 240,
    background: '#09090c',
    clipRadius: 109,
    paths: [-1, 1].map((side) => ({
      fill: settings.eyeColor,
      points: Array.from({ length: 80 }, (_, k) => {
        const angle = (k / 80) * Math.PI * 2,
          co = Math.cos(angle),
          si = Math.sin(angle);
        const px =
          settings.eyeWidth *
          Math.sign(co) *
          Math.abs(co) ** 0.88 *
          (1 + 0.045 * si);
        const h = settings.eyeHeight * (1 - pose.closed) + 1.25 * pose.closed;
        const py =
          h * Math.sign(si) * Math.abs(si) ** 0.94 +
          pose.closed * (3.8 + 1.2 * (1 - co * co));
        const x = side * settings.eyeSpacing + px * (1 + 0.018 * pose.closed),
          y = py - 7;
        const z = Math.sqrt(Math.max(0, 102 * 102 - x * x - y * y));
        const qx = x * Math.cos(ay) + z * Math.sin(ay),
          depth = -x * Math.sin(ay) + z * Math.cos(ay);
        const qy = y * Math.cos(ax) + depth * Math.sin(ax);
        return {
          x: 120 + qx * Math.cos(pose.roll) - qy * Math.sin(pose.roll),
          y: 120 + qx * Math.sin(pose.roll) + qy * Math.cos(pose.roll),
        };
      }),
    })),
  };
}
