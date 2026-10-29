import tauriConfig from "../src-tauri/tauri.conf.json";

export const CURRENT_APP_VERSION = tauriConfig.version;
export const RELEASES_API_URL = "https://api.github.com/repos/uthumany/zorin-devstart/releases/latest";
const RELEASES_PAGE_PREFIX = "https://github.com/uthumany/zorin-devstart/releases/";
const RELEASE_DOWNLOAD_PREFIX = "https://github.com/uthumany/zorin-devstart/releases/download/";

export type InstallerKind = "deb" | "appimage";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  kind: InstallerKind;
}

export interface AppRelease {
  tag: string;
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  notes: string;
  assets: ReleaseAsset[];
}

function safeProjectReleaseUrl(value: unknown, prefix: string): string | null {
  if (typeof value !== "string" || !value.startsWith(prefix) || /[\r\n\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith(prefix.slice("https://github.com".length))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeVersion(value: string): string | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? `-${match[4]}` : ""}`;
}

function comparePrerelease(left: string | undefined, right: string | undefined): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] === b[index]) continue;
    const aNumeric = /^\d+$/.test(a[index]);
    const bNumeric = /^\d+$/.test(b[index]);
    if (aNumeric && bNumeric) return Number(a[index]) < Number(b[index]) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) throw new Error("A release version is not a valid semantic version.");
  const [aCore, aPre] = a.split("-", 2);
  const [bCore, bPre] = b.split("-", 2);
  const aParts = aCore.split(".").map(Number);
  const bParts = bCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (aParts[index] !== bParts[index]) return aParts[index] < bParts[index] ? -1 : 1;
  }
  return comparePrerelease(aPre, bPre);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<AppRelease | null> {
  const response = await fetch(RELEASES_API_URL, {
    method: "GET",
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal,
  });
  if (response.status === 404) return null;
  if (response.status === 403 && response.headers.get("X-RateLimit-Remaining") === "0") {
    throw new Error("GitHub’s public release-check limit was reached. Try again in a little while.");
  }
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Try again later.`);

  const record = asRecord(await response.json());
  if (!record || record.draft === true || record.prerelease === true) return null;
  const tag = typeof record.tag_name === "string" ? record.tag_name : "";
  const version = normalizeVersion(tag);
  const url = safeProjectReleaseUrl(record.html_url, RELEASES_PAGE_PREFIX);
  if (!version || !url) throw new Error("The latest release response was missing a valid version or project URL.");

  const assets: ReleaseAsset[] = [];
  if (Array.isArray(record.assets)) {
    for (const rawAsset of record.assets) {
      const asset = asRecord(rawAsset);
      if (!asset || typeof asset.name !== "string") continue;
      const kind: InstallerKind | null = asset.name.toLowerCase().endsWith(".deb")
        ? "deb"
        : asset.name.toLowerCase().endsWith(".appimage")
          ? "appimage"
          : null;
      const assetUrl = safeProjectReleaseUrl(asset.browser_download_url, RELEASE_DOWNLOAD_PREFIX);
      if (!kind || !assetUrl) continue;
      assets.push({
        name: asset.name,
        url: assetUrl,
        size: typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : 0,
        kind,
      });
    }
  }

  return {
    tag,
    version,
    name: typeof record.name === "string" && record.name.trim() ? record.name : `Zorin DevStart ${tag}`,
    url,
    publishedAt: typeof record.published_at === "string" ? record.published_at : "",
    notes: typeof record.body === "string" ? record.body.trim() : "",
    assets,
  };
}
