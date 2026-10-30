mod apt;
mod locking;
mod profiles;
mod store;

use chrono::Utc;
use profiles::{ExtensionManifest, ProfileDefinition};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::Path,
    process::{Command, Output},
    sync::{Mutex, MutexGuard, TryLockError},
};
use store::{OperationRecord, OwnedProfile, PendingReconciliation, Store};
use tauri::{AppHandle, Emitter};

impl From<CommandFailure> for apt::AptFailure {
    fn from(failure: CommandFailure) -> Self {
        Self {
            status: failure.status,
            message: failure.message,
        }
    }
}

const APT_GET: &str = "/usr/bin/apt-get";
const DPKG_QUERY: &str = "/usr/bin/dpkg-query";
static MUTATION_LOCK: Mutex<()> = Mutex::new(());

fn acquire_mutation_lock() -> Result<MutexGuard<'static, ()>, String> {
    MUTATION_LOCK.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => {
            "Another package or extension change is already in progress. Wait for it to finish before starting another operation.".into()
        }
        TryLockError::Poisoned(_) => {
            "The local operation lock is unavailable after an internal error. Restart DevStart before retrying.".into()
        }
    })
}

fn acquire_process_lock() -> Result<locking::OperationLock, String> {
    let data_dir = store::data_dir().ok_or_else(|| {
        "Could not resolve the local data directory for operation locking.".to_string()
    })?;
    locking::acquire_operation_lock(&data_dir)
}

#[derive(Debug, Clone, Serialize)]
struct SystemStatus {
    distro: String,
    version: String,
    architecture: String,
    supported: bool,
    apt_available: bool,
    polkit_available: bool,
    native: bool,
}

#[derive(Debug, Serialize)]
struct AppState {
    system: SystemStatus,
    profiles: Vec<profiles::ProfileView>,
    tracked_profiles: std::collections::HashMap<String, OwnedProfile>,
    history: Vec<OperationRecord>,
    pending_reconciliation: Option<PendingReconciliation>,
    config_directory: String,
    extension_diagnostics: Vec<profiles::ProfileLoadDiagnostic>,
}

#[derive(Debug, Serialize)]
struct OperationResult {
    success: bool,
    status: String,
    message: String,
    packages: Vec<String>,
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    profile_id: String,
    stage: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct ReconciliationPreview {
    plan_id: String,
    profile_id: String,
    profile_title: String,
    packages: Vec<String>,
    missing_packages: Vec<String>,
    unexpected_changes: Vec<String>,
    ready: bool,
    message: String,
}

#[tauri::command]
fn get_app_state() -> Result<AppState, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    let system = system_status();
    let installed = if Path::new(DPKG_QUERY).exists() {
        apt::retry_inventory(installed_packages)?
    } else {
        HashSet::new()
    };
    let (loaded_profiles, extension_diagnostics) = profiles::load_profiles_with_diagnostics();
    let profiles = profiles::profile_views(loaded_profiles, &installed);
    let saved = Store::load()?;
    let config_directory = profiles::extension_dir()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "Unavailable".into());
    Ok(AppState {
        system,
        profiles,
        tracked_profiles: saved.tracked_profiles,
        history: saved.history,
        pending_reconciliation: saved.pending_reconciliation,
        config_directory,
        extension_diagnostics,
    })
}

fn reconciliation_preview(
    plan: &PendingReconciliation,
    installed: &HashSet<String>,
) -> ReconciliationPreview {
    let before: HashSet<&str> = plan.before_packages.iter().map(String::as_str).collect();
    let expected: HashSet<&str> = plan.packages.iter().map(String::as_str).collect();
    let missing_packages: Vec<String> = plan
        .packages
        .iter()
        .filter(|package| !installed.contains(*package))
        .cloned()
        .collect();
    let mut unexpected_changes: Vec<String> = installed
        .iter()
        .filter(|package| {
            !before.contains(package.as_str()) && !expected.contains(package.as_str())
        })
        .map(|package| format!("added:{package}"))
        .collect();
    unexpected_changes.extend(
        plan.before_packages
            .iter()
            .filter(|package| !installed.contains(*package))
            .map(|package| format!("removed:{package}")),
    );
    unexpected_changes.sort();
    let ready = missing_packages.is_empty() && unexpected_changes.is_empty();
    let message = if ready {
        format!(
            "{} verified package(s) are present and no unexpected package changes were detected. Confirmation will assign ownership only; it will not run APT.",
            plan.packages.len()
        )
    } else if !missing_packages.is_empty() {
        format!(
            "{} package(s) from the saved plan are still missing: {}. No ownership will be assigned.",
            missing_packages.len(),
            missing_packages.join(", ")
        )
    } else {
        format!(
            "The device changed after this plan was created ({} unexpected change(s)). Refresh and review the new state before confirming.",
            unexpected_changes.len()
        )
    };
    ReconciliationPreview {
        plan_id: plan.id.clone(),
        profile_id: plan.profile_id.clone(),
        profile_title: plan.profile_title.clone(),
        packages: plan.packages.clone(),
        missing_packages,
        unexpected_changes,
        ready,
        message,
    }
}

