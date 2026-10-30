import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppState, OperationResult, ProgressEvent, ReconciliationPreview } from "./types";

export const isDesktopRuntime = () => Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export async function isAppImageRuntime(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  return invoke<boolean>("is_appimage_runtime");
}

export async function getAppState(): Promise<AppState> {
  return invoke<AppState>("get_app_state");
}

export async function prepareReconciliation(): Promise<ReconciliationPreview | null> {
  if (!isDesktopRuntime()) throw new Error("Reconciliation is available only in the installed desktop app.");
  return invoke<ReconciliationPreview | null>("prepare_reconciliation");
}

export async function confirmReconciliation(planId: string, confirmedPackages: string[]): Promise<OperationResult> {
  if (!isDesktopRuntime()) throw new Error("Reconciliation is available only in the installed desktop app.");
  return invoke<OperationResult>("confirm_reconciliation", { planId, confirmedPackages });
}

export async function dismissReconciliation(planId: string): Promise<OperationResult> {
  if (!isDesktopRuntime()) throw new Error("Reconciliation is available only in the installed desktop app.");
  return invoke<OperationResult>("dismiss_reconciliation", { planId });
}

export async function installProfile(profileId: string): Promise<OperationResult> {
  if (!isDesktopRuntime()) throw new Error("Privileged setup is available only in the installed desktop app.");
  return invoke<OperationResult>("install_profile", { profileId });
}

export async function uninstallProfile(profileId: string): Promise<OperationResult> {
  if (!isDesktopRuntime()) throw new Error("Profile removal is available only in the installed desktop app.");
  return invoke<OperationResult>("uninstall_profile", { profileId });
}

export async function addExtension(manifest: string): Promise<string> {
  if (!isDesktopRuntime()) throw new Error("Saving extensions is available only in the installed desktop app.");
  return invoke<string>("add_extension", { manifest });
}

export async function removeExtension(profileId: string): Promise<string> {
  if (!isDesktopRuntime()) throw new Error("Managing extensions is available only in the installed desktop app.");
  return invoke<string>("remove_extension", { profileId });
}

export async function openConfigFolder(): Promise<void> {
  if (!isDesktopRuntime()) throw new Error("Opening the local config folder requires the desktop app.");
  await invoke("open_config_folder");
}

export async function onProgress(callback: (event: ProgressEvent) => void): Promise<UnlistenFn | undefined> {
  if (!isDesktopRuntime()) return undefined;
  return listen<ProgressEvent>("devstart-progress", (event) => callback(event.payload));
}
