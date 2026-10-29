import {
  AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Download, ExternalLink,
  Github, Package, RefreshCw, ShieldCheck, Smartphone,
} from "lucide-react";
import type { AppRelease, ReleaseAsset } from "./releases";
import type { UpdateState } from "./useAppUpdates";
import "./UpdatesPage.css";

interface UpdatesPageProps {
  update: UpdateState;
  currentVersion: string;
  onCheck: () => void;
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

export default function UpdatesPage({ update, currentVersion, onCheck, onOpen }: UpdatesPageProps) {
  const release = update.release;
  const hasUpdate = update.status === "available";
  const isChecking = update.status === "checking";
  const statusText = update.status === "available"
    ? "An update is ready"
    : update.status === "current"
      ? "You’re up to date"
      : update.status === "checking"
        ? "Checking for updates"
        : update.status === "error"
          ? "Couldn’t check right now"
          : update.status === "none"
            ? "No published release yet"
            : "Updates are checked here";
  const statusDescription = update.status === "available"
    ? `Version ${release?.version} is newer than your installed ${currentVersion}. Choose an installer below to continue.`
    : update.status === "current"
      ? `You have ${currentVersion}, the latest published version.`
      : update.status === "checking"
        ? "Contacting the project’s public GitHub Releases feed. Your installed packages won’t be changed."
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
          <p>Check for a new version, review its notes, and choose the installer that fits your setup.</p>
        </div>
        <div className="update-version-pill" aria-label={`Installed version ${currentVersion}`}>
          <span>INSTALLED</span>
          <strong>v{currentVersion}</strong>
        </div>
      </div>

      <section className={`update-status-card ${hasUpdate ? "is-available" : ""}`} aria-live="polite" aria-atomic="true">
        <div className={`update-status-mark ${hasUpdate ? "available" : update.status === "error" ? "error" : ""}`} aria-hidden="true">
          {hasUpdate ? <Download size={21} /> : update.status === "error" ? <AlertCircle size={21} /> : update.status === "checking" ? <RefreshCw size={21} className="spin" /> : <CheckCircle2 size={21} />}
        </div>
        <div className="update-status-copy">
          <span className="eyebrow">VERSION CHECK</span>
          <h2>{statusText}</h2>
          <p>{statusDescription}</p>
          <span className="update-checked-at">
            {update.checkedAt ? `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.checkedAt))}` : "Checks the latest public stable release"}
          </span>
        </div>
        <div className="update-status-actions">
          {hasUpdate && release && <button className="primary-button update-now-button" onClick={() => onOpen(release.url)}>
            Update now <ArrowUpRight size={15} />
          </button>}
          <button className={hasUpdate ? "secondary-button" : "primary-button"} onClick={onCheck} disabled={isChecking}>
            <RefreshCw size={14} className={isChecking ? "spin" : undefined} />
            {isChecking ? "Checking…" : "Check updates"}
          </button>
        </div>
      </section>

      {update.status === "error" && <div className="update-error-note" role="status">
        <AlertCircle size={15} /> The last successful release details, if available, remain below. Your app and development packages were not changed.
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
                <span className={`update-state-pill ${hasUpdate ? "available" : "current"}`}>
                  <span aria-hidden="true" />{hasUpdate ? "Update available" : "Latest"}
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
              <div><strong>Review before installing</strong><p>DevStart doesn’t silently replace itself or run a package install. Download the release and confirm installation with your usual Linux installer.</p></div>
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

      <div className="update-footer-note"><CheckCircle2 size={15} /><span>Checking releases is read-only. It never installs, removes, or changes your development tools.</span></div>
    </div>
  );
}