#[tauri::command]
fn prepare_reconciliation() -> Result<Option<ReconciliationPreview>, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    let saved = Store::load()?;
    let Some(plan) = saved.pending_reconciliation else {
        return Ok(None);
    };
    let installed = apt::retry_inventory(installed_packages)?;
    Ok(Some(reconciliation_preview(&plan, &installed)))
}

#[tauri::command]
fn confirm_reconciliation(
    plan_id: String,
    confirmed_packages: Vec<String>,
) -> Result<OperationResult, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    let system = system_status();
    ensure_supported(&system)?;
    let mut saved = Store::load()?;
    let Some(plan) = saved.pending_reconciliation.clone() else {
        return Err("There is no pending reconciliation plan to confirm.".into());
    };
    if plan.id != plan_id {
        return Err(
            "This reconciliation plan is stale. Refresh the device and review the current plan."
                .into(),
        );
    }
    let calculated_digest = reconciliation_plan_digest(&plan)?;
    if !plan.plan_digest.is_empty() && plan.plan_digest != calculated_digest {
        return Err(
            "The saved reconciliation plan failed its integrity check. No ownership was changed."
                .into(),
        );
    }
    let profile = find_profile(&plan.profile_id)?;
    for package in &plan.packages {
        profiles::validate_package_name(package, profile.extension)?;
        if !profile.packages.iter().any(|item| item.name == *package) {
            return Err(format!(
                "The saved reconciliation package '{package}' is no longer part of the validated profile."
            ));
        }
    }
    let installed = apt::retry_inventory(installed_packages)?;
    let preview = reconciliation_preview(&plan, &installed);
    if !preview.ready {
        return Err(preview.message);
    }
    let mut expected = plan.packages.clone();
    expected.sort();
    expected.dedup();
    let mut confirmed = confirmed_packages;
    confirmed.sort();
    confirmed.dedup();
    if confirmed != expected {
        return Err(
            "The confirmation package list does not match the current reviewed plan. Refresh and review it again."
                .into(),
        );
    }
    let entry = saved
        .tracked_profiles
        .entry(plan.profile_id.clone())
        .or_insert_with(|| OwnedProfile {
            installed_at: Utc::now().to_rfc3339(),
            owned_packages: vec![],
        });
    for package in &expected {
        if !entry.owned_packages.contains(package) {
            entry.owned_packages.push(package.clone());
        }
    }
    saved.pending_reconciliation = None;
    let message = format!(
        "Reconciliation confirmed. DevStart assigned {} verified package(s) to {}. No package installation or removal was performed.",
        expected.len(), plan.profile_title
    );
    saved.record(
        &plan.profile_id,
        &plan.profile_title,
        "reconcile",
        "success",
        &message,
        expected.clone(),
    );
    saved.save()?;
    Ok(OperationResult {
        success: true,
        status: "success".into(),
        message,
        packages: expected,
    })
}

#[tauri::command]
fn dismiss_reconciliation(plan_id: String) -> Result<OperationResult, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    let mut saved = Store::load()?;
    let Some(plan) = saved.pending_reconciliation.clone() else {
        return Err("There is no pending reconciliation plan to dismiss.".into());
    };
    if plan.id != plan_id {
        return Err(
            "This reconciliation plan is stale. Refresh device state before dismissing it.".into(),
        );
    }
    saved.pending_reconciliation = None;
    let message = format!(
        "Recovery plan for {} was dismissed. No packages were changed and no ownership was assigned; any installed packages remain on the system.",
        plan.profile_title
    );
    saved.record(
        &plan.profile_id,
        &plan.profile_title,
        "reconcile",
        "cancelled",
        &message,
        vec![],
    );
    saved.save()?;
    Ok(OperationResult {
        success: true,
        status: "cancelled".into(),
        message,
        packages: vec![],
    })
}

#[tauri::command]
async fn install_profile(app: AppHandle, profile_id: String) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_profile_inner(&app, &profile_id))
        .await
        .map_err(|e| format!("Setup worker stopped: {e}"))?
}

#[tauri::command]
async fn uninstall_profile(app: AppHandle, profile_id: String) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || uninstall_profile_inner(&app, &profile_id))
        .await
        .map_err(|e| format!("Removal worker stopped: {e}"))?
}

