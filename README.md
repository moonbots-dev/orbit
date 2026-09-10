# Orbit

Give your AI a little presence. Make a character, try an interaction, or build your own little desktop device—in TypeScript, with or without a puck.

**[Play in the browser](https://orbit.moon-bots.com/sim)** · [SDK reference](platform/packages/sdk/API.md) · [Architecture](docs/runtime-launch.md)

## Start without hardware

Install [Bun](https://bun.sh) and Node.js 22.13 or newer, then:

```sh
git clone https://github.com/moonbots-dev/orbit.git
cd orbit
bun install
bun run build
bun run dev
```

Open the local URL printed by Orbit. Home is the Familiar. Code lets you edit and run a program. Inputs provides touch, a side button, a mute switch, tilt, and an attention event. The object view uses the same cel-shaded device geometry as the website.

## Make an Orbit

```ts
import orbit from '@orbit/sdk';

const puck = await orbit.connect({ target: 'runtime', control: ['screen'] });

puck.touch.on('down', ({ position }) => {
  console.log('Touched', position.x, position.y);
});

const animation = puck.screen.animate((frame, timing) => {
  frame.clear('#09090c');
  frame.circle({
    center: frame.center,
    radius: 20 + Math.sin(timing.elapsedMs / 500) * 4,
    fill: '#b3a1f5',
  });
});
await animation.finished;
```

Save that as `orbit.ts` and run:

```sh
bun run orbit dev orbit.ts
```

Save the file to reload. No required exported function. Top-level await works in Orbit programs. Your coding agent can edit the same file; give it `AGENTS.md` and the SDK reference.

Three complete programs are in `examples/`: the original Familiar, a touch trail, and an attention/acknowledgment interaction. Changing a program does not change firmware.

## A floating Orbit on your Mac

After the web build, with Xcode Command Line Tools installed:

```sh
bun run desktop:build
bun run desktop:open
```

The open command installs your build into `~/Applications/Orbit.app` and opens it. Quit a running copy before installing a newer build. The native app bundles Bun and its web assets. Use the pin button or **◉ → Float Orbit** to show the floating Familiar. Main and floating windows share one running device. Closing the main window leaves Orbit running; **Quit Orbit** ends it. The floating window stays above normal windows and follows desktop spaces.

Use **File → Open program…** or the Code panel to select a local `.ts` or `.orbit` file. Orbit watches it: save changes from your editor or AI agent and both windows update.

This is a locally built, ad-hoc-signed Mac app. There is no signed/notarized download in this release. Windows, Linux native shells and mobile hosts are future work; the browser simulator and Bun runner are separate from the Mac shell.

## Build and share a program

```sh
bun run orbit build orbit.ts --out my-orbit.orbit
bun run orbit run my-orbit.orbit
```

You can also download TypeScript or export a `.orbit` package from Studio. Packages contain source and compiled JavaScript, with a versioned format. The runner recompiles the included source before running it. Packages currently support imports from `@orbit/sdk`, `@orbit/familiar`, and `@orbit/sdk/runtime`; npm dependency packaging is not implemented. Compilation checks syntax, not full TypeScript types.

Desktop programs are **trusted local code with Bun permissions**, executed in a replaceable process. This is not a security sandbox for downloaded extensions. The public simulator runs code in a browser worker without native controls, with network access blocked by its deployed worker CSP. No code is sent to a remote execution service. Runaway loops are terminated without blocking the main UI.

## Use a physical puck

The included adapter supports the Waveshare ESP32-S3-Touch-LCD-1.28 running the included `orbit-usb-1.1.0` firmware. The source runner can target it explicitly:

```sh
bun run orbit dev examples/familiar.ts --usb /dev/cu.YOUR_DEVICE
```

Stop any other serial bridge first. This command opens the selected port; it never flashes firmware. USB is available from the source CLI; the bundled Mac app currently starts a virtual device. Firmware receives compact vector drawing commands and streams input observations. TypeScript runs on the host, not on the ESP32. BLE transport is not part of this release.

## What's here

| Directory | Responsibility |
| --- | --- |
| `platform/packages/sdk` | Typed device, drawing, input, simulation and transport contracts |
| `platform/packages/familiar` | Character geometry and organic motion |
| `platform/packages/esp32` | USB adapter and vector protocol |
| `platform/packages/host` | Lower-level shared-device host and preview |
| `runtime` | TypeScript compiler, replaceable program process, browser worker and local API |
| `studio` | Shared simulator, editor, input controls and HUD view |
| `desktop/app` | AppKit windows, menu bar and runtime lifecycle |
| `firmware` | Existing ESP32 firmware source and vector tests |

```sh
bun run check
bun test
```

The attention example demonstrates how a host can reach the character. A production agent integration, transcript memory service, MCP server, dictation service and mobile background runtime are not included in this developer release.

MIT for Orbit-authored code. See [THIRD_PARTY.md](THIRD_PARTY.md) for retained component licenses.
