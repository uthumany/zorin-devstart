# Build Prompt — Zorin DevStart

Copy this prompt into a coding agent or use it as the product build brief. The repository includes the first implementation; this specification also describes the intended complete product and its acceptance criteria.

---

## Role and goal

Act as a senior Linux desktop application engineer, product designer, security-minded package-management specialist, and technical writer. Build **Zorin DevStart**, a fully functional, responsive desktop app primarily targeted at **Zorin OS 18.1 Core (64-bit x86)**. Its current backend safety gate accepts x86_64 Zorin OS 18.x (including 18.1) and Ubuntu 24.04 LTS. It provides explainable starter profiles for Python, web development, C/C++, Java, Rust, and Android, with safe installation and a clearly scoped uninstall path.

Deliver a distributable Linux desktop application, readable source, tests, user documentation, diagrams, and a public GitHub repository. Do not modify any unrelated repository. Keep all package lists and changes reviewable. Do not claim actual installation or visual testing on a Zorin device unless it was run there.

## 1. Software overview and description

Zorin DevStart is a small native desktop setup assistant. It helps a new developer understand and install a sensible starting toolchain without pasting opaque shell commands. A user selects a profile, reviews a plain-language explanation and exact package names, authorizes the change through the desktop's polkit prompt, observes progress, and can later remove only the packages DevStart records as newly installed for that profile.

Target Zorin OS 18.1 Core, based on Ubuntu 24.04 LTS and GNOME Shell. The implementation gate accepts Zorin OS 18.x and Ubuntu 24.04 LTS on x86_64; do not imply a Zorin device test unless one was run. Use APT/dpkg for the built-in package profiles. Do not describe a browser preview as a working installer. The Android profile may install Java, ADB, Fastboot, and supporting tools, but Android Studio/Google SDK downloads and license acceptance must remain a guided, explicit user action unless a future implementation adds a verified official installer flow.

## 2. User instructions and flow

1. Open DevStart and check the compatibility/system status.
2. Browse or search profiles; open one to see what each tool does.
3. Review only the APT packages not already installed, alongside the installed-state context and exact system changes that will occur.
4. Select **Install profile**. Confirm the new-package-only list and package-source trust warning in DevStart, then approve or cancel the native polkit prompt.
5. Follow progress and read the result, including partial-failure details if APT stops.
6. View installed profiles and operation history.
7. To remove a setup, open its profile, review the exact recorded package set, and confirm **Remove profile tools**. The app uses `apt-get remove`; never purge configuration or run broad `autoremove`.
8. Add a local extension by pasting a JSON profile manifest. Review its metadata and package list before saving. Manifests cannot supply scripts or arbitrary commands, but APT packages can run maintainer scripts with system privileges; use only trusted packages and configured sources.

## 3. Fifteen core features

1. Six built-in profiles: Python, Web, C/C++, Java, Rust, Android.
2. Profile search and category filtering.
3. Plain-language descriptions for every package/tool.
4. Exact preview of only new package IDs before any system changes.
5. Installed-state detection with pre-existing tools clearly identified.
6. Compatibility detection for the OS, release, architecture, APT, and polkit; disable system actions outside the supported target.
7. Explicit in-app confirmation followed by native polkit authorization.
8. Progress, success, cancellation, actionable errors, and serialized backend mutation states.
9. Ownership ledger recording only requested packages newly installed by this app.
10. Profile-specific clean removal of only recorded direct packages.
11. No `purge`, blanket `autoremove`, or deletion of project/SDK folders.
12. Local activity history with timestamps and concise operation results.
13. Declarative local profile extensions with strict schema/package-name validation and an explicit APT maintainer-script trust warning.
14. Light/dark theme, keyboard navigation, screen-reader labels, reduced-motion support, and responsive window layouts.
15. GitHub Actions CI, tagged draft `.deb` releases requiring manual publication, versioned documentation, and a reproducible uninstall/build guide.

## 4. iOS-inspired Clear Liquid Glass UI guidelines and principles

Use the requested iOS Clear Liquid Glass aesthetic as a reference for material, layering, and soft edge highlights, translated into a Zorin/GNOME desktop rather than copied as an iPhone UI. Do not copy Apple assets or imply endorsement. Create a crisp, high-clarity interface using the Zorin desktop system sans-serif, titlebar-friendly controls, restrained translucent surfaces, subtle rim highlights, soft depth, and readable labels. Keep text contrast independent of transparency; blur only behind surfaces and provide opaque fallbacks, reduced-motion behavior, keyboard focus, and a system-color `forced-colors` mode.