#[tauri::command]
fn add_extension(manifest: String) -> Result<String, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    if manifest.len() > 16_000 {
        return Err("Extension JSON is too large (16 KB maximum).".into());
    }
    let parsed: ExtensionManifest =
        serde_json::from_str(&manifest).map_err(|e| format!("Manifest JSON is invalid: {e}"))?;
    let profile = profiles::manifest_to_profile(parsed)?;
    if profiles::load_profiles()
        .iter()
        .any(|existing| existing.id == profile.id)
    {
        return Err(format!("A profile named '{}' already exists.", profile.id));
    }
    let folder = profiles::extension_dir()
        .ok_or_else(|| "Could not resolve the local configuration directory.".to_string())?;
    fs::create_dir_all(&folder)
        .map_err(|e| format!("Could not create the extension folder: {e}"))?;
    let file_name = format!("{}.json", profile.id);
    let content = serde_json::to_vec_pretty(&profile_to_manifest(&profile))
        .map_err(|error| format!("Could not encode the extension: {error}"))?;
    profiles::write_extension_atomically(&folder, &file_name, &content)?;
    Ok(format!(
        "{} was validated and added to this device.",
        profile.title
    ))
}

#[tauri::command]
fn remove_extension(profile_id: String) -> Result<String, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    profiles::validate_profile_id(&profile_id)?;
    if profiles::builtin_profiles()
        .iter()
        .any(|p| p.id == profile_id)
    {
        return Err("Built-in profiles cannot be removed.".into());
    }
    let saved = Store::load()?;
    if saved
        .tracked_profiles
        .get(&profile_id)
        .is_some_and(|p| !p.owned_packages.is_empty())
    {
        return Err(
            "Uninstall the tracked profile tools before removing this extension definition.".into(),
        );
    }
    let folder = profiles::extension_dir()
        .ok_or_else(|| "Could not resolve the local configuration directory.".to_string())?;
    let target = folder.join(format!("{profile_id}.json"));
    fs::remove_file(&target).map_err(|e| format!("Could not remove the extension: {e}"))?;
    Ok(format!(
        "Extension '{profile_id}' was removed. No packages were uninstalled."
    ))
}

