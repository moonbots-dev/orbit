# Building Orbit

Read README.md, docs/runtime-launch.md and platform/packages/sdk/API.md first.
Use Bun workspaces. Build with `bun run build`; check with `bun run check`; test with `bun test`.
Programs are plain TypeScript with top-level await. Use `orbit.connect({target: 'runtime', control: ['screen']})` inside a runner. No required exported app function.
Preserve the original Familiar geometry and organic motion unless the user asks to change them.
Desktop programs are trusted local code. Browser programs execute in a worker; never give it native controls or desktop credentials.
Keep transport, input observations, drawing and character behavior separate. Avoid animation driven by browser-window liveness.
Do not open or flash a physical device without a user request. USB ports may be owned by another host.
Keep local recordings, transcripts, credentials and personal research out of this repository.
To run anything on the user's computer from a cloud session (desktop app, macOS tools, the plugged-in puck), use tether; see .claude/skills/tether/SKILL.md.
