---
name: tether
description: Run commands, build and open desktop apps, take screenshots or use USB hardware on the user's own computer from a cloud session. Use whenever the user asks for something "on my computer/laptop/Mac", or the work needs macOS, a desktop app or plugged-in hardware.
---

# Working on the user's computer with tether

tether sends signed, encrypted requests through a git mailbox to an agent on the user's computer. Source: https://github.com/isaiahb/tether.

## Get ready (once per session)

```sh
[ -d /tmp/tether ] || git clone --depth 1 https://github.com/isaiahb/tether /tmp/tether
```

Below, `tether` means `bun /tmp/tether/src/cli.ts`. Shell aliases don't carry between tool calls, so write the full command each time.

- If the clone is refused, attach `isaiahb/tether` to the session (read access).
- If `TETHER` is unset, the computer isn't connected to this environment yet. Tell the user to run this in a terminal on their computer, replacing the folder with their projects folder: `git clone https://github.com/isaiahb/tether ~/.tether-src && bun ~/.tether-src/src/cli.ts setup --root ~/code`. Setup copies a line to their clipboard and opens claude.ai/code, where they paste it into the environment's variables. Then they start a new session. Never ask them to paste the line into the chat.
- If tether says it can't reach the mailbox, attach the repository it names with **push** access.

## Use it

1. `tether status`: exit 0 means the computer is online. The output lists the folders tether may work in (`roots`) and the plugged-in serial ports.
2. Move code through git: push your branch, then `tether run --cwd ~/path/to/project -- git fetch origin <branch>` and check it out there.
3. `tether run [--cwd dir] [--timeout s] [--wait s] -- argv...` runs an argv, not a shell string; use `-- sh -c '…'` for pipes. `~` means the user's home folder on that computer. Set `--timeout` and `--wait` above the expected duration for builds.
4. `tether open [--app Name] [path|url]` opens apps, files in the roots and web pages.
5. `tether screenshot --out <scratchpad>/screen.jpg`, then read the image to check a GUI.

A `denied` result is the user's policy. Report it and never look for a way around it. Don't flash firmware or take over a serial port unless the user asked for that work, and back off if the port is busy. Keep output and screenshots in your scratchpad, never in the project repository.
