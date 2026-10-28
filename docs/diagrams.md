# Wireframes and diagrams

## Desktop overview wireframe

```text
┌──────────────────┬──────────────────────────────────────────────────────────┐
│  Zorin DevStart  │ Search profiles…     Zorin 18 target       Theme  ▢      │
│                  ├──────────────────────────────────────────────────────────┤
│  ◉ Overview      │                                                          │
│  ◇ Profiles      │  Your next build starts here                             │
│  ◷ Activity      │  Choose a starter setup. See every change before it runs.│
│  ⬡ Extensions    │                                                          │
│  ⚙ Settings      │  [6 profiles]   [0 tracked setups]   [local-only state]  │
│                  │                                                          │
│                  │  Python        Web       C / C++                         │
│                  │  Java          Rust      Android                         │
│                  │                                                          │
│                  │  Recent activity               Explainable by default    │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

## Profile review wireframe

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Python Developer setup                                       close / back   │
│ A clear starter environment for Python projects.                            │
│                                                                             │
│ TOOL / APT PACKAGE                  WHY IT IS INCLUDED         STATUS       │
│ python3-venv                        isolated project envs      not installed│
│ python3-pip                         package installer           not installed│
│ pipx                               isolated app installs       installed   │
│ …                                                                           │
│                                                                             │
│ ACTION SUMMARY: refresh APT index, then install only new packages shown     │
│ DevStart asks the OS to authorize this exact package operation.              │
│ [Cancel]                              [Continue to installation review]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Application architecture

```mermaid
flowchart LR
  U[User] --> UI[React + TypeScript UI]
  UI --> IPC[Typed Tauri IPC]
  IPC --> CAT[Backend profile catalog + validator]
  CAT --> STATE[Local XDG state store]
  CAT --> EXEC[Fixed APT executor]
  EXEC --> INV[dpkg inventory]
  EXEC --> POLKIT[pkexec / polkit authorization]
  POLKIT --> APT[APT package manager]
  EXT[Local JSON extension] --> CAT
  DOC[GitHub Actions + draft release] --> BIN[Debian package artifact]
```

## Setup and removal flow

```mermaid
flowchart TD
  A[Choose profile] --> B[Read backend-owned profile]
  B --> C[Show tool purpose and exact package list]
  C --> D{User confirms in app?}
  D -- No --> X[No system change]
  D -- Yes --> LOCK[Acquire backend mutation lock]
  LOCK --> E[Compare dpkg inventory]
  E --> F{New package needed?}
  F -- No --> G[Report already installed]
  G --> RELEASE[Release mutation lock]
  F -- Yes --> H[OS polkit authorization]
  H -- Cancel --> RELEASE
  H -- Approve --> I[APT update and install fixed package IDs]
  I --> J[Recheck dpkg + persist only newly installed direct packages]
  J --> K[Report success or partial failure]
  K --> RELEASE
  RELEASE --> L[Later: review recorded package set]
  L --> M{Confirm removal?}
  M -- No --> K
  M -- Yes --> N[Revalidate saved ownership against current profile]
  N -- Invalid --> Q[Fail closed; remove nothing]
  N -- Valid --> O[APT remove only validated recorded packages]
  O --> P[Reconcile ownership; retain user files and shared dependencies]
```

## Extension validation

```mermaid
flowchart LR
  JSON[User-supplied JSON] --> PARSE[Parse + schema version]
  PARSE --> ID[Validate unique lowercase ID]
  ID --> META[Bound metadata lengths/category]
  META --> PKG[Validate package names/count/duplicates]
  PKG --> NOEXEC{Manifest has only profile data and package IDs?}
  NOEXEC -- No --> REJECT[Reject manifest]
  NOEXEC -- Yes --> SAVE[Persist under XDG config]
  SAVE --> PREVIEW[Review through fixed APT executor]
  PREVIEW --> TRUST[Warn: APT maintainer scripts may run with system privileges; trust the source]
```

## View/navigation flow

```mermaid
flowchart TD
  O[Overview] --> P[Profiles]
  O --> A[Activity]
  O --> E[Extensions]
  O --> S[Settings]
  P --> D[Profile details]
  D --> R[Review exact change]
  R --> I[Install + OS authorization]
  I --> A
  D --> U[Review owned packages]
  U --> X[Uninstall + OS authorization]
  X --> A
  E --> V[Validate extension]
  V --> P
```


## Package ownership lifecycle

```mermaid
flowchart TD
  A[User confirms install plan] --> B[Acquire process-wide mutation lock]
  B --> C[Snapshot installed packages before APT]
  C --> D[Compute new = requested minus installed]
  D --> E{Any new direct packages?}
  E -- No --> F[Record already-present result; own nothing]
  E -- Yes --> G[Polkit authorizes APT update/install]
  G -- Cancel/fail --> H[Record truthful result; own nothing not observed installed]
  G -- Approved --> I[Snapshot installed packages after APT]
  I --> J[Owned = new packages found installed afterward]
  J --> K[Atomically save ownership + activity]
  K --> L[On removal, verify unique owned names are members of the current validated profile]
  L --> M{Ownership valid?}
  M -- No --> N[Fail closed; require manual state repair]
  M -- Yes --> O[Intersect with currently installed packages]
  O --> P[Polkit authorizes apt-get remove; no purge/autoremove]
  P --> Q[Reconcile ledger and release mutation lock]
  F --> R[Release mutation lock]
  H --> R
```