#[tauri::command]
fn open_config_folder() -> Result<(), String> {
    let folder = profiles::extension_dir()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Could not resolve the local configuration directory.".to_string())?;
    fs::create_dir_all(&folder).map_err(|e| format!("Could not open the folder: {e}"))?;
    let xdg_open = ["/usr/bin/xdg-open", "/bin/xdg-open"]
        .iter()
        .find(|path| Path::new(path).exists())
        .ok_or_else(|| "The system file manager launcher was not found.".to_string())?;
    Command::new(xdg_open)
        .arg(folder)
        .spawn()
        .map_err(|e| format!("Could not open the file manager: {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_release_url(url: String) -> Result<(), String> {
    const RELEASE_PREFIX: &str = "https://github.com/uthumany/zorin-devstart/releases/";
    if !url.starts_with(RELEASE_PREFIX)
        || url
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(
            "Only this project’s GitHub release pages and downloads can be opened here.".into(),
        );
    }
    let xdg_open = ["/usr/bin/xdg-open", "/bin/xdg-open"]
        .iter()
        .find(|path| Path::new(path).exists())
        .ok_or_else(|| "The system browser launcher was not found.".to_string())?;
    Command::new(xdg_open)
        .arg(url)
        .spawn()
        .map_err(|error| format!("Could not open the release page: {error}"))?;
    Ok(())
}

#[tauri::command]
fn is_appimage_runtime() -> bool {
    #[cfg(target_os = "linux")]
    {
        tauri::utils::platform::bundle_type() == Some(tauri::utils::config::BundleType::AppImage)
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn install_profile_inner(app: &AppHandle, profile_id: &str) -> Result<OperationResult, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    let system = system_status();
    ensure_supported(&system)?;
    locking::ensure_no_active_package_manager()?;
    let profile = find_profile(profile_id)?;
    for package in &profile.packages {
        profiles::validate_package_name(&package.name, profile.extension)?;
    }
    let mut saved = Store::load()?;
    if saved.pending_reconciliation.is_some() {
        return Err(
            "A reconciliation plan is waiting for confirmation or dismissal. Review it before starting another setup operation."
                .into(),
        );
    }
    let before_refresh = installed_packages()?;
    let initially_missing = missing_direct_packages(&profile, &before_refresh);
    if initially_missing.is_empty() {
        saved.record(
            &profile.id,
            &profile.title,
            "install",
            "already-installed",
            "All profile packages are already present; no system change was needed.",
            vec![],
        );
        saved.save()?;
        return Ok(OperationResult {
            success: true,
            status: "already-installed".into(),
            message: "All profile packages are already installed. No system change was made."
                .into(),
            packages: vec![],
        });
    }

    emit_progress(
        app,
        &profile.id,
        "refresh",
        "Refreshing APT package indexes. Approve or cancel in the operating-system prompt.",
    );
    if let Err(failure) = run_privileged(&["update".into()]) {
        let status = failure.status.to_string();
        saved.record(
            &profile.id,
            &profile.title,
            "install",
            &status,
            &failure.message,
            vec![],
        );
        saved.save()?;
        return Ok(OperationResult {
            success: false,
            status,
            message: failure.message,
            packages: vec![],
        });
    }

    // Refresh the baseline after APT index work and immediately before the install
    // plan is journaled, narrowing the window in which another package tool can
    // change the inventory and be mistaken for this operation.
    locking::ensure_no_active_package_manager()?;
    let before = installed_packages()?;
    let new_packages = missing_direct_packages(&profile, &before);
    if new_packages.is_empty() {
        saved.record(
            &profile.id,
            &profile.title,
            "install",
            "already-installed",
            "The requested packages became available before the install step; no package installation was run.",
            vec![],
        );
        saved.save()?;
        return Ok(OperationResult {
            success: true,
            status: "already-installed".into(),
            message:
                "The requested packages are already installed. No package installation was run."
                    .into(),
            packages: vec![],
        });
    }

    let created_at = Utc::now().to_rfc3339();
    let mut before_packages: Vec<String> = before.iter().cloned().collect();
    before_packages.sort();
    let mut plan = PendingReconciliation {
        id: format!(
            "reconcile-{}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_millis(),
            profile.id
        ),
        profile_id: profile.id.clone(),
        profile_title: profile.title.clone(),
        packages: new_packages.clone(),
        before_packages,
        plan_digest: String::new(),
        reason: "The package install is about to start. If the app closes or cannot save after APT runs, review this plan before assigning ownership; DevStart will never rerun APT during reconciliation.".into(),
        created_at,
    };
    plan.plan_digest = reconciliation_plan_digest(&plan)?;
    saved.pending_reconciliation = Some(plan);
    // Persist recovery data before invoking the privileged package mutation.
    saved.save()?;

    emit_progress(
        app,
        &profile.id,
        "install",
        "Installing the reviewed profile packages through APT.",
    );
    let args = package_args("install", &new_packages);
    let outcome = run_privileged(&args).map_err(apt::AptFailure::from);
    let inventory = locking::ensure_no_active_package_manager()
        .and_then(|()| apt::retry_inventory(installed_packages));
    let reconciliation =
        apt::reconcile_install(&profile.title, &before, &new_packages, inventory, outcome);
    if let Some(pending) = saved.pending_reconciliation.as_mut() {
        if !reconciliation.inventory_available || reconciliation.status == "reconciliation-required"
        {
            pending.reason = reconciliation.message.clone();
        } else {
            saved.pending_reconciliation = None;
        }
    }
    if !reconciliation.newly_present.is_empty() {
        let entry = saved
            .tracked_profiles
            .entry(profile.id.clone())
            .or_insert_with(|| OwnedProfile {
                installed_at: Utc::now().to_rfc3339(),
                owned_packages: vec![],
            });
        for name in &reconciliation.newly_present {
            if !entry.owned_packages.contains(name) {
                entry.owned_packages.push(name.clone());
            }
        }
    }
    saved.record(
        &profile.id,
        &profile.title,
        "install",
        &reconciliation.status,
        &reconciliation.message,
        reconciliation.newly_present.clone(),
    );
    // If this save fails, the pre-mutation pending plan remains on disk.
    saved.save()?;
    emit_progress(
        app,
        &profile.id,
        "complete",
        if reconciliation.success {
            "Profile setup finished."
        } else {
            "Profile setup needs review or reconciliation."
        },
    );
    Ok(OperationResult {
        success: reconciliation.success,
        status: reconciliation.status,
        message: reconciliation.message,
        packages: reconciliation.newly_present,
    })
}

fn missing_direct_packages(
    profile: &ProfileDefinition,
    installed: &HashSet<String>,
) -> Vec<String> {
    profile
        .packages
        .iter()
        .filter(|package| !installed.contains(&package.name))
        .map(|package| package.name.clone())
        .collect()
}

fn reconciliation_plan_digest(plan: &PendingReconciliation) -> Result<String, String> {
    let payload = serde_json::to_vec(&(
        &plan.id,
        &plan.profile_id,
        &plan.profile_title,
        &plan.packages,
        &plan.before_packages,
        &plan.created_at,
    ))
    .map_err(|error| format!("Could not encode the reconciliation plan: {error}"))?;
    Ok(format!("sha256:{:x}", Sha256::digest(payload)))
}

fn uninstall_profile_inner(app: &AppHandle, profile_id: &str) -> Result<OperationResult, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let _process_guard = acquire_process_lock()?;
    let system = system_status();
    ensure_supported(&system)?;
    locking::ensure_no_active_package_manager()?;
    let profile = find_profile(profile_id)?;
    let saved = Store::load()?;
    if saved.pending_reconciliation.is_some() {
        return Err(
            "A reconciliation plan must be reviewed or dismissed before another package operation can start.".into(),
        );
    }
    let Some(tracked) = saved.tracked_profiles.get(profile_id).cloned() else {
        return Err("DevStart has no package ownership record for this profile.".into());
    };
    validate_owned_packages(&profile, &tracked)?;

    emit_progress(
        app,
        &profile.id,
        "remove",
        "Rechecking ownership and installed state before removal.",
    );
    // Re-read the state and package inventory immediately before constructing the
    // privileged remove command; the cross-process lock remains held throughout.
    locking::ensure_no_active_package_manager()?;
    let mut latest = Store::load()?;
    if latest.pending_reconciliation.is_some() {
        return Err(
            "A reconciliation plan appeared before removal; review it before continuing.".into(),
        );
    }
    let Some(latest_tracked) = latest.tracked_profiles.get(profile_id).cloned() else {
        return Err(
            "The ownership record changed before removal. Refresh device state and try again."
                .into(),
        );
    };
    if latest_tracked.owned_packages != tracked.owned_packages {
        return Err(
            "The ownership record changed before removal. Refresh device state and try again."
                .into(),
        );
    }
    validate_owned_packages(&profile, &latest_tracked)?;
    let installed = apt::retry_inventory(installed_packages)?;
    let removable: Vec<String> = latest_tracked
        .owned_packages
        .iter()
        .filter(|name| installed.contains(*name))
        .cloned()
        .collect();
    if removable.is_empty() {
        latest.tracked_profiles.remove(profile_id);
        latest.record(
            &profile.id,
            &profile.title,
            "remove",
            "success",
            "No recorded direct packages remain installed.",
            vec![],
        );
        latest.save()?;
        return Ok(OperationResult {
            success: true,
            status: "success".into(),
            message:
                "No recorded direct packages remain installed. The ownership record was cleared."
                    .into(),
            packages: vec![],
        });
    }

    emit_progress(
        app,
        &profile.id,
        "remove",
        "Removing only the saved direct package list. No purge or autoremove will run.",
    );
    let outcome =
        run_privileged(&package_args("remove", &removable)).map_err(apt::AptFailure::from);
    let after = locking::ensure_no_active_package_manager()
        .and_then(|()| apt::retry_inventory(installed_packages));
    let reconciliation = apt::reconcile_remove(&removable, after, outcome);
    if reconciliation.inventory_available {
        if let Some(entry) = latest.tracked_profiles.get_mut(profile_id) {
            entry
                .owned_packages
                .retain(|name| reconciliation.still_present.contains(name));
        }
        if latest
            .tracked_profiles
            .get(profile_id)
            .is_some_and(|entry| entry.owned_packages.is_empty())
        {
            latest.tracked_profiles.remove(profile_id);
        }
    }
    latest.record(
        &profile.id,
        &profile.title,
        "remove",
        &reconciliation.status,
        &reconciliation.message,
        if reconciliation.removed.is_empty() {
            reconciliation.still_present.clone()
        } else {
            reconciliation.removed.clone()
        },
    );
    latest.save()?;
    emit_progress(
        app,
        &profile.id,
        "complete",
        if reconciliation.success {
            "Profile removal finished."
        } else {
            "Profile removal needs review or reconciliation."
        },
    );
    Ok(OperationResult {
        success: reconciliation.success,
        status: reconciliation.status,
        message: reconciliation.message,
        packages: reconciliation.removed,
    })
}

fn validate_owned_packages(
    profile: &ProfileDefinition,
    tracked: &OwnedProfile,
) -> Result<(), String> {
    let allowed: HashSet<&str> = profile
        .packages
        .iter()
        .map(|package| package.name.as_str())
        .collect();
    let mut seen = HashSet::new();
    for package in &tracked.owned_packages {
        profiles::validate_package_name(package, profile.extension)?;
        if !allowed.contains(package.as_str()) {
            return Err(format!(
                "Ownership data contains '{package}', which is not in the current validated profile. No packages were removed."
            ));
        }
        if !seen.insert(package.as_str()) {
            return Err(format!(
                "Ownership data contains duplicate package '{package}'. No packages were removed."
            ));
        }
    }
    Ok(())
}

fn profile_to_manifest(profile: &ProfileDefinition) -> ExtensionManifest {
    ExtensionManifest {
        schema_version: 1,
        id: profile.id.clone(),
        title: profile.title.clone(),
        description: profile.summary.clone(),
        category: profile.category.clone(),
        packages: profile
            .packages
            .iter()
            .map(|p| profiles::ExtensionPackage {
                name: p.name.clone(),
                reason: p.reason.clone(),
            })
            .collect(),
    }
}

fn find_profile(profile_id: &str) -> Result<ProfileDefinition, String> {
    profiles::load_profiles()
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "That profile was not found or is no longer available.".to_string())
}

