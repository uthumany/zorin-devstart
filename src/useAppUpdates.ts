import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isAppImageRuntime, isDesktopRuntime } from "./api";
import { compareVersions, CURRENT_APP_VERSION, fetchLatestRelease, normalizeVersion, type AppRelease } from "./releases";

export type UpdateStatus = "idle" | "checking" | "available" | "current" | "none" | "error";
export type UpdateInstallStatus = "idle" | "downloading" | "installing" | "restarting" | "error";

export interface UpdateState {
  status: UpdateStatus;
  release: AppRelease | null;
  checkedAt: string | null;
  error: string;
  isAppImage: boolean;
  signedUpdaterEnabled: boolean;
  signedUpdateVersion: string | null;
  signedUpdaterError: string;
  installStatus: UpdateInstallStatus;
  downloadedBytes: number;
  contentLength: number | null;
}

const SIGNED_UPDATER_ENABLED = import.meta.env.VITE_DEVSTART_SIGNED_UPDATER === "true";
const initialState: UpdateState = {
  status: "idle",
  release: null,
  checkedAt: null,
  error: "",
  isAppImage: false,
  signedUpdaterEnabled: SIGNED_UPDATER_ENABLED,
  signedUpdateVersion: null,
  signedUpdaterError: "",
  installStatus: "idle",
  downloadedBytes: 0,
  contentLength: null,
};
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdates(notify: (message: string) => void) {
  const [update, setUpdate] = useState<UpdateState>(initialState);
  const autoCheckStarted = useRef(false);
  const lastAutomaticCheck = useRef(0);

  const checkUpdates = useCallback(async (notifyOnAvailable = true) => {
    setUpdate((previous) => ({ ...previous, status: "checking", error: "", signedUpdaterError: "" }));
    try {
      const release = await fetchLatestRelease();
      const checkedAt = new Date().toISOString();
      const appImageRuntime = isDesktopRuntime() ? await isAppImageRuntime() : false;
      let signedUpdateVersion: string | null = null;
      let signedUpdaterError = "";

      if (appImageRuntime && SIGNED_UPDATER_ENABLED) {
        let candidate: Update | null = null;
        try {
          candidate = await check({ timeout: 20_000 });
          if (candidate && compareVersions(candidate.version, CURRENT_APP_VERSION) > 0) {
            signedUpdateVersion = normalizeVersion(candidate.version);
          }
        } catch (error) {
          signedUpdaterError = errorMessage(error);
        } finally {
          if (candidate) await candidate.close().catch(() => undefined);
        }
      }

      const releaseHasUpdate = Boolean(release && compareVersions(release.version, CURRENT_APP_VERSION) > 0);
      const signedHasUpdate = Boolean(signedUpdateVersion && compareVersions(signedUpdateVersion, CURRENT_APP_VERSION) > 0);
      if (signedHasUpdate && (!release || normalizeVersion(release.version) !== signedUpdateVersion)) {
        signedUpdaterError = release
          ? `The signed update feed reports ${signedUpdateVersion}, but the public release listing reports ${release.version}. In-app installation is disabled until they match.`
          : `The signed update feed reports ${signedUpdateVersion}, but public release details are unavailable. In-app installation is disabled until they match.`;
      }
      const status = release
        ? releaseHasUpdate || signedHasUpdate ? "available" : "current"
        : "none";
      setUpdate((previous) => ({
        ...previous,
        status,
        release,
        checkedAt,
        error: "",
        isAppImage: appImageRuntime,
        signedUpdaterEnabled: SIGNED_UPDATER_ENABLED,
        signedUpdateVersion,
        signedUpdaterError,
        installStatus: previous.installStatus === "error" ? "idle" : previous.installStatus,
      }));

      if (status === "available" && notifyOnAvailable) {
        const version = signedHasUpdate ? signedUpdateVersion : release?.version;
        if (version) {
          const notifiedVersion = localStorage.getItem("zorin-devstart-notified-release");
          if (notifiedVersion !== version) {
            localStorage.setItem("zorin-devstart-notified-release", version);
            notify(`Zorin DevStart ${version} is available to update.`);
          }
        }
      }
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        status: "error",
        checkedAt: new Date().toISOString(),
        error: errorMessage(error),
      }));
    }
  }, [notify]);

  const installSignedUpdate = useCallback(async () => {
    if (!isDesktopRuntime() || !update.isAppImage || !SIGNED_UPDATER_ENABLED) {
      setUpdate((previous) => ({
        ...previous,
        installStatus: "error",
        signedUpdaterError: "Signed in-app updates are available only in a configured AppImage installation.",
      }));
      return;
    }

    setUpdate((previous) => ({
      ...previous,
      installStatus: "downloading",
      downloadedBytes: 0,
      contentLength: null,
      signedUpdaterError: "",
    }));

    let candidate: Update | null = null;
    try {
      candidate = await check({ timeout: 20_000 });
      if (!candidate) throw new Error("No signed AppImage update is currently available.");
      const candidateVersion = normalizeVersion(candidate.version);
      if (!candidateVersion || (update.signedUpdateVersion && candidateVersion !== update.signedUpdateVersion)) {
        throw new Error("The signed update changed since the last check. Check for updates again before installing.");
      }

      await candidate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdate((previous) => ({
            ...previous,
            installStatus: "downloading",
            downloadedBytes: 0,
            contentLength: event.data.contentLength ?? null,
          }));
        } else if (event.event === "Progress") {
          setUpdate((previous) => ({
            ...previous,
            downloadedBytes: previous.downloadedBytes + event.data.chunkLength,
          }));
        } else if (event.event === "Finished") {
          setUpdate((previous) => ({ ...previous, installStatus: "installing" }));
        }
      });
      await candidate.close();
      candidate = null;
      setUpdate((previous) => ({ ...previous, installStatus: "restarting" }));
      await relaunch();
    } catch (error) {
      if (candidate) await candidate.close().catch(() => undefined);
      setUpdate((previous) => ({
        ...previous,
        installStatus: "error",
        signedUpdaterError: errorMessage(error),
      }));
    }
  }, [update.isAppImage, update.signedUpdateVersion]);

  const openReleaseUrl = useCallback(async (url: string) => {
    if (isDesktopRuntime()) {
      await invoke("open_release_url", { url });
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) throw new Error("Your browser blocked the release page. Allow pop-ups or open the release link directly.");
  }, []);

  useEffect(() => {
    const runAutomaticCheck = () => {
      const now = Date.now();
      if (autoCheckStarted.current && now - lastAutomaticCheck.current < AUTOMATIC_CHECK_INTERVAL_MS) return;
      autoCheckStarted.current = true;
      lastAutomaticCheck.current = now;
      void checkUpdates(true);
    };
    runAutomaticCheck();
    const intervalId = window.setInterval(runAutomaticCheck, AUTOMATIC_CHECK_INTERVAL_MS);
    const handleFocus = () => {
      if (document.visibilityState === "visible") runAutomaticCheck();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [checkUpdates]);

  return { update, checkUpdates, installSignedUpdate, openReleaseUrl, currentVersion: CURRENT_APP_VERSION };
}
