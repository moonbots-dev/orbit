#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source_app="$PWD/desktop/.build/Orbit.app"
installed_app="$HOME/Applications/Orbit.app"
if [[ ! -d "$source_app" ]]; then echo 'Build Orbit first: bun run build && bun run desktop:build' >&2; exit 1; fi
if [[ -d "$installed_app" ]]; then
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$installed_app/Contents/Info.plist")
  if [[ "$bundle_id" != 'com.moonbots.orbit' ]]; then echo 'Another Orbit app already exists in ~/Applications. Choose an installation location manually.' >&2; exit 1; fi
  if pgrep -f "$installed_app/Contents/MacOS/Orbit" >/dev/null; then
    open "$installed_app"
    echo 'Orbit is already running. Quit it before installing a new build.'
    exit 0
  fi
fi
# Running from Applications avoids asking for access to a Documents checkout.
mkdir -p "$HOME/Applications"
ditto "$source_app" "$installed_app"
open "$installed_app" --args --float
