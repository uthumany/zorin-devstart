# Validation notes

## Verified in the Ubuntu 24.04 sandbox

- `npm run check` and `npm run build` passed. The sandbox uses Node.js 24; CI and the release pipeline pin Node.js 22.23.4.
- Rust formatting passed; all 40 Rust unit tests passed, and strict Clippy passed with `-D warnings` using the repository-pinned Rust 1.99.1 toolchain.
- `npm run build:desktop` built both installers into the isolated `src-tauri/target/build-linux/` tree. The resulting amd64 `.deb` was 3.19 MiB; the x86-64 AppImage was optimized from 78.19 MiB to 3.49 MiB with the repository script. The package assertion script verified Debian architecture `amd64` and an x86-64 AppImage executable after optimization. The tracked sample installers were left unchanged.
- GitHub workflow YAML parsed successfully and `actionlint` reported no issues; packaging scripts passed `bash -n`, and `git diff --check` reported no whitespace errors. These local checks are not a GitHub Actions run.

The optimized AppImage was not launch-tested in this pass. The release workflow also optimizes the AppImage and verifies its checksum and architecture before staging a draft. These checks do **not** prove that the app launches correctly on a real Zorin desktop or that polkit, APT mutations, GNOME integration, high-contrast mode, or the Debian installer work there. The reduced-size AppImage requires host packages `libwebkit2gtk-4.1-0` and `libgtk-3-0`. No Zorin OS device was available in this environment; no profile was installed and no changes were made to the user's system.

## Required before calling the app Zorin-validated

Run this checklist on a clean x86_64 Zorin OS 18.1 Core device, recording the OS build, date, result, and any deviations:

1. Install the amd64 `.deb` with the Software app or `sudo apt install ./Zorin\ DevStart_0.1.0_amd64.deb`; verify the app launches from the applications menu and the status screen reports the supported OS, architecture, APT, and polkit state.
2. Open each of the six built-in profiles and compare package inventory against the device's APT sources. Confirm the final review contains only packages not already installed and explains the system-privilege risk of APT maintainer scripts.
3. On one test profile, approve installation; verify progress, activity history, and ownership state. Then use the profile-specific removal flow and verify only recorded direct packages are requested for removal.
4. Repeat with a package already installed before DevStart; verify it is displayed as present and is never recorded as owned. Cancel an authorization prompt and confirm the operation is not reported as success.
5. Validate and save a well-formed local extension; reject malformed, duplicate, or built-in-ID manifests. Review and remove any test packages before deleting the extension definition. Also verify skipped invalid files are reported with repair/removal guidance.
6. Relaunch the app and confirm local profile/activity state persists. Check the keyboard path, focus return/Escape behavior, reduced-motion setting, and the OS high-contrast/forced-colors mode.
7. Remove DevStart with `sudo apt remove zorin-dev-start`; confirm language toolchains remain installed. Reinstall DevStart if necessary to remove tracked test packages first.

Until those checks have been run and results recorded, describe Zorin compatibility as a target rather than a device-validated release.