fn package_args(action: &str, packages: &[String]) -> Vec<String> {
    let mut args = vec![
        action.to_string(),
        "-y".into(),
        "-o".into(),
        "Dpkg::Options::=--force-confdef".into(),
        "-o".into(),
        "Dpkg::Options::=--force-confold".into(),
    ];
    if action == "install" {
        args.push("--no-install-recommends".into());
    }
    args.push("--".into());
    args.extend(packages.iter().cloned());
    args
}

#[derive(Debug)]
struct CommandFailure {
    status: String,
    message: String,
}

fn run_privileged(args: &[String]) -> Result<(), CommandFailure> {
    let pkexec = ["/usr/bin/pkexec", "/bin/pkexec"]
        .iter()
        .find(|path| Path::new(path).exists())
        .ok_or_else(|| CommandFailure {
            status: "failed".into(),
            message: "pkexec was not found; system authorization is unavailable.".into(),
        })?;
    if !Path::new(APT_GET).exists() {
        return Err(CommandFailure {
            status: "failed".into(),
            message: "APT was not found at /usr/bin/apt-get.".into(),
        });
    }
    let mut command = Command::new(pkexec);
    command.arg(APT_GET).args(args);
    let output = command.output().map_err(|e| CommandFailure {
        status: "failed".into(),
        message: format!("Could not start the system authorization prompt: {e}"),
    })?;
    if output.status.success() {
        return Ok(());
    }
    Err(classify_failure(&output))
}