Use a left navigation rail on wide windows and a compact bottom/navigation drawer on narrow windows. Keep the primary action and safety summary visible. Each profile card should communicate language, effort/size only when known, key tools, and install state. Include a lightweight, non-interactive CSS 3D/perspective glass hero visual with a static fallback; decorative depth must never interfere with input or readability.

Use motion sparingly and purposefully: short opacity/transform feedback, no `transition: all`, no scale-from-zero entrances, hover effects only for fine pointers, and `prefers-reduced-motion` alternatives. Keyboard focus is unmistakable. Dialogs must trap or manage focus correctly, expose a title/description, support Escape when safe, and return focus to their trigger. Touch targets should remain comfortable. Provide error, loading, empty, offline, backend-unavailable, and long-content states.

## 5. Package managers, languages, frameworks, technologies, dependencies, prerequisites

**App stack:** Tauri 2 desktop shell (Rust backend); React + TypeScript + Vite UI; plain CSS design tokens and responsive layout; `lucide-react` icons; serde JSON persistence; Rust tests. Prefer minimal dependencies.

**System integration:** APT/dpkg inventory; `pkexec`/polkit for privilege elevation; XDG config/data directories for extension/state storage; desktop link to Android's official download/install guidance. Never concatenate user-provided values into a shell string. Use fixed executable paths, immutable backend-owned built-in profile definitions, strict package-ID validation, and argument arrays; package-name validation does not verify provenance or package contents.

**Profiles (Ubuntu 24.04 APT names; verify on the target before release):**
- Python: `python3`, `python3-venv`, `python3-pip`, `pipx`, `build-essential`, `git`.
- Web: `nodejs`, `npm`, `git`, `curl`. Ubuntu Noble's `nodejs` package is 18.19.1 and upstream Node 18 is EOL; show a prominent warning before install, do not add an external repository, and do not claim this is a current upstream LTS.
- C/C++: `build-essential`, `clang`, `cmake`, `gdb`, `ninja-build`, `lldb`.
- Java: `default-jdk`, `maven`, `git`. Do not install Ubuntu Noble's obsolete `gradle` 4.4.1; explain how to use the checked-in Gradle Wrapper when a project requires Gradle.
- Rust: `rustc`, `cargo`, `rustfmt`, `rust-clippy`, `git`. `rust-clippy` is the Noble APT package name. Rust Analyzer has no Noble archive package; document editor/toolchain setup separately and do not claim it is installed.
- Android starter: `default-jdk`, `adb`, `fastboot`, `unzip`, `git`. Guide the user to Android Studio/SDK Manager for licensed/vendor SDK components.

