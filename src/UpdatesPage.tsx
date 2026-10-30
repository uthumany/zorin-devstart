import {
  AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Download, ExternalLink,
  Github, Package, RefreshCw, ShieldCheck, Smartphone,
} from "lucide-react";
import { compareVersions, type AppRelease, type ReleaseAsset } from "./releases";
import type { UpdateState } from "./useAppUpdates";
import "./UpdatesPage.css";

interface UpdatesPageProps {
  update: UpdateState;
  currentVersion: string;
  onCheck: () => void;
  onInstallSignedUpdate: () => void;
  onOpen: (url: string) => void;
}

function readableSize(bytes: number): string {
  if (bytes <= 0) return "Size unavailable";
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1_000)} KB`;
}

function readableDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Publication date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function cleanNotes(notes: string): string[] {
  return notes
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph
      .replace(/^\s*[-*]\s+/gm, "• ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_#]/g, "")
      .trim())
    .filter(Boolean);
}

function InstallerCard({ asset, onOpen }: { asset: ReleaseAsset; onOpen: (url: string) => void }) {
  const label = asset.kind === "deb" ? "Debian package" : "AppImage";
  return (
    <div className="update-installer">
      <div className={`update-installer-icon ${asset.kind}`} aria-hidden="true">
        {asset.kind === "deb" ? <Package size={18} /> : <Smartphone size={18} />}
      </div>
      <div className="update-installer-copy">
        <strong>{label}</strong>
        <span title={asset.name}>{asset.name}</span>
      </div>
      <span className="update-installer-size">{readableSize(asset.size)}</span>
      <button className="secondary-button compact" onClick={() => onOpen(asset.url)} aria-label={`Download ${label}`}>
        <Download size={14} /> Download
      </button>
    </div>
  );
}

function ReleaseNotes({ release }: { release: AppRelease }) {
  const paragraphs = cleanNotes(release.notes);
  return (
    <section className="update-panel glass-card" aria-labelledby="release-notes-title">
      <div className="update-panel-heading">
        <div>
          <span className="eyebrow">WHAT’S NEW</span>
          <h2 id="release-notes-title">Release notes</h2>
        </div>
        <span className="update-release-tag">{release.tag}</span>
      </div>
      <div className="update-notes-copy">
        {paragraphs.length
          ? paragraphs.map((paragraph, index) => <p key={`${release.tag}-${index}`}>{paragraph}</p>)
          : <p>The maintainer hasn’t added release notes for this version yet.</p>}
      </div>
    </section>
  );
}

export default function UpdatesPage({ update, currentVersion, onCheck, onInstallSignedUpdate, onOpen }: UpdatesPageProps) {
  const release = update.release;
  const hasUpdate = update.status === "available";
  const releaseHasUpdate = Boolean(release && compareVersions(release.version, currentVersion) > 0);
  const isChecking = update.status === "checking";
  const installBusy = ["downloading", "installing", "restarting"].includes(update.installStatus);
  const canInstallSignedUpdate = Boolean(
    hasUpdate && update.isAppImage && update.signedUpdaterEnabled && update.signedUpdateVersion
      && release?.version === update.signedUpdateVersion,
  );
  const progressPercent = update.contentLength && update.contentLength > 0
    ? Math.min(100, Math.round((update.downloadedBytes / update.contentLength) * 100))
    : null;

  const statusText = update.installStatus === "downloading"
    ? "Downloading signed update"
    : update.installStatus === "installing"
      ? "Verifying and applying update"
      : update.installStatus === "restarting"
        ? "Restarting to finish update"
        : update.installStatus === "error"
          ? "Signed update could not be installed"
          : update.status === "available"
            ? "An update is available"
            : update.status === "current"
              ? "You’re up to date"
              : update.status === "checking"
                ? "Checking for updates"
                : update.status === "error"
                  ? "Couldn’t check right now"
                  : update.status === "none"
                    ? "No published release yet"
                    : "Updates are checked here";

  const statusDescription = update.installStatus === "downloading"
    ? "Downloading the AppImage update. The signature will be verified before the file is installed."
    : update.installStatus === "installing"
      ? "The downloaded AppImage is being checked against the built-in signing key before replacement."
      : update.installStatus === "restarting"
        ? "The signed AppImage has been installed. The app is restarting now."
        : update.installStatus === "error"
          ? "The running app was not restarted. Check the message below, then retry or use a release download."
          : update.status === "available"
          ? update.isAppImage && canInstallSignedUpdate
              ? `Version ${release?.version} is ready. Choose Install & restart to download and verify the signed AppImage. Save other work first.`
              : update.isAppImage && update.signedUpdaterEnabled && update.signedUpdateVersion && release?.version !== update.signedUpdateVersion
                ? `The signed update feed reports ${update.signedUpdateVersion}, but the public release listing reports ${release?.version}. In-app installation is disabled until they match.`
              : update.isAppImage
                ? `Version ${release?.version} is newer than your installed ${currentVersion}. A signed in-app package is not available, so download the AppImage below.`
                : `Version ${release?.version} is newer than your installed ${currentVersion}. Download the Debian package and install it through Software or APT.`
            : update.status === "current"
              ? `You have ${currentVersion}, the latest published version.`
              : update.status === "checking"
                ? "Contacting the project’s public GitHub Releases feed. Checking for updates does not install anything."
                : update.status === "error"
                  ? update.error
                  : update.status === "none"
                    ? "There isn’t a public stable release to install yet. Draft releases aren’t shown."
                    : `Installed version ${currentVersion}. Check the public release feed for a newer version.`;

  return (
    <div className="page-wrap subpage updates-page">
      <div className="page-title-row updates-title-row">
        <div>
          <span className="eyebrow">DEVSTART · RELEASE CHANNEL</span>
          <h1>App updates</h1>
          <p>Check for a new version, review its notes, and install a signed AppImage update or choose a package manually.</p>
        </div>
        <div className="update-version-pill" aria-label={`Installed version ${currentVersion}`}>
          <span>INSTALLED</span>
          <strong>v{currentVersion}</strong>
        </div>
      </div>

      <section className={`update-status-card ${hasUpdate ? "is-available" : ""}`} aria-live="polite" aria-atomic="true">
        <div className={`update-status-mark ${hasUpdate ? "available" : update.status === "error" || update.installStatus === "error" ? "error" : ""}`} aria-hidden="true">
          {hasUpdate ? <Download size={21} /> : update.status === "error" || update.installStatus === "error" ? <AlertCircle size={21} /> : update.status === "checking" ? <RefreshCw size={21} className="spin" /> : <CheckCircle2 size={21} />}
        </div>
        <div className="update-status-copy">
          <span className="eyebrow">VERSION CHECK</span>
          <h2>{statusText}</h2>
          <p>{statusDescription}</p>
          {update.installStatus === "downloading" && <div className="update-progress">
            <div className="update-progress-label">
              <span>{progressPercent === null ? "Downloading…" : `${progressPercent}% downloaded`}</span>
              <span>{update.downloadedBytes > 0 ? readableSize(update.downloadedBytes) : "0 KB"}{update.contentLength ? ` of ${readableSize(update.contentLength)}` : ""}</span>
            </div>
            <div
              className={`update-progress-track ${progressPercent === null ? "indeterminate" : ""}`}
              role="progressbar"
              aria-label="Signed update download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent ?? undefined}
            >
              <span style={{ width: progressPercent === null ? "35%" : `${progressPercent}%` }} />
            </div>
          </div>}
          <span className="update-checked-at">
            {update.checkedAt ? `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.checkedAt))}` : "Checks the latest public stable release"}
          </span>
        </div>
        <div className="update-status-actions">
          {hasUpdate && release && (canInstallSignedUpdate
            ? <button className="primary-button update-now-button" onClick={onInstallSignedUpdate} disabled={installBusy}>
              {installBusy ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
              {update.installStatus === "downloading" ? "Downloading…" : update.installStatus === "installing" ? "Verifying…" : update.installStatus === "restarting" ? "Restarting…" : "Install & restart"}
            </button>
            : <button className="primary-button update-now-button" onClick={() => onOpen(release.url)}>
              View release <ArrowUpRight size={15} />
            </button>)}
          <button className={hasUpdate ? "secondary-button" : "primary-button"} onClick={onCheck} disabled={isChecking || installBusy}>
            <RefreshCw size={14} className={isChecking ? "spin" : undefined} />
            {isChecking ? "Checking…" : "Check updates"}
          </button>
        </div>
      </section>

      {(update.status === "error" || update.signedUpdaterError) && <div className="update-error-note" role="status">
        <AlertCircle size={15} />
        <span>{update.installStatus === "error"
          ? update.signedUpdaterError || "The signed update did not complete. You can retry or download a release manually."
          : update.status === "error"
            ? `${update.error} The app and development packages were not changed.`
            : `Signed update note: ${update.signedUpdaterError} You can still download a release manually.`}</span>
      </div>}

      {release ? (
        <div className="updates-content-grid">
          <div className="updates-primary-column">
            <section className="update-panel glass-card update-release-panel" aria-labelledby="latest-release-title">
              <div className="update-panel-heading">
                <div>
                  <span className="eyebrow">LATEST PUBLIC RELEASE</span>
                  <h2 id="latest-release-title">{release.name}</h2>
                </div>
                <span className={`update-state-pill ${releaseHasUpdate ? "available" : "current"}`}>
                  <span aria-hidden="true" />{releaseHasUpdate ? "Update available" : "Latest"}
                </span>
              </div>
              <div className="update-release-meta">
                <span>{release.tag}</span><span aria-hidden="true">·</span><span>Published {readableDate(release.publishedAt)}</span>
              </div>
              <ReleaseNotes release={release} />
            </section>
          </div>

          <aside className="updates-side-column">
            <section className="update-panel glass-card installer-panel" aria-labelledby="installer-title">
              <div className="update-panel-heading">
                <div><span className="eyebrow">LINUX INSTALLERS</span><h2 id="installer-title">Choose a package</h2></div>
                <Package size={18} aria-hidden="true" />
              </div>
              {release.assets.length > 0 ? <div className="update-installer-list">
                {release.assets.map((asset) => <InstallerCard key={asset.name} asset={asset} onOpen={onOpen} />)}
              </div> : <p className="update-empty-assets">This release has no supported .deb or AppImage installer attached.</p>}
              <p className="installer-footnote">Downloads come directly from the project’s GitHub release.</p>
            </section>

            <section className="update-safety-card" aria-label="Safe update information">
              <div className="update-safety-icon" aria-hidden="true"><ShieldCheck size={18} /></div>
              <div><strong>Choose how to update</strong><p>AppImage installs can use the signed updater; the downloaded file is verified before replacement. Debian packages stay under Software or APT. DevStart never runs APT or pkexec to update itself.</p></div>
            </section>

            <div className="update-source-row">
              <span><Clock3 size={14} /> {release.publishedAt ? `Released ${readableDate(release.publishedAt)}` : "Release date unavailable"}</span>
              <button className="text-button" onClick={() => onOpen(release.url)}>View release <ExternalLink size={13} /></button>
            </div>
          </aside>
        </div>
      ) : (
        <section className="update-empty-release glass-card">
          <div className="update-empty-mark" aria-hidden="true"><Github size={20} /></div>
          <div><strong>{update.status === "none" ? "Waiting for a published release" : "Release details will appear here"}</strong><p>When a stable release is public, its version, notes, and supported Linux installers will show on this page.</p></div>
        </section>
      )}

      <div className="update-footer-note"><CheckCircle2 size={15} /><span>Checking is read-only. A signed AppImage is installed only after you choose Install & restart; Debian updates remain manual.</span></div>
    </div>
  );
}
