# Releasing musicware (macOS)

Three small commands cover version bumps, app-name changes, and building the installer.

## 1. Bump the version

```sh
npm run version:set 0.2.0
```

Syncs the version across **package.json**, **src-tauri/tauri.conf.json** (the bundle/installer
version), and **src-tauri/Cargo.toml** so they never drift. Run this *before* a release build so
the DMG filename and the app's About version match.

## 2. Rename the app (optional)

```sh
npm run app-name:set "MoonOzy Studio"
```

Sets `productName` (the `.app` / Finder / Dock / menu-bar name) **and** the main window title.
The bundle identifier (`com.musicware.app`) is intentionally left unchanged — keep it stable so
macOS treats updates as the same app.

## 3. Build the installer

```sh
npm run release          # alias for `tauri build`
```

Produces, for your Mac's architecture:

- **App:** `src-tauri/target/release/bundle/macos/<productName>.app`
- **DMG:** `src-tauri/target/release/bundle/dmg/<productName>_<version>_<arch>.dmg`

### Installing the unsigned build

It's an **unsigned** local build, so the first launch is blocked by Gatekeeper:

- Right-click the app → **Open** → **Open**, or
- System Settings → Privacy & Security → **Open Anyway**.

On the first voice recording, macOS prompts for **microphone** access — allow it.

## Notes / debt

- The dev Content-Security-Policy and the `fs` write scope (`$HOME/**` …) are intentionally
  broad to keep mic capture and export working. **Tighten both before any public distribution.**
- The build is unsigned and un-notarized — fine for installing on your own machine; for sharing
  you'd add Apple Developer signing + notarization.