**Desktop build prerequisites:** 64-bit x86 Linux; Node.js 22.x (pinned in CI); Rust stable; `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `pkg-config`. Package prerequisites should be installed by the developer during setup, not silently by the app.

## 6. Free integrations and how they work

- **APT/dpkg:** local package catalogue and status; no login, token, or paid API.
- **polkit:** delegates privileged APT requests to the operating system's authorization UI. DevStart does not embed or persist an administrator password.
- **GitHub Actions:** install pinned/locked JS dependencies, check/typecheck, run Rust tests, compile bundles on the documented Ubuntu baseline; no external service account required.
- **GitHub Releases:** a version tag creates a draft release with the `.deb` build using the repo-scoped `GITHUB_TOKEN`; a maintainer reviews and manually publishes it. Do not claim signing unless key management is configured.
- **Local JSON extensions:** validate schema, package names, duplicates, bounds, and ID; persist in XDG config. The manifest has no executable plugin code, but APT package maintainer scripts can run with system privileges; warn users to trust package sources.

## 7. Code and GitHub repository architecture

Use a single repository named `uthumany/zorin-devstart`, independent from other projects. Suggested tree:

```text
zorin-devstart/
├── .github/workflows/{ci.yml,release.yml}
├── .github/dependabot.yml
├── docs/{USER_GUIDE.md,ARCHITECTURE.md,diagrams.md,research-notes.md}
│   ├── validation.md
│   └── screenshots/{devstart-desktop.png,devstart-mobile.png}
├── src/
│   ├── components/               # cards, dialogs, nav, status, toasts
│   ├── data/                     # presentation-only profile descriptions
│   ├── App.tsx, App.css, api.ts, types.ts, main.tsx
├── src-tauri/
│   ├── icons/{32x32.png,128x128.png,256x256.png}
│   ├── capabilities/default.json
│   ├── src/{main.rs,lib.rs,profiles.rs,store.rs}
│   ├── Cargo.toml, Cargo.lock, tauri.conf.json, build.rs
├── index.html
├── package.json, package-lock.json, tsconfig.json, vite.config.ts
├── README.md, BUILD_PROMPT.md, LICENSE
└── .gitignore
```

Keep the backend authoritative for package IDs and profile ownership. Frontend profile copy may not be used to authorize a system command. Define typed Tauri IPC DTOs and validate every command input. Minimize Tauri permissions; do not grant shell/plugin APIs to the frontend. Store only local setup state, not credentials or telemetry.

## 8. Extension mechanism

Extensions are declarative JSON, stored below `$XDG_CONFIG_HOME/zorin-devstart/profiles/`. A manifest contains a schema version, stable slug ID, title, short description, category, and a bounded list of APT package identifiers with human-readable reasons. Enforce length/count limits, reject duplicate IDs and package names, reject invalid characters, reject attempts to override built-in IDs, and display a new-package-only preview before installation. Explain that APT can run package maintainer scripts with system privileges and that DevStart does not verify package provenance or audit package contents. Never allow scripts, URLs as executable instructions, shell arguments, hooks, environment mutation, or arbitrary install/uninstall commands in the manifest. Built-in and extension profiles share the fixed package executor; the backend validates package names and uninstall ownership, but users must trust the configured APT sources and package maintainer scripts.

## 9. Wireframes and use-flow architecture

Wide-window overview:

```text
┌────────────────┬──────────────────────────────────────────┐
│ DevStart       │ Search…             Compatibility  Theme │
│ Overview       ├──────────────────────────────────────────┤
│ Profiles       │ Your next build starts here               │
│ Activity       │ [setup status] [installed] [history]       │
│ Extensions     │ Python     Web      C/C++                  │
│ Settings       │ Java       Rust     Android                │
│                │ Latest activity       Safety note          │
└────────────────┴──────────────────────────────────────────┘
```

Profile detail/review:

```text
┌────────────────────────────────────────────────────────────┐
│ ← Profiles  Python Developer                         Close │
│ What you'll get and why                                    │
│ python3-venv  isolated project environments                │
│ python3-pip   installs packages inside environments        │
│ …                                                          │
│ Already installed: git       New packages: 5               │
│ APT change: update index, then install the listed packages │
│ [Cancel]                              [Review & install]    │
└────────────────────────────────────────────────────────────┘
```

On mobile/narrow windows, the navigation collapses; the same profile content, package list, safety text, and actions remain available without horizontal scrolling.

## 10. Diagrams, hosting, deployment, and acceptance

Add Mermaid diagrams for component architecture, profile-install and uninstall flows, extension validation, and package-ownership state. Host source and docs in a public GitHub repository. CI builds/test-checks on pull requests and pushes. A version tag creates a draft GitHub Release with a `.deb`; document manual review/publication, local install, and removal. Build on Ubuntu 24.04 (matching the Zorin OS 18.1 base); if extending compatibility to older systems, verify WebKitGTK 4.1 support and build on the oldest valid baseline. Document Zorin OS 18.1 testing requirements.

**Acceptance criteria:**
- `npm ci`, frontend check/build, Rust tests, and desktop build commands are documented and reproducible.
- All six profiles are visible, searchable, and have understandable package explanations.
- Browser-only preview cannot perform privileged operations.
- A fresh install previews only packages not already installed, warns about trusted APT sources/maintainer scripts, and requires OS authorization; cancellation does not claim success.
- Pre-installed packages are never recorded as owned by DevStart.
- Backend mutations are serialized; uninstall requires saved package ownership to be a subset of the current validated profile and does not remove unrelated applications or user files.
- Invalid or malicious extension manifests are rejected; valid manifests are persisted and available after restart.
- Browser preview, desktop-backend-unavailable, unsupported-system, responsive, keyboard, reduced-motion, opaque-blur-fallback, and forced-colors states are implemented and truthfully distinguished.
- Public repository, workflows, build artifacts, screenshots, and device test results are described truthfully.

---
