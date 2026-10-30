import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight,
  Blocks, Check, CheckCircle2, ChevronDown, CircleHelp, FolderOpen,
  Gem, Github, History, Home, Laptop, LoaderCircle,
  Moon, Package, Plus, RefreshCw, Search, Settings2, ShieldCheck, Smartphone,
  Sun, Trash2, X, type LucideIcon,
} from "lucide-react";
import {
  addExtension, confirmReconciliation, dismissReconciliation, getAppState, installProfile,
  isDesktopRuntime, onProgress, openConfigFolder, prepareReconciliation, removeExtension,
  uninstallProfile,
} from "./api";
import type { AppState, OperationRecord, OperationResult, Profile, ProfileLoadDiagnostic, ProgressEvent, ReconciliationPreview } from "./types";
import UpdatesPage from "./UpdatesPage";
import { useAppUpdates } from "./useAppUpdates";

type Page = "Overview" | "Profiles" | "Activity" | "Extensions" | "Updates" | "Settings";
type DialogMode = "details" | "install" | "remove";

const demoProfiles: Profile[] = [
  { id: "python", title: "Python", category: "Language", summary: "A clear starting point for Python projects, virtual environments, and command-line tools.", accent: "#8c7cf5", extension: false, packages: [
    { name: "python3", reason: "The Python interpreter included in Ubuntu's supported archive.", installed: false }, { name: "python3-venv", reason: "Creates isolated environments for each project.", installed: false }, { name: "python3-pip", reason: "Installs Python packages inside a virtual environment.", installed: false }, { name: "pipx", reason: "Installs standalone Python command-line applications separately.", installed: false }, { name: "build-essential", reason: "Compiler tools needed by packages with native extensions.", installed: false }, { name: "git", reason: "Tracks changes and works with hosted repositories.", installed: false },
  ] },
  { id: "web", title: "Web development", category: "Frontend", summary: "Node.js®, npm, Git, and curl for building and testing modern web applications.", accent: "#31a8b7", extension: false, packages: [
    { name: "nodejs", reason: "Runs JavaScript tools and server-side applications.", installed: false }, { name: "npm", reason: "Installs and manages JavaScript project dependencies.", installed: false }, { name: "git", reason: "Tracks changes and works with hosted repositories.", installed: false }, { name: "curl", reason: "A command-line tool for transferring data and testing endpoints.", installed: false },
  ] },
  { id: "cpp", title: "C / C++", category: "Systems", summary: "Compilers, a debugger, and modern build tools for native Linux development.", accent: "#4389f4", extension: false, packages: [
    { name: "build-essential", reason: "Provides the GNU compiler toolchain and make.", installed: false }, { name: "clang", reason: "An alternative C/C++ compiler and development toolchain.", installed: false }, { name: "cmake", reason: "Generates portable native build systems.", installed: false }, { name: "gdb", reason: "Debugs native programs interactively.", installed: false }, { name: "ninja-build", reason: "A fast build system used by many CMake projects.", installed: false }, { name: "lldb", reason: "The LLVM debugger for inspecting native programs.", installed: false },
  ] },
  { id: "java", title: "Java", category: "Language", summary: "A distro-supported JDK and Maven; use a repository's Gradle Wrapper for its supported version.", accent: "#f08a58", extension: false, packages: [
    { name: "default-jdk", reason: "The Java Development Kit selected by the Ubuntu release.", installed: false }, { name: "maven", reason: "Builds Java projects and manages dependencies.", installed: false }, { name: "git", reason: "Tracks changes and works with hosted repositories.", installed: false },
  ] },
  { id: "rust", title: "Rust", category: "Language", summary: "The distro-packaged Rust compiler, Cargo, rustfmt, Clippy, and Git; configure a language server separately.", accent: "#d17a50", extension: false, packages: [
    { name: "rustc", reason: "Compiles Rust source code.", installed: false }, { name: "cargo", reason: "Builds Rust projects and manages crates.", installed: false }, { name: "rustfmt", reason: "Formats Rust source consistently.", installed: false }, { name: "rust-clippy", reason: "Finds common mistakes and suggests idiomatic Rust.", installed: false }, { name: "git", reason: "Tracks changes and works with hosted repositories.", installed: false },
  ] },
  { id: "android", title: "Android", category: "Mobile", summary: "Java, ADB, Fastboot, and archive tools, with the vendor SDK setup kept explicit.", accent: "#62a876", extension: false, packages: [
    { name: "default-jdk", reason: "Provides a Java toolchain for Android development.", installed: false }, { name: "adb", reason: "Communicates with Android devices and emulators.", installed: false }, { name: "fastboot", reason: "Supports device bootloader operations when needed.", installed: false }, { name: "unzip", reason: "Extracts SDK and development archives.", installed: false }, { name: "git", reason: "Tracks changes and works with hosted repositories.", installed: false },
  ] },
];

const nav: { label: Page; icon: LucideIcon }[] = [
  { label: "Overview", icon: Home }, { label: "Profiles", icon: Blocks }, { label: "Activity", icon: Activity }, { label: "Extensions", icon: Gem }, { label: "Updates", icon: RefreshCw }, { label: "Settings", icon: Settings2 },
];
const profileIconAssets: Record<string, string> = {
  python: "/assets/language-icons/python.svg",
  web: "/assets/language-icons/nodejs.svg",
  cpp: "/assets/language-icons/cpp.svg",
  java: "/assets/language-icons/java-monogram.svg",
  android: "/assets/language-icons/android.svg",
};
function ProfileArtwork({ profileId }: { profileId: string }) {
  if (profileId === "rust") return <>
    <img className="profile-art rust-logo-light" src="/assets/language-icons/rust-black.svg" alt="" aria-hidden="true" />
    <img className="profile-art rust-logo-dark" src="/assets/language-icons/rust-white.png" alt="" aria-hidden="true" />
  </>;
  const source = profileIconAssets[profileId];
  return source
    ? <img className="profile-art" src={source} alt="" aria-hidden="true" />
    : <Package size={21} strokeWidth={1.8} aria-hidden="true" />;
}
function ProfileMark({ profileId }: { profileId: string }) {
  return <><ProfileArtwork profileId={profileId} />{profileId === "python" && <sup className="logo-trademark" aria-hidden="true">™</sup>}</>;
}
function ProfileName({ profile }: { profile: Profile }) {
  return profile.id === "python" ? <>Python<sup className="trademark-symbol">®</sup></> : profile.title;
}
const extensionExample = JSON.stringify({ schema_version: 1, id: "example-docs", title: "Documentation tools", description: "A small local profile for authoring docs.", category: "Writing", packages: [{ name: "pandoc", reason: "Converts Markdown and document formats." }, { name: "git", reason: "Tracks changes to documentation." }] }, null, 2);

