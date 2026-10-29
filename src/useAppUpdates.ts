import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./api";
import { compareVersions, CURRENT_APP_VERSION, fetchLatestRelease, type AppRelease } from "./releases";

export type UpdateStatus = "idle" | "checking" | "available" | "current" | "none" | "error";

export interface UpdateState {
  status: UpdateStatus;
  release: AppRelease | null;
  checkedAt: string | null;
  error: string;
}

const initialState: UpdateState = { status: "idle", release: null, checkedAt: null, error: "" };
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function useAppUpdates(notify: (message: string) => void) {
  const [update, setUpdate] = useState<UpdateState>(initialState);
  const autoCheckStarted = useRef(false);
  const lastAutomaticCheck = useRef(0);

  const checkUpdates = useCallback(async (notifyOnAvailable = true) => {
    setUpdate((previous) => ({ ...previous, status: "checking", error: "" }));
    try {
      const release = await fetchLatestRelease();
      const checkedAt = new Date().toISOString();
      if (!release) {
        setUpdate({ status: "none", release: null, checkedAt, error: "" });
        return;
      }
      const status = compareVersions(release.version, CURRENT_APP_VERSION) > 0 ? "available" : "current";
      setUpdate({ status, release, checkedAt, error: "" });
      if (status === "available" && notifyOnAvailable) {
        const notifiedVersion = localStorage.getItem("zorin-devstart-notified-release");
        if (notifiedVersion !== release.version) {
          localStorage.setItem("zorin-devstart-notified-release", release.version);
          notify(`Zorin DevStart ${release.version} is available to download.`);
        }
      }
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        status: "error",
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [notify]);

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

  return { update, checkUpdates, openReleaseUrl, currentVersion: CURRENT_APP_VERSION };
}
