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

export interface OwnedProfile {
  installed_at: string;
  owned_packages: string[];
}

export interface OperationRecord {
  id: string;
  profile_id: string;
  profile_title: string;
  action: "install" | "remove";
  status: "success" | "partial" | "failed" | "cancelled" | "already-installed";
  message: string;
  packages: string[];
  timestamp: string;
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
  config_directory: string;
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
