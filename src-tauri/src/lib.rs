mod profiles;
mod store;

use chrono::Utc;
use profiles::{ExtensionManifest, ProfileDefinition};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::Path,
    process::{Command, Output},
    sync::{Mutex, MutexGuard, TryLockError},
};
use store::{OperationRecord, OwnedProfile, Store};
use tauri::{AppHandle, Emitter};

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
    config_directory: String,
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

#[tauri::command]
fn get_app_state() -> Result<AppState, String> {
    let system = system_status();
    let installed = if Path::new(DPKG_QUERY).exists() {
        installed_packages()?
    } else {
        HashSet::new()
    };
    let profiles = profiles::profile_views(profiles::load_profiles(), &installed);
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
        config_directory,
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
    let target = folder.join(format!("{}.json", profile.id));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                "An extension with that ID already exists.".into()
            } else {
                format!("Could not create the extension: {e}")
            }
        })?;
    file.write_all(
        serde_json::to_string_pretty(&profile_to_manifest(&profile))
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| format!("Could not write the extension: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Could not save the extension: {e}"))?;
    Ok(format!(
        "{} was validated and added to this device.",
        profile.title
    ))
}

#[tauri::command]
fn remove_extension(profile_id: String) -> Result<String, String> {
    let _operation_guard = acquire_mutation_lock()?;
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

fn install_profile_inner(app: &AppHandle, profile_id: &str) -> Result<OperationResult, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let system = system_status();
    ensure_supported(&system)?;
    let profile = find_profile(profile_id)?;
    for package in &profile.packages {
        profiles::validate_package_name(&package.name, profile.extension)?;
    }
    let mut saved = Store::load()?;
    let before = installed_packages()?;
    let new_packages: Vec<String> = profile
        .packages
        .iter()
        .filter(|p| !before.contains(&p.name))
        .map(|p| p.name.clone())
        .collect();
    if new_packages.is_empty() {
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

    emit_progress(
        app,
        &profile.id,
        "install",
        "Installing the reviewed profile packages through APT.",
    );
    let args = package_args("install", &new_packages);
    let outcome = run_privileged(&args);
    let after = installed_packages()?;
    let newly_present: Vec<String> = new_packages
        .iter()
        .filter(|name| !before.contains(*name) && after.contains(*name))
        .cloned()
        .collect();
    if !newly_present.is_empty() {
        let entry = saved
            .tracked_profiles
            .entry(profile.id.clone())
            .or_insert_with(|| OwnedProfile {
                installed_at: Utc::now().to_rfc3339(),
                owned_packages: vec![],
            });
        for name in &newly_present {
            if !entry.owned_packages.contains(name) {
                entry.owned_packages.push(name.clone());
            }
        }
    }

    let (success, status, message) = match outcome {
        Ok(()) => (
            true,
            "success".to_string(),
            format!(
                "{} setup is ready. DevStart recorded {} newly installed direct package(s).",
                profile.title,
                newly_present.len()
            ),
        ),
        Err(failure) if !newly_present.is_empty() => (
            false,
            "partial".to_string(),
            format!(
                "APT did not finish, but {} requested package(s) were installed and recorded: {}",
                newly_present.len(),
                failure.message
            ),
        ),
        Err(failure) => (false, failure.status, failure.message),
    };
    saved.record(
        &profile.id,
        &profile.title,
        "install",
        &status,
        &message,
        newly_present.clone(),
    );
    saved.save()?;
    emit_progress(
        app,
        &profile.id,
        "complete",
        if success {
            "Profile setup finished."
        } else {
            "Profile setup did not finish; review the result."
        },
    );
    Ok(OperationResult {
        success,
        status,
        message,
        packages: newly_present,
    })
}

fn uninstall_profile_inner(app: &AppHandle, profile_id: &str) -> Result<OperationResult, String> {
    let _operation_guard = acquire_mutation_lock()?;
    let system = system_status();
    ensure_supported(&system)?;
    let profile = find_profile(profile_id)?;
    let mut saved = Store::load()?;
    let Some(tracked) = saved.tracked_profiles.get(profile_id).cloned() else {
        return Err("DevStart has no package ownership record for this profile.".into());
    };
    validate_owned_packages(&profile, &tracked)?;
    let installed = installed_packages()?;
    let removable: Vec<String> = tracked
        .owned_packages
        .iter()
        .filter(|name| installed.contains(*name))
        .cloned()
        .collect();
    if removable.is_empty() {
        saved.tracked_profiles.remove(profile_id);
        saved.record(
            &profile.id,
            &profile.title,
            "remove",
            "success",
            "No recorded direct packages remain installed.",
            vec![],
        );
        saved.save()?;
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
    let outcome = run_privileged(&package_args("remove", &removable));
    let after = installed_packages()?;
    let still_present: Vec<String> = removable
        .iter()
        .filter(|name| after.contains(*name))
        .cloned()
        .collect();
    let removed: Vec<String> = removable
        .iter()
        .filter(|name| !after.contains(*name))
        .cloned()
        .collect();
    if let Some(entry) = saved.tracked_profiles.get_mut(profile_id) {
        entry.owned_packages.retain(|name| after.contains(name));
    }
    if saved
        .tracked_profiles
        .get(profile_id)
        .is_some_and(|entry| entry.owned_packages.is_empty())
    {
        saved.tracked_profiles.remove(profile_id);
    }
    let (success, status, message) = match outcome {
        Ok(()) if still_present.is_empty() => (true, "success".to_string(), format!("Removed {} DevStart-tracked direct package(s). User files and shared dependencies were not touched.", removed.len())),
        Ok(()) => (false, "partial".to_string(), format!("APT completed, but {} tracked package(s) remain installed and are still recorded.", still_present.len())),
        Err(failure) if !removed.is_empty() => (false, "partial".to_string(), format!("Some packages were removed, but APT stopped: {}", failure.message)),
        Err(failure) => (false, failure.status, failure.message),
    };
    saved.record(
        &profile.id,
        &profile.title,
        "remove",
        &status,
        &message,
        if removed.is_empty() {
            still_present
        } else {
            removed.clone()
        },
    );
    saved.save()?;
    emit_progress(
        app,
        &profile.id,
        "complete",
        if success {
            "Profile removal finished."
        } else {
            "Profile removal did not finish; review the result."
        },
    );
    Ok(OperationResult {
        success,
        status,
        message,
        packages: removed,
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
    let code = output.status.code();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let details = stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .or_else(|| stdout.lines().rev().find(|line| !line.trim().is_empty()))
        .unwrap_or("The package manager returned an error.");
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
                "APT exited with {}: {}",
                code.map(|x| x.to_string())
                    .unwrap_or_else(|| "a signal".into()),
                details.chars().take(250).collect::<String>()
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
    Ok(text
        .lines()
        .filter_map(|line| {
            let (name, status) = line.split_once('\t')?;
            status.trim().starts_with("ii").then(|| name.to_string())
        })
        .collect())
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
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            install_profile,
            uninstall_profile,
            add_extension,
            remove_extension,
            open_config_folder
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
}