fn classify_failure(output: &Output) -> CommandFailure {
    classify_failure_parts(
        output.status.code(),
        &String::from_utf8_lossy(&output.stderr),
        &String::from_utf8_lossy(&output.stdout),
    )
}

fn classify_failure_parts(code: Option<i32>, stderr: &str, stdout: &str) -> CommandFailure {
    let stderr_lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let last_stderr = stderr_lines.last().copied();
    let last_stdout = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty());
    let (details, dependency_error) = if let Some(last) = last_stderr {
        let lower = last.to_ascii_lowercase();
        let dependency_error = [
            "unable to correct problems",
            "held broken packages",
            "unmet dependencies",
        ]
        .iter()
        .any(|phrase| lower.contains(phrase));
        if dependency_error {
            let mut context: Vec<&str> = stderr_lines.iter().rev().take(5).rev().copied().collect();
            if context.len() == 1 {
                let stdout_context: Vec<&str> = stdout
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .rev()
                    .take(4)
                    .collect();
                context = stdout_context.into_iter().rev().collect();
                context.push(last);
            }
            (context.join(" | "), true)
        } else {
            (last.to_string(), false)
        }
    } else {
        (
            last_stdout
                .unwrap_or("The package manager returned an error.")
                .to_string(),
            false,
        )
    };
    if matches!(code, Some(126 | 127)) {
        CommandFailure {
            status: "cancelled".into(),
            message: "System authorization was declined or unavailable. No success was recorded."
                .into(),
        }
    } else {
        CommandFailure {
            status: "failed".into(),
            message: format!(
                "APT exited with {}: {}{}",
                code.map(|x| x.to_string())
                    .unwrap_or_else(|| "a signal".into()),
                details.chars().take(600).collect::<String>(),
                if dependency_error {
                    " — Review the package-specific dependency details, resolve the conflict or held-package state with your system package manager, then retry. DevStart does not run repair commands automatically."
                } else {
                    ""
                }
            ),
        }
    }
}

