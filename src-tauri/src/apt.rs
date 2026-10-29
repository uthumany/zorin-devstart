use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AptFailure {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallReconciliation {
    pub success: bool,
    pub status: String,
    pub message: String,
    pub newly_present: Vec<String>,
    pub inventory_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoveReconciliation {
    pub success: bool,
    pub status: String,
    pub message: String,
    pub removed: Vec<String>,
    pub still_present: Vec<String>,
    pub inventory_available: bool,
}

fn unique_names(names: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    names
        .iter()
        .filter(|name| seen.insert((*name).clone()))
        .cloned()
        .collect()
}

pub fn reconcile_install(
    profile_title: &str,
    before: &HashSet<String>,
    requested: &[String],
    after: Result<HashSet<String>, String>,
    outcome: Result<(), AptFailure>,
) -> InstallReconciliation {
    let requested = unique_names(requested);
    let Ok(after) = after else {
        let inventory_error = after.expect_err("inventory result was checked above");
        return InstallReconciliation {
            success: false,
            status: "reconciliation-required".into(),
            message: format!(
                "APT completed or failed, but DevStart could not verify installed packages: {inventory_error}. Reconciliation is required before ownership can be recorded."
            ),
            newly_present: vec![],
            inventory_available: false,
        };
    };

    let missing_before: Vec<String> = requested
        .iter()
        .filter(|name| !before.contains(*name))
        .cloned()
        .collect();
    let newly_present: Vec<String> = missing_before
        .iter()
        .filter(|name| after.contains(*name))
        .cloned()
        .collect();
    let all_requested_present = newly_present.len() == missing_before.len();

    match outcome {
        Ok(()) if all_requested_present => InstallReconciliation {
            success: true,
            status: "success".into(),
            message: format!(
                "{profile_title} setup is ready. DevStart recorded {} newly installed direct package(s).",
                newly_present.len()
            ),
            newly_present,
            inventory_available: true,
        },
        Ok(()) => InstallReconciliation {
            success: false,
            status: "reconciliation-required".into(),
            message: format!(
                "APT reported success, but DevStart could verify only {} of {} requested direct package(s). Review and reconcile the installation before retrying.",
                newly_present.len(),
                missing_before.len()
            ),
            newly_present,
            inventory_available: true,
        },
        Err(failure) if !newly_present.is_empty() => InstallReconciliation {
            success: false,
            status: "partial".into(),
            message: format!(
                "APT did not finish, but {} requested package(s) were installed and recorded: {}",
                newly_present.len(),
                failure.message
            ),
            newly_present,
            inventory_available: true,
        },
        Err(failure) => InstallReconciliation {
            success: false,
            status: failure.status,
            message: failure.message,
            newly_present,
            inventory_available: true,
        },
    }
}

pub fn reconcile_remove(
    requested: &[String],
    after: Result<HashSet<String>, String>,
    outcome: Result<(), AptFailure>,
) -> RemoveReconciliation {
    let requested = unique_names(requested);
    let Ok(after) = after else {
        let inventory_error = after.expect_err("inventory result was checked above");
        return RemoveReconciliation {
            success: false,
            status: "reconciliation-required".into(),
            message: format!(
                "APT completed or failed, but DevStart could not verify removed packages: {inventory_error}. Ownership was preserved and reconciliation is required."
            ),
            removed: vec![],
            still_present: vec![],
            inventory_available: false,
        };
    };

    let still_present: Vec<String> = requested
        .iter()
        .filter(|name| after.contains(*name))
        .cloned()
        .collect();
    let removed: Vec<String> = requested
        .iter()
        .filter(|name| !after.contains(*name))
        .cloned()
        .collect();

    match outcome {
        Ok(()) if still_present.is_empty() => RemoveReconciliation {
            success: true,
            status: "success".into(),
            message: format!(
                "Removed {} DevStart-tracked direct package(s). User files and shared dependencies were not touched.",
                removed.len()
            ),
            removed,
            still_present,
            inventory_available: true,
        },
        Ok(()) => RemoveReconciliation {
            success: false,
            status: "partial".into(),
            message: format!(
                "APT completed, but {} tracked package(s) remain installed and are still recorded.",
                still_present.len()
            ),
            removed,
            still_present,
            inventory_available: true,
        },
        Err(failure) if !removed.is_empty() => RemoveReconciliation {
            success: false,
            status: "partial".into(),
            message: format!(
                "Some packages were removed, but APT stopped: {}",
                failure.message
            ),
            removed,
            still_present,
            inventory_available: true,
        },
        Err(failure) => RemoveReconciliation {
            success: false,
            status: failure.status,
            message: failure.message,
            removed,
            still_present,
            inventory_available: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| (*name).into()).collect()
    }

    fn failure(status: &str) -> AptFailure {
        AptFailure {
            status: status.into(),
            message: format!("{status} details"),
        }
    }

    #[test]
    fn install_success_records_only_direct_packages_absent_before() {
        let result = reconcile_install(
            "Python",
            &set(&["git"]),
            &["python3".into(), "git".into(), "python3-venv".into()],
            Ok(set(&["git", "python3", "python3-venv"])),
            Ok(()),
        );

        assert_eq!(result.status, "success");
        assert!(result.success);
        assert_eq!(result.newly_present, vec!["python3", "python3-venv"]);
    }

    #[test]
    fn install_deduplicates_requested_packages() {
        let result = reconcile_install(
            "Test",
            &HashSet::new(),
            &["git".into(), "git".into()],
            Ok(set(&["git"])),
            Ok(()),
        );

        assert!(result.success);
        assert_eq!(result.newly_present, vec!["git"]);
    }

    #[test]
    fn install_failure_with_some_packages_present_is_partial() {
        let result = reconcile_install(
            "Rust",
            &HashSet::new(),
            &["cargo".into(), "rustc".into()],
            Ok(set(&["cargo"])),
            Err(failure("failed")),
        );

        assert_eq!(result.status, "partial");
        assert!(!result.success);
        assert_eq!(result.newly_present, vec!["cargo"]);
    }

    #[test]
    fn install_cancellation_with_no_packages_preserves_cancelled_status() {
        let result = reconcile_install(
            "Java",
            &HashSet::new(),
            &["default-jdk".into()],
            Ok(HashSet::new()),
            Err(failure("cancelled")),
        );

        assert_eq!(result.status, "cancelled");
        assert!(!result.success);
        assert!(result.newly_present.is_empty());
    }

    #[test]
    fn install_inventory_failure_requires_reconciliation_without_claiming_ownership() {
        let result = reconcile_install(
            "Web",
            &HashSet::new(),
            &["nodejs".into(), "npm".into()],
            Err("dpkg-query failed".into()),
            Ok(()),
        );

        assert_eq!(result.status, "reconciliation-required");
        assert!(!result.success);
        assert!(!result.inventory_available);
        assert!(result.newly_present.is_empty());
        assert!(result.message.contains("dpkg-query failed"));
    }

    #[test]
    fn install_success_with_missing_inventory_entries_is_not_reported_as_ready() {
        let result = reconcile_install(
            "C / C++",
            &HashSet::new(),
            &["build-essential".into(), "cmake".into()],
            Ok(set(&["build-essential"])),
            Ok(()),
        );

        assert_eq!(result.status, "reconciliation-required");
        assert!(!result.success);
        assert_eq!(result.newly_present, vec!["build-essential"]);
    }

    #[test]
    fn remove_success_reports_all_removed_packages() {
        let result = reconcile_remove(
            &["cargo".into(), "rustc".into()],
            Ok(HashSet::new()),
            Ok(()),
        );

        assert_eq!(result.status, "success");
        assert!(result.success);
        assert_eq!(result.removed, vec!["cargo", "rustc"]);
        assert!(result.still_present.is_empty());
    }

    #[test]
    fn remove_failure_with_some_packages_removed_is_partial() {
        let result = reconcile_remove(
            &["cargo".into(), "rustc".into()],
            Ok(set(&["rustc"])),
            Err(failure("failed")),
        );

        assert_eq!(result.status, "partial");
        assert!(!result.success);
        assert_eq!(result.removed, vec!["cargo"]);
        assert_eq!(result.still_present, vec!["rustc"]);
    }

    #[test]
    fn remove_inventory_failure_preserves_ownership_state() {
        let result = reconcile_remove(&["cargo".into()], Err("dpkg-query failed".into()), Ok(()));

        assert_eq!(result.status, "reconciliation-required");
        assert!(!result.success);
        assert!(!result.inventory_available);
        assert!(result.removed.is_empty());
        assert!(result.still_present.is_empty());
    }

    #[test]
    fn remove_success_with_remaining_package_is_partial() {
        let result = reconcile_remove(
            &["cargo".into(), "rustc".into()],
            Ok(set(&["rustc"])),
            Ok(()),
        );

        assert_eq!(result.status, "partial");
        assert_eq!(result.removed, vec!["cargo"]);
        assert_eq!(result.still_present, vec!["rustc"]);
    }
}
