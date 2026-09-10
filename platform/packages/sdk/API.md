# Implemented API · 0.1.0

This is the current callable surface. [types.ts](src/types.ts) defines every field, option and return type for the main entry point. The generated `dist/*.d.ts` files also expose inferred simulator/replay types. The older project inventory is future scope.

| Object/import | Methods and properties |
| --- | --- |
| default `orbit` | `connect(options)`, `discover(options)` |
| `puck` | `info`, `capabilities`, `clock`, `status`, `closed`, `on('error' / 'disconnect', handler)`, `close()` |
| `puck.screen` | `size`, `center`, `capabilities`, `contains(point)`, `draw(callback, options?)`, `animate(callback, options?)`, `createFrame()`, `present(scene, options?)`, `on('frame', handler)` |
| `frame` | `size`, `center`, `clear(color)`, `circle(options)`, `ellipse(options)`, `rect(options)`, `line(options)`, `path(options)`, `pixels(options)` |
| `frame` transforms | `save()`, `restore()`, `translate(x, y)`, `rotate(radians)`, `scale(x, y)`, `setOpacity(value)`, `clip(path)` |
| Reserved frame methods | `text(options)`, `image(options)` reject `unsupported` in this release. |
| Manual `FrameBuilder` | Everything on `Frame`, plus `build(): Scene`. Callback frames are finalized by the SDK. |
| `animation` | `state`, `finished`, `pause()`, `resume()`, `stop()`, `onError(handler)` |
| `puck.touch` | `capabilities`, `contacts`, `on('down' / 'move' / 'up' / 'cancel', handler)` |
| `puck.imu` | `latest`, `on('sample', handler)` |
| `puck.buttons` | `ids`, `get(id)`, `on('down' / 'up' / 'cancel', handler)` |
| `puck.switches` | `ids`, `get(id)`, `on('change', handler)` |
| `puck.inputs` | `on(handler)`, `stream({ kinds?, signal?, buffer? })` |
| `puck.diagnostics` | `snapshot()` with input gaps and received/submitted/acknowledged/superseded/pending counters, plus screen control status. |
| `Subscription` | `active`, `unsubscribe()` |
| `Clock` | `now(): number` in monotonic milliseconds, `after(delayMs, callback)` returning `{ cancel() }` |

## Simulation: `@orbit/sdk/simulation`

```ts
createSimulator({ profile?, seed?, clock?, latencyMs? })
createManualClock({ startMs? })
```

The simulator exposes `target`, `clock`, `capabilities`, `info`, `snapshot()`, `on('frame', handler)`, `disconnect({ reason? })`, `reset()`, and `close()`.

Its explicit virtual inputs are:

```ts
simulator.input.touch({ phase, contactId?, position? });
simulator.input.imu({ acceleration: [x, y, z], angularVelocity: [x, y, z] });
simulator.input.button({ id, phase });
simulator.input.switch({ id, value });
simulator.input.cancel();
clock.advanceBy(deltaMs); // ManualClock only
```

The default profile is `puck-240-v1`, with one contact, a `talk` button and a `mute` switch. Custom profiles specify `{ id, width, height, shape, maxContacts? }`. Virtual IMU units are m/s² and rad/s. The simulator generates no spontaneous behavior; the seed contributes to simulation identity, while character programs own their randomness. `reset` disconnects sessions, clears state and creates a new boot identity. No synthetic input API exists on a connected `puck`.

## Recording: `@orbit/sdk/replay`

```ts
recordInputs(puck, { maxBytes?, maxDurationMs? })
serializeRecording(recording): string
parseRecording(text): InputRecording
createReplay(recording, { clock? })
```

A recorder exposes `active`, `stop()` and `on('limit', handler)`. A replay exposes `target`, `state`, `positionMs`, `durationMs`, `play({ speed? })`, `pause()`, `restart()` and `close()`. Defaults: 8 MB maximum recording bytes, 120 seconds maximum capture duration. Replay uses recorded offsets; raw device timestamps retain their original units and provenance with source changed to `replay`.

## Rendering: `@orbit/sdk/canvas`

`createCanvasRenderer(canvas, { shape? })` returns `draw(scene)`, `resize({ width, height })` and `dispose()`. It renders validated copied scenes and supports circular clipping. Importing it does not access the DOM. Call it in a browser with an actual canvas.

## Transport: `@orbit/sdk/protocol`

`PROTOCOL_VERSION`, `MAX_MESSAGE_BYTES`, `encodeMessage(message)`, `decodeMessage(text)`, `validateMessage(value)`, and `createDecoder({ maxBytes? })`. The stream decoder exposes `push(bytes)` and `reset()`. These are versioned host envelopes; message-specific validation happens at the session boundary. They are not compatible with the frozen ESP32 POC's wire format.

`DeviceAdapter.open({ control, signal?, timeoutMs? })` returns an `AdapterSession` containing validated capabilities, device info, a clock, `onInput`, `onFrame`, `onDisconnect`, `present` and `close`. The SDK bounds connection setup and frame submission; custom transports must honor cancellation to prevent commands executing after cancellation. A late successful connection is closed by the SDK.

## Related packages

`@orbit/familiar`: `Character`, `DEFAULT_SETTINGS`, `projectEyes`, `drawFamiliar`, plus `Settings` and `Pose` types.

`@orbit/host`: `createHost({ token, port?, origins?, simulator?, preview? })` returns `endpoint`, `port`, `simulator`, `close()`.

`@orbit/host/preview`: `createPreview({ simulator, port? })` returns `url`, `close()`. This optional Bun tool serves a loopback browser preview with virtual controls and an ephemeral credential. It does not open a browser automatically.

## Orbit runtime

Run a top-level TypeScript program using `bun run orbit dev orbit.ts` or Studio.
`orbit.connect({ target: 'runtime', control: ['screen'] })` connects to the device
selected by that runner. It throws outside a runtime; `target: 'simulator'` instead
creates an independent simulator for standalone SDK use.

```ts
import { onAttention } from '@orbit/sdk/runtime';
const subscription = onAttention(({ message }: { message: string }) => {
  console.log(message);
});
subscription.unsubscribe();
```

Host integrations may call `setRuntimeTarget(adapter | undefined)` and
`dispatchAttention(message)` from the same module. Normal programs do not need
them. The runner closes the previous process and all its device connections on
reload; browser Studio replaces its worker.

A `.orbit` file contains `version: 1`, `name`, TypeScript `source`, and compiled
JavaScript `code`. The runner validates the format and recompiles source before
execution so source remains authoritative. Build checks syntax and supported
imports; use TypeScript's type checker for full semantic validation.