const previewState: AppState = {
  system: { distro: "Browser preview", version: "Desktop runtime not connected", architecture: "—", supported: false, apt_available: false, polkit_available: false, native: false },
  profiles: demoProfiles, tracked_profiles: {}, history: [], pending_reconciliation: null, config_directory: "Available in the installed desktop app", extension_diagnostics: [],
};

function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [state, setState] = useState<AppState>(previewState);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("zorin-devstart-theme") === "light" ? "light" : "dark");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("details");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [toast, setToast] = useState("");
  const [manifest, setManifest] = useState(extensionExample);
  const [actionError, setActionError] = useState("");
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const [reconciliationCheckedAt, setReconciliationCheckedAt] = useState<string | null>(null);
  const [reconciliationPreview, setReconciliationPreview] = useState<ReconciliationPreview | null>(null);
  const [reconciliationAcknowledged, setReconciliationAcknowledged] = useState(false);
  const updates = useAppUpdates(setToast);
  const searchRef = useRef<HTMLInputElement>(null);
  const workingRef = useRef(working);

  const desktopRuntime = isDesktopRuntime();
  const native = desktopRuntime && !backendUnavailable && state.system.native;
  const canManage = native && state.system.supported && state.system.apt_available && state.system.polkit_available;
  const profiles = state.profiles.length ? state.profiles : demoProfiles;
  const filteredProfiles = useMemo(() => profiles.filter((p) => `${p.title} ${p.category} ${p.summary} ${p.packages.map((x) => x.name).join(" ")}`.toLowerCase().includes(query.toLowerCase())), [profiles, query]);

  async function refresh() {
    if (!desktopRuntime) { setLoading(false); return; }
    try { setState(await getAppState()); setBackendUnavailable(false); }
    catch (err) { setBackendUnavailable(true); setToast(`Could not read desktop status: ${String(err)}`); }
    finally { setLoading(false); }
  }

  async function recheckReconciliation() {
    if (!desktopRuntime) {
      setToast("Manual reconciliation requires the installed desktop app.");
      return;
    }
    setReconciliationBusy(true);
    try {
      const next = await getAppState();
      setState(next);
      setBackendUnavailable(false);
      setReconciliationCheckedAt(new Date().toISOString());
      const preview = await prepareReconciliation();
      if (!preview) {
        setToast("Device re-check complete. No pending reconciliation notice remains.");
      } else {
        if (!preview.ready) {
          setToast(`Device re-check complete: ${preview.message}`);
        } else {
          setReconciliationPreview(preview);
          setReconciliationAcknowledged(false);
          setToast("Device re-check complete. Review the verified package list before confirming ownership.");
        }
      }
    } catch (err) {
      setBackendUnavailable(true);
      setToast(`Could not re-check the device: ${String(err)}`);
    } finally {
      setReconciliationBusy(false);
    }
  }

  async function confirmPendingReconciliation() {
    if (!reconciliationPreview || !reconciliationAcknowledged) return;
    setReconciliationBusy(true);
    try {
      const result = await confirmReconciliation(reconciliationPreview.plan_id, reconciliationPreview.packages);
      setReconciliationPreview(null);
      setReconciliationAcknowledged(false);
      await refresh();
      setToast(result.message);
    } catch (err) {
      setToast(`Could not confirm reconciliation: ${String(err)}`);
    } finally {
      setReconciliationBusy(false);
    }
  }

  async function dismissPendingReconciliation() {
    const pending = state.pending_reconciliation;
    if (!pending || !window.confirm("Dismiss this recovery plan? No packages will be installed or removed. Any installed packages will remain on your system and will not be tracked by DevStart.")) return;
    setReconciliationBusy(true);
    try {
      const result = await dismissReconciliation(pending.id);
      setReconciliationPreview(null);
      setReconciliationAcknowledged(false);
      await refresh();
      setToast(result.message);
    } catch (err) {
      setToast(`Could not dismiss reconciliation: ${String(err)}`);
    } finally {
      setReconciliationBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    void onProgress(setProgress).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => { localStorage.setItem("zorin-devstart-theme", theme); }, [theme]);
  useEffect(() => { workingRef.current = working; }, [working]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !document.querySelector("[role='dialog']")) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>(".profile-dialog");
    const first = dialog?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]");
    first?.focus();
    const onDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !workingRef.current) { setSelected(null); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]"));
      if (!focusables.length) return;
      const firstFocusable = focusables[0];
      const lastFocusable = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) { event.preventDefault(); lastFocusable.focus(); }
      else if (!event.shiftKey && document.activeElement === lastFocusable) { event.preventDefault(); firstFocusable.focus(); }
    };
    document.addEventListener("keydown", onDialogKey);
    return () => { document.removeEventListener("keydown", onDialogKey); previous?.focus(); };
  }, [selected]);

  function openProfile(profile: Profile) {
    setSelected(profile);
    setDialogMode("details");
    setActionError("");
  }

  async function runAction(action: "install" | "remove") {
    if (!selected || !canManage) return;
    setWorking(true); setActionError("");
    try {
      const result: OperationResult = action === "install" ? await installProfile(selected.id) : await uninstallProfile(selected.id);
      if (result.success) {
        setToast(result.message);
        setSelected(null);
      } else {
        setActionError(result.message);
      }
      await refresh();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setWorking(false); setProgress(null);
    }
  }

  async function submitExtension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setActionError("");
    if (!native) { setToast(backendUnavailable ? "The desktop backend is unavailable; extension changes are disabled." : "Saving extensions needs the installed desktop app."); return; }
    setWorking(true);
    try {
      const message = await addExtension(manifest);
      await refresh(); setToast(message); setPage("Profiles");
    } catch (err) { setActionError(String(err)); }
    finally { setWorking(false); }
  }

  async function deleteExtension(id: string) {
    if (!native) { setToast(backendUnavailable ? "The desktop backend is unavailable; no extension was removed." : "Extension management requires the installed desktop app."); return; }
    if (!window.confirm(`Remove the “${id}” extension definition? This does not uninstall packages.`)) return;
    try { setToast(await removeExtension(id)); await refresh(); }
    catch (err) { setToast(String(err)); }
  }

  function showPage(next: Page) { setPage(next); setQuery(""); }

  return (
    <div className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <div><strong>devstart</strong><small>for Zorin OS</small></div>
          <span className="brand-version">0.1</span>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="main-nav">
          {nav.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${page === label ? "active" : ""}`} onClick={() => showPage(label)} aria-current={page === label ? "page" : undefined}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === "Activity" && state.history.length > 0 && <span className="nav-count">{state.history.length}</span>}{label === "Updates" && updates.update.status === "available" && <span className="nav-count">1</span>}
          </button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-safety glass-inset">
          <div className="safety-icon"><ShieldCheck size={17} /></div>
          <div><strong>Clear by design</strong><p>Review every package before it changes your system.</p></div>
        </div>
        <button className="account-row" onClick={() => showPage("Settings")}>
          <div className="avatar">U</div><div className="account-copy"><strong>Local workspace</strong><span>No account required</span></div><ChevronDown size={15} />
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="crumb"><span>DevStart</span><span className="crumb-slash">/</span><strong>{page}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={16} /><input ref={searchRef} aria-label="Search setup profiles" placeholder="Search profiles" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setPage("Profiles"); }} /><kbd>⌘ K</kbd></label>
            <div className={`target-chip ${native && state.system.supported ? "target-ok" : "target-preview"}`}><span className="status-dot" />{backendUnavailable ? "Backend unavailable" : native ? `${state.system.distro} ${state.system.version}` : desktopRuntime ? "System status unavailable" : "Zorin OS 18 target"}</div>
            <button className="icon-button theme-toggle" aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {(!native || backendUnavailable) && <div className={`preview-banner ${backendUnavailable ? "preview-banner-error" : ""}`} role={backendUnavailable ? "status" : undefined}><span className="preview-badge"><Laptop size={14} />{backendUnavailable ? "Unavailable" : desktopRuntime ? "Status" : "Preview"}</span><span>{backendUnavailable ? "The desktop backend did not respond. Package and extension changes are disabled." : desktopRuntime ? "System status is unavailable; system changes remain disabled until Settings can refresh it." : "This is a browser preview. Package installs and extension writes are available only in the desktop app."}</span><button onClick={() => showPage("Settings")}>{backendUnavailable ? "Open settings" : "What this means"} <ArrowRight size={14} /></button></div>}
          {native && state.extension_diagnostics.length > 0 && <div className="extension-diagnostics-banner" role="alert"><AlertCircle size={17} /><span>{state.extension_diagnostics.length} extension file{state.extension_diagnostics.length === 1 ? " was" : "s were"} skipped and cannot be installed.</span><button onClick={() => showPage("Extensions")}>Review extension files <ArrowRight size={14} /></button></div>}
          {state.pending_reconciliation && desktopRuntime && <section className="reconciliation-banner" role="alert" aria-live="polite" aria-labelledby="reconciliation-title">
            <div className="reconciliation-icon" aria-hidden="true"><AlertCircle size={18} /></div>
            <div className="reconciliation-copy">
              <strong id="reconciliation-title">Confirm package ownership for {state.pending_reconciliation.profile_title}</strong>
              <p>{state.pending_reconciliation.reason}</p>
              <span>{reconciliationCheckedAt ? `Last checked ${formatTime(reconciliationCheckedAt)}. ` : ""}Re-checking reads current package state only. It does not install, remove, or change ownership records.</span>
            </div>
            <div className="reconciliation-actions">
              <button className="secondary-button" onClick={() => showPage("Activity")}>Review activity</button>
              <button className="secondary-button" onClick={() => void dismissPendingReconciliation()} disabled={reconciliationBusy || backendUnavailable}>Keep untracked</button>
              <button className="primary-button" onClick={() => void recheckReconciliation()} disabled={reconciliationBusy || backendUnavailable}>
                <RefreshCw size={14} className={reconciliationBusy ? "spin" : undefined} />{reconciliationBusy ? "Checking…" : "Review & confirm"}
              </button>
            </div>
          </section>}
          {page === "Overview" && <OverviewPage profiles={profiles} state={state} loading={loading} native={native} desktopRuntime={desktopRuntime} backendUnavailable={backendUnavailable} canManage={canManage} onOpenProfile={openProfile} onNavigate={showPage} />}
          {page === "Profiles" && <ProfilesPage profiles={filteredProfiles} query={query} onQuery={setQuery} tracked={state.tracked_profiles} onOpen={openProfile} />}
          {page === "Activity" && <ActivityPage history={state.history} native={native} desktopRuntime={desktopRuntime} backendUnavailable={backendUnavailable} />}
          {page === "Extensions" && <ExtensionsPage native={native} backendUnavailable={backendUnavailable} manifest={manifest} onManifest={setManifest} onSubmit={submitExtension} working={working} error={actionError} extensions={profiles.filter((p) => p.extension)} diagnostics={state.extension_diagnostics} onDelete={deleteExtension} onOpenFolder={() => void openConfigFolder().catch((err) => setToast(String(err)))} />}
          {page === "Updates" && <UpdatesPage update={updates.update} currentVersion={updates.currentVersion} onCheck={() => void updates.checkUpdates(true)} onOpen={(url) => void updates.openReleaseUrl(url).catch((err) => setToast(String(err)))} />}
          {page === "Settings" && <SettingsPage state={state} native={native} desktopRuntime={desktopRuntime} backendUnavailable={backendUnavailable} theme={theme} onTheme={setTheme} onRefresh={() => void refresh()} onOpenFolder={() => void openConfigFolder().catch((err) => setToast(String(err)))} />}
        </main>
        <footer className="app-footer"><span><span className="footer-dot" /> Local-first · No telemetry</span><span>Made for focused beginnings</span></footer>
      </div>

      {selected && <ProfileDialog profile={selected} mode={dialogMode} native={native} desktopRuntime={desktopRuntime} backendUnavailable={backendUnavailable} canManage={canManage} owned={state.tracked_profiles[selected.id]?.owned_packages ?? []} working={working} progress={progress} error={actionError} onMode={setDialogMode} onClose={() => { if (!working) setSelected(null); }} onRun={runAction} />}
      {reconciliationPreview && <ReconciliationDialog preview={reconciliationPreview} acknowledged={reconciliationAcknowledged} busy={reconciliationBusy} onAcknowledge={setReconciliationAcknowledged} onClose={() => { if (!reconciliationBusy) { setReconciliationPreview(null); setReconciliationAcknowledged(false); } }} onConfirm={() => void confirmPendingReconciliation()} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}

function OverviewPage({ profiles, state, loading, native, desktopRuntime, backendUnavailable, canManage, onOpenProfile, onNavigate }: { profiles: Profile[]; state: AppState; loading: boolean; native: boolean; desktopRuntime: boolean; backendUnavailable: boolean; canManage: boolean; onOpenProfile: (p: Profile) => void; onNavigate: (p: Page) => void }) {
  const featured = profiles.filter((p) => !p.extension).slice(0, 6);
  const statusLabel = backendUnavailable ? "Backend unavailable" : !desktopRuntime ? "Browser preview" : !native ? "System status unavailable" : canManage ? "System ready" : "System check required";
  const statusDetail = backendUnavailable ? "System status could not be read" : native ? `${state.system.distro} ${state.system.version}` : !desktopRuntime ? "Package changes are disabled here" : "System changes remain disabled";
  const quickActions: { title: string; detail: string; page: Page; icon: LucideIcon }[] = [
    { title: "Browse profiles", detail: "Review available toolchains", page: "Profiles", icon: Blocks },
    { title: "Activity log", detail: state.history.length ? `${state.history.length} local records` : "See changes made on this device", page: "Activity", icon: History },
    { title: "Extensions", detail: "Manage local profile manifests", page: "Extensions", icon: Gem },
    { title: "Settings", detail: "Appearance and system status", page: "Settings", icon: Settings2 },
  ];
  return <div className="page-wrap overview-page">
    <section className="overview-welcome">
      <div><div className="eyebrow">YOUR LOCAL DEVELOPMENT WORKSPACE</div><h1>Welcome to <span>DevStart</span></h1><p>Choose a practical toolchain, review every package, and keep changes in your hands.</p></div>
      <div className={`workspace-status ${canManage ? "ready" : backendUnavailable ? "unavailable" : "preview"}`}><span className="status-dot" /><div><strong>{statusLabel}</strong><small>{statusDetail}</small></div></div>
    </section>
    <section className="stats-row" aria-label="Workspace summary">
      <StatCard icon={Blocks} value={loading ? "—" : String(profiles.length)} label="starter profiles" detail="Built around real workflows" tone="blue" />
      <StatCard icon={Package} value={String(Object.keys(state.tracked_profiles).length)} label="tracked setups" detail={`${Object.values(state.tracked_profiles).reduce((n, p) => n + p.owned_packages.length, 0)} packages recorded`} tone="violet" />
      <StatCard icon={ShieldCheck} value="You" label="in control" detail={state.system.native ? "Polkit authorization" : "Desktop approval required"} tone="green" />
    </section>
    <div className="overview-layout">
      <section className="overview-profiles">
        <div className="section-heading"><div><div className="eyebrow">PICK YOUR TOOLCHAIN</div><h2>Made for how you build</h2><p>Six practical starting points. Every tool has a reason.</p></div><button className="text-button" onClick={() => onNavigate("Profiles")}>View all <ArrowRight size={15} /></button></div>
        <div className="profile-grid">{featured.map((profile, i) => <ProfileCard key={profile.id} profile={profile} index={i} onClick={() => onOpenProfile(profile)} tracked={Boolean(state.tracked_profiles[profile.id])} />)}</div>
      </section>
      <aside className="overview-rail" aria-label="Workspace shortcuts and recent activity">
        <section className="quick-actions-card glass-card"><div className="card-heading"><div><span className="eyebrow">QUICK ACTIONS</span><h3>Workspace</h3></div></div>
          {quickActions.map(({ title, detail, page: destination, icon: Icon }) => <button className="quick-action" key={destination} onClick={() => onNavigate(destination)}><span className="quick-action-icon"><Icon size={16} /></span><span className="quick-action-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowRight className="quick-action-arrow" size={15} /></button>)}
        </section>
        <section className="activity-card glass-card overview-activity"><div className="card-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h3>Latest changes</h3></div><button className="icon-button" aria-label="View all activity" onClick={() => onNavigate("Activity")}><ArrowUpRight size={17} /></button></div>
          {state.history.length ? state.history.slice(0, 3).map((item) => <ActivityRow key={item.id} item={item} />) : <div className="empty-activity"><div className="empty-icon"><History size={18} /></div><div><strong>No changes yet</strong><p>Setup and removal records will appear here.</p></div></div>}
        </section>
        <div className="overview-safety glass-card"><span className="safety-icon"><ShieldCheck size={17} /></span><div><strong>Review before anything changes</strong><p>The app shows a package plan first; your operating system handles authorization.</p></div></div>
      </aside>
    </div>
  </div>;
}

function StatCard({ icon: Icon, value, label, detail, tone }: { icon: LucideIcon; value: string; label: string; detail: string; tone: string }) {
  return <div className="stat-card glass-card"><div className={`stat-icon ${tone}`}><Icon size={17} /></div><div className="stat-main"><strong>{value}</strong><span>{label}</span><small>{detail}</small></div><div className="stat-sheen" /></div>;
}

function ProfileCard({ profile, index, onClick, tracked }: { profile: Profile; index: number; onClick: () => void; tracked: boolean }) {
  const tools = profile.packages.slice(0, 3).map((x) => x.name).join(" · ");
  return <button className={`profile-card glass-card profile-${profile.id}`} onClick={onClick} style={{ "--profile-accent": profile.accent, "--card-delay": `${index * 45}ms` } as CSSProperties}>
    <div className="profile-card-top"><span className="profile-icon" aria-hidden="true"><ProfileMark profileId={profile.id} /></span><span className="profile-tag">{tracked ? "TRACKED" : profile.category.toUpperCase()}</span></div>
    <h3><ProfileName profile={profile} /></h3><p>{profile.summary}</p>
    <div className="profile-tools"><span>{tools}</span><span className="tool-count">+{Math.max(0, profile.packages.length - 3)}</span></div>
    <div className="profile-card-bottom"><span>{tracked ? <><CheckCircle2 size={14} /> Setup recorded</> : <><ArrowDownToLine size={14} /> View setup plan</>}</span><span className="card-arrow"><ArrowUpRight size={15} /></span></div>
  </button>;
}

function ProfilesPage({ profiles, query, onQuery, tracked, onOpen }: { profiles: Profile[]; query: string; onQuery: (value: string) => void; tracked: AppState["tracked_profiles"]; onOpen: (profile: Profile) => void }) {
  const [filter, setFilter] = useState("All profiles");
  const categories = ["All profiles", "Language", "Frontend", "Systems", "Mobile", "Writing"];
  const visible = profiles.filter((p) => filter === "All profiles" || p.category === filter);
  return <div className="page-wrap subpage">
    <div className="page-title-row"><div><div className="eyebrow">YOUR TOOLBOX, WITHOUT THE GUESSWORK</div><h1>Setup profiles</h1><p>Understand what each tool does before it reaches your system.</p></div><div className="profile-total"><span>{profiles.length.toString().padStart(2, "0")}</span><small>PROFILES</small></div></div>
    <div className="filters-row"><div className="filter-pills" role="group" aria-label="Filter profiles by category">{categories.map((c) => <button key={c} className={filter === c ? "filter-pill selected" : "filter-pill"} onClick={() => setFilter(c)}>{c}</button>)}</div><label className="search-box inner-search"><Search size={15} /><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Find a tool or language" aria-label="Find a tool or language" /></label></div>
    {visible.length ? <div className="profile-grid profiles-list">{visible.map((profile, i) => <ProfileCard key={profile.id} profile={profile} index={i} onClick={() => onOpen(profile)} tracked={Boolean(tracked[profile.id])} />)}</div> : <div className="empty-state"><Search size={22} /><strong>No matching setup</strong><p>Try a different name or remove a filter.</p><button className="text-button" onClick={() => { onQuery(""); setFilter("All profiles"); }}>Clear search <X size={14} /></button></div>}
    <div className="info-strip"><ShieldCheck size={17} /><p><strong>Nothing installs from a card click.</strong> Open a profile to review its exact package plan first.</p></div>
  </div>;
}

function ReconciliationDialog({ preview, acknowledged, busy, onAcknowledge, onClose, onConfirm }: { preview: ReconciliationPreview; acknowledged: boolean; busy: boolean; onAcknowledge: (value: boolean) => void; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="glass-dialog profile-dialog reconciliation-dialog" role="dialog" aria-modal="true" aria-labelledby="reconciliation-dialog-title">
      <div className="dialog-header"><div className="dialog-icon"><ShieldCheck size={20} /></div><div><span className="eyebrow">DURABLE CONFIRMATION</span><h2 id="reconciliation-dialog-title">Assign verified ownership?</h2></div><button className="icon-button" aria-label="Close reconciliation confirmation" onClick={onClose} disabled={busy}><X size={16} /></button></div>
      <p className="dialog-lead">DevStart found the packages from the interrupted <strong>{preview.profile_title}</strong> setup and did not detect any other package changes.</p>
      <div className="reconciliation-review"><div className="reconciliation-review-heading"><strong>{preview.packages.length} package(s) will be assigned</strong><span>Read-only ownership update</span></div><div className="package-list reconciliation-package-list">{preview.packages.map((packageName) => <div className="package-row" key={packageName}><span className="package-check"><Check size={13} /></span><code>{packageName}</code><span className="package-reason">already present</span></div>)}</div></div>
      <label className="reconciliation-confirm-check"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} disabled={busy} /><span>I confirm that I reviewed this package list and want DevStart to assign ownership. No packages will be installed or removed.</span></label>
      <div className="dialog-actions"><button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" onClick={onConfirm} disabled={!acknowledged || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{busy ? "Saving…" : "Confirm ownership"}</button></div>
    </section>
  </div>;
}

function ProfileDialog({ profile, mode, native, desktopRuntime, backendUnavailable, canManage, owned, working, progress, error, onMode, onClose, onRun }: { profile: Profile; mode: DialogMode; native: boolean; desktopRuntime: boolean; backendUnavailable: boolean; canManage: boolean; owned: string[]; working: boolean; progress: ProgressEvent | null; error: string; onMode: (m: DialogMode) => void; onClose: () => void; onRun: (a: "install" | "remove") => void }) {
  const tracked = owned.length > 0;
  const isRemove = mode === "remove";
  const packages = isRemove ? owned.map((name) => ({ name, reason: "Recorded by DevStart as newly installed for this profile.", installed: false })) : profile.packages.filter((pkg) => !pkg.installed);
  const newPackages = profile.packages.filter((p) => !p.installed);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !working) onClose(); }}>
    <section className="profile-dialog glass-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description">
      <div className="dialog-top"><div className="dialog-icon" style={{ "--profile-accent": profile.accent } as CSSProperties} aria-hidden="true"><ProfileMark profileId={profile.id} /></div><button className="icon-button" aria-label="Close profile details" onClick={onClose} disabled={working}><X size={18} /></button></div>
      {mode === "details" ? <>
        <div className="eyebrow">{profile.extension ? "LOCAL EXTENSION" : `${profile.category.toUpperCase()} PROFILE`}</div>
        <h2 id="dialog-title"><ProfileName profile={profile} /> developer setup</h2><p className="dialog-lead" id="dialog-description">{profile.summary}</p>
        {profile.id === "android" && <div className="callout android-callout"><Smartphone size={17} /><p><strong>Android Studio is a separate guided step.</strong> This profile prepares Java, ADB, and Fastboot. The Google SDK components and licences are managed through Android Studio's SDK Manager.</p></div>}
        {profile.id === "web" && <div className="callout android-callout"><CircleHelp size={16} /><p><strong>Check your project's Node.js® requirement.</strong> The Ubuntu 24.04 archive provides Node.js 18 in the verified environment, and upstream Node 18 is end-of-life. Some current frameworks require a newer runtime. DevStart does not add an external repository or run a remote installer.</p></div>}
        {profile.id === "java" && <div className="callout android-callout"><CircleHelp size={16} /><p><strong>Gradle is intentionally not installed from APT.</strong> Ubuntu 24.04 provides an old Gradle package candidate; use the project's checked-in Gradle Wrapper to select its compatible version.</p></div>}
        {profile.id === "rust" && <div className="callout android-callout"><CircleHelp size={16} /><p><strong>Rust Analyzer is a separate editor setup.</strong> Ubuntu 24.04's archive has no rust-analyzer package; Clippy is available as <code>rust-clippy</code>.</p></div>}
        <div className="package-heading"><span>TOOLS IN THIS PROFILE</span><span>{profile.packages.length} PACKAGES</span></div>
        <div className="package-list">{profile.packages.map((pkg) => <div className="package-row" key={pkg.name}><div className="package-check">{pkg.installed ? <Check size={13} /> : <span />}</div><div className="package-copy"><strong>{pkg.name}</strong><p>{pkg.reason}</p></div><span className={`installed-label ${pkg.installed ? "is-installed" : ""}`}>{pkg.installed ? "Installed" : "New"}</span></div>)}</div>
        <div className="dialog-summary"><div><span className="summary-dot green" />{profile.packages.filter((p) => p.installed).length} already present</div><div><span className="summary-dot blue" />{newPackages.length} requested packages</div></div>
        <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Done</button>{tracked ? <button className="danger-outline" onClick={() => onMode("remove")}><Trash2 size={15} /> Review removal</button> : <button className="primary-button" onClick={() => onMode("install")}><ShieldCheck size={16} /> Review install plan</button>}</div>
        {!canManage && <div className="dialog-note"><Laptop size={14} />{backendUnavailable ? "The desktop backend did not respond. No system action is available." : native ? "System changes are disabled because this OS is outside the supported target." : desktopRuntime ? "Device status is unavailable; system actions are disabled until refresh." : "Browser preview — system actions require the native desktop app."}</div>}
      </> : <>
        <button className="back-link" onClick={() => onMode("details")} disabled={working}><ArrowLeft size={14} /> Back to profile</button>
        <div className="eyebrow">{isRemove ? "SAFE REMOVAL REVIEW" : "SYSTEM CHANGE REVIEW"}</div>
        <h2 id="dialog-title">{isRemove ? "Remove tracked tools?" : <>Set up <ProfileName profile={profile} /></>}</h2>
        <p className="dialog-lead" id="dialog-description">{isRemove ? "Only packages DevStart recorded as newly installed for this profile are eligible. Existing tools and your files stay untouched." : "Review the exact APT action. DevStart will update package indexes, then request installation of the packages listed below."}</p>
        <div className="change-summary"><div className="change-icon"><ShieldCheck size={17} /></div><div><strong>{isRemove ? "APT remove · no purge" : "APT update + install"}</strong><span>{isRemove ? "No autoremove. No project or SDK files deleted." : "System authorization is handled by polkit."}</span></div></div>
        {!isRemove && <div className="callout package-trust-callout"><ShieldCheck size={16} /><p><strong>Review package sources.</strong> APT packages may run maintainer scripts with system privileges. DevStart validates package names, not package contents; install only from repositories you trust.</p></div>}
        <div className="package-heading"><span>{isRemove ? "RECORDED PACKAGES" : "NEW PACKAGES REQUESTED"}</span><span>{packages.length} ITEMS</span></div>
        <div className="review-package-list">{packages.map((pkg) => <div className="review-package" key={pkg.name}><code>{pkg.name}</code><span>{pkg.reason}</span></div>)}</div>
        {!isRemove && profile.id === "android" && <div className="callout android-callout"><CircleHelp size={16} /><p>Google Android SDK packages and licence acceptance are not part of this APT transaction. See the official Android Studio setup guide after this starter step.</p></div>}
        {error && <div className="error-callout" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
        {working && <div className="progress-callout" role="status"><LoaderCircle className="spin" size={17} /><div><strong>{progress?.message ?? (isRemove ? "Removing tracked packages…" : "Preparing package setup…")}</strong><span>{progress?.stage ?? "Waiting for the system package manager"}</span></div></div>}
        <div className="dialog-actions"><button className="secondary-button" onClick={() => onMode("details")} disabled={working}>Cancel</button><button className={isRemove ? "danger-button" : "primary-button"} onClick={() => onRun(isRemove ? "remove" : "install")} disabled={!canManage || working || packages.length === 0}>{working ? <LoaderCircle className="spin" size={16} /> : isRemove ? <Trash2 size={15} /> : <ShieldCheck size={16} />}{working ? "Working…" : isRemove ? "Confirm removal" : "Authorize install"}</button></div>
        {!canManage && <div className="dialog-note"><Laptop size={14} />{backendUnavailable ? "The desktop backend did not respond. No system action is available." : native ? "System changes are disabled for this operating system." : desktopRuntime ? "Device status is unavailable; system actions are disabled until refresh." : "Browser preview — no system changes can be made here."}</div>}
      </>}
    </section>
  </div>;
}

function ActivityPage({ history, native, desktopRuntime, backendUnavailable }: { history: OperationRecord[]; native: boolean; desktopRuntime: boolean; backendUnavailable: boolean }) {
  return <div className="page-wrap subpage">
    <div className="page-title-row"><div><div className="eyebrow">LOCAL CHANGE JOURNAL</div><h1>Activity</h1><p>A quiet record of profile setup and removal on this device.</p></div><div className="history-icon"><History size={22} /></div></div>
    {!native && <div className="preview-callout"><Laptop size={17} /><p>{backendUnavailable ? "The desktop backend did not respond; device activity cannot be loaded." : desktopRuntime ? "Device activity is unavailable until system status can be refreshed." : "Activity is stored locally by the installed desktop app. This browser preview doesn't connect to device history."}</p></div>}
    {!backendUnavailable && history.length ? <div className="timeline">{history.map((item, index) => <div className="timeline-item" key={item.id}><div className="timeline-rail"><span className={`timeline-dot ${item.status}`}><StatusIcon status={item.status} /></span>{index < history.length - 1 && <span className="timeline-line" />}</div><div className="timeline-card glass-card"><div className="timeline-top"><div><span className={`status-pill ${item.status}`}>{item.status}</span><time>{formatTime(item.timestamp)}</time></div><span className="activity-action">{item.action === "install" ? "Setup installed" : item.action === "remove" ? "Tools removed" : "Ownership reconciled"}</span></div><h3>{item.profile_title}</h3><p>{item.message}</p><div className="timeline-packages">{item.packages.map((pkg) => <code key={pkg}>{pkg}</code>)}</div></div></div>)}</div> : <div className="empty-state activity-empty"><div className="empty-icon"><History size={22} /></div><strong>{backendUnavailable ? "Activity unavailable" : "No activity yet"}</strong><p>{backendUnavailable ? "Reconnect to the desktop backend to read this device’s history." : "When you set up or remove a profile, the change will appear here."}</p></div>}
  </div>;
}
function StatusIcon({ status }: { status: OperationRecord["status"] }) { return status === "success" || status === "already-installed" ? <Check size={12} /> : status === "failed" || status === "partial" || status === "reconciliation-required" ? <AlertCircle size={12} /> : <X size={12} />; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function ActivityRow({ item }: { item: OperationRecord }) { return <div className="activity-row"><span className={`activity-mini-dot ${item.status}`}><StatusIcon status={item.status} /></span><div><strong>{item.profile_title} {item.action === "install" ? "setup" : item.action === "remove" ? "removal" : "ownership reconciliation"}</strong><span>{item.message}</span></div><time>{formatTime(item.timestamp)}</time></div>; }

function ExtensionsPage({ native, backendUnavailable, manifest, onManifest, onSubmit, working, error, extensions, diagnostics, onDelete, onOpenFolder }: { native: boolean; backendUnavailable: boolean; manifest: string; onManifest: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; working: boolean; error: string; extensions: Profile[]; diagnostics: ProfileLoadDiagnostic[]; onDelete: (id: string) => void; onOpenFolder: () => void }) {
  return <div className="page-wrap subpage">
    <div className="page-title-row"><div><div className="eyebrow">SMALL, REVIEWABLE ADD-ONS</div><h1>Extensions</h1><p>Add a local profile using metadata and APT package names—not executable commands.</p></div><div className="extension-badge"><Blocks size={22} /></div></div>
    {!native && <div className="preview-callout"><Laptop size={17} /><p>{backendUnavailable ? "The installed desktop backend is unavailable; extension writes are disabled." : "Extension saving requires the installed desktop app. You can still inspect the example format here."}</p></div>}
    {diagnostics.length > 0 && <section className="extension-diagnostics-panel" role="alert" aria-labelledby="extension-diagnostics-title"><div className="diagnostics-heading"><span className="diagnostics-icon"><AlertCircle size={18} /></span><div><h2 id="extension-diagnostics-title">Some extension files were skipped</h2><p>Invalid files are not available as setup profiles. Open the folder to inspect, repair, or remove them.</p></div><button className="secondary-button" onClick={onOpenFolder}><FolderOpen size={14} />Open config folder</button></div><div className="diagnostics-list">{diagnostics.map((item) => <article className="diagnostic-item" key={`${item.path}:${item.kind}`}><div><strong>{item.file_name ?? "Extension directory"}</strong><span>{item.kind.replaceAll("-", " ")}</span></div><p>{item.message}</p><code title={item.path}>{item.path}</code></article>)}</div></section>}
    <div className="extension-layout"><form className="extension-editor glass-card" onSubmit={onSubmit}><div className="editor-heading"><div><span className="eyebrow">PROFILE MANIFEST</span><h2>Describe a starter</h2></div><span className="json-chip">JSON · schema 1</span></div><label htmlFor="manifest-json">Paste a manifest</label><textarea id="manifest-json" className="manifest-input" spellCheck={false} value={manifest} onChange={(e) => onManifest(e.target.value)} /><div className="editor-footer"><span><ShieldCheck size={14} /> Metadata + APT package IDs only</span><button className="primary-button" type="submit" disabled={!native || working}>{working ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{working ? "Validating…" : "Validate and add"}</button></div>{error && <div className="error-callout" role="alert"><AlertCircle size={15} />{error}</div>}</form>
      <aside className="extension-aside"><div className="extension-rule"><div className="rule-icon safe"><ShieldCheck size={17} /></div><strong>Manifest data only</strong><p>Profiles cannot include scripts, commands, environment changes, or remote hooks. APT packages can still run maintainer scripts with system privileges; use only packages and configured repositories you trust.</p></div><div className="extension-rule"><div className="rule-icon"><Package size={17} /></div><strong>Validated by the app</strong><p>IDs, field lengths, duplicate package names, and package-name characters are checked again before saving.</p></div><div className="extension-rule"><div className="rule-icon"><FolderOpen size={17} /></div><strong>Stored on this device</strong><p>{native ? "Your local profile definitions live in the app's configuration folder." : "Saved manifests live in the user's XDG configuration directory."}</p>{native && <button className="inline-link" onClick={onOpenFolder}>Open config folder <ArrowUpRight size={13} /></button>}</div></aside></div>
    <section className="section-block extension-list-section"><div className="section-heading"><div><div className="eyebrow">YOUR LOCAL PROFILES</div><h2>Added extensions</h2></div><span className="count-badge">{extensions.length}</span></div>{extensions.length ? <div className="extension-list">{extensions.map((p) => <div className="extension-item glass-card" key={p.id}><div className="profile-icon ext-icon"><Blocks size={19} /></div><div className="extension-item-main"><strong>{p.title}</strong><p>{p.summary}</p><span>{p.packages.length} APT packages · {p.id}</span></div><button className="icon-button remove-extension" onClick={() => onDelete(p.id)} aria-label={`Remove ${p.title} extension`}><Trash2 size={16} /></button></div>)}</div> : <div className="extensions-empty"><div className="empty-icon"><Gem size={20} /></div><div><strong>No extensions added</strong><p>The six built-in developer profiles are ready to explore.</p></div></div>}</section>
  </div>;
}

function SettingsPage({ state, native, desktopRuntime, backendUnavailable, theme, onTheme, onRefresh, onOpenFolder }: { state: AppState; native: boolean; desktopRuntime: boolean; backendUnavailable: boolean; theme: "light" | "dark"; onTheme: (theme: "light" | "dark") => void; onRefresh: () => void; onOpenFolder: () => void }) {
  const systemLabel = backendUnavailable ? "Desktop backend unavailable" : native ? `${state.system.distro} ${state.system.version}` : desktopRuntime ? "Desktop status unavailable" : "Browser preview";
  const systemDetail = backendUnavailable ? "System status could not be read; system changes are disabled" : native ? `${state.system.architecture} · ${state.system.supported ? "supported target" : "not yet validated for this OS"}` : desktopRuntime ? "Native system status is unavailable" : "No native operating-system connection";
  const systemReady = native && state.system.supported;
  const systemChip = backendUnavailable ? "Unavailable" : systemReady ? "Ready" : desktopRuntime ? "Check status" : "Preview";
  return <div className="page-wrap subpage settings-page">
    <div className="page-title-row"><div><div className="eyebrow">YOUR WORKSPACE, YOUR WAY</div><h1>Settings</h1><p>Local preferences and information about this DevStart session.</p></div><div className="settings-icon"><Settings2 size={22} /></div></div>
    <section className="settings-panel glass-card"><div className="settings-section-title"><div className="settings-section-icon"><Laptop size={18} /></div><div><h2>System compatibility</h2><p>Targets x86_64 Zorin OS 18.1 Core; the gate accepts Zorin OS 18.x and Ubuntu 24.04 LTS.</p></div></div><div className="settings-row"><div><strong>{systemLabel}</strong><span>{systemDetail}</span></div><span className={`status-chip ${systemReady ? "good" : "muted"}`}><span className="status-dot" />{systemChip}</span></div><div className="settings-row"><div><strong>APT package manager</strong><span>{backendUnavailable ? "Status unavailable" : native ? state.system.apt_available ? "Available" : "Not found" : desktopRuntime ? "Status unavailable" : "Desktop app required"}</span></div><span className="status-chip muted">{native && state.system.apt_available ? "Detected" : "Unavailable"}</span></div><div className="settings-row"><div><strong>System authorization</strong><span>Uses the operating system's polkit agent. DevStart never stores your password.</span></div><span className="status-chip muted">{native && state.system.polkit_available ? "Detected" : "OS-managed"}</span></div><button className="refresh-button" onClick={onRefresh}><RefreshCw size={14} /> Refresh system status</button></section>
    <section className="settings-panel glass-card"><div className="settings-section-title"><div className="settings-section-icon lilac"><Sun size={18} /></div><div><h2>Appearance</h2><p>Choose a high-clarity surface for your workspace.</p></div></div><div className="appearance-options"><button className={`appearance-option ${theme === "light" ? "chosen" : ""}`} onClick={() => onTheme("light")}><span className="appearance-preview light-preview"><span /><span /><span /></span><strong>Light glass</strong><small>Soft, bright workspace</small></button><button className={`appearance-option ${theme === "dark" ? "chosen" : ""}`} onClick={() => onTheme("dark")}><span className="appearance-preview dark-preview"><span /><span /><span /></span><strong>Dark glass</strong><small>Low-light friendly</small></button></div></section>
    <section className="settings-panel glass-card icon-credits-panel"><div className="settings-section-title"><div><h2>Language icon credits</h2><p>Official marks identify the toolchains shown in DevStart.</p></div></div><p className="icon-credit-copy">“The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">Creative Commons 3.0 Attribution License</a>.”</p><p className="icon-credit-copy">Node.js® is a trademark of the OpenJS Foundation. Python® is a registered trademark of the Python Software Foundation; its unaltered logo™ is shown with a separate mark to identify the Python profile under the <a href="https://www.python.org/psf/trademarks/" target="_blank" rel="noreferrer">PSF’s nominative-use guidance</a>. The Rust, Android, and C++ marks remain the property of their respective owners. DevStart is independent and is not endorsed by these organizations. See the <a href="https://github.com/uthumany/zorin-devstart/blob/main/docs/ASSET_ATTRIBUTIONS.md" target="_blank" rel="noreferrer">full icon sources and terms</a>.</p></section>
    <section className="settings-panel glass-card"><div className="settings-section-title"><div className="settings-section-icon green-bg"><FolderOpen size={18} /></div><div><h2>Local data</h2><p>No account, cloud sync, analytics, or telemetry is required.</p></div></div><div className="settings-row"><div><strong>Configuration directory</strong><span className="path-text">{state.config_directory}</span></div>{native && <button className="secondary-button compact" onClick={onOpenFolder}>Open folder <ArrowUpRight size={14} /></button>}</div><div className="settings-row"><div><strong>Release channel</strong><span>Source build · tagged builds are staged as GitHub release drafts.</span></div><a className="secondary-button compact" href="https://github.com/uthumany/zorin-devstart" target="_blank" rel="noreferrer">Repository <Github size={14} /></a></div></section>
    <div className="settings-footnote"><ShieldCheck size={16} /><p><strong>Removal stays narrow.</strong> Uninstalling a profile uses only direct packages the app recorded as newly installed. Shared dependencies and user files are left alone.</p></div>
  </div>;
}

export default App;
