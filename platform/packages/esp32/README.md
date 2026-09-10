# @orbit/esp32

Local USB adapter for the Waveshare ESP32-S3-Touch-LCD-1.28. Your program uses the same `orbit.connect`, drawing and input API as the simulator. Opening a connection never compiles or flashes firmware.

```ts
import orbit from '@orbit/sdk';
import { openESP32 } from '@orbit/esp32';

const usb = await openESP32({ port: '/dev/cu.YOUR_DEVICE' });
const puck = await orbit.connect({ target: usb.target, control: ['screen'] });

try {
  puck.touch.on('move', event => console.log(event.position));
  puck.imu.on('sample', event => console.log(event.acceleration));
  await puck.screen.draw(frame => {
    frame.clear('#09090c');
    frame.circle({ center: frame.center, radius: 20, fill: '#ffe3c2' });
  }, { acknowledgement: 'applied' });
  // Keep your program running for ongoing input/animation.
} finally {
  await puck.close();
  await usb.close();
}
```

`listESP32Ports()` lists matching CH343 ports without opening them. `usb.configure({ imuHz, touchHz, brightness })` changes RAM-only settings: IMU 0–100 Hz, touch 10–120 Hz, backlight 0–255. These are requested sampling rates; display work can reduce the observed rate. `usb.statistics()` returns framebuffer CRC, applied frame count, LCD transfer time, sensor counts and error counters. `usb.snapshot()` includes the last acknowledged Scene and cached statistics.

One process owns the serial handle; one SDK session controls its screen, and multiple sessions may observe inputs and frames. For multiple programs or a browser, use the Bun host (`bun run hardware` from the platform workspace). The existing product lab is `http://localhost:3000/lab?device=esp32`; this preserves its Familiar character and CAD. The separate SDK sample at port 4402 is not the product design.

The supported bring-up environment is this macOS ARM64 + Bun installation, with Node available on PATH. The native serialport library calls a libuv function unsupported by this Bun build, so a private Node helper owns the handle. TypeScript behavior, command compilation and the host remain in Bun. The helper communicates over bounded JSON lines on inherited pipes and exits when its parent closes the pipe. No extra TCP service is used. The current native binding explicitly supports macOS; other platforms need their own bring-up. Empty reads yield for 2 ms to avoid a busy loop.

Firmware `orbit-usb-1.1.0` is a generic vector display/input bridge. The adapter compiles SDK Scenes into compact drawing records; the ESP32 retains them and rasterizes with antialiasing locally. Only changed records are sent. A scene update is atomic, checks the required base frame and resulting scene CRC, and acknowledges after LCD writes complete. The SDK API and Familiar geometry are unchanged. Path coordinates use 1/16-unit precision, with delta coding that preserves every outline point. Curves, transforms, clipping, strokes and opacity remain drawing operations.

The physical renderer holds at most 64 KiB of compiled commands and assets, 1024 commands, 2048 segments per path, and 32 saved states. Oversized drawings fail explicitly. Explicit `frame.pixels` assets count toward this budget and are resent only when changed; normal vector scenes are never converted into transmitted bitmaps. Legacy bitmap firmware commands remain for recovery diagnostics. Text/image decoding is still not advertised.

`usb.statistics()` additionally reports `sceneCRC`, `vectorBytes`, `renderUs`, `clearUs`, `drawUs` and `convertUs`, alongside actual LCD write timing and sensor/error counters. One frame remains in flight; obsolete pending frames can be coalesced. An unplug/restart closes the session; reconnect explicitly. Behavior still runs on the computer, so stopping its program leaves the last complete screen static. BLE and autonomous animation scheduling are not implemented by this renderer milestone.

See [native renderer design](../../../docs/native-renderer-design.md) and [measured performance](../../../docs/display-latency.md).

Touch is single contact. The physical button is `boot`; there is no talk button, mute switch, microphone or HID mouse advertised. IMU axes are sensor-native and have not been calibrated to screen orientation. The SDK raw input recorder is available; the older lab's simulation-specific trial recorder is disabled in USB mode.

Firmware installation and the wire contract are documented in `docs/esp32-sdk-bridge.md` at the project root. `firmware/flash.sh` requires an explicit hardware work session and updates only the application on this board's existing partition layout. It is never called by this package or the lab.
