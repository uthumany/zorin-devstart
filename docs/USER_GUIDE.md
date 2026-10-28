# User guide

## Before you start

DevStart is primarily targeted at x86_64 Zorin OS 18.1 Core. Its backend gate accepts Zorin OS 18.x and Ubuntu 24.04 LTS on x86_64; actual Zorin device validation is still required. It uses APT and invokes polkit only after you review a package plan. APT may run package maintainer scripts with system privileges; use only packages from repositories you trust. Keep the system's package sources current and close other package managers before installing.

The Android starter installs Java, ADB/Fastboot, Git, and unzip. It does **not** silently download Android Studio or accept Google's SDK licences. Follow the official [Android Studio](https://developer.android.com/studio) and [SDK tools](https://developer.android.com/tools) guides for the remaining vendor-managed components.

## Install the application

The build produces both a `.deb` under `src-tauri/target/release/bundle/deb/` and an `.AppImage` under `src-tauri/target/release/bundle/appimage/`.

For the Debian package, open the `.deb` in Software or run:

```bash
sudo apt install "./src-tauri/target/release/bundle/deb/Zorin DevStart_"*.deb
```

For direct AppImage execution, review the file, make it executable, then launch it:

```bash
chmod +x src-tauri/target/release/bundle/appimage/*.AppImage
src-tauri/target/release/bundle/appimage/*.AppImage
```

The Debian bundle depends on WebKitGTK 4.1 and GTK libraries. AppImage is built on Ubuntu 24.04; compatibility with older Linux systems is not guaranteed because core-library requirements such as glibc depend on the build baseline. Both formats are unsigned. Do not install or run an artifact you have not reviewed.

## First run

1. Open **Zorin DevStart** from the applications menu.
2. Browse a profile or search for a language/toolchain.
3. Select a profile to read each tool's purpose and current installed state.
4. Open the install review. Check the package list and the explanation.
5. Confirm in the app. Approve or cancel the operating-system authorization prompt.
6. Wait for the result. A canceled prompt or APT failure is not reported as a successful installation.

A browser-only preview is available with `npm run dev`, but privileged actions are disabled there.

## Built-in profiles

| Profile | Starter tools | Notes |
| --- | --- | --- |
| Python | python3, venv/pip, pipx, build tools, Git | Prefer per-project virtual environments. |
| Web | Node.js, npm, Git, curl | Noble's APT package is Node.js 18.19.1; upstream Node 18 is EOL. Check project requirements and arrange a maintained runtime separately if needed. |
| C/C++ | compiler/build tools, Clang, CMake, GDB, Ninja, LLDB | Installs native compiler/debugger packages. |
| Java | default JDK, Maven, Git | `default-jdk` follows the distro's default Java version. Use the project's Gradle Wrapper; Noble's APT Gradle package is 4.4.1 and is not installed by this profile. |
| Rust | rustc, Cargo, rustfmt, `rust-clippy`, Git | `rust-clippy` is the Ubuntu package name. Rust Analyzer is not available in the Noble archive and must be configured separately. |
| Android | Java, ADB, Fastboot, unzip, Git | SDK/Studio install and licence acceptance are guided separately. |

Package availability can vary if the device's repositories or architecture differ. DevStart validates the supported platform and lets APT report an unavailable package rather than executing a fallback script. Upstream Node 18 is end-of-life, so review the Node notice in the Web profile before installation; DevStart never silently adds an external repository or downloads a runtime installer.

## Uninstall a profile

1. Open the installed profile and choose **Remove profile tools**.
2. Review the precise direct package list DevStart recorded as absent before installation.
3. Confirm the removal, then authorize it through polkit.

DevStart uses `apt-get remove`, not `purge` or a global `autoremove`. It does not delete project folders, SDK downloads, user configuration, shared dependencies, or package data. Dependencies APT marked as automatic may remain; that conservative behavior avoids removing something another app now uses.

Uninstalling the DevStart application does not remove language tools. Remove each tracked profile first if that is what you intend.

To remove the desktop app itself, use the Software app or run `sudo apt remove zorin-dev-start`. This removes DevStart only; it does not remove profile packages, project folders, SDKs, or the local ownership ledger. Do not use `purge` if you want to keep local configuration.

## Profile extensions

Open **Extensions**, paste a JSON manifest, and select **Validate and add**. A manifest contains profile metadata and package IDs, not executable commands. However, installing an APT package can run its maintainer scripts with system privileges; DevStart validates package names but does not verify package provenance or audit package contents. Use only packages and configured repositories you trust. For example:

```json
{
  "schema_version": 1,
  "id": "example-docs",
  "title": "Documentation tools",
  "description": "A small local profile for authoring docs.",
  "category": "Writing",
  "packages": [
    { "name": "pandoc", "reason": "Converts Markdown and document formats." },
    { "name": "git", "reason": "Tracks changes to documentation." }
  ]
}
```

Use a unique lowercase ID; built-in IDs cannot be replaced. The app limits fields and package counts, rejects invalid package identifiers, and stores accepted manifests in the user's XDG config directory. Removing an extension definition does not uninstall tools; use the profile uninstall action first.

## Developer build

Install the native dependencies in the root README, Node.js 22.x (the version pinned by CI), and Rust stable. Then:

```bash
npm ci
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
```

See [architecture](ARCHITECTURE.md), [diagrams](diagrams.md), and the [validation checklist](validation.md) for implementation, safety boundaries, and unrun device checks.
