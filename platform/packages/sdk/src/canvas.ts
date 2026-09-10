import type { DrawCommand, Paint, PathGeometry, Scene, Size } from './types.js';
import { createSimulator } from './simulation.js';
import { validateScene } from './scene.js';
import { integer, invalid } from './errors.js';

function trace(ctx: CanvasRenderingContext2D, geometry: PathGeometry): void {
  ctx.beginPath();
  for (const s of geometry.segments)
    switch (s.type) {
      case 'move':
        ctx.moveTo(s.to.x, s.to.y);
        break;
      case 'line':
        ctx.lineTo(s.to.x, s.to.y);
        break;
      case 'quadratic':
        ctx.quadraticCurveTo(s.control.x, s.control.y, s.to.x, s.to.y);
        break;
      case 'cubic':
        ctx.bezierCurveTo(
          s.control1.x,
          s.control1.y,
          s.control2.x,
          s.control2.y,
          s.to.x,
          s.to.y,
        );
        break;
      case 'close':
        ctx.closePath();
        break;
    }
}
function paint(
  ctx: CanvasRenderingContext2D,
  p: Paint,
  fillRule: CanvasFillRule = 'nonzero',
): void {
  if (p.fill) {
    ctx.fillStyle = p.fill;
    ctx.fill(fillRule);
  }
  if (p.stroke) {
    ctx.strokeStyle = p.stroke.color;
    ctx.lineWidth = p.stroke.width;
    ctx.stroke();
  }
}

/** Browser-only rendering. Importing this module does not touch document or canvas. */
export function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  options: { shape?: 'circle' | 'rectangle' } = {},
) {
  const context = canvas.getContext('2d');
  if (!context) invalid('canvas', 'A 2D context is required.');
  const ctx = context!;
  let disposed = false;
  const pixels = new WeakMap<object, HTMLCanvasElement>();
  function command(c: DrawCommand): void {
    switch (c.op) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(
          c.value.center.x,
          c.value.center.y,
          c.value.radius,
          0,
          Math.PI * 2,
        );
        paint(ctx, c.value);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(
          c.value.center.x,
          c.value.center.y,
          c.value.radiusX,
          c.value.radiusY,
          0,
          0,
          Math.PI * 2,
        );
        paint(ctx, c.value);
        break;
      case 'rect':
        ctx.beginPath();
        ctx.roundRect(
          c.value.x,
          c.value.y,
          c.value.width,
          c.value.height,
          c.value.cornerRadius ?? 0,
        );
        paint(ctx, c.value);
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(c.value.from.x, c.value.from.y);
        ctx.lineTo(c.value.to.x, c.value.to.y);
        paint(ctx, { stroke: c.value.stroke });
        break;
      case 'path':
        trace(ctx, c.value);
        paint(ctx, c.value, c.value.fillRule);
        break;
      case 'clip':
        trace(ctx, c.value);
        ctx.clip(c.value.fillRule);
        break;
      case 'save':
        ctx.save();
        break;
      case 'restore':
        ctx.restore();
        break;
      case 'translate':
        ctx.translate(c.x, c.y);
        break;
      case 'scale':
        ctx.scale(c.x, c.y);
        break;
      case 'rotate':
        ctx.rotate(c.value);
        break;
      case 'opacity':
        ctx.globalAlpha = c.value;
        break;
      case 'pixels': {
        let surface = pixels.get(c);
        if (!surface) {
          surface = canvas.ownerDocument.createElement('canvas');
          surface.width = c.value.width;
          surface.height = c.value.height;
          const local = surface.getContext('2d')!;
          const data = local.createImageData(surface.width, surface.height);
          if (c.value.format === 'rgba8888') data.data.set(c.value.data);
          else
            for (let i = 0; i < c.value.width * c.value.height; i++) {
              const rgb = c.value.data[i * 2] | (c.value.data[i * 2 + 1] << 8);
              data.data[i * 4] = Math.round((((rgb >> 11) & 31) * 255) / 31);
              data.data[i * 4 + 1] = Math.round((((rgb >> 5) & 63) * 255) / 63);
              data.data[i * 4 + 2] = Math.round(((rgb & 31) * 255) / 31);
              data.data[i * 4 + 3] = 255;
            }
          local.putImageData(data, 0, 0);
          pixels.set(c, surface);
        }
        ctx.drawImage(surface, c.value.x, c.value.y);
        break;
      }
    }
  }
  let profile:
    | { size: Size; screen: import('./types.js').Screen['capabilities'] }
    | undefined;
  return {
    draw(scene: Scene) {
      if (disposed) invalid('canvas.draw', 'Renderer is disposed.');
      if (
        !profile ||
        scene.size.width !== profile.size.width ||
        scene.size.height !== profile.size.height
      ) {
        profile = {
          size: { ...scene.size },
          screen: createSimulator({
            profile: {
              id: 'canvas',
              ...scene.size,
              shape: options.shape ?? 'circle',
            },
          }).capabilities.screen,
        };
      }
      // Render the validated copy. A shallow-frozen caller object is not trusted.
      scene = validateScene(scene, profile.size, profile.screen);
      ctx.save();
      try {
        ctx.setTransform(
          canvas.width / scene.size.width,
          0,
          0,
          canvas.height / scene.size.height,
          0,
          0,
        );
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, scene.size.width, scene.size.height);
        if ((options.shape ?? 'circle') === 'circle') {
          ctx.beginPath();
          ctx.arc(
            scene.size.width / 2,
            scene.size.height / 2,
            scene.size.width / 2,
            0,
            Math.PI * 2,
          );
          ctx.clip();
        }
        ctx.fillStyle = scene.background;
        ctx.fillRect(0, 0, scene.size.width, scene.size.height);
        for (const c of scene.commands) command(c);
      } finally {
        ctx.restore();
      }
    },
    resize(size: Size) {
      canvas.width = integer(size.width, 1, 8192, 'width');
      canvas.height = integer(size.height, 1, 8192, 'height');
    },
    dispose() {
      disposed = true;
    },
  };
}
