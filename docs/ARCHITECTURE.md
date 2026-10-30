# Architecture

## System shape

Zorin DevStart is a single-user Linux desktop app: React/TypeScript renders the interface in Tauri's webview; a small Rust backend owns all package metadata, OS inspection, persistent state, and privileged operations. The frontend never receives a shell API. Tauri IPC exposes a short list of typed commands.

## Responsibilities

- **React UI (`src/`)** — navigation, search, profile cards, package explanations, confirmation dialogs, progress/error states, activity, extension form, light/dark appearance, and responsive layout. It may offer a browser preview, but preview mode cannot execute package commands.
- **IPC adapter (`src/api.ts`)** — checks for a native Tauri runtime and invokes only named commands. Errors remain visible; a failed native call does not silently become mock success.
- **Profile catalog (`src-tauri/src/profiles.rs`)** — authoritative built-in IDs, APT package names, descriptions, and extension schema validation. Built-in UI copy is not trusted for command authorization.
- **APT executor (`src-tauri/src/lib.rs`)** — revalidates profile/package IDs and uninstall ownership, checks installed status, serializes state reads and mutations with thread and cross-process locks, checks `/proc/locks` for active APT/dpkg operations, calls fixed `/usr/bin/pkexec` with `/usr/bin/apt-get` and a typed argument vector, and emits structured stage/result events. It never uses a shell, interpolated command string, remote script, or stored password.
- **State store (`src-tauri/src/store.rs`)** — records only direct requested packages absent before installation and found installed afterward, plus timestamp and operation history. JSON state lives under the user's XDG data directory; manifests live under XDG config. Install recovery plans include a timestamp and SHA-256 digest, and are written before privileged APT installation starts.
- **Polkit** — the OS supplies the authorization agent. DevStart asks the OS to authorize an exact APT operation, rather than collecting a password itself.

## Install algorithm

1. Look up the immutable built-in profile or validated extension by ID.
2. Confirm supported architecture/platform and required executables.
3. Query dpkg for installed package status and compute `newly_requested = requested - installed_before`.
4. If no package is new, return the current state without elevation.
5. Check for competing package-manager locks, run `pkexec /usr/bin/apt-get update`, and re-query the baseline immediately before installation.
6. Persist a recovery plan before executing `pkexec /usr/bin/apt-get install -y --no-install-recommends` with fixed dpkg conffile defaults and validated package arguments.
7. Retry transient dpkg inventory failures with bounded backoff. Persist only direct requested package names that were absent before and installed afterward. If the final inventory is unavailable or unexpected device changes make attribution uncertain, keep the recovery plan and require user review; reconciliation never reruns APT.
8. Do not persist credentials or package-index contents.

Package-manager actions are only available in the native app. An in-app review precedes polkit; the backend serializes mutations and independently validates profile IDs, package names, and the ownership ledger against the current profile. APT packages may execute maintainer scripts with system privileges; DevStart does not audit package contents or verify configured repository provenance.

## Uninstall algorithm and limits

1. Read the profile's saved owned package names.
2. Confirm every saved package is a unique member of the current validated profile, reload the ownership record under the cross-process lock, and intersect it with a fresh, retried installed-package inventory immediately before removal. Corrupt or tampered ownership data fails closed; no profile data means nothing is eligible for removal.
3. Require confirmation in the UI; call polkit with fixed `apt-get remove -y` and validated saved names as separate arguments. Dpkg keeps existing conffiles; never purge.
4. On success, remove ownership records for packages no longer installed. Preserve user config and files. Never call `purge`, `autoremove`, or a shell wildcard.

APT may leave auto-installed dependencies behind. This is intentional: removing dependencies globally could break software installed outside DevStart.

## Extension trust boundary

JSON profile extensions can contain only descriptive metadata and APT package IDs. Validation enforces a schema version, bounded field lengths/package count, a lowercase unique slug, no built-in ID overrides, no duplicates, and a strict package-name character set. New manifests are written to a synced temporary file and published atomically without replacing an existing ID. Unreadable, malformed, symlinked, invalid, or duplicate extension files are skipped with visible file-specific diagnostics and an open-folder action for repair or removal. No command, script, URL-to-execute, hook, environment setting, path, package manager, or privilege policy is extensible. The manifest cannot execute code, but APT packages may run maintainer scripts as root; users must trust package names and configured sources. The UI states this before installation.

## Data and privacy

No account, telemetry, backend service, or API key is required. Local state consists of profile ownership and a bounded activity history. Extension manifests are user-local. GitHub integration is a repository/development concern; the installed app does not call GitHub.

## Signed updater boundary

The Tauri updater is exposed only for Linux AppImage runtime sessions. The Updates page performs a read-only check first; installation requires an explicit **Install & restart** click. Tauri verifies the detached signature against the public key compiled into the app and `requireSignedVersion` requires the trusted signature comment to match the manifest version, preventing a modified manifest from relabeling an older signed artifact as a newer one. The AppImage is replaced and the process relaunched only after that check. Debian packages remain manual Software/APT installs; DevStart never runs a package manager to update itself. Local builds keep updater installation disabled unless both signing keys are supplied.

The first updater-enabled release cannot update earlier binaries that do not contain the plugin and public key. The v0.1.1 installation therefore needs a manual AppImage update once. The private key must remain in the protected GitHub `release-signing` environment; losing or rotating it requires a manually installed build with the new public key. The release pipeline signs the final AppImage after size optimization, publishes its sidecar signature and a static `linux-x86_64-appimage` manifest, and verifies that manifest and checksums before a separate manual publication step.

## Build and release

Vite produces the frontend. Cargo/Tauri packages the app as both a Debian bundle and an AppImage. Pull requests run frontend checks/build and Rust tests. Only x86_64/amd64 builds are allowed. Node 22.23.4 and Rust 1.99.1 are pinned; workflow actions use immutable commit SHAs. Version tags stage a draft with the manual `.deb`, optimized signed AppImage, updater signature and manifest, SHA-256 checksums, and build-provenance attestations. The signing job uses a protected GitHub environment named `release-signing`; a separate manual workflow verifies staged assets and targets `release-publish`. Repository administrators must configure both environments with appropriate required reviewers and deployment restrictions. The Debian bundle depends on target-system WebKitGTK 4.1 and GTK libraries. Tauri notes that Linux bundles should be built on the oldest supported base that provides WebKitGTK 4.1; AppImage compatibility with older systems can also be limited by glibc. If supporting older OS versions, adjust the CI image and test that exact target. Zorin OS 18.1 itself uses Ubuntu 24.04 LTS.
