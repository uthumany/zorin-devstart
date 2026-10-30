# APT reconciliation test suite

The backend now separates APT result reconciliation from privileged command execution. This lets tests exercise package-state edge cases without invoking `pkexec`, `apt-get`, or changing the host package database.

## Run the suite

From the repository root:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run check
npm run build
```

The suite currently contains 41 Rust tests. The APT module covers install/remove reconciliation and bounded inventory retries; backend tests cover inventory parsing, cancellation classification, and APT failure diagnostics.

## Covered edge cases

### Install reconciliation

- All newly requested direct packages become installed.
- Packages already installed before the transaction are not recorded as DevStart-owned.
- Duplicate requested package names are deduplicated.
- APT fails after installing some packages: result is `partial` and only proven packages are recorded.
- APT is cancelled before installing anything: result remains `cancelled`.
- Post-install inventory fails: result is `reconciliation-required` and no ownership is claimed.
- APT reports success but inventory is missing requested packages: result is `reconciliation-required`, not success.

### Removal reconciliation

- All tracked packages are removed successfully.
- APT removes only part of the tracked set: result is `partial`.
- APT reports success but packages remain: remaining packages stay eligible for later removal.
- Post-remove inventory fails: result is `reconciliation-required` and ownership is preserved.

### Inventory and failure parsing

- Only `dpkg-query` lines with installed `ii` status are accepted.
- Empty and malformed inventory output is handled without panicking.
- Authorization exit codes 126 and 127 are classified as `cancelled`.
- Ordinary APT errors prefer the last non-empty stderr line; dependency-resolution failures retain the nearby package-specific resolver context before the generic “held broken packages” summary. Details remain bounded in length.
- Signal termination is represented without assuming an exit code.

On the Ubuntu 24.04 Noble amd64 sandbox, `apt-get -s install --no-install-recommends` resolved all six built-in package sets (Python, Web, C/C++, Java, Rust, and Android) without changing the package database. This is a package-index simulation only; it does not rule out device-specific holds, third-party repository conflicts, or damaged package state.

## Test boundary

These tests deliberately do not invoke the real package manager. They validate the deterministic decision boundary after command execution and inventory collection. A disposable Ubuntu/Zorin integration environment should still test:

- real polkit cancellation;
- APT locks and concurrent package managers;
- interrupted dpkg operations;
- state-save failures after mutation;
- actual package installation and removal;
- recovery and reconciliation after process termination.

## Durable confirmation workflow

When an install finishes but the post-install inventory cannot be read, DevStart stores a `pending_reconciliation` plan in the same atomically written state file as ownership and history. The plan contains the profile, candidate direct packages, the complete pre-operation package snapshot, a reason, and a durable plan ID. A pending plan blocks new setup operations so it cannot be overwritten accidentally.

The frontend calls `prepare_reconciliation` after the user chooses “Review & confirm.” The backend re-reads the installed package database and returns a preview. The preview is confirmable only when every candidate package is present and the device differs from the saved snapshot only by the candidate package additions. Missing candidates, unrelated additions, removals, stale plan IDs, invalid package names, and profile changes all prevent confirmation.

The confirmation dialog requires an explicit checkbox acknowledgement and calls `confirm_reconciliation` with the plan ID and reviewed package list. The backend validates the plan again under the mutation lock, assigns only the verified packages, clears the pending plan, and records a successful `reconcile` history event. No APT command runs during either preview or confirmation.
