---
name: relay
description: Run commands, open apps, take screenshots or use USB hardware on the user's laptop from a cloud session. Use whenever the user asks to do something "on my computer/laptop/Mac", or work needs the desktop app, macOS tools or the plugged-in puck.
---

# Working on the user's laptop

Read `docs/relay.md` for the model. From this checkout:

1. `bun run relay status` — exit 0 means the laptop is online. It also lists plugged-in serial ports. If `ORBIT_RELAY_KEY` is missing, the user has not finished setup; point them at `docs/relay.md`.
2. Get your changes onto the laptop through git: push the branch, then `bun run relay run -- git -C orbit fetch origin <branch>` and check it out. Paths are relative to the first workspace root.
3. Run work with `bun run relay run [--cwd dir] [--timeout seconds] -- argv...`. Builds can take minutes, so pass `--timeout` and `--wait` above the expected duration.
4. Check GUI results with `bun run relay screenshot --out <scratchpad>/screen.png` and read the image.

A `denied` result is the laptop's policy speaking. Report it; do not look for a way around it. Don't flash or open a device unless the user asked for that work, and back off if the port is busy. Screenshots and output land in the private mailbox repo only, never in this repository.
