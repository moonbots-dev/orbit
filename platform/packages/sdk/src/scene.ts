import type {
  FrameBuilder,
  Scene,
  Color,
  Point,
  Paint,
  PathGeometry,
  DrawCommand,
  Screen,
  Size,
} from './types.js';
import { finite, integer, invalid, object, OrbitError } from './errors.js';

// Only scenes constructed by this module can bypass repeated validation.
const trustedScenes = new WeakMap<object, string>();
const contractKey = (size: Size, caps: Screen['capabilities']) =>
  JSON.stringify([size, caps]);

export function color(value: unknown): Color {
  if (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))
    invalid('color', 'Use #RRGGBB or #RRGGBBAA.');
  return value as Color;
}
export function point(value: unknown): Point {
  const p = object(value, 'point');
  return { x: finite(p.x, -1e6, 1e6, 'x'), y: finite(p.y, -1e6, 1e6, 'y') };
}
function paint(value: unknown): Paint {
  const p = object(value, 'paint');
  const fill = p.fill === undefined ? undefined : color(p.fill);
  const s = p.stroke === undefined ? undefined : object(p.stroke);
  const stroke = s && {
    color: color(s.color),
    width: finite(s.width, 0.001, 4096, 'stroke.width'),
  };
  if (!fill && !stroke) invalid('paint', 'Provide fill, stroke, or both.');
  return { ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) } as Paint;
}
function path(value: unknown, max: number): PathGeometry {
  const p = object(value, 'path');
  if (
    !Array.isArray(p.segments) ||
    !p.segments.length ||
    p.segments.length > max
  )
    invalid('path', `Expected 1–${max} segments.`);
  if (
    p.fillRule !== undefined &&
    p.fillRule !== 'nonzero' &&
    p.fillRule !== 'evenodd'
  )
    invalid('path', 'Unknown fill rule.');
  let started = false;
  const segments = (p.segments as unknown[]).map((value) => {
    const s = object(value, 'path.segment');
    if (!started && s.type !== 'move')
      invalid('path', 'A path must begin with move.');
    switch (s.type) {
      case 'move':
        started = true;
        return { type: 'move' as const, to: point(s.to) };
      case 'line':
        return { type: 'line' as const, to: point(s.to) };
      case 'quadratic':
        return {
          type: 'quadratic' as const,
          control: point(s.control),
          to: point(s.to),
        };
      case 'cubic':
        return {
          type: 'cubic' as const,
          control1: point(s.control1),
          control2: point(s.control2),
          to: point(s.to),
        };
      case 'close':
        return { type: 'close' as const };
      default:
        return invalid('path', 'Unknown path segment.');
    }
  });
  return {
    segments,
    ...(p.fillRule ? { fillRule: p.fillRule as 'nonzero' | 'evenodd' } : {}),
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** All payloads are copied/validated at the boundary; finalized scenes are immutable. */
export function createFrame(
  size: Size,
  caps: Screen['capabilities'],
): FrameBuilder {
  let background: Color | undefined,
    finalized = false,
    depth = 0;
  const commands: DrawCommand[] = [];
  const check = () => {
    if (finalized) invalid('frame', 'This frame is already finalized.');
  };
  const add = (
    command: DrawCommand,
    capability?: Screen['capabilities']['operations'][number],
  ) => {
    check();
    if (capability && !caps.operations.includes(capability))
      throw new OrbitError(
        'unsupported',
        `frame.${capability}`,
        `Target does not support ${capability}.`,
      );
    if (!background)
      invalid('frame', 'Call frame.clear(color) before drawing.');
    if (commands.length >= caps.maxPrimitives)
      invalid('frame', 'Frame command limit exceeded.');
    commands.push(command);
  };
  const dimensions = (value: unknown) => {
    const p = object(value);
    return {
      x: finite(p.x, -1e6, 1e6, 'x'),
      y: finite(p.y, -1e6, 1e6, 'y'),
      width: finite(p.width, 0.001, 4096, 'width'),
      height: finite(p.height, 0.001, 4096, 'height'),
    };
  };
  return {
    size: Object.freeze({ ...size }),
    center: Object.freeze({ x: size.width / 2, y: size.height / 2 }),
    clear(value) {
      check();
      if (background || commands.length)
        invalid('frame.clear', 'Set the background once, before drawing.');
      background = color(value);
    },
    circle(value) {
      const p = object(value);
      add(
        {
          op: 'circle',
          value: {
            ...paint(p),
            center: point(p.center),
            radius: finite(p.radius, 0.001, 4096, 'radius'),
          },
        },
        'circle',
      );
    },
    ellipse(value) {
      const p = object(value);
      add(
        {
          op: 'ellipse',
          value: {
            ...paint(p),
            center: point(p.center),
            radiusX: finite(p.radiusX, 0.001, 4096, 'radiusX'),
            radiusY: finite(p.radiusY, 0.001, 4096, 'radiusY'),
          },
        },
        'ellipse',
      );
    },
    rect(value) {
      const p = object(value);
      const d = dimensions(p);
      add(
        {
          op: 'rect',
          value: {
            ...paint(p),
            ...d,
            cornerRadius: finite(
              p.cornerRadius ?? 0,
              0,
              Math.min(d.width, d.height) / 2,
              'cornerRadius',
            ),
          },
        },
        'rect',
      );
    },
    line(value) {
      const p = object(value);
      const style = paint({ stroke: p.stroke });
      add(
        {
          op: 'line',
          value: {
            from: point(p.from),
            to: point(p.to),
            stroke: style.stroke!,
          },
        },
        'line',
      );
    },
    path(value) {
      add(
        {
          op: 'path',
          value: { ...path(value, caps.maxPathSegments), ...paint(value) },
        },
        'path',
      );
    },
    text() {
      check();
      throw new OrbitError(
        'unsupported',
        'frame.text',
        'Font assets are not implemented in this adapter.',
      );
    },
    image() {
      check();
      throw new OrbitError(
        'unsupported',
        'frame.image',
        'Image assets are not implemented; use frame.pixels for raw pixels.',
      );
    },
    pixels(value) {
      const p = object(value);
      const width = integer(p.width, 1, 4096, 'pixels.width'),
        height = integer(p.height, 1, 4096, 'pixels.height');
      if (p.format !== 'rgba8888' && p.format !== 'rgb565-le')
        invalid('pixels', 'Unknown pixel format.');
      const length = width * height * (p.format === 'rgba8888' ? 4 : 2);
      if (
        length > caps.maxFrameBytes ||
        !(p.data instanceof Uint8Array) ||
        p.data.length !== length
      )
        invalid('pixels', 'Pixel data length or budget is invalid.');
      add(
        {
          op: 'pixels',
          value: {
            x: finite(p.x, -1e6, 1e6, 'x'),
            y: finite(p.y, -1e6, 1e6, 'y'),
            width,
            height,
            format: p.format,
            data: Array.from(p.data as Uint8Array),
          },
        },
        'pixels',
      );
    },
    save() {
      if (depth >= 32) invalid('frame.save', 'Transform stack limit exceeded.');
      add({ op: 'save' }, 'transform');
      depth++;
    },
    restore() {
      if (depth === 0) invalid('frame.restore', 'Transform stack is empty.');
      add({ op: 'restore' }, 'transform');
      depth--;
    },
    translate(x, y) {
      add(
        {
          op: 'translate',
          x: finite(x, -1e6, 1e6, 'x'),
          y: finite(y, -1e6, 1e6, 'y'),
        },
        'transform',
      );
    },
    rotate(value) {
      add(
        { op: 'rotate', value: finite(value, -1e6, 1e6, 'radians') },
        'transform',
      );
    },
    scale(x, y) {
      add(
        {
          op: 'scale',
          x: finite(x, -1000, 1000, 'x'),
          y: finite(y, -1000, 1000, 'y'),
        },
        'transform',
      );
    },
    setOpacity(value) {
      add({ op: 'opacity', value: finite(value, 0, 1, 'opacity') }, 'opacity');
    },
    clip(value) {
      add({ op: 'clip', value: path(value, caps.maxPathSegments) }, 'clip');
    },
    build() {
      check();
      finalized = true;
      if (!background || depth)
        invalid(
          'frame.build',
          'A frame needs a background and balanced save/restore calls.',
        );
      const scene: Scene = {
        version: 1,
        size: { ...size },
        background,
        commands,
      };
      if (
        new TextEncoder().encode(JSON.stringify(scene)).length >
        caps.maxFrameBytes
      )
        invalid('frame.build', 'Serialized frame exceeds target byte budget.');
      deepFreeze(scene);
      trustedScenes.set(scene, contractKey(size, caps));
      return scene;
    },
  };
}

export function validateScene(
  value: unknown,
  size: Size,
  caps: Screen['capabilities'],
): Scene {
  if (
    value &&
    typeof value === 'object' &&
    trustedScenes.get(value) === contractKey(size, caps)
  )
    return value as Scene;
  const scene = object(value, 'scene'),
    viewport = object(scene.size, 'scene.size');
  if (
    scene.version !== 1 ||
    viewport.width !== size.width ||
    viewport.height !== size.height
  )
    invalid('scene', 'Scene version or viewport does not match target.');
  if (
    !Array.isArray(scene.commands) ||
    scene.commands.length > caps.maxPrimitives
  )
    invalid('scene', 'Invalid command list.');
  const frame = createFrame(size, caps);
  frame.clear(color(scene.background));
  for (const raw of scene.commands) {
    const c = object(raw, 'scene.command');
    switch (c.op) {
      case 'circle':
        frame.circle(c.value as never);
        break;
      case 'ellipse':
        frame.ellipse(c.value as never);
        break;
      case 'rect':
        frame.rect(c.value as never);
        break;
      case 'line':
        frame.line(c.value as never);
        break;
      case 'path':
        frame.path(c.value as never);
        break;
      case 'pixels': {
        const p = object(c.value);
        if (!Array.isArray(p.data) || p.data.length > caps.maxFrameBytes)
          invalid('pixels', 'Invalid bytes.');
        const data = Uint8Array.from(
          (p.data as unknown[]).map((v) => integer(v, 0, 255, 'pixel byte')),
        );
        frame.pixels({ ...p, data } as never);
        break;
      }
      case 'save':
        frame.save();
        break;
      case 'restore':
        frame.restore();
        break;
      case 'translate':
        frame.translate(c.x as number, c.y as number);
        break;
      case 'scale':
        frame.scale(c.x as number, c.y as number);
        break;
      case 'rotate':
        frame.rotate(c.value as number);
        break;
      case 'opacity':
        frame.setOpacity(c.value as number);
        break;
      case 'clip':
        frame.clip(c.value as never);
        break;
      default:
        invalid('scene', 'Unknown drawing command.');
    }
  }
  return frame.build();
}