fn installed_packages() -> Result<HashSet<String>, String> {
    if !Path::new(DPKG_QUERY).exists() {
        return Err("dpkg-query was not found; installed-state checks are unavailable.".into());
    }
    let output = Command::new(DPKG_QUERY)
        .args(["-W", "-f=${Package}\\t${db:Status-Abbrev}\\n"])
        .output()
        .map_err(|e| format!("Could not query the installed package database: {e}"))?;
    if !output.status.success() {
        return Err("dpkg-query could not read the local package database.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(parse_installed_packages(&text))
}

fn parse_installed_packages(text: &str) -> HashSet<String> {
    text.lines()
        .filter_map(|line| {
            let (name, status) = line.split_once('\t')?;
            status.trim().starts_with("ii").then(|| name.to_string())
        })
        .collect()
}

fn system_status() -> SystemStatus {
    let values = fs::read_to_string("/etc/os-release")
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            Some((key.to_string(), value.trim().trim_matches('"').to_string()))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let name = values
        .get("NAME")
        .cloned()
        .unwrap_or_else(|| "Linux".into());
    let id = values
        .get("ID")
        .cloned()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let version = values
        .get("VERSION_ID")
        .cloned()
        .unwrap_or_else(|| "unknown".into());
    let architecture = std::env::consts::ARCH.to_string();
    let base_supported =
        (id == "zorin" && version.starts_with("18")) || (id == "ubuntu" && version == "24.04");
    let supported = base_supported && architecture == "x86_64";
    SystemStatus {
        distro: name,
        version,
        architecture,
        supported,
        apt_available: Path::new(APT_GET).exists(),
        polkit_available: Path::new("/usr/bin/pkexec").exists()
            || Path::new("/bin/pkexec").exists(),
        native: true,
    }
}

fn ensure_supported(system: &SystemStatus) -> Result<(), String> {
    if !system.supported {
        return Err(format!(
            "This setup targets Zorin OS 18.x or Ubuntu 24.04 LTS on x86_64. Detected {} {} ({})",
            system.distro, system.version, system.architecture
        ));
    }
    if !system.apt_available {
        return Err("APT is not available on this system.".into());
    }
    if !system.polkit_available {
        return Err("The system's polkit authorization tool (pkexec) is not available.".into());
    }
    Ok(())
}

fn emit_progress(app: &AppHandle, profile_id: &str, stage: &str, message: &str) {
    let _ = app.emit(
        "devstart-progress",
        ProgressEvent {
            profile_id: profile_id.into(),
            stage: stage.into(),
            message: message.into(),
        },
    );
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            prepare_reconciliation,
            confirm_reconciliation,
            dismiss_reconciliation,
            install_profile,
            uninstall_profile,
            add_extension,
            remove_extension,
            open_config_folder,
            open_release_url,
            is_appimage_runtime
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zorin DevStart");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apt_argument_builder_uses_separate_package_arguments() {
        let args = package_args("install", &["python3".into(), "git".into()]);
        assert_eq!(
            args,
            vec![
                "install",
                "-y",
                "-o",
                "Dpkg::Options::=--force-confdef",
                "-o",
                "Dpkg::Options::=--force-confold",
                "--no-install-recommends",
                "--",
                "python3",
                "git"
            ]
        );
        let remove = package_args("remove", &["git".into()]);
        assert_eq!(
            remove,
            vec![
                "remove",
                "-y",
                "-o",
                "Dpkg::Options::=--force-confdef",
                "-o",
                "Dpkg::Options::=--force-confold",
                "--",
                "git"
            ]
        );
        assert!(!remove.contains(&"purge".into()));
        assert!(!remove.contains(&"autoremove".into()));
    }

    #[test]
    fn release_detection_only_accepts_zorin_18_or_ubuntu_2404_x64() {
        let status = SystemStatus {
            distro: "Zorin OS".into(),
            version: "18.1".into(),
            architecture: "x86_64".into(),
            supported: true,
            apt_available: true,
            polkit_available: true,
            native: true,
        };
        assert!(ensure_supported(&status).is_ok());
        let wrong = SystemStatus {
            distro: "Fedora".into(),
            version: "42".into(),
            supported: false,
            ..status
        };
        assert!(ensure_supported(&wrong).is_err());
    }

    #[test]
    fn overlapping_mutations_are_rejected_without_waiting() {
        let first = acquire_mutation_lock().expect("first mutation should acquire the lock");
        let second = acquire_mutation_lock().expect_err("overlapping mutation must be rejected");
        assert!(second.contains("already in progress"));
        drop(first);
        assert!(acquire_mutation_lock().is_ok());
    }

    #[test]
    fn uninstall_ownership_must_be_a_subset_of_the_current_profile() {
        let profile = profiles::builtin_profiles()
            .into_iter()
            .find(|profile| profile.id == "rust")
            .expect("Rust profile exists");
        let valid = OwnedProfile {
            installed_at: "test-time".into(),
            owned_packages: vec!["cargo".into(), "rustc".into()],
        };
        assert!(validate_owned_packages(&profile, &valid).is_ok());

        let tampered = OwnedProfile {
            installed_at: "test-time".into(),
            owned_packages: vec!["cargo".into(), "curl".into()],
        };
        assert!(validate_owned_packages(&profile, &tampered)
            .unwrap_err()
            .contains("not in the current validated profile"));
    }

    #[test]
    fn installed_package_parser_accepts_only_installed_status_lines() {
        let packages = parse_installed_packages(
            "python3\tii  \npython3-venv\tui  \nmalformed\nlibc6:amd64\tii  \n",
        );

        assert_eq!(
            packages,
            HashSet::from(["python3".into(), "libc6:amd64".into()])
        );
    }

    #[test]
    fn installed_package_parser_handles_empty_and_malformed_output() {
        assert!(parse_installed_packages("").is_empty());
        assert!(parse_installed_packages("garbage without a tab\n\t\n").is_empty());
    }

    #[test]
    fn authorization_exit_codes_are_classified_as_cancelled() {
        for code in [Some(126), Some(127)] {
            let failure = classify_failure_parts(code, "authorization denied", "");
            assert_eq!(failure.status, "cancelled");
            assert!(failure.message.contains("No success was recorded"));
        }
    }

    #[test]
    fn apt_failure_prefers_last_non_empty_stderr_line_and_truncates_details() {
        let long_line = "x".repeat(400);
        let failure = classify_failure_parts(Some(100), "first\n\nsecond", &long_line);
        assert_eq!(failure.status, "failed");
        assert!(failure.message.starts_with("APT exited with 100: second"));
        assert!(failure.message.len() < 280);
    }

    #[test]
    fn apt_dependency_failure_keeps_package_specific_resolver_context() {
        let failure = classify_failure_parts(
            Some(100),
            "The following packages have unmet dependencies:\nnodejs : Depends: libnode-dev (= 18.19.1+dfsg-6ubuntu5) but it is not going to be installed\nE: Unable to correct problems, you have held broken packages.",
            "",
        );

        assert!(failure.message.contains("nodejs : Depends: libnode-dev"));
        assert!(failure.message.contains("held broken packages"));
        assert!(failure
            .message
            .contains("does not run repair commands automatically"));
    }

    #[test]
    fn apt_signal_failure_uses_signal_word_when_exit_code_is_missing() {
        let failure = classify_failure_parts(None, "terminated", "");
        assert_eq!(failure.status, "failed");
        assert!(failure.message.contains("APT exited with a signal"));
    }

    #[test]
    fn reconciliation_preview_is_ready_for_only_expected_package_additions() {
        let plan = PendingReconciliation {
            id: "plan-1".into(),
            profile_id: "web".into(),
            profile_title: "Web development".into(),
            packages: vec!["nodejs".into(), "npm".into()],
            before_packages: vec!["git".into()],
            plan_digest: String::new(),
            reason: "inventory unavailable".into(),
            created_at: "test-time".into(),
        };
        let preview = reconciliation_preview(
            &plan,
            &HashSet::from(["git".into(), "nodejs".into(), "npm".into()]),
        );
        assert!(preview.ready);
        assert!(preview.missing_packages.is_empty());
        assert!(preview.unexpected_changes.is_empty());
    }

    #[test]
    fn reconciliation_preview_rejects_missing_candidate_packages() {
        let plan = PendingReconciliation {
            id: "plan-2".into(),
            profile_id: "python".into(),
            profile_title: "Python".into(),
            packages: vec!["python3".into(), "pipx".into()],
            before_packages: vec!["git".into()],
            plan_digest: String::new(),
            reason: "inventory unavailable".into(),
            created_at: "test-time".into(),
        };
        let preview =
            reconciliation_preview(&plan, &HashSet::from(["git".into(), "python3".into()]));
        assert!(!preview.ready);
        assert_eq!(preview.missing_packages, vec!["pipx"]);
        assert!(preview.message.contains("still missing"));
    }

    #[test]
    fn reconciliation_preview_rejects_unexpected_device_changes() {
        let plan = PendingReconciliation {
            id: "plan-3".into(),
            profile_id: "rust".into(),
            profile_title: "Rust".into(),
            packages: vec!["cargo".into()],
            before_packages: vec!["git".into()],
            plan_digest: String::new(),
            reason: "inventory unavailable".into(),
            created_at: "test-time".into(),
        };
        let preview = reconciliation_preview(
            &plan,
            &HashSet::from(["cargo".into(), "git".into(), "curl".into()]),
        );
        assert!(!preview.ready);
        assert_eq!(preview.unexpected_changes, vec!["added:curl"]);
        assert!(preview.message.contains("device changed after this plan"));
    }
}
