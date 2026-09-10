# Orbit developer launch

Approved September 10: build the open framework, desktop simulator/floating HUD and public `/sim` playground. Preserve the Familiar geometry and motion. Firmware remains unchanged. Mobile is a later host implementation.

## First release

The desktop app is a small AppKit/WKWebView shell around a loopback Bun runtime. Bun owns the virtual device and program lifecycle, so window rendering does not drive the animation. Main window and floating panel observe the same scenes. A narrow rail opens Home, Code and input controls. No fabricated transcript archive or active microphone is added in this developer milestone.

`orbit dev [program.ts]` runs a trusted local program and watches its source; `orbit build program.ts` produces a versioned `.orbit` JSON package; `orbit run package.orbit` loads it. Programs use `orbit.connect({target:'runtime', control:['screen']})`, binding to the runner's virtual or explicitly selected USB device. Source execution has ordinary local Bun permissions; this is not the future sandboxed extension runtime. A separate process owns each program, with orderly teardown and bounded bridge messages. Hot reload must preserve the last good program when compilation fails.

Public `/sim` runs a private simulator in a dedicated browser worker. TypeScript is compiled locally; no source executes on the web server. Run/Stop, three examples, touch/buttons/tilt controls, downloadable source/package and SDK reference are provided. Workers can be terminated independently of the UI. A no-network CSP is applied to the worker resource; workers never receive desktop credentials or native bridge access. This limits accidental runaway code but does not promise a hard memory sandbox. Source is stored only in that browser, never uploaded automatically.

Desktop code execution is explicit, authorized by the locally launched app's ephemeral token and same-origin request checks. The public site's code executor cannot access it. The desktop runtime serves only built public assets, not repository files. USB is opt-in from the CLI, reports a busy device rather than taking another host's port, and never flashes firmware. Existing lab/bridge and recordings stay intact.

The native floating panel is movable, resizable and closable, stays above normal windows, and displays the same device as Home. The main app remains available from its menu. Quitting stops its child runtime. Main window close leaves the HUD/runtime running.

## Repository

Publish a curated source checkout under the user's chosen GitHub organization with an MIT license for Orbit-authored code; preserve third-party notices. Do not publish local journals, credentials, application data, personal research or repository history containing those materials. The development checkout is retained. A clean-checkout quickstart and desktop build must work using documented prerequisites.

## Verification

Check program replacement/disposal, package validation, source syntax failures, input semantics, HTTP authorization and static-path traversal. Exercise a standalone program, simulate touch/attention and confirm output changes. Build the native app and public simulator; verify hosted assets and routes by HTTP. Device flashing and mobile development are outside this milestone.
