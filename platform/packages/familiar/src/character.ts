import { clamp, type Point, type Pose, type Settings } from './types.js';

type Channel = { from: number; to: number; at: number; duration: number };
type Axis = 'eyeX' | 'eyeY' | 'headX' | 'headY' | 'roll';
const ease = (v: number) => {
  const p = clamp(v, 0, 1);
  return p * p * p * (p * (p * 6 - 15) + 10);
};
const smooth = (v: number) => {
  const p = clamp(v, 0, 1);
  return p * p * (3 - 2 * p);
};

/** The selected attention study, with scheduling independent of draw cadence. */
export class Character {
  private randomState: number;
  private time = 0;
  private anchor: Point;
  private history: Point[] = [];
  private episodeAt = 0;
  private refinements = 0;
  private nextDecision: number;
  private nextBlink: number;
  private pendingBlink = Infinity;
  private tiltAt = Infinity;
  private tiltGoal = 0;
  private blinkAt = -10_000;
  private blinkMs = 360;
  private channels: Record<Axis, Channel>;
  constructor(
    seed: number,
    public settings: Settings,
  ) {
    this.randomState = seed >>> 0;
    this.anchor = this.place();
    this.nextDecision = this.random(1800, 3200);
    this.nextBlink = this.random(2600, 5200);
    const initial = {
      eyeX: this.anchor.x,
      eyeY: this.anchor.y,
      headX: this.anchor.x,
      headY: this.anchor.y,
      roll: this.anchor.x * this.anchor.y * 1.2,
    };
    this.channels = Object.fromEntries(
      Object.entries(initial).map(([k, v]) => [
        k,
        { from: v, to: v, at: 0, duration: 1 },
      ]),
    ) as Record<Axis, Channel>;
  }
  private random(a = 0, b = 1) {
    this.randomState =
      (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return a + (this.randomState / 4294967296) * (b - a);
  }
  private place(): Point {
    return { x: this.random(-0.53, 0.53), y: this.random(-0.26, 0.23) };
  }
  private value(key: Axis) {
    const c = this.channels[key];
    return c.from + (c.to - c.from) * ease((this.time - c.at) / c.duration);
  }
  private to(key: Axis, value: number, duration: number, delay = 0) {
    this.channels[key] = {
      from: this.value(key),
      to: value,
      at: this.time + delay,
      duration,
    };
  }
  private hold(a: number, b: number) {
    return this.random(a, b) * this.settings.pauseLength;
  }
  blink() {
    this.blinkAt = this.time;
    this.blinkMs = this.random(325, 390);
    this.nextBlink = this.time + this.random(4100, 9500);
    this.pendingBlink = Infinity;
  }
  private move(target: Point, kind: 'shift' | 'inspect' | 'notice') {
    const distance = Math.hypot(
      target.x - this.value('eyeX'),
      target.y - this.value('eyeY'),
    );
    const inspect = kind === 'inspect',
      notice = kind === 'notice';
    const lead = inspect
      ? this.random(0, 45)
      : notice
        ? this.random(45, 110)
        : this.random(25, 140);
    const duration = inspect
      ? this.random(95, 160)
      : this.random(100, 180) + distance * 65;
    this.to('eyeX', target.x, duration, lead);
    this.to('eyeY', target.y, duration * this.random(0.94, 1.09), lead);
    if (!inspect || this.random() < 0.24) {
      const headDuration =
        (notice
          ? this.random(230, 360)
          : this.random(290, 460) + distance * this.random(110, 270)) /
        this.settings.headSpeed;
      const delay =
        lead + (inspect ? this.random(80, 150) : this.random(50, 120));
      this.to('headX', target.x, headDuration, delay);
      this.to(
        'headY',
        target.y,
        headDuration * this.random(0.82, 1.2),
        delay + this.random(0, 45),
      );
      this.to(
        'roll',
        clamp(
          target.x * target.y * 1.3 + this.random(-0.07, 0.07),
          -0.19,
          0.19,
        ) * this.settings.tiltAmount,
        headDuration * this.random(1.05, 1.5),
        delay + this.random(35, 145),
      );
    }
    if (
      !inspect &&
      distance > 0.3 &&
      this.random() < 0.4 &&
      this.time - this.blinkAt > 2200
    )
      this.pendingBlink = this.time + lead + this.random(5, 65);
  }
  private begin(target: Point, kind: 'shift' | 'notice') {
    this.history.push({ ...this.anchor });
    if (this.history.length > 3) this.history.shift();
    this.anchor = {
      x: clamp(target.x, -0.59, 0.59),
      y: clamp(target.y, -0.3, 0.28),
    };
    this.episodeAt = this.time;
    this.refinements = 0;
    this.tiltAt = Infinity;
    this.move(this.anchor, kind);
    this.nextDecision =
      this.time +
      this.hold(
        kind === 'notice' ? 1600 : 1500,
        kind === 'notice' ? 3400 : 3900,
      );
    if (this.random() < 0.32) {
      this.tiltAt = this.time + this.hold(1000, 2100);
      this.tiltGoal = clamp(
        this.value('roll') + this.random(-0.07, 0.07),
        -0.2,
        0.2,
      );
    }
  }
  notice(point: Point) {
    this.begin(point, 'notice');
  }
  private decide() {
    const age = this.time - this.episodeAt;
    if (
      this.refinements < 2 &&
      age < 7200 &&
      this.random() < (this.refinements === 0 ? 0.66 : 0.38)
    ) {
      this.move(
        {
          x: clamp(this.anchor.x + this.random(-0.075, 0.075), -0.59, 0.59),
          y: clamp(this.anchor.y + this.random(-0.045, 0.045), -0.3, 0.28),
        },
        'inspect',
      );
      this.refinements++;
      this.nextDecision = this.time + this.hold(1200, 3300);
    } else if (age < 8200 && this.random() < 0.24)
      this.nextDecision = this.time + this.hold(2000, 4200);
    else {
      let candidate = this.place();
      if (this.history.length && this.random() < 0.16) {
        const p = this.history[Math.floor(this.random(0, this.history.length))];
        candidate = {
          x: p.x + this.random(-0.025, 0.025),
          y: p.y + this.random(-0.02, 0.02),
        };
      }
      for (
        let i = 0;
        i < 12 &&
        Math.hypot(candidate.x - this.anchor.x, candidate.y - this.anchor.y) <
          0.19;
        i++
      )
        candidate = this.place();
      this.begin(candidate, 'shift');
    }
  }
  advance(now: number) {
    if (!Number.isFinite(now) || now < this.time)
      throw new Error('Character time must advance monotonically.');
    for (;;) {
      const next = Math.min(
        this.nextDecision,
        this.nextBlink,
        this.pendingBlink,
        this.tiltAt,
      );
      if (next > now) break;
      this.time = next;
      if (next === this.nextDecision) this.decide();
      if (next >= this.nextBlink || next >= this.pendingBlink) this.blink();
      if (next >= this.tiltAt) {
        this.to(
          'roll',
          this.tiltGoal * this.settings.tiltAmount,
          this.random(520, 950) / this.settings.headSpeed,
        );
        this.tiltAt = Infinity;
      }
    }
    this.time = now;
  }
  pose(): Pose {
    const p = (this.time - this.blinkAt) / this.blinkMs;
    const closed =
      p < 0 || p >= 1
        ? 0
        : p < 0.31
          ? smooth(p / 0.31)
          : p < 0.39
            ? 1
            : 1 - smooth((p - 0.39) / 0.61);
    return {
      eyeX: this.value('eyeX'),
      eyeY: this.value('eyeY'),
      headX: this.value('headX'),
      headY: this.value('headY'),
      roll: this.value('roll'),
      closed,
    };
  }
}
