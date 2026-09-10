#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="desktop/.build/Orbit.app"
if [[ ! -f dist/landing/sim/index.html ]]; then
  echo "Build the web assets first: bun run build:landing" >&2
  exit 1
fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/runtime" "$app/Contents/Resources/web"
bun build runtime/cli.ts --target bun --outfile "$app/Contents/Resources/runtime/cli.js"
bun build runtime/child.ts --target bun --external @orbit/esp32 --outfile "$app/Contents/Resources/runtime/child.js"
cp "$(command -v bun)" "$app/Contents/MacOS/bun"
rsync -a --delete dist/landing/ "$app/Contents/Resources/web/"
xcrun swiftc desktop/app/Orbit.swift -O -framework AppKit -framework WebKit -o "$app/Contents/MacOS/Orbit"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.moonbots.orbit</string>
<key>CFBundleName</key><string>Orbit</string>
<key>CFBundleDisplayName</key><string>Orbit</string>
<key>CFBundleExecutable</key><string>Orbit</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
python3 - "$app" <<'PYLICENSE'
from pathlib import Path
import shutil,sys
out=Path(sys.argv[1])/'Contents/Resources/licenses'
out.mkdir(parents=True,exist_ok=True)
for root in [Path('node_modules'),Path('notices')]:
    for name in root.rglob('*'):
        if name.is_file() and name.name.lower().startswith(('license','licence','copying','ofl','bun-license')) and name.stat().st_size < 1_000_000:
            target=out/root.name/name.relative_to(root)
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(name,target)
PYLICENSE
codesign --force --deep --sign - "$app"
echo "Built $app"
