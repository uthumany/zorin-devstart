export type Category = "Language" | "Frontend" | "Systems" | "Mobile" | "Writing" | string;

export interface PackageItem {
  name: string;
  reason: string;
  installed: boolean;
}

export interface Profile {
  id: string;
  title: string;
  category: Category;
  summary: string;
  accent: string;
  packages: PackageItem[];
  extension: boolean;
}

export interface ProfileLoadDiagnostic {
  path: string;
  file_name: string | null;
  kind: string;
  message: string;
}

export interface OwnedProfile {
  installed_at: string;
  owned_packages: string[];
}

export interface OperationRecord {
  id: string;
  profile_id: string;
  profile_title: string;
  action: "install" | "remove" | "reconcile";
  status: "success" | "partial" | "failed" | "cancelled" | "already-installed" | "reconciliation-required";
  message: string;
  packages: string[];
  timestamp: string;
}

export interface PendingReconciliation {
  id: string;
  profile_id: string;
  profile_title: string;
  packages: string[];
  before_packages: string[];
  reason: string;
  created_at: string;
}

export interface ReconciliationPreview {
  plan_id: string;
  profile_id: string;
  profile_title: string;
  packages: string[];
  missing_packages: string[];
  unexpected_changes: string[];
  ready: boolean;
  message: string;
}

export interface SystemStatus {
  distro: string;
  version: string;
  architecture: string;
  supported: boolean;
  apt_available: boolean;
  polkit_available: boolean;
  native: boolean;
}

export interface AppState {
  system: SystemStatus;
  profiles: Profile[];
  tracked_profiles: Record<string, OwnedProfile>;
  history: OperationRecord[];
  pending_reconciliation: PendingReconciliation | null;
  config_directory: string;
  extension_diagnostics: ProfileLoadDiagnostic[];
}

export interface ProgressEvent {
  profile_id: string;
  stage: string;
  message: string;
}

export interface OperationResult {
  success: boolean;
  status: OperationRecord["status"];
  message: string;
  packages: string[];
}
