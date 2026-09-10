# @orbit/sdk

Orbit's device API for ordinary TypeScript programs. Version 0.1.0 is local and unpublished. Tested with Bun; its browser build is used by the local design lab. The Bun server is a separate optional package.

```ts
import orbit from '@orbit/sdk';

const puck = await orbit.connect({
  target: 'simulator',
  control: ['screen'],
});

try {
  await puck.screen.draw(frame => {
    frame.clear('#101425');
    frame.circle({ center: frame.center, radius: 20, fill: '#98eed3' });
  });
} finally {
  await puck.close();
}
```

`orbit` is a stateless entry point. `puck` is your connection to one device. `target: 'simulator'` creates an isolated virtual device. `control: ['screen']` asks for drawing ownership; omit it to observe. Importing the package connects to nothing. A real-time Bun connection keeps the script alive until you close it; manual-clock sessions default to no keep-alive.

For a browser preview, use the workspace's `examples/custom-face.ts`, or connect to an explicitly created simulator and pass it to `createPreview` from `@orbit/host/preview`. The headless `simulator` shorthand does not start a browser or server.

## Draw and animate

```ts
let position = puck.screen.center;
const touch = puck.touch.on('down', event => {
  position = event.position;
});

const animation = puck.screen.animate((frame, timing) => {
  frame.clear('#101425');
  frame.circle({
    center: position,
    radius: 20 + Math.sin(timing.elapsedMs / 700) * 2,
    fill: '#98eed3',
  });
}, { fps: 60 });

animation.onError(error => console.error(error.code, error.message));
// Later: animation.pause(); animation.resume(); animation.stop();
// Later: touch.unsubscribe(); await puck.close();
```

Both callbacks build one complete frame in memory. Call `clear` once at the beginning. Nothing is submitted until the callback returns successfully and the frame validates. Callbacks must be synchronous; fetch assets or do async work outside them. Event callbacks are synchronous too: handle asynchronous work with an explicit `.catch(...)`.

`Timing` has three fields:

```ts
interface Timing {
  readonly elapsedMs: number; // Active time since the first callback; starts at 0.
  readonly deltaMs: number;   // Time since the previous callback; 0 after resume.
  readonly frameIndex: number;// Zero-based number of callbacks.
}
```

The requested FPS controls host callbacks. It does not claim device refresh rate. A slow target can supersede older pending frames; `queue: 'fifo'` preserves requests within the target's bounded queue. Stop the animation before manual `draw` or `present` calls. `animation.finished` resolves on stop/normal close and rejects on failure or abort.

## Coordinates and capabilities

The default screen is a 240 × 240 circle. Coordinates are logical units: x right, y down, origin at the top-left of its bounding square. The center is `{ x: 120, y: 120 }`. Rotation is in radians; colors are `#RRGGBB` or `#RRGGBBAA`. `screen.contains(point)` checks the visible shape. Frame geometry is clipped by the renderer.

Read `puck.capabilities` to inspect supported operations, contact count, limits and acknowledgement levels. This release implements shapes, paths, transforms, clipping, opacity and raw pixels. `text` and `image` are reserved methods that reject with `unsupported`; font/image decoders are not implemented. The optional `@orbit/esp32` adapter supports the Orbit USB bridge's physical display, touch, IMU and BOOT input. Audio and HID are not implemented.

The reusable `@orbit/familiar` package contains the selected eyes and attention behavior. `examples/interaction-study.ts` in the platform workspace shows an ordinary Bun program reusing it while adding a circular selector, mock mouse and sample dictation. The same experiment runs inside the local lab. Computer-side program changes do not reflash the board; closing the last drawing program leaves its last complete frame on the display.

## Input, recording and lifecycle

`puck.touch.on('down', callback)` gives autocomplete for a down event's exact type. Other groups are `imu`, `buttons` and `switches`. Their current values are updated before callbacks. `puck.inputs.on(callback)` receives raw observations with boot ID, sequence, source and device/host timestamps; `inputs.stream()` is an optional bounded async iterator.

A sequence gap cancels derived held touches/buttons. An orphan move cannot restart a drag. Raw observations keep their original sequence numbers so a recording can reproduce the gap. Clock resets across device boots are distinct from host receipt time. Cancellation events are observable on disconnect/close.

`recordInputs` from `@orbit/sdk/replay` records every input kind to preserve continuity. Start with neutral inputs. Stop and serialize the bounded tape, then pass it to `createReplay`. A replay is read-only input and isolated simulated output; it never controls the OS or physical hardware. `restart()` disconnects existing replay sessions: reconnect and recreate your program state. There is no implicit rewind of arbitrary application state.

Each `on` returns `{ active, unsubscribe() }`. Closing a puck cancels its work and removes its subscriptions; subscribing to a closed puck fails. Repeated `close()` calls are safe. `closed` resolves on normal close and rejects on a failed connection. Your application owns its shutdown handlers.

`connect`/`discover` have real-time deadlines including credentials and adapter setup. `timeoutMs` defaults to 5000. A connection's caller-provided abort signal also ends the live session. Frame deadlines use the session clock. `keepAlive: false` lets other application resources own process lifetime.

Errors are `OrbitError` instances with a stable `code`, `operation`, and message. Failed operations reject; background callback failures reach `puck.on('error', ...)`. Acknowledgements distinguish accepted, applied, and presentation-submitted. No level proves that physical pixels were visible.

See the [full API map](API.md) and [all public interfaces](src/types.ts), including `Frame`, `Timing`, `Scene`, `FrameResult`, `InputEvent` and adapter contracts. Source and declaration maps are included in the package for editor navigation.
