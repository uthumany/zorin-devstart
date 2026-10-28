# Validation notes

## Verified in the Ubuntu 24.04 sandbox

- `npm run check` and `npm run build` passed in this sandbox with Node.js 24.19.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` passed; all 10 Rust unit tests passed.
- `npm run tauri -- build --bundles deb,appimage` produced the unsigned amd64 `Zorin DevStart_0.1.0_amd64.deb` (3.00 MiB) and executable `Zorin DevStart_0.1.0_amd64.AppImage` (78.01 MiB). Debian metadata lists `libwebkit2gtk-4.1-0` and `libgtk-3-0`; the AppImage extracted successfully and contained its application entry point.
- The Mermaid diagrams rendered successfully.
- Playwright browser-preview checks covered the Overview, Rust profile/review, Extensions, and Settings screens at desktop and 390×844 mobile sizes. The install and extension-save actions were disabled in browser preview. No browser console errors were reported.

These checks do **not** prove that polkit, APT mutations, GNOME integration, high-contrast mode, or the Debian installer work on a real Zorin desktop. No Zorin OS device was available in this environment; no profile was installed and no changes were made to the user's system.

## Required before calling the app Zorin-validated

Run this checklist on a clean x86_64 Zorin OS 18.1 Core device, recording the OS build, date, result, and any deviations:

1. Install the `.deb` with the Software app or `sudo apt install ./Zorin\ DevStart_0.1.0_amd64.deb`; verify the app launches from the applications menu and the status screen reports the supported OS, architecture, APT, and polkit state.
2. Open each of the six built-in profiles and compare package inventory against the device's APT sources. Confirm the final review contains only packages not already installed and explains the system-privilege risk of APT maintainer scripts.
3. On one test profile, approve installation; verify progress, activity history, and ownership state. Then use the profile-specific removal flow and verify only recorded direct packages are requested for removal.
4. Repeat with a package already installed before DevStart; verify it is displayed as present and is never recorded as owned. Cancel an authorization prompt and confirm the operation is not reported as success.
5. Validate and save a well-formed local extension; reject malformed, duplicate, or built-in-ID manifests. Review and remove any test packages before deleting the extension definition.
6. Relaunch the app and confirm local profile/activity state persists. Check the keyboard path, focus return/Escape behavior, reduced-motion setting, and the OS high-contrast/forced-colors mode.
7. Remove DevStart with `sudo apt remove zorin-dev-start`; confirm language toolchains remain installed. Reinstall DevStart if necessary to remove tracked test packages first.

Until those checks have been run and results recorded, describe Zorin compatibility as a target rather than a device-validated release.
