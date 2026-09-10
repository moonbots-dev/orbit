export type Point = { x: number; y: number };
export interface Settings {
  headSpeed: number;
  pauseLength: number;
  tiltAmount: number;
  eyeWidth: number;
  eyeHeight: number;
  eyeSpacing: number;
  eyeColor: string;
}
export interface Pose {
  eyeX: number;
  eyeY: number;
  headX: number;
  headY: number;
  roll: number;
  closed: number;
}
export const DEFAULT_SETTINGS: Settings = {
  headSpeed: 1,
  pauseLength: 1,
  tiltAmount: 1,
  eyeWidth: 11.8,
  eyeHeight: 17.8,
  eyeSpacing: 29,
  eyeColor: '#ffe3c2',
};
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
