# Platform and package notes

## Zorin and desktop target

Zorin OS 18.1 Core is Ubuntu 24.04 LTS-based, uses GNOME Shell, and supports APT alongside Flatpak, Snap, `.deb`, and AppImage formats. The app is primarily targeted at x86_64 Zorin OS 18.1; its current backend gate accepts Zorin OS 18.x and Ubuntu 24.04 LTS on x86_64. A Zorin desktop was not available in this sandbox, so validation must still include a real Zorin OS 18.1 device. See [Zorin OS technical details](https://zorin.com/os/details/).

## Package choices checked against Ubuntu Noble

The official Noble archive lists [`nodejs` 18.19.1](https://packages.ubuntu.com/noble/nodejs). The Node.js project marks v18 end-of-life, meaning it receives no upstream updates, including security fixes ([Node.js EOL](https://nodejs.org/en/about/eol)). DevStart keeps `nodejs` and `npm` visible in its Web starter because they are the distro package candidates, but warns users before proceeding, does not call this a current upstream LTS, and does not silently add another repository or execute a remote installer.

Ubuntu Noble's [`gradle` package is 4.4.1](https://packages.ubuntu.com/noble/gradle), so the Java profile intentionally installs `default-jdk` and Maven instead; projects should use their checked-in Gradle Wrapper when they require Gradle. Ubuntu Noble supplies Clippy as [`rust-clippy`](https://packages.ubuntu.com/noble/rust-clippy), not `clippy`. Its [Rust availability guide](https://ubuntu.com/developers/docs/reference/availability/rust/) lists Rust 1.75 as the Noble default and versioned packages for other compiler releases. The Noble archive does not list a `rust-analyzer` binary package, so the Rust profile leaves language-server setup to the user's editor/toolchain choice.

The Android starter installs the archive's Java, `adb`, Fastboot, and unzip prerequisites. Android Studio, Google's SDK components, and their licence acceptance remain an explicit user-guided step; see [Android Studio](https://developer.android.com/studio) and [Android SDK tools](https://developer.android.com/tools).

## Desktop build dependencies

Tauri lists `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, and `librsvg2-dev` among its Linux prerequisites, along with Rust and Node.js for a JavaScript frontend ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)). Tauri's [Debian bundling guide](https://v2.tauri.app/distribute/debian/) discusses WebKitGTK/GTK runtime dependencies and building on the oldest supported baseline; the app bundle is configured to depend on WebKitGTK 4.1 and GTK 3. Tauri's [configuration reference](https://v2.tauri.app/reference/config/) documents icon paths in the bundle configuration.

Package list and runtime-candidate observations were checked against the Ubuntu 24.04 package index in this build environment. Re-check them against a clean, current Zorin OS 18.1 install before a production release; DevStart does not claim a device-level Zorin test.
