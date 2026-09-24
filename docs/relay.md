# Orbit relay

Lets a Claude Code session running in the cloud run commands, open apps, take screenshots and work with USB hardware on your laptop while it is on, without you approving each step. When the laptop is off, cloud work carries on and requests expire unanswered.

## How it connects

The cloud container can reach GitHub but not your laptop, and your laptop accepts no inbound connections. Both sides meet in a **private** GitHub repository used as a mailbox:

```
cloud session ── signed request ──▶ requests-<device> ──▶ laptop agent (polls every 3 s)
cloud session ◀──── result ──────── results-<device>  ◀──┘  runs it, pushes output
cloud session ◀──── heartbeat ───── presence-<device>      online, paused, serial ports
```

Each branch has one writer. The agent only dials out; it opens no ports.

## One-time setup

1. Create an empty **private** repository for the mailbox, e.g. `orbit-relay-mailbox`. Command output and screenshots are stored there, so never make it public.
2. On the laptop, in this checkout:
   ```sh
   bun run relay setup --mailbox https://github.com/<you>/orbit-relay-mailbox.git --root ~/orbit
   bun run relay install
   ```
   `setup` prints `ORBIT_RELAY_KEY`, `ORBIT_RELAY_MAILBOX` and `ORBIT_RELAY_DEVICE`. The private key is shown once and not kept on the laptop.
3. Add those three values to the Claude Code cloud environment's variables, and give the cloud session push access to the mailbox repository.
4. The first screenshot request makes macOS ask for Screen Recording permission for Bun; grant it once.

The agent pushes with your normal git credentials (the macOS keychain helper or `gh auth setup-git`).

## Using it from the cloud

```sh
bun run relay status                                   # online? which serial ports?
bun run relay run -- git -C ~/orbit pull
bun run relay run --cwd orbit --timeout 900 -- bun run desktop:build
bun run relay open orbit/desktop/.build/Orbit.app
bun run relay screenshot --out screen.png
```

`run` takes an argv, not a shell string; use `-- sh -c '…'` when a shell is needed.

## What stops misuse

- **Only your cloud environment can issue requests.** Every request is signed with Ed25519. The laptop has only the public key, and rejects anything unsigned, altered, meant for another device, older than its expiry (at most one hour) or already handled. Someone who can write to the mailbox still cannot run anything.
- **Scope.** Commands run only with a working directory inside the configured roots. `open` accepts URLs, apps and files inside the roots, but not scripts, installers or terminal apps.
- **macOS sandbox.** Every command, and everything it starts, runs under `sandbox-exec`. It cannot read SSH, cloud and GitHub credentials, keychains, browser profiles, Mail or Messages. It cannot write the relay's config, LaunchAgents or shell startup files. It cannot run `sudo`, `osascript`, `open`, `launchctl` or `security`, or send Apple Events to other apps.
- **The agent runs from its own copy** in `~/.orbit-relay/app`, which relayed commands cannot modify.
- **Clean environment.** Commands get `PATH`, `HOME` and locale only; no tokens from the agent's environment.
- **Audit and stop.** `bun run relay log` lists every request and its outcome. `bun run relay pause` refuses everything until `resume`; `bun run relay uninstall` removes the agent.

Limits worth knowing: an app you ask the relay to open, including one it just built, runs with your full user permissions like any app you launch. The sandbox deny list protects well-known secret locations, not every file in your home directory. Keep sensitive work outside the roots.

## Hardware

The heartbeat lists USB serial ports (`/dev/cu.usb*`, `/dev/cu.wch*`, `/dev/cu.SLAB*`), so the cloud session can see when a device is plugged in. Flashing and serial tools run through `relay run` like any other command. Agents still flash or open a device only when you have asked for that work, and back off if the port is owned by another host.
